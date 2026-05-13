#!/usr/bin/env node
/**
 * Apply agent-discovered logo URLs into `data/stations.yaml`. Mirrors
 * the surgical-insert pattern in `wire-metadata.mjs` / `scrape-logos.mjs`
 * so the hand-formatted YAML structure stays intact.
 *
 *   node tools/apply-logos.mjs                   # apply all (insert only)
 *   node tools/apply-logos.mjs --replace         # also overwrite existing favicon lines
 *   node tools/apply-logos.mjs --dry-run         # don't mutate yaml
 *   node tools/apply-logos.mjs --in <path>       # default internal/logos/all.json
 *
 * Without --replace: skips stations that already have a favicon: line.
 * With --replace: overwrites existing favicon: lines (upgrade mode).
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
const REPLACE = argFlag('--replace');
const inputPath = join(root, argVal('--in', 'internal/logos/all.json'));

const stationsPath = join(root, 'data/stations.yaml');
let text = readFileSync(stationsPath, 'utf8');
const all = JSON.parse(readFileSync(inputPath, 'utf8'));

const ok = all.filter((r) => r.id && r.url);
console.log(`apply-logos: ${ok.length} url(s) to apply (of ${all.length} entries)`);

let inserted = 0;
let replaced = 0;
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

  const insertAt = idIdx + idLine.length;
  const quoted = /[:#&*!|>'"%@`,\[\]{}]/.test(w.url) ? JSON.stringify(w.url) : w.url;
  const newFavLine = `  favicon: ${quoted}\n`;
  const newSrcLine = w.source ? `  faviconSource: ${w.source}\n` : '';

  // Find whether the station block already has a favicon: line, and
  // whether a faviconSource: line immediately follows it.
  let favStart = -1;
  let favEnd = -1;
  let srcStart = -1;
  let srcEnd = -1;
  let p = insertAt;
  while (p < text.length) {
    const lineEnd = text.indexOf('\n', p);
    const line = text.slice(p, lineEnd === -1 ? text.length : lineEnd);
    if (line.startsWith('- id:')) break;
    if (line.startsWith('  favicon:')) {
      favStart = p;
      favEnd = lineEnd + 1;
      const nextLineEnd = text.indexOf('\n', favEnd);
      const nextLine = text.slice(favEnd, nextLineEnd === -1 ? text.length : nextLineEnd);
      if (nextLine.startsWith('  faviconSource:')) {
        srcStart = favEnd;
        srcEnd = nextLineEnd + 1;
      }
      break;
    }
    if (lineEnd === -1) break;
    p = lineEnd + 1;
  }

  if (favStart !== -1) {
    if (!REPLACE) {
      skippedAlreadyHas++;
      continue;
    }
    // Replace the existing favicon: block (and faviconSource: if present) in place.
    const blockEnd = srcStart !== -1 ? srcEnd : favEnd;
    text = text.slice(0, favStart) + newFavLine + newSrcLine + text.slice(blockEnd);
    replaced++;
  } else {
    text = text.slice(0, insertAt) + newFavLine + newSrcLine + text.slice(insertAt);
    inserted++;
  }
}

if (DRY_RUN) {
  console.log(
    `apply-logos --dry-run: would insert ${inserted}, replace ${replaced}, skip-already-has ${skippedAlreadyHas}, miss ${skippedMissing}`,
  );
  process.exit(0);
}

writeFileSync(stationsPath, text);
console.log(
  `apply-logos: inserted ${inserted}, replaced ${replaced}, skipped-already-has ${skippedAlreadyHas}, missing-id ${skippedMissing}`,
);
