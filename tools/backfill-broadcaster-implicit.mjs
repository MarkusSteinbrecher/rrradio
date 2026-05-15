#!/usr/bin/env node
/**
 * One-shot backfill: write `faviconLicense: broadcaster-implicit` for every
 * station whose `faviconSource: broadcaster-api` (and no license set yet).
 *
 * Rationale: broadcaster-API endpoints (api.ardmediathek.de, audioapi.orf.at,
 * images.zeno.fm, anything matching the API_URL pattern) serve images with
 * CORS-open headers and long cache lifetimes, signalling an implicit grant
 * for external embedding — but we haven't audited any formal terms-of-use
 * document. `broadcaster-implicit` keeps this distinct from `broadcaster`
 * (= explicit grant or bundled local asset) so the audit debt is visible
 * in the matrix instead of papered over.
 *
 * Idempotent. Re-running over an already-backfilled file is a no-op.
 *
 *   node tools/backfill-broadcaster-implicit.mjs            # write
 *   node tools/backfill-broadcaster-implicit.mjs --dry-run  # report only
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const YAML_PATH = join(ROOT, 'data/stations.yaml');

const DRY_RUN = process.argv.includes('--dry-run');

const text = readFileSync(YAML_PATH, 'utf8');
const parsed = parseYaml(text);
if (!Array.isArray(parsed)) {
  console.error('backfill-broadcaster-implicit: stations.yaml is not a list');
  process.exit(1);
}

const wantedIds = new Set();
for (const s of parsed) {
  if (!s || typeof s !== 'object') continue;
  if (s.faviconSource !== 'broadcaster-api') continue;
  if (s.faviconLicense) continue;
  wantedIds.add(s.id);
}

console.log(`backfill-broadcaster-implicit: ${wantedIds.size} entries to label`);

const lines = text.split('\n');
const out = [];
let currentId = null;
let inserted = 0;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  out.push(line);

  const idMatch = line.match(/^- id: (.+)$/);
  if (idMatch) {
    currentId = idMatch[1].trim();
    continue;
  }

  // Insert immediately after the faviconSource line so license stays adjacent.
  if (currentId && /^  faviconSource: broadcaster-api\b/.test(line)) {
    if (!wantedIds.has(currentId)) continue;
    const next = lines[i + 1] || '';
    if (/^  faviconLicense:/.test(next)) continue;
    out.push(`  faviconLicense: broadcaster-implicit`);
    inserted++;
  }
}

console.log(`backfill-broadcaster-implicit: ${inserted} lines inserted`);

if (DRY_RUN) {
  console.log('--dry-run, no file written');
  process.exit(0);
}

writeFileSync(YAML_PATH, out.join('\n'));
console.log(`wrote ${YAML_PATH}`);
