#!/usr/bin/env node
/**
 * Build a local-only iOS test catalog from the station-tracker playable set.
 *
 * This intentionally does not update public/stations.json. It creates a
 * separate JSON feed that mirrors the iOS Station decoder shape while using
 * one row per dashboard-playable source candidate, including HTTP streams.
 *
 *   npm run catalog:ios-local
 *
 * Output:
 *   public/stations-ios-local.json
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { writeStationCapabilities } from './build-station-capabilities.mjs';
import { detectFamilies, familyBucketKey } from './lib/station-family.mjs';
import { nameTokens } from './lib/station-name-signature.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PUBLIC = join(ROOT, 'public');
const OUT = join(PUBLIC, 'stations-ios-local.json');
const CAPABILITIES_OUT = join(PUBLIC, 'station-capabilities-ios-local.json');
const PUBLISHED_CATALOG = join(PUBLIC, 'stations.json');
const STATIONS_YAML = join(ROOT, 'data', 'stations.yaml');
const RB_CANDIDATES = join(PUBLIC, 'sources', 'radio-browser-candidates.json');
const MANUAL_CANDIDATES = join(PUBLIC, 'sources', 'manual-candidates.json');
const BYTE_PROBES = join(PUBLIC, 'sources', 'radio-browser-byte-probes.json');
const RAW_DIR = join(ROOT, 'data', 'sources', 'radio-browser', 'by-country');

function fail(message) {
  console.error(`catalog:ios-local: ${message}`);
  process.exit(1);
}

function readJson(path, fallback = null) {
  if (!existsSync(path)) {
    if (fallback !== null) return fallback;
    fail(`${path.replace(`${ROOT}/`, '')} not found`);
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

function text(value) {
  return String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanUrl(value, { httpsOnly = false } = {}) {
  const url = text(value);
  if (!url || url === 'null' || url.startsWith('data:')) return undefined;
  try {
    const parsed = new URL(url);
    if (httpsOnly && parsed.protocol !== 'https:') return undefined;
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    return url;
  } catch {
    return undefined;
  }
}

function cleanFavicon(value) {
  const url = text(value);
  if (/^stations\/[^\s]+$/i.test(url)) return url;
  return cleanUrl(url, { httpsOnly: true });
}

function slug(value) {
  return text(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 44) || 'station';
}

function tags(value) {
  if (!value) return undefined;
  const source = Array.isArray(value) ? value : String(value).split(/[,;]/);
  const out = source
    .map((t) => text(t).toLowerCase())
    .filter(Boolean)
    .filter((t, i, a) => a.indexOf(t) === i)
    .slice(0, 6);
  return out.length > 0 ? out : undefined;
}

function geo(raw) {
  const lat = Number(raw?.geo_lat);
  const lon = Number(raw?.geo_long);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;
  const round = (n) => Math.round(n * 1e4) / 1e4;
  return [round(lat), round(lon)];
}

function loadRawByUuid() {
  if (!existsSync(RAW_DIR)) {
    fail('data/sources/radio-browser/by-country not found; run npm run fetch-rb-raw first');
  }
  const byUuid = new Map();
  for (const file of readdirSync(RAW_DIR).filter((f) => /^[A-Z]{2}\.json$/.test(f)).sort()) {
    const data = readJson(join(RAW_DIR, file), { stations: [] });
    for (const row of data.stations || []) {
      if (row?.stationuuid && !byUuid.has(row.stationuuid)) byUuid.set(row.stationuuid, row);
    }
  }
  return byUuid;
}

function byteProbeKey(stationuuid, streamUrl) {
  return `${stationuuid}::${streamUrl ?? ''}`;
}

function loadByteProbes() {
  const data = readJson(BYTE_PROBES, { results: [] });
  const byUuid = new Map();
  const byKey = new Map();
  for (const row of data.results || []) {
    if (!row?.stationuuid) continue;
    byUuid.set(row.stationuuid, row);
    byKey.set(byteProbeKey(row.stationuuid, row.streamUrl), row);
  }
  return {
    generatedAt: data.generatedAt ?? null,
    get(candidate) {
      return byKey.get(byteProbeKey(candidate.stationuuid, candidate.streamUrl))
        ?? byUuid.get(candidate.stationuuid);
    },
  };
}

function loadCatalogById() {
  const data = readJson(PUBLISHED_CATALOG, { stations: [] });
  const stations = Array.isArray(data) ? data : data.stations;
  const out = new Map();
  for (const station of stations || []) {
    if (station?.id) out.set(station.id, station);
  }
  return out;
}

/**
 * Map legacy/aliased Radio Browser `stationuuid`s → their curated catalog
 * station. The uuid/streamUrl matcher in build-sources can only link a candidate
 * to the catalog when they share a stationuuid or stream URL — so RB records that
 * pre-date a broadcaster's HTTPS migration or a rename (different uuid, dead old
 * stream, drifted name) stay orphaned and render iconless here. `akaStationUuids`
 * in data/stations.yaml declares those legacy ids so this catalog can inherit the
 * curated station's per-channel art. Source of truth is the YAML (build-catalog
 * strips the field from the public stations.json).
 */
