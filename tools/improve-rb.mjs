#!/usr/bin/env node
/**
 * Aggregates the per-country `public/rb-analysis-<CC>.json` verdict
 * files and `data/stations.yaml` into "RB-improvement" reports — the
 * data shape we'd hand Radio Browser if the project linked databases.
 *
 *   npm run improve-rb           # all countries we have analysis for
 *
 * Output (committed, served by Pages):
 *   public/rb-improvements-<CC>.json   # per country
 *   public/rb-improvements-summary.json  # cross-country signals
 *
 * Four signals are emitted today (Phase 1, no probes):
 *
 *   1. deadStreams[]     — verdict ∈ {broken-network, broken-format};
 *                          RB cleanup signal.
 *   2. internalDupes[]   — RB's own duplicateOf clusters (canonical +
 *                          variants), with which fields actually differ.
 *   3. metadataAPIs[]    — stations from data/stations.yaml that have a
 *                          known metadataUrl (RB has no field for this).
 *   4. crossCountryDupes — stationuuid appearing under multiple country
 *                          codes; review-required (in summary only).
 *
 * `httpsVariants[]` is wired in the per-country shape but always empty
 * here — Phase 2 will populate it via tools/probe-https-variants.mjs
 * (a separate, slow probe pass).
 *
 * Read-only on the network side. Cheap to run repeatedly.
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = dirname(__dirname);
const ANALYSIS_DIR = join(ROOT, 'public');

const FILE_RE = /^rb-analysis-([A-Z]{2})\.json$/;

// ─────────────────────────────────────────────────────────────
// Pure-function signal computation (exported for tests)
// ─────────────────────────────────────────────────────────────

/** Stations with a verdict that says "this stream isn't recoverable" —
 *  RB's cleanup queue. Sorted by votes desc so the most-listened-to
 *  dead stations surface first. */
export function computeDeadStreams(analysis) {
  const dead = (analysis.stations || []).filter(
    (s) => s.verdict === 'broken-network' || s.verdict === 'broken-format',
  );
  dead.sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0));
  return dead.map((s) => ({
    stationuuid: s.stationuuid,
    name: s.name,
    url: s.streamUrl,
    verdict: s.verdict,
    verdictReason: s.verdictReason,
    votes: s.votes ?? 0,
    lastProbedAt: s.probedAt,
  }));
}

const COMPARED_FIELDS = ['name', 'streamUrl', 'bitrate', 'codec'];
const FIELD_ALIAS = { streamUrl: 'url' };

/** Roll up RB's `duplicateOf` chains into clusters: one canonical
 *  station + N variants pointing at it. `differs[]` lists which
 *  fields actually changed across the cluster — useful for showing
 *  RB which dupes are pure (same URL twice, just different uuid)
 *  vs meaningful (different bitrate / codec / mirror). */
export function computeInternalDupes(analysis) {
  const stations = analysis.stations || [];
  const byUuid = new Map();
  for (const s of stations) byUuid.set(s.stationuuid, s);

  const clusters = new Map();
  for (const s of stations) {
    if (!s.duplicateOf) continue;
    if (!byUuid.has(s.duplicateOf)) continue;
    if (!clusters.has(s.duplicateOf)) clusters.set(s.duplicateOf, []);
    clusters.get(s.duplicateOf).push(s);
  }

  const out = [];
  for (const [canonicalUuid, variants] of clusters) {
    const canonical = byUuid.get(canonicalUuid);
    out.push({
      canonical: {
        stationuuid: canonical.stationuuid,
        name: canonical.name,
        url: canonical.streamUrl,
        votes: canonical.votes ?? 0,
      },
      variants: variants
        .sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0))
        .map((v) => {
          const differs = [];
          for (const f of COMPARED_FIELDS) {
            if (v[f] !== canonical[f]) differs.push(FIELD_ALIAS[f] ?? f);
          }
          return {
            stationuuid: v.stationuuid,
            name: v.name,
            url: v.streamUrl,
            votes: v.votes ?? 0,
            differs,
          };
        }),
    });
  }
  out.sort((a, b) => b.canonical.votes - a.canonical.votes);
  return out;
}

/** Walk the curated YAML and extract per-station metadata-API
 *  endpoints scoped to one country. RB has no metadataUrl field —
 *  this is data we have that they don't, so it's the most directly
 *  useful contribution if/when a DB-link conversation happens. */
