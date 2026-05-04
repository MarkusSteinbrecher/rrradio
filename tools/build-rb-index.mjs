#!/usr/bin/env node
/**
 * Aggregates every public/rb-analysis-<CC>.json verdict file into a
 * single station-level index keyed by stationuuid.
 *
 *   npm run build-rb-index
 *
 * Output: .cache/rb-station-index.json (gitignored — derived artifact).
 *
 * The per-country files remain the source of truth. This index is
 * for cross-country lookups answering questions like:
 *
 *   - Have we already scanned this stationuuid? (any country)
 *   - When was its last verdict, and what was it?
 *   - How much of RB have we covered (countries × stations probed)?
 *   - Which curated rows have a recorded verdict, which don't?
 *
 * Per-station record:
 *   {
 *     name, country, streamUrl, votes, clickcount, codec, bitrate,
 *     verdict, verdictReason,
 *     isCurated, duplicateOf,
 *     probedAt,           // most recent if seen in multiple countries
 *     scannedFromCountry, // CC of the file this entry came from
 *   }
 *
 * Top-level shape:
 *   {
 *     generatedAt,
 *     countriesScanned: ["CH","DE",...],
 *     totalStations,
 *     curatedCount,
 *     byVerdict: { ok: N, "broken-mixed": N, ... },
 *     oldestProbe, newestProbe,
 *     stations: { "<stationuuid>": { ... } }
 *   }
 *
 * Read-only on disk except for the cache file. Safe to re-run any
 * time — just walks `public/rb-analysis-*.json` and rewrites the
 * cache atomically.
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ANALYSIS_DIR = join(ROOT, 'public');
const OUT_DIR = join(ROOT, '.cache');
const OUT_PATH = join(OUT_DIR, 'rb-station-index.json');

const FILE_RE = /^rb-analysis-([A-Z]{2})\.json$/;

const files = readdirSync(ANALYSIS_DIR)
  .filter((f) => FILE_RE.test(f))
  .sort();

if (files.length === 0) {
  console.error('build-rb-index: no public/rb-analysis-*.json files found.');
  console.error('Run `node tools/analyze-rb.mjs <CC>` first.');
  process.exit(1);
}

const stations = Object.create(null);
const countriesScanned = [];
const byVerdict = Object.create(null);
let oldestProbe = null;
let newestProbe = null;
let curatedCount = 0;
let collisions = 0;

for (const file of files) {
  const cc = file.match(FILE_RE)[1];
  countriesScanned.push(cc);
  const raw = readFileSync(join(ANALYSIS_DIR, file), 'utf8');
  const data = JSON.parse(raw);
  const list = Array.isArray(data.stations) ? data.stations : [];
  for (const s of list) {
    if (!s.stationuuid) continue;
    const record = {
      name: s.name,
      country: s.country,
      streamUrl: s.streamUrl,
      votes: s.votes ?? 0,
      clickcount: s.clickcount ?? 0,
      codec: s.codec,
      bitrate: s.bitrate,
      verdict: s.verdict,
      verdictReason: s.verdictReason,
      isCurated: !!s.isCurated,
      duplicateOf: s.duplicateOf ?? null,
      probedAt: s.probedAt,
      scannedFromCountry: cc,
    };
    const existing = stations[s.stationuuid];
    if (existing) {
      collisions++;
      // Same uuid in two country files — keep the most recent probe.
      if (!existing.probedAt || (record.probedAt && record.probedAt > existing.probedAt)) {
        stations[s.stationuuid] = record;
      }
    } else {
      stations[s.stationuuid] = record;
    }
  }
}

for (const uuid of Object.keys(stations)) {
  const r = stations[uuid];
  byVerdict[r.verdict] = (byVerdict[r.verdict] ?? 0) + 1;
  if (r.isCurated) curatedCount++;
  if (r.probedAt) {
    if (!oldestProbe || r.probedAt < oldestProbe) oldestProbe = r.probedAt;
    if (!newestProbe || r.probedAt > newestProbe) newestProbe = r.probedAt;
  }
}

const totalStations = Object.keys(stations).length;

const out = {
  generatedAt: new Date().toISOString(),
  countriesScanned,
  totalStations,
  curatedCount,
  byVerdict,
  oldestProbe,
  newestProbe,
  stations,
};

mkdirSync(OUT_DIR, { recursive: true });
const tmp = OUT_PATH + '.tmp';
writeFileSync(tmp, JSON.stringify(out));
renameSync(tmp, OUT_PATH);

console.log(
  `build-rb-index: ${totalStations.toLocaleString()} stations across ${countriesScanned.length} countries → ${OUT_PATH}`,
);
if (collisions > 0) {
  console.log(`  · ${collisions} cross-country uuid collisions (kept most recent probe)`);
}
console.log(`  · curated: ${curatedCount.toLocaleString()}`);
console.log(`  · verdicts:`);
const ranked = Object.entries(byVerdict).sort((a, b) => b[1] - a[1]);
for (const [v, n] of ranked) {
  console.log(`      ${v.padEnd(20)} ${n.toLocaleString()}`);
}
console.log(`  · probe window: ${oldestProbe ?? '—'} → ${newestProbe ?? '—'}`);
