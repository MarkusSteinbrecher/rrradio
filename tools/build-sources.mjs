#!/usr/bin/env node
/**
 * Builds public/sources.json — the source-level inventory the admin
 * dashboard renders.
 *
 * Inputs:
 *   data/sources.yaml                              — registry of sources
 *   data/sources/radio-browser/by-country/*.json   — RAW RB snapshots,
 *                                                    one per country
 *                                                    (tools/fetch-rb-raw.mjs)
 *   data/sources/manual/stations.yaml              — manual source extract
 *                                                    (tools/extract-manual-source.mjs)
 *   data/stations.yaml                             — curated catalog
 *   public/rb-analysis-<CC>.json                   — per-country probe verdicts
 *                                                    (tools/analyze-rb.mjs)
 *
 * The raw snapshots are now the source of truth for "what stations
 * exist upstream". Verdicts from rb-analysis are layered on top by
 * stationuuid. Countries with a raw snapshot but no rb-analysis
 * contribute to the "not analyzed yet" bucket — visible in the
 * sources tab as candidates with `verdict: null`.
 *
 *   npm run build-sources
 *
 * Writes:
 *   public/sources.json                          — summary
 *   public/sources/<source-id>.json              — per-source detail
 *   public/sources/<source-id>-candidates.json   — full per-station list
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { detectFamilies } from './lib/station-family.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SOURCES_YAML = join(ROOT, 'data', 'sources.yaml');
const STATIONS_YAML = join(ROOT, 'data', 'stations.yaml');
const RAW_SOURCES_DIR = join(ROOT, 'data', 'sources');
const PUBLIC_DIR = join(ROOT, 'public');
const OUT_SUMMARY = join(PUBLIC_DIR, 'sources.json');
const OUT_PER_SOURCE_DIR = join(PUBLIC_DIR, 'sources');

// Caps for the per-source detail JSONs so they stay browser-friendly.
const MAX_DUP_GROUPS_IN_DETAIL = 100;
const MAX_TOP_CANDIDATES = 200;  // shown in summary panel for RB

// ─── 1. Load registry + catalog ───────────────────────────────────────
const sources = YAML.parse(readFileSync(SOURCES_YAML, 'utf8'));
if (!Array.isArray(sources) || sources.length === 0) {
  console.error('build-sources: data/sources.yaml must be a non-empty list');
  process.exit(1);
}
const catalog = YAML.parse(readFileSync(STATIONS_YAML, 'utf8'));
if (!Array.isArray(catalog)) {
  console.error('build-sources: data/stations.yaml is not a list');
  process.exit(1);
}

// ─── 2. Classify catalog entries by source ───────────────────────────
const sourceById = new Map(sources.map((s) => [s.id, s]));

function classify(entry) {
  if (entry.source && sourceById.has(entry.source)) return entry.source;
  for (const src of sources) {
    const hints = src.matchHints;
    if (!hints) continue;
    if (hints.hasStationUuid && entry.stationuuid) return src.id;
    if (Array.isArray(hints.idPrefixAny) &&
        hints.idPrefixAny.some((p) => typeof entry.id === 'string' && entry.id.startsWith(p))) {
      return src.id;
    }
    if (Array.isArray(hints.faviconSourceAny) &&
        hints.faviconSourceAny.includes(entry.faviconSource)) {
      return src.id;
    }
  }
  if (sourceById.has('manual')) return 'manual';
  return null;
}

const catalogBySource = new Map();
const catalogByStationUuid = new Map();
const catalogByStreamUrl = new Map();
let unclassified = 0;
for (const entry of catalog) {
  if (!entry || !entry.id) continue;
  const src = classify(entry);
  if (!src) { unclassified++; continue; }
  if (!catalogBySource.has(src)) catalogBySource.set(src, []);
  catalogBySource.get(src).push(entry);
  if (entry.stationuuid) catalogByStationUuid.set(entry.stationuuid, entry);
  if (entry.streamUrl) {
    const key = normStreamUrl(entry.streamUrl);
    if (key && !catalogByStreamUrl.has(key)) catalogByStreamUrl.set(key, entry);
  }
}
if (unclassified > 0) {
  console.warn(`build-sources: ${unclassified} catalog entries could not be classified`);
}

// ─── 3. Helpers ──────────────────────────────────────────────────────
function normStreamUrl(u) {
  if (!u) return '';
  try {
    const url = new URL(String(u));
    let path = url.pathname.replace(/\/$/, '') || '/';
    return `${url.protocol}//${url.host.toLowerCase()}${path}`;
  } catch {
    return String(u).trim().toLowerCase();
  }
}

function cleanFavicon(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text === 'null') return null;
  return text;
}

const NAME_NOISE = new Set([
  'live', 'online', 'web', 'radio', 'fm', 'am', 'stream', 'streaming',
  'hd', 'hq', 'sd', 'stereo', 'mono', 'official',
  'mp3', 'aac', 'flac', 'ogg', 'opus',
  '64k', '96k', '128k', '160k', '192k', '256k', '320k', 'kbps',
]);
function nameSignature(name) {
  const n = String(name ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!n) return '';
  return n.split(' ').filter((t) => t && !NAME_NOISE.has(t)).sort().join(' ');
}

function findCatalogMatch(candidate) {
  if (candidate.stationuuid) {
    const e = catalogByStationUuid.get(candidate.stationuuid);
    if (e) return { id: e.id, via: 'stationuuid' };
  }
  if (candidate.streamUrl) {
    const e = catalogByStreamUrl.get(normStreamUrl(candidate.streamUrl));
    if (e) return { id: e.id, via: 'streamUrl' };
  }
  return null;
}

function tally(values) {
  const m = {};
  for (const v of values) m[v] = (m[v] || 0) + 1;
  return m;
}

// Disposition of one candidate row — same vocabulary as the tracker's
// Sources view (src/tracker/view-sources.ts dispositionOf), precomputed
// here so the Overview donut can render from the summary without
// downloading the multi-MB candidates files.
function dispositionOf(c) {
  if (c.matchedCatalogId) return 'imported';
  if (c.duplicateOf) return 'duplicate';
  if (!c.verdict) return 'unprobed';
  if (c.verdict === 'ok' || c.verdict === 'ok-hls' || c.verdict === 'needs-playlist') return 'available';
  return 'broken';
}

// ─── 4. Per-source collectors ────────────────────────────────────────
function collectRadioBrowser(src) {
  // Raw inventory: data/sources/radio-browser/by-country/<CC>.json
  // (committed snapshots of the upstream RB catalog). Verdicts are
  // layered on top from public/rb-analysis-<CC>.json — countries that
  // have a raw snapshot but no analysis end up with verdict=null,
  // surfaced in the dashboard as "not yet analyzed".
  const rawDir = join(RAW_SOURCES_DIR, 'radio-browser', 'by-country');
  if (!existsSync(rawDir)) {
    console.warn(`build-sources: ${src.id} — no raw snapshots at ${rawDir.replace(ROOT + '/', '')}; run \`npm run fetch-rb-raw\``);
    return emptyCollectorResult(src);
  }

  // Verdict index from rb-analysis (per-country files under public/).
  // Verdicts only — dedupe info comes from data/sources/radio-browser/
  // dedupe.json now, which sees cross-country links too.
  const verdictIndex = new Map();
  const analyzedCountries = new Set();
  const verdictTotals = {};
  const uuidToName = new Map();
  const perCountryAnalysis = new Map();

  const analysisFiles = readdirSync(PUBLIC_DIR)
    .filter((f) => /^rb-analysis-[A-Z]{2}\.json$/.test(f))
    .sort();
  for (const file of analysisFiles) {
    const cc = file.slice('rb-analysis-'.length, -'.json'.length);
    analyzedCountries.add(cc);
    let data;
    try { data = JSON.parse(readFileSync(join(PUBLIC_DIR, file), 'utf8')); }
    catch (err) { console.warn(`build-sources: skipping ${file} — ${err.message}`); continue; }
    perCountryAnalysis.set(cc, {
      generatedAt: data.generatedAt ?? null,
      playable: data.playable ?? 0,
      broken: data.broken ?? 0,
    });
    for (const s of data.stations || []) {
      if (!s?.stationuuid) continue;
      if (s.verdict) verdictTotals[s.verdict] = (verdictTotals[s.verdict] || 0) + 1;
      verdictIndex.set(s.stationuuid, {
        verdict: s.verdict || null,
        rbCheckOk: typeof s.lastcheckok === 'number' ? s.lastcheckok : null,
      });
      if (s.name) uuidToName.set(s.stationuuid, s.name);
    }
  }

  // Cross-country dedupe DB (tools/dedupe-raw.mjs).
  // byStationUuid: { <duplicate-uuid>: { canonical, via, lockedBy? } }
  const dedupePath = join(RAW_SOURCES_DIR, 'radio-browser', 'dedupe.json');
  let dedupeByUuid = {};
  let dedupeMeta = null;
  if (existsSync(dedupePath)) {
    try {
      const data = JSON.parse(readFileSync(dedupePath, 'utf8'));
      dedupeByUuid = data.byStationUuid || {};
      dedupeMeta = {
        generatedAt: data.generatedAt,
        totals: data.totals,
      };
    } catch (err) {
      console.warn(`build-sources: dedupe.json unparseable, ignoring: ${err.message}`);
    }
  } else {
    console.warn('build-sources: no data/sources/radio-browser/dedupe.json — run `npm run dedupe-raw`');
  }
  const canonicalUuids = new Set(Object.values(dedupeByUuid).map((d) => d.canonical));

  // Walk the raw snapshots — these are now the authoritative
  // inventory of "what stations exist on RB".
  const seen = new Set();
  const perCountry = new Map();
  const topCandidates = [];
  const allCandidates = [];
  const importedCatalogIds = new Set();
  let candidateTotal = 0;
  let importedCandidateRows = 0;
  let availableCandidateRows = 0;

  const snapshotFiles = readdirSync(rawDir)
    .filter((f) => /^[A-Z]{2}\.json$/.test(f))
    .sort();
  const snapshotCountries = snapshotFiles.map((f) => f.slice(0, 2));

  for (const file of snapshotFiles) {
    const cc = file.slice(0, 2);
    let data;
    try { data = JSON.parse(readFileSync(join(rawDir, file), 'utf8')); }
    catch (err) { console.warn(`build-sources: skipping ${file} — ${err.message}`); continue; }
    const list = Array.isArray(data.stations) ? data.stations : [];

    let ccCandidateCount = 0;
    let ccImportedCount = 0;
    const ccImportedIds = new Set();

    for (const s of list) {
      if (!s?.stationuuid) continue;
      if (seen.has(s.stationuuid)) continue;
      seen.add(s.stationuuid);
      if (s.name) uuidToName.set(s.stationuuid, s.name);
      candidateTotal++;
      ccCandidateCount++;

      const streamUrl = s.url_resolved || s.url;
      const match = findCatalogMatch({ stationuuid: s.stationuuid, streamUrl });
      if (match) {
        importedCandidateRows++;
        importedCatalogIds.add(match.id);
        ccImportedIds.add(match.id);
        ccImportedCount++;
      } else {
        availableCandidateRows++;
      }

      const ver = verdictIndex.get(s.stationuuid) || { verdict: null, rbCheckOk: null };
      const dup = dedupeByUuid[s.stationuuid] || null;
      // Dedupe-group key: the group's canonical uuid — set on the
      // canonical row too, so the disposition stamp can reason about
      // whole groups (e.g. http/https variants of one stream).
      const dedupeGroup = dup?.canonical ?? (canonicalUuids.has(s.stationuuid) ? s.stationuuid : null);
      topCandidates.push({
        stationuuid: s.stationuuid,
        name: s.name, country: s.countrycode || cc,
        streamUrl, homepage: s.homepage,
        favicon: cleanFavicon(s.favicon),
        votes: s.votes ?? 0, clickcount: s.clickcount ?? 0,
        verdict: ver.verdict,
        matchedCatalogId: match?.id ?? null,
      });

      let streamHost = '';
      try { if (streamUrl) streamHost = new URL(streamUrl).host; } catch { /* malformed */ }
      allCandidates.push({
        stationuuid: s.stationuuid,
        name: s.name || '',
        country: s.countrycode || cc,
        votes: s.votes ?? 0,
        clickcount: s.clickcount ?? 0,
        verdict: ver.verdict,
        rbCheckOk: ver.rbCheckOk,
        duplicateOf: dup?.canonical ?? null,
        duplicateVia: dup?.via ?? null,
        dedupeGroup,
        matchedCatalogId: match?.id ?? null,
        streamHost,
        streamUrl: streamUrl || null,
        homepage: s.homepage || null,
        favicon: cleanFavicon(s.favicon),
      });
    }

    const analysis = perCountryAnalysis.get(cc);
    perCountry.set(cc, {
      country: cc,
      total: data.count ?? list.length,
      candidatesIndexed: ccCandidateCount,
      imported: ccImportedIds.size,
      importedRows: ccImportedCount,
      available: ccCandidateCount - ccImportedCount,
      playable: analysis?.playable ?? null,
      broken: analysis?.broken ?? null,
      analyzed: analyzedCountries.has(cc),
      snapshotAt: data.fetchedAt ?? null,
      analysisAt: analysis?.generatedAt ?? null,
      detailUrl: analyzedCountries.has(cc) ? `/rb-analysis-${cc}.json` : null,
      snapshotPath: `data/sources/radio-browser/by-country/${cc}.json`,
    });
  }

  // Catalog entries whose RB country isn't in the raw snapshot set
  // (shouldn't happen for a complete fetch, but guard against partial
  // raw DBs the same way the old aggregator handled orphans).
  const importedWithoutCountryAnalysis = [];
  for (const entry of catalogBySource.get(src.id) || []) {
    if (!entry.stationuuid || seen.has(entry.stationuuid)) continue;
    seen.add(entry.stationuuid);
    importedCatalogIds.add(entry.id);
    importedCandidateRows++;
    candidateTotal++;
    importedWithoutCountryAnalysis.push({
      catalogId: entry.id, stationuuid: entry.stationuuid,
      name: entry.name, country: entry.country, streamUrl: entry.streamUrl,
    });
    let streamHost = '';
    try { if (entry.streamUrl) streamHost = new URL(entry.streamUrl).host; } catch { /* malformed */ }
    const dup = dedupeByUuid[entry.stationuuid] || null;
    allCandidates.push({
      stationuuid: entry.stationuuid,
      name: entry.name || '',
      country: entry.country || '',
      votes: 0, clickcount: 0,
      verdict: null, rbCheckOk: null, duplicateOf: null,
      dedupeGroup: dup?.canonical ?? (canonicalUuids.has(entry.stationuuid) ? entry.stationuuid : null),
      matchedCatalogId: entry.id,
      streamHost,
      streamUrl: entry.streamUrl || null,
      homepage: entry.homepage || null,
      favicon: cleanFavicon(entry.favicon),
      note: 'not-in-raw-snapshot',
    });
  }

  // FAMILY layer (Phase 3c): group regional / sub-brand siblings of ONE brand
  // ("Bayern 1 Oberbayern / Franken / Schwaben", bigFM's genre channels) using
  // the SAME model the dedupe gate uses — `detectFamilies`, bucketed by
  // COUNTRY|homepage-host (tools/lib/station-family.mjs). Candidates already
  // carry name/country/homepage, so it runs with no field adapter. A family is
  // NOT a duplicate set: members stay DISTINCT, just tagged, so the tracker can
  // flag "many slightly-renamed siblings" as one coherent group, not noise.
  const families = detectFamilies(allCandidates);
  for (const fam of families) {
    for (const m of fam.members) {
      m.familyId = fam.id;
      m.familyCore = fam.core;
      m.familySize = fam.members.length;
    }
  }
  const familyMemberRows = families.reduce((n, f) => n + f.members.length, 0);
  console.log(
    `build-sources: ${src.id} — ${families.length} brand families (${familyMemberRows} member rows)`,
  );

  for (const c of allCandidates) {
    if (c.duplicateOf) c.duplicateOfName = uuidToName.get(c.duplicateOf) || null;
  }

  topCandidates.sort((a, b) => (b.votes || 0) - (a.votes || 0));
  const topByVotes = topCandidates.slice(0, MAX_TOP_CANDIDATES);
  const topUnimportedByVotes = topCandidates
    .filter((c) => !c.matchedCatalogId)
    .slice(0, MAX_TOP_CANDIDATES);
  allCandidates.sort((a, b) => (b.votes || 0) - (a.votes || 0));

  return {
    countersTotal: candidateTotal,
    countersImported: importedCatalogIds.size,
    countersImportedRows: importedCandidateRows,
    countersAvailable: availableCandidateRows,
    detail: {
      snapshotCountries,
      countriesInRawSnapshot: snapshotCountries.length,
      analyzedCountries: [...analyzedCountries].sort(),
      countriesAnalyzed: analyzedCountries.size,
      perCountry: Object.fromEntries(
        [...perCountry.entries()].sort((a, b) => b[1].total - a[1].total),
      ),
      verdictTotals,
      topByVotes,
      topUnimportedByVotes,
      importedWithoutCountryAnalysis,
      candidatesUrl: `/sources/${src.id}-candidates.json`,
      rawSnapshotRoot: 'data/sources/radio-browser/',
      dedupe: dedupeMeta,
      families: {
        total: families.length,
        totalMembers: familyMemberRows,
        list: [...families]
          .sort((a, b) => b.members.length - a.members.length)
          .slice(0, MAX_DUP_GROUPS_IN_DETAIL)
          .map((f) => {
            const [country, host] = f.bucket.split('|');
            return { id: f.id, country, host, core: f.core, size: f.members.length };
          }),
      },
    },
    extraArtifacts: [
      {
        path: `${src.id}-candidates.json`,
        body: {
          generatedAt: new Date().toISOString(),
          sourceId: src.id,
          count: allCandidates.length,
          candidates: allCandidates,
        },
      },
    ],
  };
}

