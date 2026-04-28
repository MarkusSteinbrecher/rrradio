#!/usr/bin/env node
/**
 * Analyse every Radio Browser station for a given country and write
 * a verdict file under public/rb-analysis-<CC>.json.
 *
 *   node tools/analyze-rb.mjs CH               — Switzerland
 *   node tools/analyze-rb.mjs DE --concurrency 8
 *   node tools/analyze-rb.mjs DE --resume       — skip uuids already
 *                                                 verdicted in the
 *                                                 existing report
 *
 * Output per station:
 *   {
 *     stationuuid, changeuuid, name, country, streamUrl, homepage,
 *     codec, bitrate, votes, clickcount,
 *     verdict, verdictReason, finalUrl?,
 *     duplicateOf,        // stationuuid of the higher-voted dupe, or null
 *     isCurated,          // true when our YAML references this uuid
 *     probedAt
 *   }
 *
 * Verdict scope follows playable-check.mjs. The full report is sorted
 * by votes desc — top of the list is what real users want.
 *
 * Politeness: default 5 concurrent probes, 10s per probe, 50ms stagger.
 * Bump --concurrency carefully — the same broadcaster often hosts many
 * channels under one origin and you'll get rate-limited.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { pickServer } from './rb-client.mjs';
import { probeStream } from './playable-check.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const args = process.argv.slice(2);
const cc = (args[0] || '').toUpperCase();
if (!/^[A-Z]{2}$/.test(cc)) {
  console.error('usage: node tools/analyze-rb.mjs <ISO 3166-1 country code> [--concurrency N] [--resume]');
  process.exit(1);
}
const concurrency = Math.max(
  1,
  Math.min(20, Number(args[args.indexOf('--concurrency') + 1]) || 5),
);
const resume = args.includes('--resume');

const outPath = join(ROOT, `public/rb-analysis-${cc}.json`);
mkdirSync(dirname(outPath), { recursive: true });

// ─── 1. Fetch the country's RB stations ────────────────────────
const server = await pickServer();
console.log(`analyze-rb: fetching ${cc} stations from ${server}…`);
// RB paginates this endpoint at 1000 by default — pass an explicit
// limit so we always get the full country set in one shot.
const rbUrl = `${server}/json/stations/bycountrycodeexact/${cc}?hidebroken=false&limit=100000`;
const res = await fetch(rbUrl, { headers: { 'User-Agent': 'rrradio-analyze-rb/1.0' } });
if (!res.ok) {
  console.error(`analyze-rb: RB request failed ${res.status}`);
  process.exit(1);
}
const stations = await res.json();
if (!Array.isArray(stations) || stations.length === 0) {
  console.error(`analyze-rb: ${cc} returned no stations`);
  process.exit(1);
}

// Sort by votes desc so the most-wanted stations get probed first
// (and dupe resolution prefers the popular one as the canonical row).
stations.sort((a, b) => (b.votes || 0) - (a.votes || 0));
console.log(`analyze-rb: ${stations.length} stations to probe (concurrency ${concurrency})`);

// ─── 2. Curated-set lookup + previous report (for --resume) ────
const curatedUuids = new Set();
try {
  const yaml = parseYaml(readFileSync(join(ROOT, 'data/stations.yaml'), 'utf8'));
  for (const s of yaml || []) if (s?.stationuuid) curatedUuids.add(s.stationuuid);
} catch {
  /* fine — no curated set yet */
}

let prior = new Map();
if (resume && existsSync(outPath)) {
  try {
    const data = JSON.parse(readFileSync(outPath, 'utf8'));
    for (const r of data.stations || []) prior.set(r.stationuuid, r);
    console.log(`analyze-rb: --resume — ${prior.size} prior verdicts kept`);
  } catch {
    console.warn('analyze-rb: previous report unparseable, ignoring --resume');
  }
}

// ─── 3. Probe with bounded concurrency ─────────────────────────
const verdicts = new Array(stations.length);
let next = 0;
let done = 0;
const startTs = Date.now();

