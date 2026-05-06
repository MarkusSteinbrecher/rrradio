#!/usr/bin/env node
/**
 * Batch import script for sweeping a country's RB analysis into stations.yaml.
 * Usage: node tools/batch-import.mjs <CC>
 *
 * Filters public/rb-analysis-<CC>.json for importable stations
 * (verdict ok|ok-hls, not curated, not duplicate), dedupes by name + URL,
 * sorts by votes desc, and appends YAML stubs to data/stations.yaml.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const cc = process.argv[2]?.toUpperCase();
if (!cc) {
  console.error('Usage: node tools/batch-import.mjs <CC>');
  process.exit(1);
}

const reviewedAt = '2026-05-04';

// ─────────────────────────────────────────────────────────────
// Load RB analysis file
// ─────────────────────────────────────────────────────────────
const analysisPath = join(root, `public/rb-analysis-${cc}.json`);
let analysis;
try {
  analysis = JSON.parse(readFileSync(analysisPath, 'utf8'));
} catch (e) {
  console.error(`Cannot read ${analysisPath}: ${e.message}`);
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────
// Load existing stations.yaml
// ─────────────────────────────────────────────────────────────
const stationsPath = join(root, 'data/stations.yaml');
const stationsText = readFileSync(stationsPath, 'utf8');
const stationsList = parseYaml(stationsText);

const curatedUuids = new Set(stationsList.filter(s => s.stationuuid).map(s => s.stationuuid));
const curatedNames = new Set(stationsList.map(s => normName(s.name)).filter(Boolean));
const curatedUrls = new Set(stationsList.map(s => s.streamUrl).filter(Boolean));
const curatedIds = new Set(stationsList.map(s => s.id).filter(Boolean));

function normName(n) {
  return (n || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// ─────────────────────────────────────────────────────────────
// Filter candidates
// ─────────────────────────────────────────────────────────────
const candidates = (analysis.stations || []).filter(s => {
  if (s.verdict !== 'ok' && s.verdict !== 'ok-hls') return false;
  if (s.isCurated) return false;
  if (s.duplicateOf) return false;
  // Skip if uuid already in YAML
  if (s.stationuuid && curatedUuids.has(s.stationuuid)) return false;
  // Skip if name matches existing (case/whitespace-normalized)
  if (curatedNames.has(normName(s.name))) return false;
  // Skip if streamUrl exact-matches existing
  if (s.streamUrl && curatedUrls.has(s.streamUrl)) return false;
  return true;
});

// ─────────────────────────────────────────────────────────────
// Intra-set dedup: by name (keep highest votes), then by URL
// ─────────────────────────────────────────────────────────────
// Sort by votes desc first
candidates.sort((a, b) => (b.votes || 0) - (a.votes || 0));

const seenIntraNames = new Set();
const seenIntraUrls = new Set();
let skippedName = 0;
let skippedUrl = 0;
let skippedUuid = 0;
let skippedNameYaml = 0;
let skippedUrlYaml = 0;

// Count skips by reason for reporting
const skippedReasons = {
  uuid: 0,
  name: 0,
  url: 0,
  intraDupeName: 0,
  intraDupeUrl: 0,
};

// Recount from raw analysis
for (const s of (analysis.stations || [])) {
  if (s.verdict !== 'ok' && s.verdict !== 'ok-hls') continue;
  if (s.isCurated) continue;
  if (s.duplicateOf) continue;
  if (s.stationuuid && curatedUuids.has(s.stationuuid)) { skippedReasons.uuid++; continue; }
  if (curatedNames.has(normName(s.name))) { skippedReasons.name++; continue; }
  if (s.streamUrl && curatedUrls.has(s.streamUrl)) { skippedReasons.url++; continue; }
}

const dedupedCandidates = candidates.filter(s => {
  const nn = normName(s.name);
  if (seenIntraNames.has(nn)) { skippedReasons.intraDupeName++; return false; }
  seenIntraNames.add(nn);
  if (s.streamUrl && seenIntraUrls.has(s.streamUrl)) { skippedReasons.intraDupeUrl++; return false; }
  if (s.streamUrl) seenIntraUrls.add(s.streamUrl);
  return true;
});

// Already sorted by votes desc
const toImport = dedupedCandidates;

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function slugify(s) {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function quote(s) {
  // Quote names containing YAML-significant chars
  if (!s) return '""';
  return /[:#&*!|>'"%@`,\[\]{}]/.test(s) || /^\s|\s$/.test(s) || /^[0-9]/.test(s)
    ? JSON.stringify(s)
    : s;
}

function normaliseTags(rbTags) {
  if (!rbTags) return [];
  return rbTags
    .split(/[,;]/)
    .map(t => t.trim().toLowerCase())
    .filter(Boolean)
    .filter((t, i, a) => a.indexOf(t) === i)
    .slice(0, 6);
}

function buildYamlEntry(s, id) {
  const lines = [];
  lines.push('');
  lines.push(`# Auto-imported from Radio Browser (${reviewedAt})`);
  lines.push(`- id: ${id}`);
  lines.push(`  broadcaster: independent`);
  lines.push(`  name: ${quote(s.name)}`);
  lines.push(`  streamUrl: ${s.streamUrl}`);
  if (s.bitrate && s.bitrate > 0) lines.push(`  bitrate: ${s.bitrate}`);
  if (s.codec) lines.push(`  codec: ${s.codec.toUpperCase()}`);
  const tags = normaliseTags(s.tags);
  if (tags.length > 0) lines.push(`  tags: [${tags.join(', ')}]`);
  if (s.favicon) lines.push(`  favicon: ${s.favicon}`);
  if (s.homepage) lines.push(`  homepage: ${s.homepage}`);
  if (s.country) lines.push(`  country: ${s.country}`);
  if (s.geo && s.geo.length === 2) lines.push(`  geo: [${s.geo[0]}, ${s.geo[1]}]`);
  lines.push(`  status: stream-only`);
  lines.push(`  stationuuid: ${s.stationuuid}`);
  lines.push(`  changeuuid: ${s.changeuuid}`);
  lines.push(`  reviewedAt: "${reviewedAt}"`);
  return lines.join('\n') + '\n';
}

// ─────────────────────────────────────────────────────────────
// Generate IDs and build YAML
// ─────────────────────────────────────────────────────────────
const prefix = cc.toLowerCase() + '-';
const newIds = new Set(curatedIds);

const entries = [];
for (const s of toImport) {
  let base = prefix + slugify(s.name);
  let id = base;
  let suffix = 2;
  while (newIds.has(id)) {
    id = base + '-' + suffix++;
  }
  newIds.add(id);
  entries.push({ id, s });
}

// ─────────────────────────────────────────────────────────────
// Append to stations.yaml
// ─────────────────────────────────────────────────────────────
const additions = entries.map(({ id, s }) => buildYamlEntry(s, id)).join('');
const trailing = stationsText.endsWith('\n') ? '' : '\n';
writeFileSync(stationsPath, stationsText + trailing + additions);

// ─────────────────────────────────────────────────────────────
// Report
// ─────────────────────────────────────────────────────────────
console.log(`\n=== ${cc} import complete ===`);
console.log(`Imported: ${entries.length}`);
console.log(`Skipped (uuid conflict with YAML): ${skippedReasons.uuid}`);
console.log(`Skipped (name conflict with YAML): ${skippedReasons.name}`);
console.log(`Skipped (url conflict with YAML): ${skippedReasons.url}`);
console.log(`Skipped (intra-set name dedup): ${skippedReasons.intraDupeName}`);
console.log(`Skipped (intra-set url dedup): ${skippedReasons.intraDupeUrl}`);
console.log('\nTop 5 by votes:');
toImport.slice(0, 5).forEach(s => console.log(`  ${s.votes} votes — ${s.name} (${s.streamUrl.slice(0, 60)})`));