function emptyCollectorResult(src) {
  return {
    countersTotal: 0, countersImported: 0, countersImportedRows: 0, countersAvailable: 0,
    detail: { snapshotCountries: [], countriesInRawSnapshot: 0,
      analyzedCountries: [], countriesAnalyzed: 0,
      perCountry: {}, verdictTotals: {},
      topByVotes: [], topUnimportedByVotes: [], importedWithoutCountryAnalysis: [],
      candidatesUrl: `/sources/${src.id}-candidates.json`,
    },
    extraArtifacts: [{
      path: `${src.id}-candidates.json`,
      body: { generatedAt: new Date().toISOString(), sourceId: src.id, count: 0, candidates: [] },
    }],
  };
}

function collectManual(src) {
  const entries = catalogBySource.get(src.id) || [];
  // Intra-source duplicates by stream URL (cheap, no upstream catalog
  // for manual so this captures "we typed the same station twice").
  const byStream = new Map();
  for (const e of entries) {
    const k = normStreamUrl(e.streamUrl);
    if (!k) continue;
    if (!byStream.has(k)) byStream.set(k, []);
    byStream.get(k).push(e);
  }
  const duplicateGroups = [];
  for (const [key, list] of byStream) {
    if (list.length < 2) continue;
    duplicateGroups.push({
      kind: 'streamUrl', key,
      entries: list.map((e) => ({
        catalogId: e.id, name: e.name, country: e.country,
        streamUrl: e.streamUrl,
      })),
    });
  }

  const items = entries.map((e) => ({
    catalogId: e.id,
    name: e.name,
    country: e.country,
    broadcaster: e.broadcaster,
    streamUrl: e.streamUrl,
    homepage: e.homepage,
    favicon: e.favicon,
    codec: e.codec,
    bitrate: e.bitrate,
    status: e.status,
    matchedCatalogId: e.id,
  }));

  // Manual candidates use the same shape as RB candidates so the
  // tracker's filterable table can render either without branching.
  const dupSet = new Set();
  for (const g of duplicateGroups) for (const e of g.entries) dupSet.add(e.catalogId);
  const allCandidates = entries.map((e) => {
    let streamHost = '';
    try { if (e.streamUrl) streamHost = new URL(e.streamUrl).host; } catch { /* malformed */ }
    return {
      // Manual entries don't have an RB stationuuid; reuse the catalog
      // id as the row key on the candidates table.
      stationuuid: e.id,
      name: e.name,
      country: e.country,
      votes: 0,
      clickcount: 0,
      verdict: null,
      duplicateOf: dupSet.has(e.id) ? 'manual-duplicate' : null,
      matchedCatalogId: e.id,
      streamHost,
      streamUrl: e.streamUrl || null,
      homepage: e.homepage || null,
      favicon: cleanFavicon(e.favicon),
      broadcaster: e.broadcaster || null,
      status: e.status || null,
    };
  });
  allCandidates.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  return {
    countersTotal: items.length,
    countersImported: items.length,
    countersImportedRows: items.length,
    countersAvailable: 0,
    detail: {
      items,
      duplicateGroups,
      candidatesUrl: `/sources/${src.id}-candidates.json`,
    },
    extraArtifacts: [
      {
        path: `${src.id}-candidates.json`,
        body: {
          generatedAt: new Date().toISOString(),
          sourceId: src.id,
          count: allCandidates.length,
          candidates: allCandidates,
        },
      },
    ],
  };
}

