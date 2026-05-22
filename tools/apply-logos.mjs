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
 * Patch entries must include { id, url, source }; source must be one of the
 * known faviconSource values documented in docs/logo-extraction.md.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
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
const inputArg = argVal('--in', 'internal/logos/all.json');
const inputPath = isAbsolute(inputArg) ? inputArg : join(root, inputArg);

const ALLOWED_SOURCES = new Set([
  'broadcaster-site',
  'broadcaster-api',
  'wiki',
  'radio-browser',
  'http-upgraded',
  'broadcaster',
  'manual',
]);
const ALLOWED_SOURCE_TYPES = new Set(['bundle', 'api', 'cdn', 'none']);
const LOGO_FIELD_RE = /^  (faviconSource|faviconSourceUrl|faviconLicense|faviconSourceType|faviconOk):/;

const stationsPath = join(root, 'data/stations.yaml');
let text = readFileSync(stationsPath, 'utf8');
const all = JSON.parse(readFileSync(inputPath, 'utf8'));

if (!Array.isArray(all)) {
  console.error('apply-logos: input JSON must be an array');
  process.exit(2);
}

function quoteYaml(value) {
  const s = String(value);
  return /[:#&*!|>'"%@`,\[\]{}]/.test(s) ? JSON.stringify(s) : s;
}

function optionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function validateEntry(raw) {
  const id = optionalString(raw.id);
  const url = optionalString(raw.url);
  const source = optionalString(raw.source ?? raw.faviconSource);
  const sourceUrl = optionalString(raw.sourceUrl ?? raw.faviconSourceUrl);
  const sourceType = optionalString(raw.sourceType ?? raw.faviconSourceType);
  const license = optionalString(raw.license ?? raw.faviconLicense);
  const faviconOk = raw.ok ?? raw.faviconOk;

  if (!id) return { ok: false, reason: 'missing-id' };
  if (!url) return { ok: false, id, reason: 'missing-url' };
  if (!url.startsWith('https://') && !url.startsWith('stations/')) {
    return { ok: false, id, reason: 'favicon-url-must-be-https-or-local' };
  }
  if (!source) return { ok: false, id, reason: 'missing-source' };
  if (!ALLOWED_SOURCES.has(source)) {
    return { ok: false, id, reason: `unknown-source:${source}` };
  }
  if (sourceUrl && !sourceUrl.startsWith('https://')) {
    return { ok: false, id, reason: 'source-url-must-be-https' };
  }
  if (sourceType && !ALLOWED_SOURCE_TYPES.has(sourceType)) {
    return { ok: false, id, reason: `unknown-source-type:${sourceType}` };
  }
  if (faviconOk !== undefined && typeof faviconOk !== 'boolean') {
    return { ok: false, id, reason: 'favicon-ok-must-be-boolean' };
  }

  return { ok: true, id, url, source, sourceUrl, sourceType, license, faviconOk };
}

function logoBlock(entry) {
  const lines = [`  favicon: ${quoteYaml(entry.url)}\n`, `  faviconSource: ${entry.source}\n`];
  if (entry.sourceUrl) lines.push(`  faviconSourceUrl: ${quoteYaml(entry.sourceUrl)}\n`);
  if (entry.sourceType) lines.push(`  faviconSourceType: ${entry.sourceType}\n`);
  if (entry.license) lines.push(`  faviconLicense: ${quoteYaml(entry.license)}\n`);
  if (entry.faviconOk === true) lines.push('  faviconOk: true\n');
  return lines.join('');
}

function findLogoMetadataBlockEnd(src, start) {
  let end = start;
  while (end < src.length) {
    const lineEnd = src.indexOf('\n', end);
    const line = src.slice(end, lineEnd === -1 ? src.length : lineEnd);
    if (!LOGO_FIELD_RE.test(line)) break;
    end = lineEnd === -1 ? src.length : lineEnd + 1;
  }
  return end;
}

const validated = all.map(validateEntry);
const ok = validated.filter((r) => r.ok);
const invalid = validated.filter((r) => !r.ok);
console.log(`apply-logos: ${ok.length} valid url(s) to apply (of ${all.length} entries)`);

let inserted = 0;
let replaced = 0;
let skippedAlreadyHas = 0;
let skippedMissing = 0;
let skippedInvalid = invalid.length;

for (const bad of invalid.slice(0, 25)) {
  console.warn(`  ! skipping ${bad.id ?? '<unknown>'}: ${bad.reason}`);
}
if (invalid.length > 25) {
  console.warn(`  ! ${invalid.length - 25} more invalid entr${invalid.length === 26 ? 'y' : 'ies'} not shown`);
}

for (const w of ok) {
  const idLine = `- id: ${w.id}\n`;
  const idIdx = text.indexOf(idLine);
  if (idIdx === -1) {
    skippedMissing++;
    console.warn(`  ! couldn't locate id line for ${w.id}`);
    continue;
  }

  const insertAt = idIdx + idLine.length;
  const newLogoBlock = logoBlock(w);

  // Find whether the station block already has a favicon: line, and
  // whether logo metadata fields immediately follow it.
  let favStart = -1;
  let favEnd = -1;
  let metadataEnd = -1;
  let p = insertAt;
  while (p < text.length) {
    const lineEnd = text.indexOf('\n', p);
    const line = text.slice(p, lineEnd === -1 ? text.length : lineEnd);
    if (line.startsWith('- id:')) break;
    if (line.startsWith('  favicon:')) {
      favStart = p;
      favEnd = lineEnd + 1;
      metadataEnd = findLogoMetadataBlockEnd(text, favEnd);
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
    // Replace the existing favicon block and adjacent logo metadata in place.
    const blockEnd = metadataEnd !== -1 ? metadataEnd : favEnd;
    text = text.slice(0, favStart) + newLogoBlock + text.slice(blockEnd);
    replaced++;
  } else {
    text = text.slice(0, insertAt) + newLogoBlock + text.slice(insertAt);
    inserted++;
  }
}

if (DRY_RUN) {
  console.log(
    `apply-logos --dry-run: would insert ${inserted}, replace ${replaced}, skip-already-has ${skippedAlreadyHas}, miss ${skippedMissing}, invalid ${skippedInvalid}`,
  );
  process.exit(0);
}

writeFileSync(stationsPath, text);
console.log(
  `apply-logos: inserted ${inserted}, replaced ${replaced}, skipped-already-has ${skippedAlreadyHas}, missing-id ${skippedMissing}, invalid ${skippedInvalid}`,
);