function loadAkaCatalog(catalogById) {
  const out = new Map();
  let yamlList;
  try {
    yamlList = parseYaml(readFileSync(STATIONS_YAML, 'utf8'));
  } catch {
    return out;
  }
  if (!Array.isArray(yamlList)) return out;
  for (const s of yamlList) {
    if (!Array.isArray(s?.akaStationUuids)) continue;
    const station = catalogById.get(s.id);
    if (!station) continue;
    for (const uuid of s.akaStationUuids) {
      if (typeof uuid === 'string' && uuid && !out.has(uuid)) out.set(uuid, station);
    }
  }
  return out;
}

/**
 * Per detected brand family, a representative "brand" favicon plus the family's
 * name-token core. Last-resort icon for an RB candidate that belongs to a
 * broadcaster we curate but matches no specific station and has no usable
 * favicon of its own — so a name-drifted sibling renders the broadcaster's mark
 * rather than blank.
 *
 * We gate on `detectFamilies` (shared COUNTRY|host AND a shared name-token core),
 * NOT a bare host bucket: a host alone groups unrelated tenants (facebook.com
 * pages, platform subdomains) into a bogus "family" and would smear one
 * station's art across them. Requiring the candidate to also carry the family
 * core (checked at assignment time) keeps the fallback to true siblings.
 *
 * The representative is the family member with the fewest identity tokens (the
 * one closest to the bare brand name), chosen deterministically.
 *
 * @returns {Map<string, Array<{coreTokens: string[], brand: string}>>} bucket → families
 */
function buildFamilyBrandIndex(catalogById) {
  const members = [...catalogById.values()]
    .filter((s) => cleanFavicon(s.favicon))
    .map((s) => ({ id: s.id, name: s.name, country: s.country, homepage: s.homepage, favicon: cleanFavicon(s.favicon) }));
  const byBucket = new Map();
  for (const fam of detectFamilies(members)) {
    const favMembers = fam.members.filter((m) => m.favicon);
    if (favMembers.length < 2) continue;
    favMembers.sort((a, b) => nameTokens(a.name).length - nameTokens(b.name).length || a.id.localeCompare(b.id));
    const coreTokens = fam.core.split(' ').filter(Boolean);
    if (!coreTokens.length) continue;
    if (!byBucket.has(fam.bucket)) byBucket.set(fam.bucket, []);
    byBucket.get(fam.bucket).push({ coreTokens, brand: favMembers[0].favicon });
  }
  return byBucket;
}

/**
 * Brand favicon for a candidate: only when its name carries a curated family's
 * full core (i.e. it really is a sibling of that brand), not merely its host.
 */
function familyBrandFavicon(byBucket, bucket, candidateName) {
  const families = bucket ? byBucket.get(bucket) : undefined;
  if (!families) return undefined;
  const tokens = new Set(nameTokens(candidateName));
  for (const fam of families) {
    if (fam.coreTokens.every((t) => tokens.has(t))) return fam.brand;
  }
  return undefined;
}

function dashboardPlayableSource(candidate, byteProbes) {
  if (candidate.matchedCatalogId) return 'imported';
  if (candidate.duplicateOf) return null;
  if (candidate.verdict === 'ok' || candidate.verdict === 'ok-hls') return 'analyzer-ok';
  if (byteProbes.get(candidate)?.byteOk === true) return 'byte-ok';
  return null;
}

function stableId(candidate, raw) {
  const country = text(candidate.country || raw.countrycode || 'rb').toLowerCase() || 'rb';
  const name = candidate.name || raw.name || 'station';
  const uuid = text(candidate.stationuuid || raw.stationuuid).slice(0, 8);
  return `rb-${country}-${slug(name)}-${uuid}`;
}

