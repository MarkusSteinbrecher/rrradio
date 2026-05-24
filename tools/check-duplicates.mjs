#!/usr/bin/env node
/**
 * Scans data/stations.yaml for likely-duplicate station entries.
 *
 * Four kinds of collision are reported:
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
 *   4. `homepage+favicon` collision — two entries within the same
 *      country pointing at the same homepage URL *and* the same
 *      favicon URL. Catches near-duplicates that slip past exact
 *      stream/name matching (e.g. "BR24" + "BR24live" where the same
 *      broadcaster ships two slightly-different stream paths). Same
 *      broadcaster + same brand mark = same station.
 *
 * Read-only on the YAML — surfaces findings, doesn't auto-fix.
 *
 *   npm run check-duplicates
 *
 * Exits non-zero when UUID or stream URL collisions are found so the catalog-watch
 * workflow can branch and open a triage issue. Name- and homepage+favicon-only
 * collisions are reported as curation warnings (exit 0). Writes
 * public/station-duplicates.json with the structured findings so
 * the admin dashboard can render them too.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { nameSignature } from './lib/station-name-signature.mjs';

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
function homepageKey(url) {
  // Normalise homepage URLs aggressively so trivial variants collide:
  // lowercase, drop protocol, drop `www.`, drop trailing slash, drop
  // `/index.{html,htm,php}` suffix. Returns '' when there's no host —
  // groupBy ignores empty keys, so missing-homepage entries don't
  // pile up into a giant false-positive group.
  try {
    const u = new URL(String(url));
    const host = u.host.toLowerCase().replace(/^www\./, '');
    if (!host) return '';
    let path = u.pathname.replace(/\/index\.(html?|php)$/i, '').replace(/\/$/, '');
    return `${host}${path}`;
  } catch {
    return '';
  }
}
function homepageFaviconKey(s) {
  // Group within the same country + broadcaster identity (homepage URL
  // + favicon URL) and require the name signatures to match after
  // stripping noise tokens like "live", "online", "hd". This keeps
  // BR24 + BR24live colliding while letting genuinely-distinct
  // sub-channels under one broadcaster (different decades, formats,
  // genres) stay apart.
  const home = homepageKey(s.homepage);
  const fav = String(s.favicon ?? '').toLowerCase().trim();
  const cc = String(s.country ?? '').toUpperCase().trim();
  const sig = nameSignature(s.name);
  if (!home || !fav || !cc || !sig) return '';
  return `${cc}|${home}|${fav}|${sig}`;
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
const byHomepageFavicon = groupBy(candidates, homepageFaviconKey).map(([key, group]) => ({
  kind: 'homepage+favicon',
  key,
  entries: group.map((s) => ({ id: s.id, name: s.name, streamUrl: s.streamUrl })),
}));

const blockingCollisions = [...byUuid, ...byStream];
const collisions = [...byUuid, ...byStream, ...byName, ...byHomepageFavicon];

// ─── 3. Report + write ──────────────────────────────────────────────
const summary = {
  generatedAt: new Date().toISOString(),
  totalScanned: candidates.length,
  collisionCount: collisions.length,
  byKind: {
    stationuuid: byUuid.length,
    streamUrl: byStream.length,
    name: byName.length,
    'homepage+favicon': byHomepageFavicon.length,
  },
  blockingCollisionCount: blockingCollisions.length,
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
    `(${byUuid.length} uuid, ${byStream.length} streamUrl, ` +
    `${byName.length} name, ${byHomepageFavicon.length} homepage+favicon)`,
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
if (blockingCollisions.length > 0) {
  process.exit(2);
}
console.log(
  'check-duplicates: name + homepage+favicon collisions reported as curation warnings ✓',
);
process.exit(0);
