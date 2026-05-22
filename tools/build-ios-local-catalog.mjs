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
import { writeStationCapabilities } from './build-station-capabilities.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PUBLIC = join(ROOT, 'public');
const OUT = join(PUBLIC, 'stations-ios-local.json');
const CAPABILITIES_OUT = join(PUBLIC, 'station-capabilities-ios-local.json');
const PUBLISHED_CATALOG = join(PUBLIC, 'stations.json');
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
  const matchedCatalog = candidate.matchedCatalogId
    ? catalogById.get(candidate.matchedCatalogId)
    : undefined;
  const country = text(candidate.country || raw.countrycode).toUpperCase() || undefined;
  const favicon = cleanFavicon(matchedCatalog?.favicon)
    ?? cleanFavicon(raw.favicon || candidate.favicon);
  const homepage = cleanUrl(candidate.homepage || raw.homepage);
  const station = pruneUndefined({
    id: stableId(candidate, raw),
    name,
    broadcaster: matchedCatalog?.broadcaster || 'independent',
    streamUrl,
    homepage,
    country,
    tags: tags(raw.tags),
    favicon,
    faviconSource: matchedCatalog?.faviconSource || (favicon ? 'radio-browser' : undefined),
    faviconSourceType: matchedCatalog?.faviconSourceType,
    faviconSourceUrl: matchedCatalog?.faviconSourceUrl,
    faviconLicense: matchedCatalog?.faviconLicense,
    faviconOk: matchedCatalog?.faviconOk,
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
    localMatchedCatalogId: candidate.matchedCatalogId || undefined,
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
