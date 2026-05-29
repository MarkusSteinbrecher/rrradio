#!/usr/bin/env node
/**
 * Import playable Radio Browser source candidates into data/stations.yaml.
 *
 * This is the local bulk-import path behind the station tracker "Playable"
 * donut. It reads the generated source candidates and byte-probe artifact,
 * joins candidates back to the raw Radio Browser snapshots for full metadata,
 * and appends minimal stream-only catalog rows.
 *
 * Default mode is a dry run. Use --apply to mutate data/stations.yaml.
 *
 *   npm run import-playable
 *   npm run import-playable -- --apply
 *   npm run import-playable -- --country DE,AT --limit 100 --apply
 *   npm run import-playable -- --include-http --apply
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { normalizeStreamUrl as sharedStreamKey } from './lib/dedupe-normalize.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATIONS_YAML = join(ROOT, 'data', 'stations.yaml');
const CANDIDATES_JSON = join(ROOT, 'public', 'sources', 'radio-browser-candidates.json');
const BYTE_PROBES_JSON = join(ROOT, 'public', 'sources', 'radio-browser-byte-probes.json');
const DEDUPE_JSON = join(ROOT, 'data', 'sources', 'radio-browser', 'dedupe.json');
const RAW_DIR = join(ROOT, 'data', 'sources', 'radio-browser', 'by-country');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, def = null) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
};

const apply = flag('--apply');
const dryRun = !apply || flag('--dry-run');
const includeHttp = flag('--include-http');
const includeByteOk = !flag('--no-byte-ok');
const minVotes = Number(value('--min-votes', '0'));
const limitValue = value('--limit', null);
const limit = limitValue == null ? Infinity : Math.max(0, Number(limitValue));
const reviewedAt = value('--reviewed-at', new Date().toISOString().slice(0, 10));
const status = value('--status', 'stream-only');
const reportPath = resolve(ROOT, value('--out', '.local/import-playable-candidates-report.json'));
const countriesArg = value('--country', null);
const countryFilter = countriesArg
  ? new Set(countriesArg.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean))
  : null;

if (!Number.isFinite(minVotes) || minVotes < 0) {
  fail('--min-votes must be a non-negative number');
}
if (!Number.isFinite(limit) && limit !== Infinity) {
  fail('--limit must be a number');
}
if (!['stream-only', 'icy-only', 'working'].includes(status)) {
  fail('--status must be stream-only, icy-only, or working');
}

function fail(message) {
  console.error(`import-playable: ${message}`);
  process.exit(1);
}

function readJson(path, fallback = null) {
  if (!existsSync(path)) {
    if (fallback !== null) return fallback;
    fail(`${path.replace(`${ROOT}/`, '')} not found`);
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

function normalizeName(name) {
  return String(name ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function sanitizeText(value) {
  return String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeStreamUrl(value) {
  // Mirror tools/check-duplicates.mjs (keep query) so an import cannot
  // introduce a streamUrl collision that the catalog gate then blocks.
  return sharedStreamKey(value, { dropQuery: false });
}

function streamProtocol(value) {
  try {
    return new URL(String(value ?? '')).protocol;
  } catch {
    return '';
  }
}

function slugify(value) {
  return sanitizeText(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function yamlScalar(value) {
  const text = sanitizeText(value);
  if (!text) return '""';
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return JSON.stringify(text);
  if (/^(true|false|null|yes|no|on|off|~)$/i.test(text)) return JSON.stringify(text);
  if (/[:#&*!|>'"%@`,\[\]{}?]/.test(text)) return JSON.stringify(text);
  if (/^[-\s?:!&*|>%@`]/.test(text)) return JSON.stringify(text);
  if (/\s-\s/.test(text)) return JSON.stringify(text);
  return text;
}

function yamlTag(value) {
  return yamlScalar(String(value ?? '').trim().toLowerCase());
}

function normalizeTags(tags) {
  if (!tags) return [];
  const source = Array.isArray(tags) ? tags : String(tags).split(/[,;]/);
  return source
    .map((t) => String(t).trim().toLowerCase())
    .filter(Boolean)
    .filter((t, i, a) => a.indexOf(t) === i)
    .slice(0, 6);
}

function cleanFavicon(value) {
  const text = String(value ?? '').trim();
  if (!text || text === 'null' || text.startsWith('data:')) return '';
  try {
    const url = new URL(text);
    // Keep bulk imports browser/iOS-safe by default. HTTP favicons can be
    // recovered later through the logo scraper with provenance.
    if (url.protocol !== 'https:') return '';
    return text;
  } catch {
    return '';
  }
}

function cleanHomepage(value) {
  const text = String(value ?? '').trim();
  if (!text || text === 'null') return '';
  try {
    const url = new URL(text);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return text;
  } catch {
    return '';
  }
}

function geoFromRaw(raw) {
  const lat = Number(raw?.geo_lat);
  const lon = Number(raw?.geo_long);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const round = (n) => Math.round(n * 1e4) / 1e4;
  return [round(lat), round(lon)];
}

function byteProbeKey(stationuuid, streamUrl) {
  return `${stationuuid}::${streamUrl ?? ''}`;
}

function loadRawByUuid() {
  if (!existsSync(RAW_DIR)) {
    fail('data/sources/radio-browser/by-country not found; run npm run fetch-rb-raw first');
  }
  const byUuid = new Map();
  for (const file of readdirSync(RAW_DIR).filter((f) => /^[A-Z]{2}\.json$/.test(f)).sort()) {
    const data = readJson(join(RAW_DIR, file), { stations: [] });
    for (const row of data.stations || []) {
      if (!row?.stationuuid || byUuid.has(row.stationuuid)) continue;
      byUuid.set(row.stationuuid, row);
    }
  }
  return byUuid;
}

function loadByteProbes() {
  const data = readJson(BYTE_PROBES_JSON, { results: [] });
  const byUuid = new Map();
  const byKey = new Map();
  for (const row of data.results || []) {
    if (!row?.stationuuid) continue;
    byUuid.set(row.stationuuid, row);
    byKey.set(byteProbeKey(row.stationuuid, row.streamUrl), row);
  }
  return {
    generatedAt: data.generatedAt ?? null,
    byUuid,
    byKey,
    get(candidate) {
      return byKey.get(byteProbeKey(candidate.stationuuid, candidate.streamUrl))
        ?? byUuid.get(candidate.stationuuid);
    },
  };
}

function loadDedupe() {
  const data = readJson(DEDUPE_JSON, { byStationUuid: {}, groups: [], generatedAt: null });
  const byStationUuid = data.byStationUuid && typeof data.byStationUuid === 'object'
    ? data.byStationUuid
    : {};
  const groupUuids = new Set(Object.keys(byStationUuid));
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
  };
}

const stationsText = readFileSync(STATIONS_YAML, 'utf8');
const existingStations = YAML.parse(stationsText);
if (!Array.isArray(existingStations)) fail('data/stations.yaml is not a list');

const existingIds = new Set();
const existingUuids = new Set();
const existingStreamUrls = new Set();
const existingNames = new Map();
for (const station of existingStations) {
  if (!station || typeof station !== 'object') continue;
  if (station.id) existingIds.add(station.id);
  if (station.stationuuid) existingUuids.add(station.stationuuid);
  if (station.streamUrl) existingStreamUrls.add(normalizeStreamUrl(station.streamUrl));
  const name = normalizeName(station.name);
  if (name) {
    if (!existingNames.has(name)) existingNames.set(name, []);
    existingNames.get(name).push(station.id);
  }
}

const candidatesPayload = readJson(CANDIDATES_JSON);
const candidates = candidatesPayload.candidates || [];
const rawByUuid = loadRawByUuid();
const byteProbes = loadByteProbes();
const dedupe = loadDedupe();

const existingCanonicalGroups = new Set();
for (const uuid of existingUuids) {
  if (dedupe.hasGroup(uuid)) existingCanonicalGroups.add(dedupe.canonicalOf(uuid));
}

const skipped = {
  alreadyMatched: 0,
  existingUuid: 0,
  existingStreamUrl: 0,
  existingCanonicalGroup: 0,
  duplicate: 0,
  country: 0,
  minVotes: 0,
  noStreamUrl: 0,
  noRawRecord: 0,
  notPlayable: 0,
  httpStream: 0,
  intraStreamUrl: 0,
  intraCanonicalGroup: 0,
};
const nameConflicts = [];
const accepted = [];
const seenImportStreamUrls = new Set();
const seenImportCanonicalGroups = new Set();

function candidatePlayableSource(candidate) {
  if (candidate.verdict === 'ok' || candidate.verdict === 'ok-hls') return 'analyzer-ok';
  if (includeByteOk && byteProbes.get(candidate)?.byteOk === true) return 'byte-ok';
  return null;
}

const sortedCandidates = [...candidates].sort((a, b) => {
  const av = Number(a.votes ?? 0);
  const bv = Number(b.votes ?? 0);
  if (bv !== av) return bv - av;
  return String(a.name ?? '').localeCompare(String(b.name ?? ''));
});

for (const candidate of sortedCandidates) {
  if (accepted.length >= limit) break;
  if (candidate.matchedCatalogId) { skipped.alreadyMatched++; continue; }
  if (candidate.duplicateOf) { skipped.duplicate++; continue; }
  if (existingUuids.has(candidate.stationuuid)) { skipped.existingUuid++; continue; }
  const raw = rawByUuid.get(candidate.stationuuid);
  if (!raw) { skipped.noRawRecord++; continue; }
  const canonicalGroup = dedupe.hasGroup(candidate.stationuuid)
    ? dedupe.canonicalOf(candidate.stationuuid)
    : '';
  if (canonicalGroup && existingCanonicalGroups.has(canonicalGroup)) {
    skipped.existingCanonicalGroup++;
    continue;
  }
  if (canonicalGroup && seenImportCanonicalGroups.has(canonicalGroup)) {
    skipped.intraCanonicalGroup++;
    continue;
  }

  const country = String(candidate.country || raw.countrycode || '').toUpperCase();
  if (countryFilter && !countryFilter.has(country)) { skipped.country++; continue; }
  const votes = Number(candidate.votes ?? raw.votes ?? 0);
  if (votes < minVotes) { skipped.minVotes++; continue; }

  const streamUrl = candidate.streamUrl || raw.url_resolved || raw.url || '';
  if (!streamUrl) { skipped.noStreamUrl++; continue; }
  const streamKey = normalizeStreamUrl(streamUrl);
  if (existingStreamUrls.has(streamKey)) { skipped.existingStreamUrl++; continue; }
  if (seenImportStreamUrls.has(streamKey)) { skipped.intraStreamUrl++; continue; }
  if (!includeHttp && streamProtocol(streamUrl) !== 'https:') { skipped.httpStream++; continue; }

  const playableSource = candidatePlayableSource(candidate);
  if (!playableSource) { skipped.notPlayable++; continue; }

  const name = sanitizeText(candidate.name || raw.name || '');
  if (!name) { skipped.noRawRecord++; continue; }
  const nameKey = normalizeName(name);
  const conflicts = existingNames.get(nameKey);
  if (conflicts?.length) {
    nameConflicts.push({
      stationuuid: candidate.stationuuid,
      name,
      country,
      existingIds: conflicts.slice(0, 5),
    });
  }

  seenImportStreamUrls.add(streamKey);
  if (canonicalGroup) seenImportCanonicalGroups.add(canonicalGroup);
  accepted.push({
    candidate,
    raw,
    country,
    streamUrl,
    votes,
    playableSource,
  });
}

function makeId(row) {
  const prefix = `${row.country.toLowerCase() || 'rb'}-`;
  const slug = slugify(row.candidate.name || row.raw.name || 'station') || 'station';
  const base = `${prefix}${slug}`;
  if (!existingIds.has(base)) {
    existingIds.add(base);
    return base;
  }
  const uuidSuffix = String(row.candidate.stationuuid).slice(0, 8);
  let candidate = `${base.slice(0, 54)}-${uuidSuffix}`;
  let n = 2;
  while (existingIds.has(candidate)) {
    candidate = `${base.slice(0, 50)}-${uuidSuffix}-${n++}`;
  }
  existingIds.add(candidate);
  return candidate;
}

function buildYamlEntry(row, id) {
  const raw = row.raw;
  const name = row.candidate.name || raw.name;
  const favicon = cleanFavicon(raw.favicon || row.candidate.favicon);
  const homepage = cleanHomepage(row.candidate.homepage || raw.homepage);
  const tags = normalizeTags(raw.tags);
  const geo = geoFromRaw(raw);
  const lines = [];
  lines.push('');
  lines.push(`# Auto-imported from Radio Browser playable sweep (${reviewedAt}, ${row.playableSource})`);
  lines.push(`- id: ${id}`);
  lines.push(`  source: radio-browser`);
  lines.push(`  broadcaster: independent`);
  lines.push(`  name: ${yamlScalar(name)}`);
  lines.push(`  streamUrl: ${yamlScalar(row.streamUrl)}`);
  if (raw.bitrate && Number(raw.bitrate) > 0) lines.push(`  bitrate: ${Number(raw.bitrate)}`);
  if (raw.codec) lines.push(`  codec: ${yamlScalar(String(raw.codec).toUpperCase())}`);
  if (tags.length > 0) lines.push(`  tags: [${tags.map(yamlTag).join(', ')}]`);
  if (favicon) {
    lines.push(`  favicon: ${yamlScalar(favicon)}`);
    lines.push(`  faviconSource: radio-browser`);
  }
  if (homepage) lines.push(`  homepage: ${yamlScalar(homepage)}`);
  if (row.country) lines.push(`  country: ${row.country}`);
  if (geo) lines.push(`  geo: [${geo[0]}, ${geo[1]}]`);
  lines.push(`  status: ${status}`);
  lines.push(`  stationuuid: ${raw.stationuuid || row.candidate.stationuuid}`);
  if (raw.changeuuid) lines.push(`  changeuuid: ${raw.changeuuid}`);
  lines.push(`  reviewedAt: ${yamlScalar(reviewedAt)}`);
  return lines.join('\n') + '\n';
}

const importRows = accepted.map((row) => ({ ...row, id: makeId(row) }));
const yamlBlocks = importRows.map((row) => buildYamlEntry(row, row.id));

const byCountry = {};
const byPlayableSource = {};
for (const row of importRows) {
  byCountry[row.country] = (byCountry[row.country] || 0) + 1;
  byPlayableSource[row.playableSource] = (byPlayableSource[row.playableSource] || 0) + 1;
}

const report = {
  generatedAt: new Date().toISOString(),
  dryRun,
  apply,
  inputs: {
    candidates: CANDIDATES_JSON.replace(`${ROOT}/`, ''),
    byteProbes: existsSync(BYTE_PROBES_JSON) ? BYTE_PROBES_JSON.replace(`${ROOT}/`, '') : null,
    byteProbeGeneratedAt: byteProbes.generatedAt,
    dedupe: DEDUPE_JSON.replace(`${ROOT}/`, ''),
    dedupeGeneratedAt: dedupe.generatedAt,
  },
  options: {
    includeHttp,
    includeByteOk,
    minVotes,
    limit: limit === Infinity ? null : limit,
    reviewedAt,
    status,
    countries: countryFilter ? [...countryFilter].sort() : null,
  },
  counts: {
    inputCandidates: candidates.length,
    accepted: importRows.length,
    skipped,
    nameConflictWarnings: nameConflicts.length,
    byPlayableSource,
    byCountry: Object.fromEntries(
      Object.entries(byCountry).sort((a, b) => b[1] - a[1]),
    ),
  },
  accepted: importRows.map((row) => ({
    id: row.id,
    stationuuid: row.candidate.stationuuid,
    name: row.candidate.name || row.raw.name,
    country: row.country,
    votes: row.votes,
    streamUrl: row.streamUrl,
    playableSource: row.playableSource,
    verdict: row.candidate.verdict,
  })),
  nameConflicts: nameConflicts.slice(0, 500),
};

mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');

console.log(`import-playable: ${dryRun ? 'dry run' : 'apply'} report -> ${reportPath.replace(`${ROOT}/`, '')}`);
console.log(`  accepted: ${importRows.length}`);
console.log(`  analyzer-ok: ${byPlayableSource['analyzer-ok'] || 0}`);
console.log(`  byte-ok: ${byPlayableSource['byte-ok'] || 0}`);
console.log(`  skipped http stream: ${skipped.httpStream}`);
console.log(`  skipped existing/matched: ${skipped.alreadyMatched + skipped.existingUuid + skipped.existingStreamUrl}`);
console.log(`  skipped existing canonical group: ${skipped.existingCanonicalGroup}`);
console.log(`  name conflict warnings: ${nameConflicts.length}`);
console.log('  top countries:');
for (const [country, count] of Object.entries(report.counts.byCountry).slice(0, 10)) {
  console.log(`    ${country}: ${count}`);
}

if (dryRun) {
  console.log('import-playable: no files changed; pass --apply to append YAML rows');
  process.exit(0);
}

if (yamlBlocks.length === 0) {
  console.log('import-playable: nothing to append');
  process.exit(0);
}

const trailing = stationsText.endsWith('\n') ? '' : '\n';
writeFileSync(STATIONS_YAML, stationsText + trailing + yamlBlocks.join(''), 'utf8');
console.log(`import-playable: appended ${yamlBlocks.length} row(s) to data/stations.yaml`);
