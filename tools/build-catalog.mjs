#!/usr/bin/env node
/**
 * Reads data/broadcasters.yaml + data/stations.yaml, writes the curated
 * subset to public/stations.json. Stations inherit fields from their
 * broadcaster (metadata key, country, homepage) unless they override.
 *
 * Stations may carry a `stationuuid` referencing a Radio Browser record.
 * When set, the RB record is used as the baseline and local YAML fields
 * override it field-by-field. This lets us keep tiny enrichment rows
 * (uuid + curated logo + fetcher key) and rely on RB for the fungible
 * data (stream URL, codec, bitrate, geo, tags). RB lookups are cached
 * under .cache/ so rebuilds are offline-safe once primed.
 *
 * Only stations whose status is one of {working, stream-only, icy-only}
 * are emitted. Other statuses (investigate, fetcher-todo, not-public,
 * broken) are kept in the YAML as documentation but stay out of the
 * shipped catalog.
 *
 *   npm run catalog               — fetch fresh RB data when cache is stale
 *   RRRADIO_OFFLINE=1 npm run catalog
 *                                 — cache-only, fail if any uuid is missing
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { fetchByUuid } from './rb-client.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const PUBLISHABLE = new Set(['working', 'stream-only', 'icy-only']);
const OFFLINE = process.env.RRRADIO_OFFLINE === '1' || process.argv.includes('--offline');

function loadYaml(path) {
  const text = readFileSync(join(root, path), 'utf8');
  const parsed = parseYaml(text);
  if (parsed === null || parsed === undefined) {
    throw new Error(`${path}: empty or invalid YAML`);
  }
  return parsed;
}

function fail(msg) {
  console.error(`build-catalog: ${msg}`);
  process.exit(1);
}

const broadcasters = loadYaml('data/broadcasters.yaml');
const stations = loadYaml('data/stations.yaml');

if (!broadcasters || typeof broadcasters !== 'object') fail('broadcasters.yaml: not a map');
if (!Array.isArray(stations)) fail('stations.yaml: not a list');

// ─── 1. Pre-merge validation: things that don't depend on RB ────────────
const errors = [];
const seenIds = new Set();
const seenUuids = new Set();
for (const s of stations) {
  if (!s || typeof s !== 'object') {
    errors.push('station entry is not an object');
    continue;
  }
  if (!s.id) errors.push(`station missing id: ${JSON.stringify(s).slice(0, 80)}`);
  else if (seenIds.has(s.id)) errors.push(`duplicate station id: ${s.id}`);
  else seenIds.add(s.id);
  if (!s.status) errors.push(`${s.id}: missing status`);
  if (!s.broadcaster) errors.push(`${s.id}: missing broadcaster`);
  else if (!broadcasters[s.broadcaster]) {
    errors.push(`${s.id}: unknown broadcaster ${s.broadcaster}`);
  }
  if (s.stationuuid) {
    if (seenUuids.has(s.stationuuid)) {
      errors.push(`${s.id}: stationuuid reused (${s.stationuuid})`);
    } else seenUuids.add(s.stationuuid);
  }
}
if (errors.length > 0) {
  for (const e of errors) console.error(`build-catalog: ${e}`);
  process.exit(1);
}

// ─── 2. Resolve RB baselines for entries with stationuuid ───────────────
const uuidsNeeded = stations
  .filter((s) => s.stationuuid && PUBLISHABLE.has(s.status))
  .map((s) => s.stationuuid);

let rbByUuid = new Map();
if (uuidsNeeded.length > 0) {
  console.log(
    `catalog: resolving ${uuidsNeeded.length} stationuuid(s) ${OFFLINE ? '(offline)' : 'from Radio Browser'}…`,
  );
  const records = await fetchByUuid(uuidsNeeded, { offline: OFFLINE });
  for (const r of records) rbByUuid.set(r.stationuuid, r);
  const missing = uuidsNeeded.filter((u) => !rbByUuid.has(u));
  if (missing.length > 0) {
    // Missing upstream is non-fatal — local fields may still cover it,
    // but the operator should know.
    console.warn(
      `build-catalog: ${missing.length} stationuuid(s) not found upstream: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ', …' : ''}`,
    );
  }
}

// ─── 3. Merge: RB baseline → broadcaster fallback → local override ──────
function pickStreamUrl(rb) {
  return rb?.url_resolved || rb?.url || undefined;
}

function pickGeo(rb) {
  if (rb?.geo_lat == null || rb?.geo_long == null) return undefined;
  // Round to 4 decimals (~10m), matches the convention in stations.yaml.
  const round = (n) => Math.round(n * 1e4) / 1e4;
  return [round(rb.geo_lat), round(rb.geo_long)];
}

function pickTags(rb) {
  if (!rb?.tags) return undefined;
  const list = rb.tags
    .split(/[,;]/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  return list.length > 0 ? [...new Set(list)].slice(0, 6) : undefined;
}

function merged(s) {
  const b = broadcasters[s.broadcaster] ?? {};
  const rb = s.stationuuid ? rbByUuid.get(s.stationuuid) : undefined;

  // Build the RB-derived view of the station first (the baseline).
  const fromRb = rb
    ? {
        name: rb.name,
        streamUrl: pickStreamUrl(rb),
        homepage: rb.homepage || undefined,
        country: rb.countrycode || undefined,
        tags: pickTags(rb),
        favicon: rb.favicon || undefined,
        bitrate: rb.bitrate && rb.bitrate > 0 ? rb.bitrate : undefined,
        codec: rb.codec || undefined,
        geo: pickGeo(rb),
      }
    : {};

  // Local YAML fields win on every key they set; broadcaster fills in
  // the org-wide things (metadata fetcher key, default country/homepage)
  // when neither local nor RB provided one.
  return {
    id: s.id,
    name: s.name ?? fromRb.name,
    streamUrl: s.streamUrl ?? fromRb.streamUrl,
    homepage: s.homepage ?? b.homepage ?? fromRb.homepage,
    country: s.country ?? b.country ?? fromRb.country,
    tags: s.tags ?? fromRb.tags,
    favicon: s.favicon ?? fromRb.favicon,
    bitrate: s.bitrate ?? fromRb.bitrate,
    codec: s.codec ?? fromRb.codec,
    metadata: s.metadata ?? b.metadata,
    metadataUrl: s.metadataUrl,
    geo: Array.isArray(s.geo) && s.geo.length === 2 ? s.geo : fromRb.geo,
    featured: s.featured === true ? true : undefined,
    status: s.status,
    _rb: rb, // kept for post-merge validation; stripped before write
  };
}

// ─── 4. Post-merge validation, drift warning, build payload ─────────────
const built = [];
const counts = { total: stations.length, byStatus: {}, published: 0 };
const driftWarnings = [];
const fatal = [];

for (const s of stations) {
  counts.byStatus[s.status] = (counts.byStatus[s.status] ?? 0) + 1;
  if (!PUBLISHABLE.has(s.status)) continue;

  const m = merged(s);
  if (!m.name) fatal.push(`${s.id}: no name (local nor RB provides one)`);
  if (!m.streamUrl) fatal.push(`${s.id}: no streamUrl (local nor RB provides one)`);

  if (s.stationuuid && s.changeuuid && m._rb && m._rb.changeuuid !== s.changeuuid) {
    driftWarnings.push(
      `${s.id}: changeuuid drifted (stored ${s.changeuuid.slice(0, 8)}…, upstream ${m._rb.changeuuid.slice(0, 8)}…)`,
    );
  }

  delete m._rb;
  built.push(m);
}

if (fatal.length > 0) {
  for (const e of fatal) console.error(`build-catalog: ${e}`);
  process.exit(1);
}
counts.published = built.length;

const outPath = join(root, 'public/stations.json');
mkdirSync(dirname(outPath), { recursive: true });
const payload = {
  $schema: 'generated by tools/build-catalog.mjs from data/{broadcasters,stations}.yaml',
  stations: built,
};
writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n');

const summary = Object.entries(counts.byStatus)
  .map(([k, v]) => `${k}=${v}`)
  .join(', ');
console.log(
  `catalog: ${counts.published}/${counts.total} stations published → public/stations.json (${summary})`,
);
if (driftWarnings.length > 0) {
  console.log(`catalog: ${driftWarnings.length} drift warning(s) — run \`npm run check-drift\` for details`);
  for (const w of driftWarnings.slice(0, 5)) console.log(`  · ${w}`);
  if (driftWarnings.length > 5) console.log(`  · …and ${driftWarnings.length - 5} more`);
}
