#!/usr/bin/env node
/**
 * Surfaces curation candidates: stations real users have played
 * (per GoatCounter) that are NOT yet in our YAML catalog.
 *
 * Source of truth on the play-count side is the public worker
 * endpoint, which aggregates `play: <name>` events from GC.
 *
 *   npm run candidates           — last 30 days, top 20
 *   npm run candidates -- 90 50  — explicit days + limit
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const days = Math.max(1, Math.min(365, Number(process.argv[2]) || 30));
const limit = Math.max(1, Math.min(50, Number(process.argv[3]) || 20));

const WORKER = 'https://rrradio-stats.markussteinbrecher.workers.dev';
const url = `${WORKER}/api/public/top-stations?days=${days}&limit=${limit}`;

const res = await fetch(url);
if (!res.ok) {
  console.error(`candidates: worker fetch failed ${res.status}`);
  process.exit(1);
}
const data = await res.json();
const items = Array.isArray(data.items) ? data.items : [];

const stations = parseYaml(readFileSync(join(root, 'data/stations.yaml'), 'utf8'));
const known = new Set(
  (Array.isArray(stations) ? stations : [])
    .map((s) => (s?.name ?? '').toLowerCase())
    .filter(Boolean),
);

const curated = [];
const candidates = [];
for (const i of items) {
  if (!i?.name) continue;
  (known.has(i.name.toLowerCase()) ? curated : candidates).push(i);
}

const pad = (n, w) => String(n).padStart(w, ' ');
const fmt = (rows) =>
  rows.map((r) => `  ${pad(r.count, 4)}  ${r.name}`).join('\n') || '  (none)';

console.log(`\nrange: last ${days} days · top ${limit} from GoatCounter\n`);
console.log(`already curated (${curated.length}):`);
console.log(fmt(curated));
console.log(`\ncuration candidates — played but not in YAML (${candidates.length}):`);
console.log(fmt(candidates));
console.log('');