function pruneUndefined(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

const rbCandidates = readJson(RB_CANDIDATES).candidates || [];
const manualCandidates = readJson(MANUAL_CANDIDATES, { candidates: [] }).candidates || [];
const rawByUuid = loadRawByUuid();
const byteProbes = loadByteProbes();
const catalogById = loadCatalogById();
const akaCatalog = loadAkaCatalog(catalogById);
const familyBrand = buildFamilyBrandIndex(catalogById);

const stations = [];
const seenIds = new Set();
const counts = {
  radioBrowserCandidates: rbCandidates.length,
  manualCandidates: manualCandidates.length,
  playable: 0,
  imported: 0,
  analyzerOk: 0,
  byteOk: 0,
  skippedDuplicate: 0,
  includedDuplicateMatches: 0,
  httpStreams: 0,
  httpsStreams: 0,
  skippedMissingRaw: 0,
  skippedNotPlayable: 0,
  faviconFromCatalog: 0,
  faviconFromRb: 0,
  faviconFromAka: 0,
  faviconFromFamilyBrand: 0,
  faviconMissing: 0,
};
const byCountry = {};

function addStation(row) {
  let id = row.id;
  let n = 2;
  while (seenIds.has(id)) id = `${row.id}-${n++}`;
  seenIds.add(id);
  stations.push({ ...row, id });
  const country = row.country || '??';
  byCountry[country] = (byCountry[country] || 0) + 1;
}

for (const candidate of rbCandidates) {
  const source = dashboardPlayableSource(candidate, byteProbes);
  if (!source) {
    if (candidate.duplicateOf) counts.skippedDuplicate++;
    counts.skippedNotPlayable++;
    continue;
  }
  const raw = rawByUuid.get(candidate.stationuuid);
  if (!raw) {
    counts.skippedMissingRaw++;
    continue;
  }

  const streamUrl = cleanUrl(candidate.streamUrl || raw.url_resolved || raw.url);
  if (!streamUrl) {
    counts.skippedNotPlayable++;
    continue;
  }
  const name = text(candidate.name || raw.name);
  if (!name) {
    counts.skippedNotPlayable++;
    continue;
  }
  const matchedById = candidate.matchedCatalogId
    ? catalogById.get(candidate.matchedCatalogId)
    : undefined;
  // Fall back to an `akaStationUuids` alias when the uuid/streamUrl matcher
  // couldn't link this stale RB record to the curated station it really is.
  const akaMatch = matchedById ? undefined : akaCatalog.get(candidate.stationuuid);
  const matchedCatalog = matchedById ?? akaMatch;
  const country = text(candidate.country || raw.countrycode).toUpperCase() || undefined;
  const homepage = cleanUrl(candidate.homepage || raw.homepage);

  // Favicon resolution tiers: curated/aliased catalog art → raw RB favicon →
  // curated brand mark for a same-broadcaster orphan → none.
  let favicon = cleanFavicon(matchedCatalog?.favicon);
  let faviconSource = favicon ? matchedCatalog.faviconSource || undefined : undefined;
  let faviconSourceType = favicon ? matchedCatalog.faviconSourceType : undefined;
  let faviconSourceUrl = favicon ? matchedCatalog.faviconSourceUrl : undefined;
  let faviconLicense = favicon ? matchedCatalog.faviconLicense : undefined;
  let faviconOk = favicon ? matchedCatalog.faviconOk : undefined;
  let faviconTier = favicon ? (akaMatch ? 'aka' : 'catalog') : null;
  if (!favicon) {
    const rbFav = cleanFavicon(raw.favicon || candidate.favicon);
    if (rbFav) {
      favicon = rbFav;
      faviconSource = 'radio-browser';
      faviconTier = 'rb';
    } else {
      const bucket = familyBucketKey({ country, homepage });
      const brand = familyBrandFavicon(familyBrand, bucket, name);
      if (brand) {
        favicon = brand;
        faviconSource = 'catalog-family-brand';
        faviconTier = 'family-brand';
      }
    }
  }

  const station = pruneUndefined({
    id: stableId(candidate, raw),
    name,
    broadcaster: matchedCatalog?.broadcaster || 'independent',
    streamUrl,
    homepage,
    country,
    tags: tags(raw.tags),
    favicon,
    faviconSource,
    faviconSourceType,
    faviconSourceUrl,
    faviconLicense,
    faviconOk,
    bitrate: Number(raw.bitrate) > 0 ? Number(raw.bitrate) : undefined,
    codec: raw.codec ? text(raw.codec).toUpperCase() : undefined,
    listeners: Number(raw.clickcount) > 0 ? Number(raw.clickcount) : undefined,
    geo: geo(raw),
    metadata: matchedCatalog?.metadata,
    metadataUrl: matchedCatalog?.metadataUrl,
    status: matchedCatalog?.status || 'stream-only',
    availableIn: matchedCatalog?.availableIn,
    stationuuid: candidate.stationuuid,
    changeuuid: raw.changeuuid,
    localPlayableSource: source,
    localMatchedCatalogId: candidate.matchedCatalogId || matchedCatalog?.id || undefined,
    localFaviconVia: faviconTier === 'aka' || faviconTier === 'family-brand' ? faviconTier : undefined,
    localDuplicateOf: candidate.duplicateOf || undefined,
  });

  addStation(station);
  counts.playable++;
  if (source === 'analyzer-ok') counts.analyzerOk++;
  if (source === 'byte-ok') counts.byteOk++;
  if (source === 'imported') counts.imported++;
  if (candidate.duplicateOf) counts.includedDuplicateMatches++;
  if (streamUrl.startsWith('http://')) counts.httpStreams++;
  if (streamUrl.startsWith('https://')) counts.httpsStreams++;
  if (faviconTier === 'catalog') counts.faviconFromCatalog++;
  else if (faviconTier === 'aka') counts.faviconFromAka++;
  else if (faviconTier === 'rb') counts.faviconFromRb++;
  else if (faviconTier === 'family-brand') counts.faviconFromFamilyBrand++;
  else counts.faviconMissing++;
}

for (const candidate of manualCandidates) {
  const streamUrl = cleanUrl(candidate.streamUrl);
  if (!streamUrl) continue;
  addStation(pruneUndefined({
    id: candidate.catalogId || candidate.stationuuid,
    name: text(candidate.name),
    broadcaster: candidate.broadcaster || 'independent',
    streamUrl,
    homepage: cleanUrl(candidate.homepage),
    country: text(candidate.country).toUpperCase() || undefined,
    favicon: cleanUrl(candidate.favicon),
    bitrate: Number(candidate.bitrate) > 0 ? Number(candidate.bitrate) : undefined,
    codec: candidate.codec ? text(candidate.codec).toUpperCase() : undefined,
    metadata: candidate.metadata,
    metadataUrl: candidate.metadataUrl,
    status: candidate.status || 'stream-only',
    localPlayableSource: 'manual',
  }));
  counts.playable++;
  if (streamUrl.startsWith('http://')) counts.httpStreams++;
  if (streamUrl.startsWith('https://')) counts.httpsStreams++;
}

stations.sort((a, b) => {
  const ac = a.country || '';
  const bc = b.country || '';
  if (ac !== bc) return ac.localeCompare(bc);
  return a.name.localeCompare(b.name);
});

const payload = {
  $schema: 'local iOS test catalog generated from station-tracker playable source candidates',
  generatedAt: new Date().toISOString(),
  sourceArtifacts: {
    radioBrowserCandidates: 'public/sources/radio-browser-candidates.json',
    manualCandidates: existsSync(MANUAL_CANDIDATES) ? 'public/sources/manual-candidates.json' : null,
    byteProbes: existsSync(BYTE_PROBES) ? 'public/sources/radio-browser-byte-probes.json' : null,
    byteProbeGeneratedAt: byteProbes.generatedAt,
  },
  counts: {
    ...counts,
    stations: stations.length,
    byCountry: Object.fromEntries(Object.entries(byCountry).sort((a, b) => b[1] - a[1])),
  },
  notes: [
    'Local-only test artifact. Do not deploy as the public website catalog.',
    'Includes HTTP streams so native iOS playback can test candidates that the web catalog rejects.',
    'Station-level local* fields are ignored by the current iOS decoder.',
  ],
  stations,
};

writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n');
const capabilities = writeStationCapabilities({
  catalogPath: OUT,
  outPath: CAPABILITIES_OUT,
  schema: 'local iOS test metadata capabilities generated from public/stations-ios-local.json + src/fetchers.json',
});
console.log(`catalog:ios-local: ${stations.length} station(s) -> ${OUT.replace(`${ROOT}/`, '')}`);
console.log(
  `  capabilities: ${CAPABILITIES_OUT.replace(`${ROOT}/`, '')} (api=${capabilities.counts.byMetadataStrategy.api}, icy=${capabilities.counts.byMetadataStrategy.icy}, hls=${capabilities.counts.byMetadataStrategy.hls}, none=${capabilities.counts.byMetadataStrategy.none})`,
);
console.log(`  analyzer-ok: ${counts.analyzerOk}`);
console.log(`  byte-ok: ${counts.byteOk}`);
console.log(`  imported source rows: ${counts.imported}`);
console.log(`  duplicate source rows skipped: ${counts.skippedDuplicate}`);
console.log(`  duplicate source rows included via catalog match: ${counts.includedDuplicateMatches}`);
console.log(`  http streams: ${counts.httpStreams}`);
console.log(`  https streams: ${counts.httpsStreams}`);
console.log(
  `  favicon: catalog=${counts.faviconFromCatalog}, aka=${counts.faviconFromAka}, ` +
    `rb=${counts.faviconFromRb}, family-brand=${counts.faviconFromFamilyBrand}, missing=${counts.faviconMissing}`,
);