const tick = () => {
  if (done % 25 === 0 || done === stations.length) {
    const pct = Math.round((done / stations.length) * 100);
    const elapsed = Math.round((Date.now() - startTs) / 1000);
    process.stdout.write(`\r  ${done}/${stations.length} (${pct}%) ${elapsed}s`);
  }
};

await Promise.all(
  Array.from({ length: concurrency }, async () => {
    for (;;) {
      const i = next++;
      if (i >= stations.length) return;
      const s = stations[i];
      const url = s.url_resolved || s.url;
      const reused = prior.get(s.stationuuid);
      let probe;
      if (reused && reused.changeuuid === s.changeuuid && reused.streamUrl === url) {
        probe = {
          verdict: reused.verdict,
          reason: reused.verdictReason,
          finalUrl: reused.finalUrl,
        };
      } else {
        probe = await probeStream(url);
      }
      verdicts[i] = {
        stationuuid: s.stationuuid,
        changeuuid: s.changeuuid,
        name: s.name,
        country: s.countrycode || cc,
        streamUrl: url,
        homepage: s.homepage || undefined,
        favicon: s.favicon || undefined,
        codec: s.codec || undefined,
        bitrate: s.bitrate || undefined,
        votes: s.votes || 0,
        clickcount: s.clickcount || 0,
        lastcheckok: s.lastcheckok ?? null,
        verdict: probe.verdict,
        verdictReason: probe.reason,
        finalUrl: probe.finalUrl,
        duplicateOf: null, // filled in pass 4
        isCurated: curatedUuids.has(s.stationuuid),
        probedAt: new Date().toISOString(),
      };
      done++;
      tick();
    }
  }),
);
process.stdout.write('\n');

// ─── 4. Duplicate pass (within this country) ───────────────────
function normStream(u) {
  if (!u) return '';
  try {
    const x = new URL(u);
    let path = x.pathname.replace(/\/$/, '');
    if (!path) path = '/';
    return `${x.protocol}//${x.host.toLowerCase()}${path}`;
  } catch {
    return (u || '').trim().toLowerCase();
  }
}
const byStream = new Map();
for (const v of verdicts) {
  const key = normStream(v.streamUrl);
  if (!key) continue;
  if (!byStream.has(key)) byStream.set(key, []);
  byStream.get(key).push(v);
}
let dupCount = 0;
for (const list of byStream.values()) {
  if (list.length < 2) continue;
  // Canonical = highest votes, then highest clickcount
  list.sort(
    (a, b) => (b.votes || 0) - (a.votes || 0) || (b.clickcount || 0) - (a.clickcount || 0),
  );
  const canonical = list[0];
  for (let i = 1; i < list.length; i++) {
    list[i].duplicateOf = canonical.stationuuid;
    dupCount++;
  }
}

// ─── 5. Roll-up summary + write the report ─────────────────────
const counts = {};
for (const v of verdicts) {
  counts[v.verdict] = (counts[v.verdict] || 0) + 1;
}
const playable = (counts.ok || 0) + (counts['ok-hls'] || 0);
const broken = Object.entries(counts)
  .filter(([k]) => k.startsWith('broken') || k === 'redirect-downgrade' || k === 'needs-playlist')
  .reduce((sum, [, n]) => sum + n, 0);

const report = {
  generatedAt: new Date().toISOString(),
  country: cc,
  total: verdicts.length,
  playable,
  broken,
  duplicates: dupCount,
  curated: verdicts.filter((v) => v.isCurated).length,
  byVerdict: counts,
  stations: verdicts,
};

writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
console.log(`analyze-rb: → ${outPath}`);
console.log(
  `  total=${report.total} playable=${report.playable} broken=${report.broken} dupes=${report.duplicates} curated=${report.curated}`,
);
console.log(
  `  by verdict: ${Object.entries(counts)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ')}`,
);
