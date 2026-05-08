#!/usr/bin/env node
/**
 * Apply Sonnet-agent-discovered logo URLs from `internal/logos/all.json`
 * into `data/stations.yaml`. Mirrors the surgical-insert pattern in
 * `wire-metadata.mjs` / `scrape-logos.mjs` / `wiki-logos.mjs` so the
 * existing hand-formatted YAML structure stays intact.
 *
 *   node tools/apply-logos.mjs                   # apply all
 *   node tools/apply-logos.mjs --dry-run         # don't mutate yaml
 *   node tools/apply-logos.mjs --in <path>       # default internal/logos/all.json
 *
 * Insert path only — agents only ran on stations with no current
 * favicon, so there's nothing to replace. If a row already has a
 * `favicon:` line (race against another tool), the entry is skipped
 * and reported.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const argv = process.argv.slice(2);
const argFlag = (n) => argv.includes(n);
const argVal = (n, fb) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fb;
};
const DRY_RUN = argFlag('--dry-run');
const inputPath = join(root, argVal('--in', 'internal/logos/all.json'));

const stationsPath = join(root, 'data/stations.yaml');
let text = readFileSync(stationsPath, 'utf8');
const all = JSON.parse(readFileSync(inputPath, 'utf8'));

const ok = all.filter((r) => r.id && r.url);
console.log(`apply-logos: ${ok.length} url(s) to apply (of ${all.length} entries)`);

let inserted = 0;
let skippedAlreadyHas = 0;
let skippedMissing = 0;

for (const w of ok) {
  const idLine = `- id: ${w.id}\n`;
  const idIdx = text.indexOf(idLine);
  if (idIdx === -1) {
    skippedMissing++;
    console.warn(`  ! couldn't locate id line for ${w.id}`);
    continue;
  }

  // Bail if row already has a favicon line (race protection — could
  // happen if another tool ran between when the agent generated the
  // candidate and when this writer applies it).
  const insertAt = idIdx + idLine.length;
  let hasFav = false;
  let p = insertAt;
  while (p < text.length) {
    const lineEnd = text.indexOf('\n', p);
    const line = text.slice(p, lineEnd === -1 ? text.length : lineEnd);
    if (line.startsWith('- id:')) break;
    if (line.startsWith('  favicon:')) { hasFav = true; break; }
    if (lineEnd === -1) break;
    p = lineEnd + 1;
  }
  if (hasFav) {
    skippedAlreadyHas++;
    continue;
  }

  const quoted = /[:#&*!|>'"%@`,\[\]{}]/.test(w.url) ? JSON.stringify(w.url) : w.url;
  text = text.slice(0, insertAt) + `  favicon: ${quoted}\n` + text.slice(insertAt);
  inserted++;
}

if (DRY_RUN) {
  console.log(
    `apply-logos --dry-run: would insert ${inserted}, skip-already-has ${skippedAlreadyHas}, miss ${skippedMissing}`,
  );
  process.exit(0);
}

writeFileSync(stationsPath, text);
console.log(
  `apply-logos: inserted ${inserted}, skipped-already-has ${skippedAlreadyHas}, missing-id ${skippedMissing}`,
);
