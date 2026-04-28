#!/usr/bin/env node
/**
 * Duplicate detector. Operates on any list of {stationuuid?, name,
 * streamUrl, country?} records and groups likely duplicates.
 *
 * Three signals (most → least confident):
 *   1. Same stationuuid — definitive (one RB record referenced twice
 *      in our YAML, or two RB rows that point at the same record)
 *   2. Same normalised streamUrl — same actual stream endpoint
 *   3. Same normalised name + country — paranoia check; catches
 *      "BBC Radio 1" vs "BBC RADIO 1 " etc.
 *
 *   node tools/dedupe-check.mjs              — checks data/stations.yaml
 *   node tools/dedupe-check.mjs --rb-cc DE   — checks RB records for a country
 *
 * Prints a human report; exits non-zero when groups with size > 1
 * are found.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { pickServer } from './rb-client.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function normaliseStreamUrl(u) {
  if (!u) return '';
  try {
    const url = new URL(u);
    // Lowercase host, strip default port + trailing slash from path,
    // drop query string (most are session-id noise).
    let path = url.pathname.replace(/\/$/, '');
    if (path === '') path = '/';
    return `${url.protocol}//${url.host.toLowerCase()}${path}`;
  } catch {
    return u.trim().toLowerCase();
  }
}

function normaliseName(n) {
  return (n || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Group records by a key function. Returns groups with size > 1. */
function groupBy(records, keyFn) {
  const groups = new Map();
  for (const r of records) {
    const k = keyFn(r);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  return [...groups.entries()].filter(([, list]) => list.length > 1);
}

export function findDuplicates(records) {
  const byUuid = groupBy(records, (r) => r.stationuuid);
  const byStream = groupBy(records, (r) => normaliseStreamUrl(r.streamUrl));
  const byName = groupBy(records, (r) => {
    const n = normaliseName(r.name);
    if (!n) return '';
    return `${n}|${(r.country || '').toUpperCase()}`;
  });
  return { byUuid, byStream, byName };
}

function printGroup(label, groups) {
  if (groups.length === 0) {
    console.log(`  ${label}: none`);
    return;
  }
  console.log(`  ${label}: ${groups.length} group(s)`);
  for (const [key, list] of groups) {
    console.log(`    · ${key.slice(0, 80)}`);
    for (const r of list) {
      console.log(`        ${r.id || r.stationuuid || '?'}  ${r.name || '<no-name>'}`);
    }
  }
}

// ─── CLI ───────────────────────────────────────────────────────
const args = process.argv.slice(2);
const ccIdx = args.indexOf('--rb-cc');
const rbCountry = ccIdx >= 0 ? args[ccIdx + 1]?.toUpperCase() : null;

let records;
let label;

if (rbCountry) {
  const server = await pickServer();
  console.log(`dedupe-check: fetching RB stations for ${rbCountry} from ${server}…`);
  const url = `${server}/json/stations/bycountrycodeexact/${rbCountry}?hidebroken=true`;
  const res = await fetch(url, { headers: { 'User-Agent': 'rrradio-dedupe-check/1.0' } });
  if (!res.ok) {
    console.error(`dedupe-check: RB request failed ${res.status}`);
    process.exit(1);
  }
  const list = await res.json();
  records = list.map((s) => ({
    id: s.stationuuid,
    stationuuid: s.stationuuid,
    name: s.name,
    streamUrl: s.url_resolved || s.url,
    country: s.countrycode,
  }));
  label = `Radio Browser (${rbCountry})`;
} else {
  const stations = parseYaml(readFileSync(join(root, 'data/stations.yaml'), 'utf8'));
  if (!Array.isArray(stations)) {
    console.error('dedupe-check: stations.yaml is not a list');
    process.exit(1);
  }
  records = stations;
  label = 'data/stations.yaml';
}

console.log(`dedupe-check: ${records.length} records from ${label}`);
const { byUuid, byStream, byName } = findDuplicates(records);
printGroup('by stationuuid', byUuid);
printGroup('by streamUrl', byStream);
printGroup('by name+country', byName);

const total = byUuid.length + byStream.length + byName.length;
if (total > 0) process.exit(2);
