#!/usr/bin/env node
/**
 * Clear favicons whose probe error is HTTP 404 (or, optionally, other
 * non-recoverable client errors). Edits `data/stations.yaml`: strips the
 * favicon-related lines and inserts `faviconBlocked: true` so the build
 * pipeline doesn't fall back to RB's copy of the same dead URL.
 *
 * Source of truth is `public/station-logo-quality.json` — run
 * `npm run probe-logos -- --remote` first.
 *
 *   node tools/clear-dead-favicons.mjs --dry-run
 *   node tools/clear-dead-favicons.mjs             # write
 *   node tools/clear-dead-favicons.mjs --include-403-400  # also clear 403/400
 *
 * 429 (rate-limited) is intentionally never cleared — those URLs are
 * probably fine and just need a retry.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { blockFavicons } from './lib/yaml-block-favicon.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const QUALITY_PATH = join(ROOT, 'public/station-logo-quality.json');
const CATALOG_PATH = join(ROOT, 'public/stations.json');
const YAML_PATH = join(ROOT, 'data/stations.yaml');

const DRY_RUN = process.argv.includes('--dry-run');
const INCLUDE_403_400 = process.argv.includes('--include-403-400');

if (!existsSync(QUALITY_PATH)) {
  console.error(`missing ${QUALITY_PATH} — run "npm run probe-logos -- --remote" first`);
  process.exit(2);
}

const quality  = JSON.parse(readFileSync(QUALITY_PATH, 'utf8'));
const catalog  = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'));
const stations = catalog.stations ?? [];

const liveIds = new Set(stations.filter((s) => s.favicon).map((s) => s.id));

// Errors we treat as "URL is dead — clear the favicon". HTTP 404 is the
// obvious one; 403 and 400 are also typically not transient (geo-gate, bad
// URL form). 429 / timeout / fetch failed are deliberately excluded — those
// are recoverable.
const DEAD_ERRORS = new Set(['HTTP 404']);
if (INCLUDE_403_400) {
  DEAD_ERRORS.add('HTTP 403');
  DEAD_ERRORS.add('HTTP 400');
}

const flagged = new Set();
const errCounts = new Map();
const hostCounts = new Map();
for (const p of quality.stations ?? []) {
  if (!p.error || !DEAD_ERRORS.has(p.error)) continue;
  // Only clear stations that currently still carry a favicon — if the
  // catalog already shows them as missing (e.g. previously blocked) there's
  // nothing to do.
  if (!liveIds.has(p.id)) continue;
  flagged.add(p.id);
  errCounts.set(p.error, (errCounts.get(p.error) || 0) + 1);
  try {
    const host = new URL(p.favicon).host.toLowerCase();
    hostCounts.set(host, (hostCounts.get(host) || 0) + 1);
  } catch { /* ignore */ }
}

console.log(`clear-dead-favicons: ${flagged.size} stations match (errors: ${[...DEAD_ERRORS].join(', ')})`);
for (const [err, n] of [...errCounts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${n.toString().padStart(5)} ${err}`);
}
console.log('top affected hosts:');
for (const [host, n] of [...hostCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`  ${n.toString().padStart(5)} ${host}`);
}

if (flagged.size === 0) {
  console.log('nothing to do');
  process.exit(0);
}

const text = readFileSync(YAML_PATH, 'utf8');
const result = blockFavicons(text, flagged);
console.log(`inserted faviconBlocked into ${result.inserted} blocks (${result.alreadyBlocked} already had it)`);

if (DRY_RUN) {
  console.log('--dry-run, no file written');
  process.exit(0);
}

writeFileSync(YAML_PATH, result.text);
console.log(`wrote ${YAML_PATH}`);
