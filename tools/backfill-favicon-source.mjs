#!/usr/bin/env node
/**
 * One-shot backfill: write `faviconSource:` into every station in
 * data/stations.yaml that has a favicon but no recorded provenance.
 *
 * The label is inferred by URL pattern (see classify() below), erring
 * toward "radio-browser" when nothing else matches because that's the
 * dominant path through tools/auto-curate.mjs — RB's `favicon` field
 * is what we picked up for the long tail.
 *
 * Idempotent: re-running over an already-backfilled file is a no-op.
 * Does not modify rows with an existing `faviconSource:` line.
 *
 *   node tools/backfill-favicon-source.mjs           # write
 *   node tools/backfill-favicon-source.mjs --dry-run # report only
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const YAML_PATH = join(ROOT, 'data/stations.yaml');

const DRY_RUN = process.argv.includes('--dry-run');

// Known broadcaster-API image hosts. Anything whose response body is
// the image itself, served by a service endpoint (size / format params,
// resource IDs in the path), belongs here. These were observed during
// the survey of the 15k untagged favicons in the catalog.
const API_HOSTS = new Set([
  'api.ardmediathek.de',
  'audioapi.orf.at',
  'image-service.api.ardmediathek.de',
  'images.zeno.fm',
]);

// Patterns that mark an URL as an API endpoint regardless of host.
const API_URL_RX =
  /(?:\/api\/|\/image-service\/|\/v3\/re\/|\/_ipx\/|\bdims\d+\b|\/dims4\/|\?ops=|\?w=|\?fit=|\?s=\d+x\d+|\?t=_\d+x\d+)/i;

function classify(favicon, homepage) {
  if (!favicon) return null;
  if (favicon.startsWith('stations/')) {
    // Local bundle — provenance is "broadcaster" by default; only the 4
    // hand-curated ones live here and they already carry an explicit label.
    return 'broadcaster';
  }
  let url;
  try { url = new URL(favicon); } catch { return 'radio-browser'; }

  const host = url.host.toLowerCase();
  if (host === 'upload.wikimedia.org' || host.endsWith('.wikipedia.org') || host === 'commons.wikimedia.org') {
    return 'wiki';
  }
  if (API_HOSTS.has(host) || API_URL_RX.test(favicon)) {
    return 'broadcaster-api';
  }
  // Broadcaster-site: favicon host matches the station homepage's base domain.
  if (homepage) {
    try {
      const hpHost = new URL(homepage).host.toLowerCase();
      // strip leading www. for the comparison both ways
      const base = (h) => h.replace(/^www\./, '');
      if (base(host) === base(hpHost) || base(host).endsWith('.' + base(hpHost))) {
        return 'broadcaster-site';
      }
    } catch { /* malformed homepage — fall through */ }
  }
  return 'radio-browser';
}

const text = readFileSync(YAML_PATH, 'utf8');
const parsed = parseYaml(text);
if (!Array.isArray(parsed)) {
  console.error('backfill-favicon-source: stations.yaml is not a list');
  process.exit(1);
}

// Build a map id -> classification by parsing the YAML structurally,
// then do the textual edit pass so we preserve formatting / comments.
const wantedById = new Map();
for (const s of parsed) {
  if (!s || typeof s !== 'object') continue;
  if (!s.id || !s.favicon) continue;
  if (s.faviconSource) continue;          // already labelled — leave alone
  const label = classify(s.favicon, s.homepage);
  if (label) wantedById.set(s.id, label);
}

console.log(`backfill: ${wantedById.size} entries to label`);

// Walk the YAML text line-by-line. Each station block starts with `- id: <slug>`.
// Within a block, when we hit the `  favicon:` line, insert
// `  faviconSource: <label>` immediately after it if not already present.
const lines = text.split('\n');
const out = [];
let currentId = null;

const counts = new Map();
let inserted = 0;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  out.push(line);

  // Track which station block we're in.
  const idMatch = line.match(/^- id: (.+)$/);
  if (idMatch) {
    currentId = idMatch[1].trim();
    continue;
  }

  // When we see a `  favicon:` line inside the current block, see if the
  // immediately-next non-empty line is already `  faviconSource:`.
  if (currentId && /^  favicon:/.test(line)) {
    const wanted = wantedById.get(currentId);
    if (!wanted) continue;
    const next = lines[i + 1] || '';
    if (/^  faviconSource:/.test(next)) continue;     // belt-and-braces guard
    out.push(`  faviconSource: ${wanted}`);
    counts.set(wanted, (counts.get(wanted) || 0) + 1);
    inserted++;
  }
}

console.log(`backfill: ${inserted} lines inserted`);
for (const [label, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${n.toString().padStart(6)} ${label}`);
}

if (DRY_RUN) {
  console.log('backfill: --dry-run, no file written');
  process.exit(0);
}

writeFileSync(YAML_PATH, out.join('\n'));
console.log(`backfill: wrote ${YAML_PATH}`);
