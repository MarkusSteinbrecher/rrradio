#!/usr/bin/env node
/**
 * pngquant pass over the local station-logo bundle.
 *
 * `tools/rasterise-remote-svgs.mjs` produces 500-wide PNGs with full
 * RGBA + uncompressed metadata, typically ~20-30 KB each (sometimes
 * 100+ KB). pngquant quantises to a palette + strips metadata for a
 * ~60% size win with no visible quality loss. Worth re-running every
 * time a new batch of broadcaster SVGs lands.
 *
 *   npm run pngquant-stations
 *   npm run pngquant-stations -- --dry-run
 *
 * Requires the `pngquant` binary on PATH (brew install pngquant; on
 * Ubuntu CI: `apt-get install pngquant`).
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileP = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const STATIONS_DIR = join(ROOT, 'public/stations');

const DRY_RUN = process.argv.includes('--dry-run');

try {
  await execFileP('pngquant', ['--version']);
} catch {
  console.error('pngquant: binary not found on PATH — brew install pngquant');
  process.exit(2);
}

const files = readdirSync(STATIONS_DIR).filter((f) => f.endsWith('.png'));
console.log(`pngquant-stations: ${files.length} file(s)${DRY_RUN ? ' · DRY RUN' : ''}`);

let shrunk = 0;
let totalBefore = 0;
let totalAfter = 0;
let skippedLarger = 0;
let errored = 0;

for (const name of files) {
  const path = join(STATIONS_DIR, name);
  const tmp = `${path}.opt`;
  const before = statSync(path).size;
  totalBefore += before;
  try {
    await execFileP('pngquant', [
      '--quality=70-95',
      '--strip',
      '--skip-if-larger',
      '--force',
      '--output', tmp,
      path,
    ]);
  } catch (err) {
    // pngquant exits non-zero when --skip-if-larger triggers — count as skip, not error.
    if (existsSync(tmp)) {
      try { unlinkSync(tmp); } catch { /* ignore */ }
    }
    if (err && /quality below/i.test(String(err.stderr ?? err.message ?? err))) {
      errored++;
      continue;
    }
    skippedLarger++;
    totalAfter += before;
    continue;
  }
  if (!existsSync(tmp)) {
    skippedLarger++;
    totalAfter += before;
    continue;
  }
  const after = statSync(tmp).size;
  if (after >= before) {
    unlinkSync(tmp);
    skippedLarger++;
    totalAfter += before;
    continue;
  }
  if (DRY_RUN) {
    unlinkSync(tmp);
  } else {
    renameSync(tmp, path);
  }
  shrunk++;
  totalAfter += after;
}

const saved = totalBefore - totalAfter;
const pct = totalBefore > 0 ? ((saved / totalBefore) * 100).toFixed(1) : '0';
console.log(
  `pngquant-stations: ${shrunk} shrunk, ${skippedLarger} skipped (not smaller), ${errored} errored — ` +
  `${(totalBefore / 1024 / 1024).toFixed(2)} MB → ${(totalAfter / 1024 / 1024).toFixed(2)} MB ` +
  `(saved ${(saved / 1024 / 1024).toFixed(2)} MB, ${pct}%)` +
  (DRY_RUN ? ' · DRY RUN — files not modified' : ''),
);
