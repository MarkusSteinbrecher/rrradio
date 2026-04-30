#!/usr/bin/env node
/**
 * Scans data/stations.yaml for likely-duplicate station entries.
 *
 * Three kinds of collision are reported:
 *
 *   1. `stationuuid` collision — two entries pointing at the same RB
 *      record. Always a bug; build-catalog would fetch the same RB
 *      data twice and the runtime would render two rows backed by
 *      identical metadata.
 *   2. `streamUrl` collision — two entries with the exact same stream.
 *      Almost always a duplicate; the only legitimate case is a
 *      regional sub-feed that happens to share a URL with its parent
 *      (rare).
 *   3. `name` collision (case-insensitive, whitespace-collapsed) —
 *      two entries with the same display name. Usually a duplicate
 *      ("BBC World Service" appearing twice). Occasionally a real
 *      pair across countries (e.g. a "Radio 1" in two networks),
 *      which the curator confirms manually.
 *
 * Read-only on the YAML — surfaces findings, doesn't auto-fix.
 *
 *   npm run check-duplicates
 *
 * Exits non-zero when collisions are found so the catalog-watch
 * workflow can branch and open a triage issue. Writes
 * public/station-duplicates.json with the structured findings so
 * the admin dashboard can render them too.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATIONS_YAML = join(ROOT, 'data', 'stations.yaml');
const OUTPUT_JSON = join(ROOT, 'public', 'station-duplicates.json');

// ─── 1. Load + normalise ─────────────────────────────────────────────
const stations = YAML.parse(readFileSync(STATIONS_YAML, 'utf8'));
if (!Array.isArray(stations)) {
  console.error('check-duplicates: data/stations.yaml did not parse as a list');
  process.exit(1);
}

const PUBLISHABLE = new Set(['working', 'icy-only', 'stream-only']);
const candidates = stations.filter((s) => PUBLISHABLE.has(s.status));
console.log(
  `check-duplicates: scanning ${candidates.length} publishable station(s) ` +
    `(of ${stations.length} total in YAML)…`,
);

function nameKey(name) {
  return String(name ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
}
function urlKey(url) {
  // Lowercase + strip trailing slash. We DO keep the query string —
  // some shared-CDN broadcasters (Sweden's tx-bauerse.sharp-stream.com,
  // ARN's stream-redirect.bauermedia.fi, …) use `?i=<channel>` or
  // similar params as the channel selector, so two genuinely distinct
  // stations would collide if we dropped queries. The cost is that
  // auth-token-bearing variants (?token=…) won't match across rotations,
  // but those are edge cases the curator can spot.
  return String(url ?? '').toLowerCase().replace(/\/+(\?|$)/, '$1');
}

// ─── 2. Group by each key ────────────────────────────────────────────
function groupBy(list, keyFn) {
  const map = new Map();
  for (const s of list) {
    const k = keyFn(s);
    if (!k) continue;
    const arr = map.get(k) ?? [];
    arr.push(s);
    map.set(k, arr);
  }
  // Only return groups with collisions
  return [...map.entries()].filter(([, arr]) => arr.length > 1);
}

const byUuid = groupBy(candidates, (s) => s.stationuuid).map(([uuid, group]) => ({
  kind: 'stationuuid',
  key: uuid,
  entries: group.map((s) => ({ id: s.id, name: s.name, streamUrl: s.streamUrl })),
}));
const byStream = groupBy(candidates, (s) => urlKey(s.streamUrl)).map(([url, group]) => ({
  kind: 'streamUrl',
  key: url,
  entries: group.map((s) => ({ id: s.id, name: s.name, streamUrl: s.streamUrl })),
}));
const byName = groupBy(candidates, (s) => nameKey(s.name)).map(([name, group]) => ({
  kind: 'name',
  key: name,
  entries: group.map((s) => ({ id: s.id, name: s.name, streamUrl: s.streamUrl })),
}));

const collisions = [...byUuid, ...byStream, ...byName];

// ─── 3. Report + write ──────────────────────────────────────────────
const summary = {
  generatedAt: new Date().toISOString(),
  totalScanned: candidates.length,
  collisionCount: collisions.length,
  byKind: {
    stationuuid: byUuid.length,
    streamUrl: byStream.length,
    name: byName.length,
  },
  collisions,
};

mkdirSync(dirname(OUTPUT_JSON), { recursive: true });
writeFileSync(OUTPUT_JSON, JSON.stringify(summary, null, 2) + '\n', 'utf8');

if (collisions.length === 0) {
  console.log('check-duplicates: 0 collisions found ✓');
  process.exit(0);
}

console.log();
console.log(
  `check-duplicates: ${collisions.length} collision group(s) ` +
    `(${byUuid.length} uuid, ${byStream.length} streamUrl, ${byName.length} name)`,
);
for (const c of collisions) {
  console.log();
  console.log(`  [${c.kind}] ${c.key}`);
  for (const e of c.entries) {
    console.log(`    · ${e.id.padEnd(36)} ${e.name}`);
    console.log(`      ${e.streamUrl}`);
  }
}
console.log();
console.log(`Report written to ${OUTPUT_JSON.replace(ROOT + '/', '')}`);
process.exit(2);
