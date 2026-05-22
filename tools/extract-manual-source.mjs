#!/usr/bin/env node
/**
 * Extracts manual-source entries from data/stations.yaml into
 * data/sources/manual/stations.yaml so the "manual" source has a
 * stable, git-tracked source file alongside the RB snapshots under
 * data/sources/radio-browser/.
 *
 *   npm run extract-manual-source
 *
 * Source of truth remains data/stations.yaml. This script regenerates
 * data/sources/manual/stations.yaml on demand. The extracted file is
 * checked in so we get version history of just the manual source view.
 *
 * Classification matches tools/build-sources.mjs:
 *   - no stationuuid AND no RB signals (faviconSource, id prefix)
 *     → manual
 *
 * Output layout:
 *   data/sources/manual/
 *     stations.yaml        — the manual entries (same row shape as input)
 *     index.json           — metadata: generatedAt, count, sourceCommit
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import YAML from 'yaml';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SOURCES_YAML = join(ROOT, 'data', 'sources.yaml');
const STATIONS_YAML = join(ROOT, 'data', 'stations.yaml');
const OUT_DIR = join(ROOT, 'data', 'sources', 'manual');
const OUT_STATIONS = join(OUT_DIR, 'stations.yaml');
const OUT_INDEX = join(OUT_DIR, 'index.json');

const sources = YAML.parse(readFileSync(SOURCES_YAML, 'utf8'));
const catalog = YAML.parse(readFileSync(STATIONS_YAML, 'utf8'));
if (!Array.isArray(catalog)) throw new Error('extract-manual-source: stations.yaml not a list');

const sourceById = new Map(sources.map((s) => [s.id, s]));

function classify(entry) {
  if (entry.source && sourceById.has(entry.source)) return entry.source;
  for (const src of sources) {
    const hints = src.matchHints;
    if (!hints) continue;
    if (hints.hasStationUuid && entry.stationuuid) return src.id;
    if (Array.isArray(hints.idPrefixAny) &&
        hints.idPrefixAny.some((p) => typeof entry.id === 'string' && entry.id.startsWith(p))) {
      return src.id;
    }
    if (Array.isArray(hints.faviconSourceAny) &&
        hints.faviconSourceAny.includes(entry.faviconSource)) {
      return src.id;
    }
  }
  return 'manual';
}

const manualEntries = [];
for (const entry of catalog) {
  if (!entry || !entry.id) continue;
  if (classify(entry) === 'manual') manualEntries.push(entry);
}

// Sort for stable git diffs.
manualEntries.sort((a, b) => String(a.id).localeCompare(String(b.id)));

mkdirSync(OUT_DIR, { recursive: true });

const header = [
  '# rrradio — manual source extract',
  '#',
  '# Auto-generated from data/stations.yaml by tools/extract-manual-source.mjs.',
  '# Do NOT hand-edit; update data/stations.yaml and re-run',
  '# `npm run extract-manual-source` (also invoked from `npm run dev`).',
  '#',
  '# These are the catalog entries classified as the "manual" source',
  '# (no stationuuid binding, no RB id prefix, no RB faviconSource).',
  '# They live here as the source-of-record for the manual source so',
  '# git tracks changes to that view independently of the full catalog.',
  '',
].join('\n');

writeFileSync(OUT_STATIONS, header + YAML.stringify(manualEntries, { sortMapEntries: false }));

let sourceCommit = null;
try {
  sourceCommit = execSync('git log -n1 --format=%H data/stations.yaml', {
    cwd: ROOT, encoding: 'utf8',
  }).trim() || null;
} catch { /* no git or no commits yet */ }

writeFileSync(OUT_INDEX, JSON.stringify({
  schemaVersion: 1,
  source: 'manual',
  generatedAt: new Date().toISOString(),
  count: manualEntries.length,
  sourceOfTruth: 'data/stations.yaml',
  sourceCommit,
}, null, 2) + '\n');

console.log(
  `extract-manual-source: ${manualEntries.length} manual entries → ${OUT_STATIONS.replace(ROOT + '/', '')}`,
);
