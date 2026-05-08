#!/usr/bin/env node
/**
 * Backfill `tags:` from the Radio Browser cache for stations whose
 * stationuuid is set but whose YAML row has no/empty tags. Mostly
 * stations imported via batch-import.mjs / import-rb-tier.mjs, where
 * the analyzer (analyze-rb.mjs) historically dropped the tags field
 * on the floor — see rrradio's untagged-station audit.
 *
 *   node tools/backfill-tags.mjs                # full sweep
 *   node tools/backfill-tags.mjs --limit 50     # validation run
 *   node tools/backfill-tags.mjs --dry-run      # don't mutate yaml
 *
 * Reads the local RB cache (`fetchByUuid` in offline mode by default
 * — every station the build-catalog pipeline has touched is already
 * there). Surgical YAML insert mirrors the pattern in `wire-metadata.mjs`,
 * `scrape-logos.mjs`, `wiki-logos.mjs`, `apply-logos.mjs` so the
 * existing hand-formatted YAML structure stays intact.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { fetchByUuid } from './rb-client.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const argv = process.argv.slice(2);
const argFlag = (n) => argv.includes(n);
const argVal = (n, fb) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fb;
};
const LIMIT = Number(argVal('--limit', Infinity));
const DRY_RUN = argFlag('--dry-run');
const ONLINE = argFlag('--online');

const stationsPath = join(root, 'data/stations.yaml');
let text = readFileSync(stationsPath, 'utf8');
const list = parseYaml(text);
if (!Array.isArray(list)) {
  console.error('backfill-tags: stations.yaml is not a list');
  process.exit(1);
}

// Candidates: has stationuuid, no/empty tags. Skip stations the
// curator already gave tags to — never overwrite hand-curated values.
const candidates = list
  .filter(
    (s) =>
      s &&
      typeof s.id === 'string' &&
      typeof s.stationuuid === 'string' &&
      (!s.tags || (Array.isArray(s.tags) && s.tags.length === 0)),
  )
  .slice(0, Number.isFinite(LIMIT) ? LIMIT : list.length);

console.log(
  `backfill-tags: ${candidates.length} candidate(s) — ` +
    (ONLINE ? 'will refresh stale cache' : 'cache-only (--online to allow refresh)'),
);

// Pre-filter to UUIDs we know are in the local cache. fetchByUuid in
// offline mode is strict — it throws if any UUID is missing. A handful
// of stationuuids in the catalog (3 today) are upstream-deleted and
// will never be found; those get skipped here as if no upstream
// record exists.
const cacheRaw = JSON.parse(readFileSync(join(root, '.cache/rb-byuuid.json'), 'utf8'));
const cachedUuids = new Set(Object.keys(cacheRaw.entries || {}));
const uuids = candidates.map((s) => s.stationuuid).filter((u) => cachedUuids.has(u));
const rb = await fetchByUuid(uuids, ONLINE ? {} : { offline: true });
const rbByUuid = new Map(rb.map((r) => [r.stationuuid, r]));

function normalizeTags(rbTagsStr) {
  // RB stores tags as a comma-separated string. Lowercase, trim, dedupe,
  // cap at 8 — the catalog's downstream UI doesn't have room for more
  // and the long tail tends to be noisy ("german station that plays
  // music sometimes" is a real RB tag).
  if (!rbTagsStr || typeof rbTagsStr !== 'string') return [];
  return rbTagsStr
    .split(/[,;]/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .filter((t, i, a) => a.indexOf(t) === i)
    .slice(0, 8);
}

function yamlSafe(t) {
  // Quote when the tag contains YAML-significant chars (any position),
  // starts with a YAML indicator (-, ?, :, etc.), has leading/trailing
  // whitespace, or contains the " - " sequence that YAML reads as a
  // block-sequence start inside a flow array. Without this, RB tags
  // like "#top100", "- dj charts", "?something" or "* hot" silently
  // corrupt the YAML when written into a flow-style `tags: [...]` line.
  // Also: quote anything that YAML would coerce to a non-string scalar
  // (numbers, true/false/null, "yes"/"no") — string tags written bare
  // come back as numbers/booleans on parse, and downstream JS filters
  // crash on `t.toLowerCase()`. Was the root cause of the WDR5 e2e
  // failure post-#187 (tags "70", "80", "11.11" → numeric in JSON).
  if (!t) return '""';
  if (/^-?\d+(?:\.\d+)?$/.test(t)) return JSON.stringify(t);
  if (/^(true|false|null|yes|no|on|off|~)$/i.test(t)) return JSON.stringify(t);
  if (/[:#&*!|>'"%@`,\[\]{}?]/.test(t)) return JSON.stringify(t);
  if (/^[-\s?:!&*|>%@`]/.test(t)) return JSON.stringify(t);
  if (/^\s|\s$/.test(t)) return JSON.stringify(t);
  if (/\s-\s/.test(t)) return JSON.stringify(t);
  return t;
}

let inserted = 0;
let noUpstream = 0;
let upstreamNoTags = 0;
let missLine = 0;
let alreadyHas = 0;

for (const s of candidates) {
  const r = rbByUuid.get(s.stationuuid);
  if (!r) {
    noUpstream++;
    continue;
  }
  const tags = normalizeTags(r.tags);
  if (tags.length === 0) {
    upstreamNoTags++;
    continue;
  }

  const idLine = `- id: ${s.id}\n`;
  const idIdx = text.indexOf(idLine);
  if (idIdx === -1) {
    missLine++;
    continue;
  }

  // Defensive: bail if a `tags:` line was added since we parsed (race
  // protection — could happen if another tool ran in parallel).
  let p = idIdx + idLine.length;
  let already = false;
  while (p < text.length) {
    const lineEnd = text.indexOf('\n', p);
    const line = text.slice(p, lineEnd === -1 ? text.length : lineEnd);
    if (line.startsWith('- id:')) break;
    if (line.startsWith('  tags:')) {
      already = true;
      break;
    }
    if (lineEnd === -1) break;
    p = lineEnd + 1;
  }
  if (already) {
    alreadyHas++;
    continue;
  }

  const tagLine = `  tags: [${tags.map(yamlSafe).join(', ')}]\n`;
  const insertAt = idIdx + idLine.length;
  text = text.slice(0, insertAt) + tagLine + text.slice(insertAt);
  inserted++;
}

console.log(
  `backfill-tags: inserted=${inserted}, no-upstream=${noUpstream}, ` +
    `upstream-no-tags=${upstreamNoTags}, already-has=${alreadyHas}, miss-id=${missLine}`,
);

if (DRY_RUN) {
  console.log('dry-run: not writing data/stations.yaml');
  process.exit(0);
}

writeFileSync(stationsPath, text);