function collectListSource(src) {
  // Generic collector for list-backed sources (kind: webpage |
  // user-suggestion): candidates live in a committed YAML list at
  // src.rawStations instead of coming from an upstream API.
  const rawPath = src.rawStations ? join(ROOT, src.rawStations) : null;
  let rows = [];
  if (rawPath && existsSync(rawPath)) {
    try {
      const parsed = YAML.parse(readFileSync(rawPath, 'utf8'));
      if (Array.isArray(parsed)) rows = parsed;
    } catch (err) {
      console.warn(`build-sources: ${src.id} — ${src.rawStations} unparseable: ${err.message}`);
    }
  } else {
    console.warn(`build-sources: ${src.id} — no list at ${src.rawStations ?? '(rawStations unset)'}`);
  }

  const triageTotals = {};
  const matchedCatalogIds = new Set();
  let importedRows = 0;
  const allCandidates = rows.map((r, i) => {
    const match = r?.streamUrl ? findCatalogMatch({ streamUrl: r.streamUrl }) : null;
    if (match) {
      matchedCatalogIds.add(match.id);
      importedRows++;
    }
    const triage = match ? 'imported' : (r?.triage || 'new');
    triageTotals[triage] = (triageTotals[triage] || 0) + 1;
    let streamHost = '';
    try { if (r?.streamUrl) streamHost = new URL(r.streamUrl).host; } catch { /* malformed */ }
    return {
      // List rows have no upstream uuid; synthesize a stable row key.
      stationuuid: `${src.id}-${i}`,
      name: r?.name || '',
      country: r?.country || '',
      votes: 0,
      clickcount: 0,
      verdict: null,
      duplicateOf: null,
      matchedCatalogId: match?.id ?? null,
      streamHost,
      streamUrl: r?.streamUrl || null,
      homepage: r?.homepage || null,
      favicon: cleanFavicon(r?.favicon),
      triage: r?.triage || null,
      suggestedVia: r?.suggestedVia || null,
      suggestedAt: r?.suggestedAt || null,
    };
  });

  // Catalog entries tagged `source: <id>` count as imported even when
  // their intake row was pruned or never written.
  for (const e of catalogBySource.get(src.id) || []) matchedCatalogIds.add(e.id);

  return {
    countersTotal: allCandidates.length,
    countersImported: matchedCatalogIds.size,
    countersImportedRows: importedRows,
    countersAvailable: allCandidates.filter((c) => !c.matchedCatalogId && c.triage !== 'rejected').length,
    detail: {
      rawStations: src.rawStations ?? null,
      triageTotals,
      candidatesUrl: `/sources/${src.id}-candidates.json`,
    },
    extraArtifacts: [
      {
        path: `${src.id}-candidates.json`,
        body: {
          generatedAt: new Date().toISOString(),
          sourceId: src.id,
          count: allCandidates.length,
          candidates: allCandidates,
        },
      },
    ],
  };
}

