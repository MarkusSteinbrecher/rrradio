#!/usr/bin/env node
/**
 * One-shot patch for `data/stations.yaml` rows whose `tags: [...]`
 * line emitted earlier through batch-import.mjs / import-rb-tier.mjs /
 * backfill-tags.mjs included entries that YAML auto-coerces to a
 * non-string scalar — bare numerics like 70, 80, 11.11 and YAML
 * reserved forms like true/false/null/yes/no/on/off/~.
 *
 * Those entries were the root cause of the WDR5 e2e regression on
 * main: at runtime the local search filter calls `t.toLowerCase()`
 * on each tag, and `(70).toLowerCase()` throws TypeError, killing
 * the whole filter pass.
 *
 * Operates only on flow-style `tags: [...]` lines (the format the
 * three importers emit). Hand-curated block-style lists are
 * untouched. Run once after the tools themselves are fixed.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const path = join(root, 'data/stations.yaml');
const text = readFileSync(path, 'utf8');

const NUMERIC_RE = /^-?\d+(?:\.\d+)?$/;
const RESERVED_RE = /^(true|false|null|yes|no|on|off|~)$/i;

let patchedRows = 0;
let patchedItems = 0;

const out = text.replace(/^(  tags: )\[(.*?)\]$/gm, (_, prefix, inner) => {
  // Split on commas — but a quoted item may itself contain a comma.
  // The importers we're cleaning up after never use commas inside
  // tag values, so a naive split is fine here. (If we ever did, this
  // tool would need a real CSV-style parser.)
  const parts = inner.split(/,\s*/);
  let rowChanged = false;
  const fixed = parts.map((raw) => {
    const t = raw.trim();
    if (!t) return t;
    if (/^["']/.test(t)) return t; // already quoted
    if (NUMERIC_RE.test(t) || RESERVED_RE.test(t)) {
      rowChanged = true;
      patchedItems++;
      return JSON.stringify(t);
    }
    return t;
  });
  if (rowChanged) patchedRows++;
  return `${prefix}[${fixed.join(', ')}]`;
});

if (out === text) {
  console.log('quote-tag-scalars: no changes');
  process.exit(0);
}

writeFileSync(path, out);
console.log(`quote-tag-scalars: patched ${patchedItems} item(s) across ${patchedRows} row(s)`);