export function computeMetadataAPIs(country, stationsYaml, broadcastersYaml) {
  // broadcasters can be a top-level object keyed by id (current shape)
  // or an array of {id, ...}. Normalize to a Map.
  const broadcasters = new Map();
  if (Array.isArray(broadcastersYaml)) {
    for (const b of broadcastersYaml) broadcasters.set(b.id ?? b.key, b);
  } else if (broadcastersYaml && typeof broadcastersYaml === 'object') {
    for (const [k, v] of Object.entries(broadcastersYaml)) broadcasters.set(k, v);
  }

  const out = [];
  for (const s of stationsYaml || []) {
    if (!s.stationuuid) continue;
    const broadcaster = broadcasters.get(s.broadcaster);
    const cc = s.country ?? broadcaster?.country;
    if (cc !== country) continue;
    const metadataUrl = s.metadataUrl ?? broadcaster?.metadataUrl;
    if (!metadataUrl) continue;
    out.push({
      stationuuid: s.stationuuid,
      name: s.name,
      broadcasterKey: s.broadcaster,
      metadataUrl,
    });
  }
  return out;
}

/** Same stationuuid appearing in multiple country files — RB's
 *  metadata error or a station legitimately broadcasting cross-border.
 *  We don't try to resolve which country "owns" it; just surface them
 *  for human review with a `primaryGuess` based on votes. */
export function computeCrossCountryDupes(allAnalysisByCc) {
  const occurrences = new Map(); // uuid → [{ cc, name, votes }]
  for (const [cc, data] of Object.entries(allAnalysisByCc)) {
    for (const s of data.stations || []) {
      if (!s.stationuuid) continue;
      if (!occurrences.has(s.stationuuid)) occurrences.set(s.stationuuid, []);
      occurrences.get(s.stationuuid).push({
        cc,
        name: s.name,
        votes: s.votes ?? 0,
      });
    }
  }

  const out = [];
  for (const [uuid, occs] of occurrences) {
    if (occs.length < 2) continue;
    const sorted = [...occs].sort((a, b) => b.votes - a.votes);
    out.push({
      stationuuid: uuid,
      name: sorted[0].name,
      listedIn: occs.map((o) => o.cc).sort(),
      primaryGuess: sorted[0].cc,
      reason: 'review-required',
    });
  }
  out.sort((a, b) => a.stationuuid.localeCompare(b.stationuuid));
  return out;
}

// ─────────────────────────────────────────────────────────────
// CLI / main
// ─────────────────────────────────────────────────────────────

function loadAllAnalysis() {
  const out = {};
  for (const f of readdirSync(ANALYSIS_DIR)) {
    const m = f.match(FILE_RE);
    if (!m) continue;
    out[m[1]] = JSON.parse(readFileSync(join(ANALYSIS_DIR, f), 'utf8'));
  }
  return out;
}

function main() {
  const allAnalysis = loadAllAnalysis();
  const countries = Object.keys(allAnalysis).sort();

  if (countries.length === 0) {
    console.error('improve-rb: no public/rb-analysis-*.json files found.');
    console.error('Run `node tools/analyze-rb.mjs <CC>` first.');
    process.exit(1);
  }

  const stationsYaml = parseYaml(readFileSync(join(ROOT, 'data', 'stations.yaml'), 'utf8'));
  const broadcastersYaml = parseYaml(
    readFileSync(join(ROOT, 'data', 'broadcasters.yaml'), 'utf8'),
  );

  const perCountry = {};

  for (const cc of countries) {
    const analysis = allAnalysis[cc];
    const deadStreams = computeDeadStreams(analysis);
    const internalDupes = computeInternalDupes(analysis);
    const metadataAPIs = computeMetadataAPIs(cc, stationsYaml, broadcastersYaml);

    const out = {
      generatedAt: new Date().toISOString(),
      country: cc,
      sourceProbedAt: analysis.generatedAt,
      totals: {
        deadStreams: deadStreams.length,
        internalDupes: internalDupes.length,
        metadataAPIs: metadataAPIs.length,
        httpsVariants: 0,
      },
      deadStreams,
      internalDupes,
      metadataAPIs,
      // Phase 2 will populate this via tools/probe-https-variants.mjs.
      httpsVariants: [],
    };

    writeFileSync(
      join(ANALYSIS_DIR, `rb-improvements-${cc}.json`),
      JSON.stringify(out, null, 2),
    );
    perCountry[cc] = out.totals;
    console.log(
      `improve-rb: ${cc} → dead=${deadStreams.length} dupes=${internalDupes.length} metaAPIs=${metadataAPIs.length}`,
    );
  }

  const crossCountryDupes = computeCrossCountryDupes(allAnalysis);
  const summary = {
    generatedAt: new Date().toISOString(),
    countries,
    perCountry,
    crossCountryDupes,
  };
  writeFileSync(
    join(ANALYSIS_DIR, 'rb-improvements-summary.json'),
    JSON.stringify(summary, null, 2),
  );
  console.log(
    `improve-rb: summary → ${countries.length} countries, crossCountryDupes=${crossCountryDupes.length}`,
  );
}

// Only run main when invoked as a script, so tests can import the
// pure functions without triggering a file write.
if (process.argv[1] === __filename) {
  main();
}
