#!/usr/bin/env node
/**
 * Verify data/genre-art.yaml against the genre-art contract
 * (docs/spec/contracts/genre-art.md) and check that the committed
 * public/genre-art.json is what the YAML builds.
 *
 * Deploys serve the committed artifact, so CI needs a deterministic
 * check: a rule broken in the YAML, a photo without a file or a licence
 * row, or a YAML edit without `npm run genre-art` all fail here.
 *
 * Exits 0 when consistent, 2 when not. Local files only, no network.
 *
 *   npm run check-genre-art
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGenreArt, serializePayload } from './build-genre-art.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function fail(lines) {
  for (const line of [].concat(lines)) console.error(`check-genre-art: ${line}`);
  process.exit(2);
}

if (!existsSync(join(root, 'data/genre-art.yaml'))) fail('data/genre-art.yaml not found');

const { payload, errors } = loadGenreArt(root);
if (errors.length > 0) fail([...errors, `${errors.length} validation error(s)`]);

const outPath = join(root, 'public/genre-art.json');
if (!existsSync(outPath)) fail('public/genre-art.json is missing: run `npm run genre-art` and commit it');
if (readFileSync(outPath, 'utf8') !== serializePayload(payload)) {
  fail('public/genre-art.json is out of sync with data/genre-art.yaml: run `npm run genre-art` and commit it');
}

const sets = Object.values(payload.genres).reduce((n, s) => n + s.length, 0);
console.log(`check-genre-art: ${Object.keys(payload.genres).length} genre(s), ${sets} set(s) match YAML ✓`);
