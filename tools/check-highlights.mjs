#!/usr/bin/env node
/**
 * Verify that `public/highlights.json` is consistent with
 * `data/highlights.yaml` and the published catalog.
 *
 * Production deploys serve the committed artifact rather than
 * regenerating it (same stance as the catalog), so CI needs a
 * deterministic check that the committed JSON matches what the YAML
 * implies. Catches the realistic regression: a curator edited
 * `data/highlights.yaml` and forgot to run `npm run highlights`.
 *
 * Re-derives the payload in-memory and byte-compares it to the committed
 * file. Validation errors (unknown station id, bad accent, bad date,
 * duplicate badge) are surfaced directly.
 *
 * Exits 0 when consistent, 2 when not. Reads only local files; no
 * network.
 *
 *   npm run check-highlights
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { buildHighlightsPayload, serializePayload } from './build-highlights.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const C = COLOR
  ? { ok: '\x1b[32m', bad: '\x1b[31m', dim: '\x1b[2m', reset: '\x1b[0m' }
  : { ok: '', bad: '', dim: '', reset: '' };

function fail(msg) {
  console.error(`${C.bad}check-highlights: ${msg}${C.reset}`);
  process.exit(2);
}

const yamlPath = join(root, 'data/highlights.yaml');
if (!existsSync(yamlPath)) fail('data/highlights.yaml not found');
const highlightsDoc = parseYaml(readFileSync(yamlPath, 'utf8'));

const catalogPath = join(root, 'public/stations.json');
if (!existsSync(catalogPath)) fail('public/stations.json not found — run `npm run catalog` first');
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
const stations = Array.isArray(catalog) ? catalog : catalog.stations;
if (!Array.isArray(stations)) fail('public/stations.json: stations[] not found');
const publishedIds = new Set(stations.map((s) => s.id));

const { payload, errors } = buildHighlightsPayload(highlightsDoc, publishedIds);
if (errors.length > 0) {
  console.error(`${C.bad}check-highlights: ${errors.length} validation error(s):${C.reset}`);
  for (const e of errors.slice(0, 20)) console.error(`  ${e}`);
  if (errors.length > 20) console.error(`  …and ${errors.length - 20} more`);
  process.exit(2);
}

const outPath = join(root, 'public/highlights.json');
if (!existsSync(outPath)) {
  fail(`public/highlights.json is missing — run ${C.ok}npm run highlights${C.reset}${C.bad} and commit it.${C.reset}`);
}

const committed = readFileSync(outPath, 'utf8');
const expected = serializePayload(payload);
if (committed !== expected) {
  console.error(
    `${C.bad}check-highlights: public/highlights.json is out of sync with data/highlights.yaml${C.reset}`,
  );
  console.error(
    `\n  Fix: run ${C.ok}npm run highlights${C.reset}${C.bad} and commit the updated public/highlights.json.${C.reset}`,
  );
  process.exit(2);
}

console.log(
  `${C.ok}check-highlights: ${payload.highlights.length} featured station(s) match YAML ✓${C.reset}`,
);
