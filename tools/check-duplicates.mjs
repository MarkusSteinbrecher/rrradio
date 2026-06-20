#!/usr/bin/env node
/**
 * Scans data/stations.yaml for likely-duplicate station entries.
 *
 * Duplicate signals are reported in three confidence tiers:
 *
 *   1. `stationuuid` collision — two entries pointing at the same RB
 *      record. Always a bug; build-catalog would fetch the same RB
 *      data twice and the runtime would render two rows backed by
 *      identical metadata.
 *   2. `streamUrl` collision — two entries with the exact same stream.
 *      Almost always a duplicate; the only legitimate case is a
 *      regional sub-feed that happens to share a URL with its parent
 *      (rare).
 *   3. Review collisions — same-country stream fingerprint + name
 *      signature (delivery variants of one feed, e.g. "Bayern 1
 *      Oberbayern (HLS 96)" + "(HLS 192)"), same-country Radio Browser
 *      canonical group, same homepage + name signature, same favicon +
 *      name signature, or same homepage + favicon + name signature
 *      inside one country. These catch near-duplicates that slip past
 *      exact stream/name matching (e.g. "BR24" + "BR24live").
 *   4. Low-confidence collisions — exact country/name, exact global
 *      name, shared oversized RB canonical clusters, or cross-country
 *      RB canonical clusters. These are counted for triage but excluded
 *      from the unique likely-duplicate group total because they can
 *      bridge unrelated network stations.
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
import { normalizeStreamUrl, normalizeHomepage, streamFingerprint } from './lib/dedupe-normalize.mjs';
import { loadHealth, saveHealth, applyFacet } from './lib/health-record.mjs';
import { groupCatalog, loadCatalogOverrides } from './lib/catalog-dedupe.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATIONS_YAML = join(ROOT, 'data', 'stations.yaml');
const OUTPUT_JSON = join(ROOT, 'public', 'station-duplicates.json');
const DEDUPE_JSON = join(ROOT, 'data', 'sources', 'radio-browser', 'dedupe.json');
const MAX_RB_CANONICAL_AUDIT_SIZE = 20;

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
  // Shared normalizer, but we KEEP the query string — some shared-CDN
  // broadcasters (Sweden's tx-bauerse.sharp-stream.com, ARN's
  // stream-redirect.bauermedia.fi, …) use `?i=<channel>` or similar params
  // as the channel selector, so two genuinely distinct stations would
  // collide if we dropped queries. (The cross-country raw dedupe drops
  // them — its scope is noisier and dominated by tracking params.)
  return normalizeStreamUrl(url, { dropQuery: false });
}
function homepageKey(url) {
  // Host + path (drop protocol, `www.`, trailing slash, `/index.*`). Returns
  // '' when there's no host — groupBy ignores empty keys, so missing-homepage
  // entries don't pile into a false-positive group.
  return normalizeHomepage(url, { includePath: true });
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

function homepageSignatureKey(s) {
  const home = homepageKey(s.homepage);
  const cc = String(s.country ?? '').toUpperCase().trim();
  const sig = nameSignature(s.name);
  if (!home || !cc || !sig) return '';
  return `${cc}|${home}|${sig}`;
}

function streamFingerprintKey(s) {
  // Delivery variants of one physical feed: same stream host+path with
  // bitrate/codec/packaging tokens stripped (e.g. "Bayern 1 Oberbayern
  // (HLS 96)" + "(HLS 192)" → //br-radio.ard-mcdn.de/br/radio/b1obb). This is
  // the catalog-side mirror of dedupe-raw's stream-fingerprint signal. It adds
  // coverage the homepage/favicon signals miss: same feed, different bitrate,
  // when the entries carry different or missing homepages/favicons.
  //
  // Scoped to country + name signature (not the raw deduper's number guard):
  // streamFingerprint drops the query, so shared-CDN entrypoints whose real
  // channel selector lives in `?i=…` collapse to one fingerprint — Sweden's
  // tx-bauerse.sharp-stream.com/http_live.php?i=<channel> fuses Mix Megapol /
  // NRJ / Rockklassiker. Requiring an identical name signature keeps those
  // distinct (their bitrate-noise-stripped signatures differ) while still
  // merging true delivery variants, whose signatures match once "(HLS 96)" /
  // "(HLS 192)" noise is stripped. streamFingerprint already returns '' for
  // host-only / all-generic paths, so aggregator entrypoints never group here.
  const fp = streamFingerprint(s.streamUrl);
  const cc = countryCode(s);
  const sig = nameSignature(s.name);
  if (!fp || !cc || !sig) return '';
  return `${cc}|${fp}|${sig}`;
}

function faviconKey(s) {
  const fav = String(s.favicon ?? '').toLowerCase().trim();
  if (!fav || fav.startsWith('data:')) return '';
  return fav;
}

function faviconSignatureKey(s) {
  const fav = faviconKey(s);
  const cc = String(s.country ?? '').toUpperCase().trim();
  const sig = nameSignature(s.name);
  if (!fav || !cc || !sig) return '';
  return `${cc}|${fav}|${sig}`;
}

function countryNameKey(s) {
  const cc = countryCode(s);
  const name = nameKey(s.name);
  if (!cc || !name) return '';
  return `${cc}|${name}`;
}

function countryCode(s) {
  return String(s.country ?? '').toUpperCase().trim();
}

function loadDedupe() {
  try {
    const data = JSON.parse(readFileSync(DEDUPE_JSON, 'utf8'));
    const byStationUuid = data.byStationUuid && typeof data.byStationUuid === 'object'
      ? data.byStationUuid
      : {};
    const groupUuids = new Set(Object.keys(byStationUuid));
    const groupSizeByCanonical = new Map();
    const groupSize = (canonical) => groupSizeByCanonical.get(canonical) ?? 0;
    for (const group of Array.isArray(data.groups) ? data.groups : []) {
      if (!group?.canonical) continue;
      groupSizeByCanonical.set(group.canonical, Number(group.size) || 0);
    }
    for (const row of Object.values(byStationUuid)) {
      if (row?.canonical) groupUuids.add(row.canonical);
    }
    return {
      generatedAt: data.generatedAt ?? null,
      groupUuids,
      canonicalOf(uuid) {
        if (!uuid) return '';
        return byStationUuid[uuid]?.canonical ?? uuid;
      },
      hasGroup(uuid) {
        return groupUuids.has(uuid);
      },
      groupSize,
      isLargeGroup(canonical) {
        return groupSize(canonical) > MAX_RB_CANONICAL_AUDIT_SIZE;
      },
    };
  } catch (err) {
    console.warn(`check-duplicates: could not read dedupe DB, skipping rb-canonical signal: ${err.message}`);
    return {
      generatedAt: null,
      groupUuids: new Set(),
      canonicalOf(uuid) { return uuid || ''; },
      hasGroup() { return false; },
      groupSize() { return 0; },
      isLargeGroup() { return false; },
    };
  }
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
const byStreamFingerprint = groupBy(candidates, streamFingerprintKey).map(([key, group]) => ({
  kind: 'stream-fingerprint',
  key,
  confidence: 'review',
  entries: group.map((s) => stationEntry(s)),
}));
const byName = groupBy(candidates, (s) => nameKey(s.name)).map(([name, group]) => ({
  kind: 'name',
  key: name,
  confidence: 'low',
  entries: group.map((s) => stationEntry(s)),
}));
const byCountryName = groupBy(candidates, countryNameKey).map(([key, group]) => ({
  kind: 'country+name',
  key,
  confidence: 'low',
  entries: group.map((s) => stationEntry(s)),
}));
const byHomepageFavicon = groupBy(candidates, homepageFaviconKey).map(([key, group]) => ({
  kind: 'homepage+favicon',
  key,
  confidence: 'review',
  entries: group.map((s) => stationEntry(s)),
}));
const byHomepageSignature = groupBy(candidates, homepageSignatureKey).map(([key, group]) => ({
  kind: 'homepage+signature',
  key,
  confidence: 'review',
  entries: group.map((s) => stationEntry(s)),
}));
const byFaviconSignature = groupBy(candidates, faviconSignatureKey).map(([key, group]) => ({
  kind: 'favicon+signature',
  key,
  confidence: 'review',
  entries: group.map((s) => stationEntry(s)),
}));

const dedupe = loadDedupe();
const rbCanonicalGroups = groupBy(candidates, (s) => {
  if (!s.stationuuid || !dedupe.hasGroup(s.stationuuid)) return '';
  const canonical = dedupe.canonicalOf(s.stationuuid);
  if (dedupe.isLargeGroup(canonical)) return '';
  return canonical;
});
const byRbCanonical = [];
const byCrossCountryRbCanonical = [];
for (const [canonical, group] of rbCanonicalGroups) {
  const knownCountries = [...new Set(group.map(countryCode).filter(Boolean))].sort();
  if (knownCountries.length <= 1) {
    byRbCanonical.push({
      kind: 'rb-canonical',
      key: `${knownCountries[0] ?? 'UNKNOWN'}|${canonical}`,
      confidence: 'review',
      groupSize: dedupe.groupSize(canonical),
      entries: group.map((s) => stationEntry(s)),
    });
    continue;
  }

  byCrossCountryRbCanonical.push({
    kind: 'rb-canonical-cross-country',
    key: canonical,
    confidence: 'low',
    groupSize: dedupe.groupSize(canonical),
    entries: group.map((s) => stationEntry(s)),
  });

  for (const cc of knownCountries) {
    const countryGroup = group.filter((s) => countryCode(s) === cc);
    if (countryGroup.length < 2) continue;
    byRbCanonical.push({
      kind: 'rb-canonical',
      key: `${cc}|${canonical}`,
      confidence: 'review',
      groupSize: dedupe.groupSize(canonical),
      entries: countryGroup.map((s) => stationEntry(s)),
    });
  }
}
const byLargeRbCanonical = groupBy(candidates, (s) => {
  if (!s.stationuuid || !dedupe.hasGroup(s.stationuuid)) return '';
  const canonical = dedupe.canonicalOf(s.stationuuid);
  return dedupe.isLargeGroup(canonical) ? canonical : '';
}).map(([key, group]) => ({
  kind: 'rb-canonical-large',
  key,
  confidence: 'low',
  groupSize: dedupe.groupSize(key),
  entries: group.map((s) => stationEntry(s)),
}));

function stationEntry(s) {
  return {
    id: s.id,
    name: s.name,
    country: s.country,
    stationuuid: s.stationuuid,
    streamUrl: s.streamUrl,
  };
}

class UnionFind {
  constructor(items) {
    this.parent = new Map(items.map((item) => [item, item]));
  }

  find(item) {
    let root = item;
    while (this.parent.get(root) !== root) root = this.parent.get(root);
    let cur = item;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur);
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

function buildDuplicateGroups(signals) {
  const uf = new UnionFind(candidates.map((s) => s.id));
  for (const signal of signals) {
    for (const c of signal.collisions) {
      const ids = c.entries.map((e) => e.id).filter(Boolean);
      for (let i = 1; i < ids.length; i++) uf.union(ids[0], ids[i]);
    }
  }

  const signalByRoot = new Map();
  for (const signal of signals) {
    for (const c of signal.collisions) {
      const ids = c.entries.map((e) => e.id).filter(Boolean);
      if (ids.length < 2) continue;
      const root = uf.find(ids[0]);
      const list = signalByRoot.get(root) ?? [];
      list.push({ kind: c.kind, key: c.key });
      signalByRoot.set(root, list);
    }
  }

  const byId = new Map(candidates.map((s) => [s.id, s]));
  const membersByRoot = new Map();
  for (const id of byId.keys()) {
    const root = uf.find(id);
    if (!signalByRoot.has(root)) continue;
    const list = membersByRoot.get(root) ?? [];
    list.push(byId.get(id));
    membersByRoot.set(root, list);
  }

  return [...membersByRoot.entries()]
    .map(([root, members]) => {
      const signalsForGroup = signalByRoot.get(root) ?? [];
      const signalKinds = [...new Set(signalsForGroup.map((s) => s.kind))].sort();
      const severity = signalKinds.some((kind) => kind === 'stationuuid' || kind === 'streamUrl')
        ? 'blocking'
        : 'review';
      return {
        severity,
        signalKinds,
        signals: signalsForGroup,
        entries: members
          .map((s) => stationEntry(s))
          .sort((a, b) => String(a.id).localeCompare(String(b.id))),
      };
    })
    .sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'blocking' ? -1 : 1;
      return b.entries.length - a.entries.length || a.entries[0].id.localeCompare(b.entries[0].id);
    });
}

const blockingCollisions = [...byUuid, ...byStream];
const reviewCollisions = [
  ...byStreamFingerprint,
  ...byRbCanonical,
  ...byHomepageSignature,
  ...byFaviconSignature,
  ...byHomepageFavicon,
];
const lowConfidenceCollisions = [
  ...byCountryName,
  ...byName,
  ...byLargeRbCanonical,
  ...byCrossCountryRbCanonical,
];
const collisions = [...blockingCollisions, ...reviewCollisions, ...lowConfidenceCollisions];
const duplicateGroups = buildDuplicateGroups([
  { collisions: blockingCollisions },
  { collisions: reviewCollisions },
]);
const blockingDuplicateGroups = duplicateGroups.filter((g) => g.severity === 'blocking');
const reviewDuplicateGroups = duplicateGroups.filter((g) => g.severity === 'review');
const duplicateRows = duplicateGroups.reduce((sum, g) => sum + Math.max(0, g.entries.length - 1), 0);

// ─── 3. Report + write ──────────────────────────────────────────────
const summary = {
  generatedAt: new Date().toISOString(),
  totalScanned: candidates.length,
  dedupeGeneratedAt: dedupe.generatedAt,
  collisionCount: collisions.length,
  byKind: {
    stationuuid: byUuid.length,
    streamUrl: byStream.length,
    'stream-fingerprint': byStreamFingerprint.length,
    'rb-canonical': byRbCanonical.length,
    'rb-canonical-large': byLargeRbCanonical.length,
    'rb-canonical-cross-country': byCrossCountryRbCanonical.length,
    'country+name': byCountryName.length,
    'homepage+signature': byHomepageSignature.length,
    'favicon+signature': byFaviconSignature.length,
    name: byName.length,
    'homepage+favicon': byHomepageFavicon.length,
  },
  blockingCollisionCount: blockingCollisions.length,
  reviewCollisionCount: reviewCollisions.length,
  lowConfidenceCollisionCount: lowConfidenceCollisions.length,
  largeRbCanonicalCollisionCount: byLargeRbCanonical.length,
  crossCountryRbCanonicalCollisionCount: byCrossCountryRbCanonical.length,
  maxRbCanonicalAuditSize: MAX_RB_CANONICAL_AUDIT_SIZE,
  duplicateGroupCount: duplicateGroups.length,
  blockingDuplicateGroupCount: blockingDuplicateGroups.length,
  reviewDuplicateGroupCount: reviewDuplicateGroups.length,
  duplicateRows,
  duplicateGroups,
  collisions,
};

mkdirSync(dirname(OUTPUT_JSON), { recursive: true });
writeFileSync(OUTPUT_JSON, JSON.stringify(summary, null, 2) + '\n', 'utf8');

// Mirror the verdicts into the unified health record (docs/station-health.md):
// members of blocking groups → bad, review-tier groups → warn, rest → ok.
{
  const updates = new Map(candidates.map((s) => [s.id, { v: 'ok' }]));
  for (const g of duplicateGroups) {
    const verdict =
      g.severity === 'blocking'
        ? { v: 'bad', d: 'blocking duplicate group' }
        : { v: 'warn', d: 'review-tier duplicate group' };
    for (const e of g.entries) updates.set(e.id, verdict);
  }
  const record = loadHealth(ROOT);
  applyFacet(record, 'duplicate', updates, {
    tool: 'check-duplicates',
    scope: 'full',
    at: summary.generatedAt,
  });
  saveHealth(ROOT, record);
}

// ─── 4. Completeness gate for the §4a catalog collapse ───────────────────
// The published catalog (public/stations.json) must not contain two rows that
// are the same logical station — the build-time collapse must be complete.
// Re-group the PUBLISHED rows with the same country-scoped signals the collapse
// uses (minus not-duplicate overrides); any surviving multi-row group means a
// sibling was added to YAML without a rebuild, or a signal regressed. This is
// blocking. (The collapse keys on streamUrl/name/homepage/country — all present
// in stations.json — so no stationuuid is needed here.)
const incompleteCollapse = [];
{
  const STATIONS_JSON = join(ROOT, 'public', 'stations.json');
  try {
    const pub = JSON.parse(readFileSync(STATIONS_JSON, 'utf8'));
    const publishedStations = Array.isArray(pub) ? pub : pub.stations || [];
    if (publishedStations.length > 0) {
      const overrides = loadCatalogOverrides(ROOT);
      const { groups } = groupCatalog(publishedStations, { overrides });
      for (const g of groups) {
        if (g.length > 1) incompleteCollapse.push(g.map((r) => r.id));
      }
    }
  } catch (err) {
    console.warn(`check-duplicates: could not read published catalog for completeness check: ${err.message}`);
  }
}
if (incompleteCollapse.length > 0) {
  console.error(
    `check-duplicates: ${incompleteCollapse.length} INCOMPLETE collapse group(s) — ` +
      `the published catalog still ships same-station duplicates:`,
  );
  for (const ids of incompleteCollapse.slice(0, 20)) console.error(`  · ${ids.join(', ')}`);
  if (incompleteCollapse.length > 20) console.error(`  · …and ${incompleteCollapse.length - 20} more`);
  console.error(
    '\n  Fix: run `npm run catalog` to re-run the collapse, or add a not-duplicate\n' +
      '  entry to data/sources/catalog-dedupe-overrides.yaml if they are genuinely distinct.',
  );
}

if (collisions.length === 0 && incompleteCollapse.length === 0) {
  console.log('check-duplicates: 0 collisions found ✓');
  process.exit(0);
}

console.log();
console.log(
  `check-duplicates: ${collisions.length} collision group(s) ` +
    `(${byUuid.length} uuid, ${byStream.length} streamUrl, ` +
    `${byStreamFingerprint.length} stream-fingerprint, ` +
    `${byRbCanonical.length} rb-canonical, ${byLargeRbCanonical.length} large rb-canonical, ` +
    `${byCrossCountryRbCanonical.length} cross-country rb-canonical, ` +
    `${byCountryName.length} low-confidence country+name, ` +
    `${byHomepageSignature.length} homepage+signature, ${byFaviconSignature.length} favicon+signature, ` +
    `${byName.length} low-confidence name, ${byHomepageFavicon.length} homepage+favicon)`,
);
console.log(
  `check-duplicates: ${duplicateGroups.length} unique likely duplicate group(s), ` +
    `${duplicateRows} duplicate row(s) ` +
    `(${blockingDuplicateGroups.length} blocking, ${reviewDuplicateGroups.length} review)`,
);
for (const c of [...blockingCollisions, ...reviewCollisions].slice(0, 200)) {
  console.log();
  console.log(`  [${c.kind}] ${c.key}`);
  for (const e of c.entries) {
    console.log(`    · ${e.id.padEnd(36)} ${e.name}`);
    console.log(`      ${e.streamUrl}`);
  }
}
console.log();
console.log(`Report written to ${OUTPUT_JSON.replace(ROOT + '/', '')}`);
if (blockingCollisions.length > 0 || incompleteCollapse.length > 0) {
  process.exit(2);
}
console.log(
  'check-duplicates: review duplicate groups reported as curation warnings ✓',
);
process.exit(0);
