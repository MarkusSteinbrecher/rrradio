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
 *   RRRADIO_OFFLINE=1 RRRADIO_ALLOW_MISSING_RB=1 npm run catalog
 *                                 — local bulk-import mode; use local YAML
 *                                    fields when a uuid is not cached
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { buildFtsDatabase } from './build-catalog-fts.mjs';
import { writeStationCapabilities } from './build-station-capabilities.mjs';
import { fetchByUuid } from './rb-client.mjs';
import { deriveShortNames } from './lib/station-short-name.mjs';
import { familyBucketKey } from './lib/station-family.mjs';
import { nameTokens } from './lib/station-name-signature.mjs';
import { collapseCatalog, loadCatalogOverrides } from './lib/catalog-dedupe.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const PUBLISHABLE = new Set(['working', 'stream-only', 'icy-only']);
const OFFLINE = process.env.RRRADIO_OFFLINE === '1' || process.argv.includes('--offline');
const ALLOW_MISSING_RB =
  process.env.RRRADIO_ALLOW_MISSING_RB === '1' ||
  process.argv.includes('--allow-missing-rb');

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
  const records = await fetchByUuid(uuidsNeeded, {
    offline: OFFLINE,
    allowMissing: OFFLINE && ALLOW_MISSING_RB,
  });
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
  return normalizeTags(rb?.tags, 6);
}

function normalizeDate(value) {
  if (!value) return undefined;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

function normalizeTags(tags, limit) {
  if (tags === null || tags === undefined) return undefined;
  const source = Array.isArray(tags) ? tags : [tags];
  const list = source
    .flatMap((t) => String(t).split(/[,;]/))
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  const unique = [...new Set(list)];
  const normalized = typeof limit === 'number' ? unique.slice(0, limit) : unique;
  return normalized.length > 0 ? normalized : undefined;
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
        // Some RB rows ship a literal "null" string for favicon — coerce
        // to undefined so downstream URL safety checks don't trip.
        favicon: rb.favicon && rb.favicon !== 'null' ? rb.favicon : undefined,
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
    // Curated short name wins; a non-empty string is carried through verbatim.
    // An explicit empty YAML string opts the station out (carried as `null`
    // until the derivation pass drops it). `undefined` means "auto-derive
    // below from the brand family". See the short-name pass after §4.
    shortName:
      typeof s.shortName === 'string'
        ? (s.shortName.trim().length > 0 ? s.shortName.trim() : null)
        : undefined,
    broadcaster: s.broadcaster,
    streamUrl: s.streamUrl ?? fromRb.streamUrl,
    homepage: s.homepage ?? b.homepage ?? fromRb.homepage,
    country: s.country ?? b.country ?? fromRb.country,
    tags: normalizeTags(s.tags) ?? fromRb.tags,
    // Local YAML always wins. `faviconBlocked: true` only suppresses the
    // Radio Browser fallback — so once tools/scrape-logos or wiki-logos write
    // a real favicon into YAML, it ships and the block flag becomes vestigial.
    favicon: s.favicon ?? (s.faviconBlocked === true ? undefined : fromRb.favicon),
    faviconSource: s.faviconSource || undefined,
    faviconSourceType: s.faviconSourceType || undefined,
    faviconSourceUrl: s.faviconSourceUrl || undefined,
    faviconLicense: s.faviconLicense || undefined,
    faviconOk: s.faviconOk === true ? true : undefined,
    bitrate: s.bitrate ?? fromRb.bitrate,
    codec: s.codec ?? fromRb.codec,
    metadata: s.metadata ?? b.metadata,
    metadataUrl: s.metadataUrl,
    geo: Array.isArray(s.geo) && s.geo.length === 2 ? s.geo : fromRb.geo,
    featured: s.featured === true ? true : undefined,
    status: s.status,
    // Geo-restriction allow-list (ISO 3166-1 alpha-2, uppercase). Only
    // emitted when the local YAML sets the field — there's no RB
    // equivalent and no broadcaster fallback. Empty arrays are
    // intentionally dropped (treated as "no restriction known").
    availableIn:
      Array.isArray(s.availableIn) && s.availableIn.length > 0
        ? s.availableIn.map((cc) => String(cc).toUpperCase())
        : undefined,
    _rb: rb, // kept for post-merge validation; stripped before write
  };
}

// ─── 4. Post-merge validation, drift warning, build payload ─────────────
const built = [];
const curation = [];
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
  curation.push({
    id: s.id,
    stationuuid: s.stationuuid,
    changeuuid: s.changeuuid,
    reviewedAt: normalizeDate(s.reviewedAt),
  });
}

if (fatal.length > 0) {
  for (const e of fatal) console.error(`build-catalog: ${e}`);
  process.exit(1);
}

// ─── 4a. Collapse same-station records into one published entry ──────────
// A physical station can appear as several rows — different bitrate/codec
// renditions of one broadcast (curated `builtin-fm4` 192k + bulk-imported
// `at-fm4-orf` 128k). Left alone they ship as duplicate search results.
// Collapse groups them by the country-scoped structural signals (exact stream
// URL / fingerprint / name+homepage) plus curator overrides, keeps the richest
// row as canonical, and folds the others' streams into a ranked `streams[]` on
// the survivor. The losing YAML rows stay in source as variant inputs — only
// the canonical publishes. Runs BEFORE short-name derivation + FTS so those see
// one row per logical station. See design/decisions + docs/spec catalog-schema.
const { stations: collapsedStations, report: dedupeReport } = collapseCatalog(built, {
  overrides: loadCatalogOverrides(root),
});
built.length = 0;
built.push(...collapsedStations);
if (dedupeReport.totals.collapsedRows > 0) {
  console.log(
    `catalog: collapsed ${dedupeReport.totals.collapsedRows} duplicate row(s) → ` +
      `${dedupeReport.totals.groups} logical station(s) ` +
      `(${dedupeReport.totals.multiVariantStations} with stream variants)`,
  );
}