// ─── 5. Build per source ─────────────────────────────────────────────
mkdirSync(OUT_PER_SOURCE_DIR, { recursive: true });

const summary = {
  generatedAt: new Date().toISOString(),
  catalogTotal: catalog.length,
  unclassifiedCatalogEntries: unclassified,
  sources: [],
  crossSourceDuplicates: [],
};

const streamSeenIn = new Map();

for (const src of sources) {
  let collected;
  switch (src.kind) {
    case 'radio-browser':   collected = collectRadioBrowser(src); break;
    case 'manual':          collected = collectManual(src); break;
    case 'webpage':
    case 'user-suggestion': collected = collectListSource(src); break;
    default:
      console.warn(`build-sources: unknown source kind '${src.kind}' for ${src.id} — skipping`);
      continue;
  }

  // Stamp the final disposition on every candidate row before the
  // artifact is written, so clients filter on one authoritative field.
  // Rows are sorted strongest-first (votes), so the best row per catalog
  // station stays `imported`; surplus rows matching the same station
  // (same stream under another record) demote to `duplicate`.
  const candidatesArtifact = (collected.extraArtifacts || [])
    .find((a) => a.path.endsWith('-candidates.json'));
  const candidateRows = candidatesArtifact?.body.candidates || [];
  const seenCatalogIds = new Set();
  for (const c of candidateRows) {
    let d = dispositionOf(c);
    if (d === 'imported') {
      if (seenCatalogIds.has(c.matchedCatalogId)) d = 'duplicate';
      else seenCatalogIds.add(c.matchedCatalogId);
    }
    c.disposition = d;
  }

  // Group-aware demotion: when a dedupe group already has an imported
  // member, every other member is a duplicate of a catalog station —
  // even the group's canonical row. Catches scheme variants the URL
  // match can't see (e.g. Bandit Metal exists as http:// and https://
  // of the same stream; we imported one, the other must not surface
  // as "available").
  const dedupeGroups = new Map();
  for (const c of candidateRows) {
    if (!c.dedupeGroup) continue;
    if (!dedupeGroups.has(c.dedupeGroup)) dedupeGroups.set(c.dedupeGroup, []);
    dedupeGroups.get(c.dedupeGroup).push(c);
  }
  let groupDemoted = 0;
  for (const members of dedupeGroups.values()) {
    const imported = members.find((m) => m.disposition === 'imported');
    if (!imported) continue;
    for (const m of members) {
      if (m.disposition === 'imported' || m.disposition === 'duplicate') continue;
      m.disposition = 'duplicate';
      if (!m.duplicateOf) {
        m.duplicateOf = imported.stationuuid;
        m.duplicateOfName = imported.name;
        m.duplicateVia = m.duplicateVia || 'dedupe-group';
      }
      groupDemoted++;
    }
  }
  if (groupDemoted > 0) {
    console.log(`build-sources: ${src.id} — ${groupDemoted} candidate(s) demoted to duplicate (dedupe group already imported)`);
  }

  // Cross-source duplicate bookkeeping. We only care about *catalog*
  // entries that this source produced — duplicates among unimported
  // candidates aren't a cross-source concern.
  for (const entry of catalogBySource.get(src.id) || []) {
    const su = normStreamUrl(entry.streamUrl);
    if (!su) continue;
    if (!streamSeenIn.has(su)) streamSeenIn.set(su, []);
    streamSeenIn.get(su).push({
      source: src.id,
      catalogId: entry.id,
      name: entry.name,
      country: entry.country,
    });
  }

  const detail = {
    generatedAt: summary.generatedAt,
    source: {
      id: src.id, name: src.name, kind: src.kind,
      homepage: src.homepage ?? null,
      description: src.description ?? null,
    },
    counts: {
      candidateTotal: collected.countersTotal,
      imported: collected.countersImported,
      importedCandidateRows: collected.countersImportedRows,
      available: collected.countersAvailable,
    },
    ...collected.detail,
  };
  // Trim duplicateGroups (manual) — manual has at most a handful, but
  // future sources with the same shape might balloon. Cap defensively.
  if (Array.isArray(detail.duplicateGroups) && detail.duplicateGroups.length > MAX_DUP_GROUPS_IN_DETAIL) {
    detail.duplicateGroupsTotal = detail.duplicateGroups.length;
    detail.duplicateGroups = detail.duplicateGroups.slice(0, MAX_DUP_GROUPS_IN_DETAIL);
  }

  writeFileSync(join(OUT_PER_SOURCE_DIR, `${src.id}.json`),
    JSON.stringify(detail, null, 2) + '\n');

  // Any larger artifacts the collector wants to ship separately (e.g.
  // the per-station candidates list, which would otherwise bloat
  // the per-source detail). Skip pretty-printing — the candidates
  // file is ~17 MB at one row per line; the unpretty form is half
  // that and stays gzip-friendly.
  for (const extra of collected.extraArtifacts || []) {
    writeFileSync(join(OUT_PER_SOURCE_DIR, extra.path),
      JSON.stringify(extra.body) + '\n');
  }

  // Disposition tally over the stamped candidate list — feeds the
  // tracker donut from the lightweight summary.
  const dispositionTotals = tally(candidateRows.map((c) => c.disposition));

  summary.sources.push({
    id: src.id,
    name: src.name,
    abbr: src.abbr ?? src.name,
    kind: src.kind,
    homepage: src.homepage ?? null,
    description: src.description ?? null,
    candidateCount: collected.countersTotal,
    importedCount: collected.countersImported,
    availableCount: collected.countersAvailable,
    dispositionTotals,
    extra: src.kind === 'radio-browser' ? {
      countriesAnalyzed: collected.detail.countriesAnalyzed,
      countriesInRawSnapshot: collected.detail.countriesInRawSnapshot,
      verdictBreakdown: collected.detail.verdictTotals,
      perCountryUrl: '/sources/radio-browser.json',
    } : {},
    detailUrl: `/sources/${src.id}.json`,
  });

  console.log(
    `build-sources: ${src.id} — ${collected.countersTotal} candidate(s), ` +
    `${collected.countersImported} imported`,
  );
}

