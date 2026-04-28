#!/usr/bin/env node
/**
 * Compares each station that carries a stationuuid against its current
 * Radio Browser record. When upstream changeuuid differs from the one
 * stored in stations.yaml, captures a per-field diff so a curator can
 * decide whether to absorb the change.
 *
 * Read-only on the YAML (does NOT bump changeuuid / reviewedAt — that's
 * a curator decision). Writes public/station-drift.json so the admin
 * dashboard and the catalog-watch workflow can surface it.
 *
 *   npm run check-drift
 *
 * Exits non-zero when drift or missing-upstream entries are found, so a
 * scheduled workflow can branch and open a PR.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { fetchByUuid } from './rb-client.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// Fields whose upstream change matters enough to flag. Anything not in
// this list (lastcheck timestamps, click counters, server uuid, …)
// updates constantly and would generate noise.
const TRACKED_FIELDS = [
  'name',
  'url_resolved',
  'homepage',
  'favicon',
  'countrycode',
  'state',
  'language',
  'codec',
  'bitrate',
  'tags',
  'geo_lat',
  'geo_long',
];

const stations = parseYaml(readFileSync(join(root, 'data/stations.yaml'), 'utf8'));
if (!Array.isArray(stations)) {
  console.error('check-drift: data/stations.yaml is not a list');
  process.exit(1);
}

const tracked = stations.filter((s) => s?.stationuuid);
if (tracked.length === 0) {
  console.log('check-drift: no stations carry a stationuuid yet.');
  writeReport({ checkedAt: new Date().toISOString(), drift: [], missing: [], checked: 0 });
  process.exit(0);
}

console.log(`check-drift: comparing ${tracked.length} station(s) against Radio Browser…`);

// maxAgeMs:0 forces a network fetch and overwrites the cache.
const records = await fetchByUuid(
  tracked.map((s) => s.stationuuid),
  { maxAgeMs: 0 },
);
const byUuid = new Map(records.map((r) => [r.stationuuid, r]));

const drift = [];
const missing = [];
for (const s of tracked) {
  const rb = byUuid.get(s.stationuuid);
  if (!rb) {
    missing.push({
      id: s.id,
      name: s.name,
      stationuuid: s.stationuuid,
      lastReviewed: s.reviewedAt ?? null,
    });
    continue;
  }
  if (!s.changeuuid) {
    // No baseline recorded — flag once so the curator records the
    // current changeuuid against this station.
    drift.push({
      id: s.id,
      name: s.name,
      stationuuid: s.stationuuid,
      reason: 'no-baseline',
      currentChangeuuid: rb.changeuuid,
      lastReviewed: s.reviewedAt ?? null,
      diffs: {},
    });
    continue;
  }
  if (rb.changeuuid === s.changeuuid) continue;

  const diffs = {};
  for (const f of TRACKED_FIELDS) {
    if (rb[f] !== undefined && rb[f] !== null && rb[f] !== '') {
      diffs[f] = { upstream: rb[f] };
    }
  }
  drift.push({
    id: s.id,
    name: s.name,
    stationuuid: s.stationuuid,
    reason: 'changeuuid-mismatch',
    storedChangeuuid: s.changeuuid,
    currentChangeuuid: rb.changeuuid,
    lastReviewed: s.reviewedAt ?? null,
    upstream: pickTracked(rb),
  });
}

const report = {
  checkedAt: new Date().toISOString(),
  checked: tracked.length,
  drift,
  missing,
};
writeReport(report);

console.log('');
console.log(`check-drift: ${drift.length} drift, ${missing.length} missing upstream`);
for (const d of drift) {
  console.log(`  ↻ ${d.id} (${d.name}) — ${d.reason}`);
}
for (const m of missing) {
  console.log(`  ✗ ${m.id} (${m.name}) — not found upstream`);
}

if (drift.length > 0 || missing.length > 0) process.exit(2);

function pickTracked(rb) {
  const out = {};
  for (const f of TRACKED_FIELDS) {
    if (rb[f] !== undefined && rb[f] !== null && rb[f] !== '') out[f] = rb[f];
  }
  return out;
}

function writeReport(report) {
  const path = join(root, 'public/station-drift.json');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
}