counts.published = built.length;

// ─── 4b. Derive per-station short names off the brand-family model ───────
// A station's short name is the distinguishing tail left after stripping the
// leading brand words it shares with its siblings (`Antenne Bayern - Chillout`
// → `Chillout`). We group by the *same* family model the dedupe redesign uses
// — `familyBucketKey`'s COUNTRY|homepage-host bucket — so a tail is resolved
// only against genuine siblings of one broadcaster, never a coincidental
// cross-broadcaster prefix (`Christmas Radio FM` must not become `FM`).
//
// We deliberately do NOT reuse `detectFamilies`' digit-guarded *core*: that
// guard treats a channel number as brand identity (keeping `Bayern 1`/`Bayern
// 2` in separate families for curation), which would orphan exactly the
// digit-discriminated channels a short name exists to surface (`BBC Radio 4` →
// `4`). The bucket is the shared half; the tail is the leading-word strip.
//
// The strip itself is the verbatim iOS `StationGridLabel` port — left untouched
// so catalog and app never disagree. Catalog-side we additionally drop two
// kinds of unusable tail: one with no identity-bearing token (`(AAC 64)` →
// `64)`, `||`) is codec/bitrate cruft, not a label; one longer than a caption
// could ever show (`SHORT_NAME_MAX`) comes from keyword-stuffed names and adds
// nothing over the full name. Both are covered by the app's own runtime strip,
// which reproduces the identical tail on demand. Curated YAML values are kept
// as-is; an empty string opts out.
const SHORT_NAME_MAX = 48; // caption ceiling — longer tails never fit a tight cell
const curatedCount = built.filter((m) => typeof m.shortName === 'string').length;
const optOutCount = built.filter((m) => m.shortName === null).length;

const familyBuckets = new Map();
for (const m of built) {
  const k = familyBucketKey(m);
  if (!k) continue; // no homepage/country, or an aggregator host → never a family
  if (!familyBuckets.has(k)) familyBuckets.set(k, []);
  familyBuckets.get(k).push(m);
}

let derivedCount = 0;
for (const group of familyBuckets.values()) {
  const derived = deriveShortNames(group);
  for (const m of group) {
    if (m.shortName !== undefined) continue; // curated or opted out
    const sn = derived.get(m.id);
    if (sn && sn.length <= SHORT_NAME_MAX && nameTokens(sn).length > 0) {
      m.shortName = sn;
      derivedCount += 1;
    }
  }
}

// Resolve the opt-out sentinel and drop every absent value before write.
for (const m of built) {
  if (typeof m.shortName !== 'string') delete m.shortName;
}
console.error(
  `build-catalog: ${curatedCount + derivedCount} short names ` +
    `(${derivedCount} derived, ${curatedCount} curated, ${optOutCount} opted out)`,
);

const outPath = join(root, 'public/stations.json');
mkdirSync(dirname(outPath), { recursive: true });
const payload = {
  $schema: 'generated by tools/build-catalog.mjs from data/{broadcasters,stations}.yaml',
  stations: built,
};
writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n');

const curationPath = join(root, 'public/station-curation.json');
writeFileSync(
  curationPath,
  JSON.stringify({
    $schema: 'generated by tools/build-catalog.mjs from data/stations.yaml',
    generatedAt: new Date().toISOString(),
    stations: curation,
  }, null, 2) + '\n',
);

// Audit trail for the §4a collapse: every logical-station group, its
// canonical, the rows folded into it, and the resulting variants. Consumed by
// the check-catalog/check-duplicates completeness gates and reviewable in diff.
const dedupeReportPath = join(root, 'public/dedup-report.json');
writeFileSync(
  dedupeReportPath,
  JSON.stringify({
    $schema: 'generated by tools/build-catalog.mjs via tools/lib/catalog-dedupe.mjs',
    generatedAt: new Date().toISOString(),
    ...dedupeReport,
  }, null, 2) + '\n',
);

const capabilities = writeStationCapabilities();
const ftsPath = buildFtsDatabase(built, { log: false });

const summary = Object.entries(counts.byStatus)
  .map(([k, v]) => `${k}=${v}`)
  .join(', ');
console.log(
  `catalog: ${counts.published}/${counts.total} stations published → public/stations.json (${summary})`,
);
console.log(
  `catalog: metadata capabilities → public/station-capabilities.json (api=${capabilities.counts.byMetadataStrategy.api}, icy=${capabilities.counts.byMetadataStrategy.icy}, hls=${capabilities.counts.byMetadataStrategy.hls}, none=${capabilities.counts.byMetadataStrategy.none})`,
);
if (ftsPath) {
  console.log(`catalog: SQLite FTS5 index → ${ftsPath.replace(`${root}/`, '')}`);
} else {
  console.log('catalog: SQLite FTS5 index skipped');
}
if (driftWarnings.length > 0) {
  console.log(`catalog: ${driftWarnings.length} drift warning(s) — run \`npm run check-drift\` for details`);
  for (const w of driftWarnings.slice(0, 5)) console.log(`  · ${w}`);
  if (driftWarnings.length > 5) console.log(`  · …and ${driftWarnings.length - 5} more`);
}