for (const [stream, hits] of streamSeenIn) {
  const sourcesHit = new Set(hits.map((h) => h.source));
  if (sourcesHit.size < 2) continue;
  summary.crossSourceDuplicates.push({ streamUrl: stream, entries: hits });
}
if (summary.crossSourceDuplicates.length > 0) {
  console.log(
    `build-sources: ${summary.crossSourceDuplicates.length} cross-source duplicate(s) ` +
    '(same stream imported under multiple sources)',
  );
}

// ─── 6. Per-station provenance map ───────────────────────────────────
// Compact catalog-id → source-id map for the tracker. The dominant
// source becomes the default so only minority-source stations need an
// override row — the file stays a few KB instead of one row per station.
let defaultSource = null;
let defaultCount = -1;
for (const [id, entries] of catalogBySource) {
  if (entries.length > defaultCount) { defaultSource = id; defaultCount = entries.length; }
}
const overrides = {};
for (const [srcId, entries] of catalogBySource) {
  if (srcId === defaultSource) continue;
  for (const e of entries) overrides[e.id] = srcId;
}
const OUT_SOURCE_MAP = join(OUT_PER_SOURCE_DIR, 'catalog-source-map.json');
writeFileSync(OUT_SOURCE_MAP, JSON.stringify({
  generatedAt: summary.generatedAt,
  defaultSource,
  overrides,
}, null, 2) + '\n');
console.log(
  `build-sources: provenance map — default ${defaultSource}, ` +
  `${Object.keys(overrides).length} override(s)`,
);

writeFileSync(OUT_SUMMARY, JSON.stringify(summary, null, 2) + '\n');
console.log(`build-sources: → ${OUT_SUMMARY.replace(ROOT + '/', '')}`);
console.log(`build-sources: per-source detail under public/sources/`);
