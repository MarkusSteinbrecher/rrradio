#!/usr/bin/env node
/**
 * Cross-country dedupe over the raw Radio Browser source DB.
 *
 * Reads:
 *   data/sources/radio-browser/by-country/<CC>.json     — raw RB snapshots
 *   data/sources/radio-browser/overrides.yaml           — curator overrides
 *
 * Writes:
 *   data/sources/radio-browser/dedupe.json              — canonical dedupe DB
 *
 *   npm run dedupe-raw
 *
 * Method:
 *
 * 1. Union-find across two automatic signals
 *    a) Normalized streamUrl              (high confidence — same physical stream)
 *    b) Country | name-signature | host   (medium confidence — same brand on same broadcaster home)
 *    Each link records the signal that triggered it for provenance.
 *
 * 2. Apply curator overrides
 *    - `not-duplicate` pairs: split the group so the listed UUIDs become singletons
 *    - `force-merge` groups: union them all together; flag the group `lockedBy: override`
 *
 * 3. For each resulting group of size ≥ 2, pick the canonical row:
 *    highest votes, then highest clickcount, then earliest changeuuid
 *    (stable across runs when RB data is unchanged).
 *
 * Output shape (top-level keys):
 *   {
 *     schemaVersion: 1,
 *     generatedAt, signals: [...],
 *     totals: { stationsConsidered, duplicateRows, groups, locked, ... },
 *     groups: [
 *       { canonical, members: [ { uuid, country, name, via } ], lockedBy? }
 *     ],
 *     byStationUuid: {                  ← O(1) lookup table for the build step
 *       "<uuid-of-duplicate>": { canonical: "<canonical-uuid>", via, group: <idx> }
 *     },
 *   }
 *
 * Safety: groups exceeding MAX_GROUP_SIZE are kept but flagged. These
 * usually indicate a shared CDN URL (e.g. a Shoutcast wildcard) that's
 * sweeping in unrelated stations — worth investigating manually.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { nameSignature } from './lib/station-name-signature.mjs';
import { normalizeStreamUrl, normalizeHomepage } from './lib/dedupe-normalize.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const RAW_DIR = join(ROOT, 'data', 'sources', 'radio-browser', 'by-country');
const OVERRIDES = join(ROOT, 'data', 'sources', 'radio-browser', 'overrides.yaml');
const OUT = join(ROOT, 'data', 'sources', 'radio-browser', 'dedupe.json');

const MAX_GROUP_SIZE = 50;

// Stronger signals win when stamping a duplicate's `via` provenance.
const SIGNAL_RANK = { override: 0, 'stream-url': 1, 'name+homepage': 2 };

// ─── Load all stations ─────────────────────────────────────────────
const stations = [];
const byUuid = new Map();

const files = readdirSync(RAW_DIR).filter((f) => /^[A-Z]{2}\.json$/.test(f)).sort();
for (const file of files) {
  let data;
  try { data = JSON.parse(readFileSync(join(RAW_DIR, file), 'utf8')); }
  catch (err) { console.warn(`dedupe-raw: skipping ${file} — ${err.message}`); continue; }
  for (const s of data.stations || []) {
    if (!s?.stationuuid) continue;
    if (byUuid.has(s.stationuuid)) continue; // first-write wins; raw files shouldn't collide but be safe
    const row = {
      uuid: s.stationuuid,
      changeuuid: s.changeuuid,
      name: s.name || '',
      country: s.countrycode || file.slice(0, 2),
      streamUrl: s.url_resolved || s.url,
      homepage: s.homepage,
      votes: s.votes ?? 0,
      clickcount: s.clickcount ?? 0,
    };
    stations.push(row);
    byUuid.set(row.uuid, row);
  }
}
console.log(`dedupe-raw: ${stations.length} stations across ${files.length} countries`);

// ─── Union-find ────────────────────────────────────────────────────
const parent = new Map();
const linkSignal = new Map(); // uuid → signal that joined it (most recent wins; ordering of signals matters)
for (const s of stations) parent.set(s.uuid, s.uuid);

function find(x) {
  let r = x;
  while (parent.get(r) !== r) r = parent.get(r);
  // Path compression.
  let cur = x;
  while (parent.get(cur) !== r) {
    const next = parent.get(cur);
    parent.set(cur, r);
    cur = next;
  }
  return r;
}
function recordSignal(uuid, signal) {
  // Keep the STRONGEST signal that ever linked this node (override >
  // stream-url > name+homepage), not the last one to fire — so a high-
  // confidence stream match isn't masked by a later name-based link.
  const cur = linkSignal.get(uuid);
  if (cur === undefined || SIGNAL_RANK[signal] < SIGNAL_RANK[cur]) {
    linkSignal.set(uuid, signal);
  }
}
function union(a, b, signal) {
  // Record provenance even when a and b are already connected — a later
  // stronger signal should still upgrade their `via`.
  recordSignal(a, signal);
  recordSignal(b, signal);
  const ra = find(a);
  const rb = find(b);
  if (ra === rb) return;
  parent.set(ra, rb);
}

function groupBy(items, keyFn) {
  const m = new Map();
  for (const s of items) {
    const k = keyFn(s);
    if (!k) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(s);
  }
  return m;
}

// Signal A: normalized streamUrl (protocol-insensitive, query dropped).
let unionedByStream = 0;
{
  const groups = groupBy(stations, (s) => normalizeStreamUrl(s.streamUrl));
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    for (let i = 1; i < list.length; i++) {
      union(list[0].uuid, list[i].uuid, 'stream-url');
      unionedByStream++;
    }
  }
}
// Signal B: country | name signature | homepage host.
let unionedByName = 0;
{
  const groups = groupBy(stations, (s) => {
    const sig = nameSignature(s.name);
    const host = normalizeHomepage(s.homepage);
    if (!sig || !host || !s.country) return '';
    return `${s.country.toUpperCase()}|${sig}|${host}`;
  });
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    for (let i = 1; i < list.length; i++) {
      union(list[0].uuid, list[i].uuid, 'name+homepage');
      unionedByName++;
    }
  }
}
console.log(`dedupe-raw: linked ${unionedByStream} pair(s) by streamUrl, ${unionedByName} by name+homepage`);

// ─── Overrides ─────────────────────────────────────────────────────
let overrides = { 'not-duplicate': [], 'force-merge': [] };
if (existsSync(OVERRIDES)) {
  try {
    const parsed = YAML.parse(readFileSync(OVERRIDES, 'utf8')) || {};
    overrides['not-duplicate'] = parsed['not-duplicate'] || [];
    overrides['force-merge']   = parsed['force-merge']   || [];
  } catch (err) {
    console.warn(`dedupe-raw: overrides.yaml unparseable, ignoring: ${err.message}`);
  }
}

// Force-merge: union every listed uuid.
let forceMergeCount = 0;
const lockedByOverride = new Set();
for (const g of overrides['force-merge']) {
  if (!g?.canonical || !Array.isArray(g.duplicates)) continue;
  if (!byUuid.has(g.canonical)) {
    console.warn(`dedupe-raw: force-merge canonical not in raw DB: ${g.canonical}`);
    continue;
  }
  for (const d of g.duplicates) {
    if (!byUuid.has(d)) {
      console.warn(`dedupe-raw: force-merge duplicate not in raw DB: ${d}`);
      continue;
    }
    union(g.canonical, d, 'override');
    forceMergeCount++;
  }
  lockedByOverride.add(g.canonical);
  for (const d of g.duplicates) lockedByOverride.add(d);
}

// not-duplicate: each listed uuid is extracted from its auto-derived group
// at materialize time (below) and emitted as a standalone — reliable
// whether the uuid was a group leaf or its root. (Re-parenting in the
// union-find was unreliable: resetting a node that was the group root left
// every other member still resolving to it, so nothing actually split.)
let notDupeCount = 0;
const protectedFromAuto = new Set();
for (const entry of overrides['not-duplicate']) {
  const uuids = entry?.uuids;
  if (!Array.isArray(uuids)) continue;
  for (const u of uuids) {
    if (!byUuid.has(u)) {
      console.warn(`dedupe-raw: not-duplicate uuid not in raw DB: ${u}`);
      continue;
    }
    protectedFromAuto.add(u);
    notDupeCount++;
  }
}

console.log(`dedupe-raw: overrides applied — force-merge ${forceMergeCount}, not-duplicate ${notDupeCount}`);

// ─── Materialize groups ────────────────────────────────────────────
const rootToMembers = new Map();
for (const s of stations) {
  const r = find(s.uuid);
  if (!rootToMembers.has(r)) rootToMembers.set(r, []);
  rootToMembers.get(r).push(s);
}

function compareCandidates(a, b) {
  // Highest votes, then clicks, then earliest changeuuid (stable).
  if ((b.votes ?? 0) !== (a.votes ?? 0)) return (b.votes ?? 0) - (a.votes ?? 0);
  if ((b.clickcount ?? 0) !== (a.clickcount ?? 0)) return (b.clickcount ?? 0) - (a.clickcount ?? 0);
  return (a.changeuuid || '').localeCompare(b.changeuuid || '');
}

// Trim redundancy: per-station fields (name, country, votes…) all
// live in the raw snapshots already. dedupe.json only stores the
// relationship: which uuid is the canonical, which signal joined
// them. Consumers look up names via the raw DB.
const groups = [];
let oversizedGroups = 0;

for (const allMembers of rootToMembers.values()) {
  // Pull curator-asserted not-duplicate uuids out of the group entirely —
  // they become standalone, never a duplicate of anyone.
  const members = allMembers.filter((m) => !protectedFromAuto.has(m.uuid));
  if (members.length < 2) continue;
  members.sort(compareCandidates);
  const canonical = members[0];
  const dupMembers = members.slice(1);
  const locked = lockedByOverride.has(canonical.uuid) ? 'override' : undefined;
  const oversized = members.length > MAX_GROUP_SIZE;
  if (oversized) oversizedGroups++;
  groups.push({
    canonical: canonical.uuid,
    size: members.length,
    // duplicates are sorted for stable git diffs.
    duplicates: dupMembers
      .map((m) => ({ uuid: m.uuid, via: linkSignal.get(m.uuid) || 'union' }))
      .sort((a, b) => a.uuid.localeCompare(b.uuid)),
    ...(locked ? { lockedBy: locked } : {}),
    ...(oversized ? { oversized: true } : {}),
  });
}

// Stable group order by canonical uuid.
groups.sort((a, b) => a.canonical.localeCompare(b.canonical));

// Flat lookup table — the primary consumer surface for build-sources.
// Keys sorted so git diffs only change where data actually changed.
const byStationUuid = {};
const sortedUuids = [];
for (const g of groups) {
  for (const d of g.duplicates) {
    sortedUuids.push({ uuid: d.uuid, canonical: g.canonical, via: d.via, ...(g.lockedBy ? { lockedBy: g.lockedBy } : {}) });
  }
}
sortedUuids.sort((a, b) => a.uuid.localeCompare(b.uuid));
for (const e of sortedUuids) {
  const { uuid, ...rest } = e;
  byStationUuid[uuid] = rest;
}

const duplicateRows = sortedUuids.length;
const lockedCount = groups.filter((g) => g.lockedBy === 'override').length;

const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  signals: [
    { id: 'stream-url',     description: 'Normalized streamUrl collision (cross-country).' },
    { id: 'name+homepage',  description: 'Same country + name signature + homepage host.' },
    { id: 'override',       description: 'Curator force-merge in overrides.yaml.' },
  ],
  totals: {
    stationsConsidered: stations.length,
    duplicateRows,
    groups: groups.length,
    overridesApplied: forceMergeCount + notDupeCount,
    lockedGroups: lockedCount,
    oversizedGroups,
  },
  groups,
  byStationUuid,
};

writeFileSync(OUT, JSON.stringify(output, null, 2) + '\n');
console.log(
  `dedupe-raw: ${groups.length} group(s), ${duplicateRows} duplicate row(s)`
  + (lockedCount > 0 ? `, ${lockedCount} locked by override` : '')
  + (oversizedGroups > 0 ? `, ${oversizedGroups} oversized (>${MAX_GROUP_SIZE}) — investigate` : ''),
);
console.log(`dedupe-raw: → ${OUT.replace(ROOT + '/', '')}`);
