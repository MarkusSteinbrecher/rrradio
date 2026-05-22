#!/usr/bin/env node
/**
 * Snapshot Radio Browser's raw catalog into data/sources/radio-browser/.
 *
 * Per-country files are the source of truth — one JSON per ISO 3166-1
 * alpha-2 code, committed to git so we get version history via
 * `git log -p data/sources/radio-browser/by-country/<CC>.json`. The
 * shape is exactly what RB returns from
 * /json/stations/bycountrycodeexact/<CC>, plus a small wrapper with
 * fetch metadata.
 *
 *   npm run fetch-rb-raw                  # missing or stale countries
 *   npm run fetch-rb-raw -- --all         # every country RB knows about
 *   npm run fetch-rb-raw -- DE            # one country
 *   npm run fetch-rb-raw -- --force       # ignore freshness
 *   npm run fetch-rb-raw -- --max-age 30d # custom freshness window
 *
 * Politeness: 250 ms between requests, one country at a time, exponential
 * back-off on 5xx. The default 7-day max age means re-running the script
 * is a no-op unless countries are stale.
 *
 * Writes:
 *   data/sources/radio-browser/by-country/<CC>.json   — raw RB station list
 *   data/sources/radio-browser/index.json             — per-country roll-up
 *
 * Stable serialisation for git-friendly diffs:
 *   - country files keyed objects are sorted by stationuuid
 *   - field order is stable (we project through a fixed key list)
 *   - pretty-printed at 2-space indent
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickServer } from './rb-client.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT_DIR = join(ROOT, 'data', 'sources', 'radio-browser');
const COUNTRY_DIR = join(OUT_DIR, 'by-country');
const INDEX_FILE = join(OUT_DIR, 'index.json');
const USER_AGENT = 'rrradio-fetch-rb-raw/1.0 (+https://rrradio.org)';

const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const POLITE_DELAY_MS = 250;
const MAX_RETRIES = 4;

// Stable RB field order. We project every station through this list
// so the on-disk shape stays identical even when RB silently reorders
// keys in its response. New fields RB adds in the future fall into
// `_extra` (so we still capture them) but at the end of the record,
// keeping diffs on the common path tight.
const RB_FIELDS = [
  'stationuuid', 'changeuuid', 'serveruuid', 'name', 'url', 'url_resolved',
  'homepage', 'favicon', 'tags', 'country', 'countrycode',
  'iso_3166_2', 'state', 'language', 'languagecodes',
  'votes', 'lastchangetime', 'lastchangetime_iso8601', 'codec', 'bitrate', 'hls',
  'lastcheckok', 'lastchecktime', 'lastchecktime_iso8601',
  'lastcheckoktime', 'lastcheckoktime_iso8601', 'lastlocalchecktime', 'lastlocalchecktime_iso8601',
  'clicktimestamp', 'clicktimestamp_iso8601', 'clickcount', 'clicktrend',
  'ssl_error', 'geo_lat', 'geo_long', 'geo_distance',
  'has_extended_info',
];
const RB_FIELD_SET = new Set(RB_FIELDS);

function normalizeStation(s) {
  const out = {};
  for (const k of RB_FIELDS) {
    if (k in s) out[k] = s[k];
  }
  // Anything new RB adds gets bundled under `_extra` so we still
  // commit it (and notice on the next diff).
  const extras = {};
  for (const k of Object.keys(s).sort()) {
    if (!RB_FIELD_SET.has(k)) extras[k] = s[k];
  }
  if (Object.keys(extras).length > 0) out._extra = extras;
  return out;
}

function parseArgs(argv) {
  const args = { country: null, all: false, force: false, maxAgeMs: DEFAULT_MAX_AGE_MS };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all') args.all = true;
    else if (a === '--force') args.force = true;
    else if (a === '--max-age') {
      const v = argv[++i];
      args.maxAgeMs = parseDuration(v);
    } else if (/^[A-Za-z]{2}$/.test(a)) {
      args.country = a.toUpperCase();
    } else {
      console.error(`fetch-rb-raw: unknown arg '${a}'`);
      process.exit(1);
    }
  }
  return args;
}

function parseDuration(s) {
  const m = /^(\d+)([dhms])?$/.exec(s || '');
  if (!m) throw new Error(`fetch-rb-raw: bad --max-age '${s}'`);
  const n = Number(m[1]);
  const unit = m[2] || 'd';
  return n * ({ d: 86400, h: 3600, m: 60, s: 1 }[unit]) * 1000;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function withRetry(label, fn) {
  let lastErr;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try { return await fn(); }
    catch (err) {
      lastErr = err;
      const backoff = 500 * Math.pow(2, attempt);
      console.warn(`fetch-rb-raw: ${label} attempt ${attempt + 1} failed (${err.message}); retry in ${backoff}ms`);
      await sleep(backoff);
    }
  }
  throw lastErr;
}

async function listCountries(server) {
  const url = `${server}/json/countrycodes`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`countrycodes ${res.status}`);
  const list = await res.json();
  // Each row: { name: "DE", stationcount: 5804 }
  return list
    .filter((r) => /^[A-Z]{2}$/.test(r.name) && (r.stationcount ?? 0) > 0)
    .map((r) => ({ cc: r.name, expected: r.stationcount }))
    .sort((a, b) => a.cc.localeCompare(b.cc));
}

async function fetchCountry(server, cc) {
  const url = `${server}/json/stations/bycountrycodeexact/${cc}?hidebroken=false&limit=100000`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`bycountrycode ${cc} ${res.status}`);
  const list = await res.json();
  if (!Array.isArray(list)) throw new Error(`bycountrycode ${cc} returned non-array`);
  return list;
}

function loadIndex() {
  if (!existsSync(INDEX_FILE)) return { schemaVersion: 1, source: 'radio-browser', countries: {} };
  try { return JSON.parse(readFileSync(INDEX_FILE, 'utf8')); }
  catch { return { schemaVersion: 1, source: 'radio-browser', countries: {} }; }
}

function isFresh(meta, maxAgeMs) {
  if (!meta || !meta.fetchedAt) return false;
  return Date.now() - new Date(meta.fetchedAt).getTime() < maxAgeMs;
}

function writeCountryFile(cc, stations, fetchedAt, server) {
  // Sort + normalize so the on-disk file is stable across runs that
  // get the same data back from RB.
  const sorted = [...stations]
    .map(normalizeStation)
    .sort((a, b) => a.stationuuid.localeCompare(b.stationuuid));
  const body = {
    schemaVersion: 1,
    source: 'radio-browser',
    country: cc,
    fetchedAt,
    server,
    count: sorted.length,
    stations: sorted,
  };
  const path = join(COUNTRY_DIR, `${cc}.json`);
  writeFileSync(path, JSON.stringify(body, null, 2) + '\n');
}

function writeIndex(idx) {
  // Sort countries by CC for stable diffs.
  const sorted = {};
  for (const cc of Object.keys(idx.countries).sort()) sorted[cc] = idx.countries[cc];
  idx.countries = sorted;
  idx.generatedAt = new Date().toISOString();
  writeFileSync(INDEX_FILE, JSON.stringify(idx, null, 2) + '\n');
}

// ─── Main ──────────────────────────────────────────────────────────
const args = parseArgs(process.argv.slice(2));
mkdirSync(COUNTRY_DIR, { recursive: true });

console.log('fetch-rb-raw: picking RB mirror…');
const server = await pickServer();
console.log(`fetch-rb-raw: using ${server}`);

let targets;
if (args.country) {
  targets = [{ cc: args.country, expected: null }];
} else {
  console.log('fetch-rb-raw: listing RB country codes…');
  targets = await withRetry('countrycodes', () => listCountries(server));
  console.log(`fetch-rb-raw: ${targets.length} country code(s) reported by RB`);
}

const index = loadIndex();
const startTs = Date.now();
let fetchedCount = 0;
let skippedCount = 0;
let totalStations = 0;

for (const { cc, expected } of targets) {
  const meta = index.countries[cc];
  if (!args.force && !args.country && isFresh(meta, args.maxAgeMs)) {
    skippedCount++;
    totalStations += meta.count ?? 0;
    continue;
  }
  const fetchedAt = new Date().toISOString();
  const list = await withRetry(`fetch ${cc}`, () => fetchCountry(server, cc));
  writeCountryFile(cc, list, fetchedAt, server);
  index.countries[cc] = {
    fetchedAt,
    server,
    count: list.length,
    expected: expected ?? null,
  };
  fetchedCount++;
  totalStations += list.length;
  const elapsed = ((Date.now() - startTs) / 1000).toFixed(1);
  process.stdout.write(
    `\r  ${(fetchedCount + skippedCount)}/${targets.length} ` +
    `(fetched ${fetchedCount}, skipped ${skippedCount}, ${elapsed}s) ` +
    `last=${cc}:${list.length}`.padEnd(80),
  );
  await sleep(POLITE_DELAY_MS);
}
process.stdout.write('\n');

// Drop countries from the index that aren't in the targets list AND
// have no on-disk file (RB removed them, presumably). Keep entries for
// countries that still have a file even if they weren't fetched this run
// (resume / single-country runs).
const haveFile = new Set(
  readdirSync(COUNTRY_DIR).filter((f) => /^[A-Z]{2}\.json$/.test(f)).map((f) => f.slice(0, 2)),
);
for (const cc of Object.keys(index.countries)) {
  if (!haveFile.has(cc)) delete index.countries[cc];
}

writeIndex(index);

console.log(
  `fetch-rb-raw: done. fetched=${fetchedCount} skipped=${skippedCount} ` +
  `countries=${Object.keys(index.countries).length} stations=${totalStations}`,
);
