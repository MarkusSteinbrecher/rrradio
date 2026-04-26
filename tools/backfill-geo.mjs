#!/usr/bin/env node
/**
 * Adds `geo: [lat, lon]` to every station in data/stations.yaml that
 * doesn't already have one. Coordinates come from Radio Browser
 * (geo_lat / geo_long) — looked up first by exact stream URL match,
 * then by exact name match, then fuzzy by name.
 *
 *   npm run backfill-geo
 *
 * Surgical text edit (not yaml.stringify) to preserve hand-formatted
 * structure, comments, and section headers in stations.yaml.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const RB = 'https://de1.api.radio-browser.info';

// Fallback per broadcaster — broadcasting HQ city. Used when Radio
// Browser doesn't carry geo for a particular channel of an otherwise
// well-known broadcaster.
const BROADCASTER_HQ = {
  br: [48.1351, 11.5820],   // Munich
  wdr: [50.9375, 6.9603],   // Cologne
  ndr: [53.5511, 9.9937],   // Hamburg
  mdr: [51.3397, 12.3731],  // Leipzig
  swr: [48.7758, 9.1829],   // Stuttgart
  hr: [50.1109, 8.6821],    // Frankfurt
  rbb: [52.5200, 13.4050],  // Berlin
  sr: [49.2402, 6.9969],    // Saarbrücken
  rb: [53.0793, 8.8017],    // Bremen
  dlf: [50.9375, 6.9603],   // Köln (Deutschlandfunk HQ)
  bbc: [51.5174, -0.1278],  // London
  orf: [48.2082, 16.3738],  // Vienna
  frisky: [43.6532, -79.3832], // Toronto
  grrif: [46.5197, 6.6323], // Lausanne (rough Swiss-French)
};

function round4(n) { return Math.round(n * 10000) / 10000; }

async function rbByUrl(url) {
  // RB has /json/stations/byurl/<url> — but it's POST with form params.
  // Easier: search for stations whose url_resolved matches.
  const params = new URLSearchParams({ url, hidebroken: 'true', limit: '5' });
  try {
    const res = await fetch(`${RB}/json/stations/byurl?${params}`, {
      headers: { 'User-Agent': 'rrradio-backfill-geo/1.0' },
    });
    if (!res.ok) return [];
    return (await res.json()) ?? [];
  } catch { return []; }
}

async function rbByName(name, exact = true) {
  const params = new URLSearchParams({
    name,
    name_exact: String(exact),
    hidebroken: 'true',
    order: 'clickcount',
    reverse: 'true',
    limit: '5',
  });
  try {
    const res = await fetch(`${RB}/json/stations/search?${params}`, {
      headers: { 'User-Agent': 'rrradio-backfill-geo/1.0' },
    });
    if (!res.ok) return [];
    return (await res.json()) ?? [];
  } catch { return []; }
}

function pickGeo(rbStations) {
  for (const s of rbStations) {
    const lat = s.geo_lat;
    const lon = s.geo_long;
    if (typeof lat === 'number' && typeof lon === 'number' && (lat !== 0 || lon !== 0)) {
      return [round4(lat), round4(lon)];
    }
  }
  return null;
}

async function findGeo(station) {
  // 1. Exact stream URL match
  let matches = await rbByUrl(station.streamUrl);
  let geo = pickGeo(matches);
  if (geo) return { geo, source: 'url' };
  // 2. Exact name match
  matches = await rbByName(station.name, true);
  geo = pickGeo(matches);
  if (geo) return { geo, source: 'name-exact' };
  // 3. Fuzzy name (substring)
  matches = await rbByName(station.name, false);
  geo = pickGeo(matches);
  if (geo) return { geo, source: 'name-fuzzy' };
  // 4. Broadcaster HQ fallback — last resort so every station has a pin.
  const hq = BROADCASTER_HQ[station.broadcaster];
  if (hq) return { geo: [round4(hq[0]), round4(hq[1])], source: `hq:${station.broadcaster}` };
  return null;
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────

const stationsPath = join(root, 'data/stations.yaml');
let text = readFileSync(stationsPath, 'utf8');
const parsed = parseYaml(text);
if (!Array.isArray(parsed)) {
  console.error('backfill-geo: stations.yaml is not a list');
  process.exit(1);
}

let updated = 0;
let skipped = 0;
let missing = 0;

for (const s of parsed) {
  if (!s?.id || !s.streamUrl) continue;
  if (s.geo && Array.isArray(s.geo) && s.geo.length === 2) { skipped++; continue; }

  process.stdout.write(`  · ${s.id} … `);
  const result = await findGeo(s);
  if (!result) {
    console.log('no geo');
    missing++;
    continue;
  }
  console.log(`${result.geo[0]}, ${result.geo[1]}  (${result.source})`);

  // Insert `  geo: [lat, lon]` line right after the `id:` line for
  // this station. Single-pass text edit; matches the unique id line.
  const idLine = `- id: ${s.id}`;
  const idx = text.indexOf(idLine);
  if (idx === -1) {
    console.warn(`    ! couldn't locate id line for ${s.id} — skipping`);
    missing++;
    continue;
  }
  // Find end of the id line
  const endOfIdLine = text.indexOf('\n', idx);
  const before = text.slice(0, endOfIdLine + 1);
  const after = text.slice(endOfIdLine + 1);
  const insertion = `  geo: [${result.geo[0]}, ${result.geo[1]}]\n`;
  text = before + insertion + after;
  updated++;
}

writeFileSync(stationsPath, text);
console.log('');
console.log(`backfill-geo done: ${updated} updated, ${skipped} already had geo, ${missing} not found`);
