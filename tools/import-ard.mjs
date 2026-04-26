#!/usr/bin/env node
/**
 * Imports ARD (German public radio) channels from Radio Browser into
 * data/stations.yaml at `status: stream-only`.
 *
 * Strategy: a hand-curated canonical channel list per broadcaster
 * (the channels we'd actually want to ship), and for each canonical
 * channel we pick the best Radio Browser variant — preferring https,
 * then lastcheckok, then highest clickcount. Avoids the noise of RB's
 * dozens of bitrate / mirror duplicates per channel.
 *
 * Today only the `br` broadcaster has a wired metadata fetcher; others
 * start at stream-only and graduate as we research their now-playing
 * APIs (the analyze tool reports the gap).
 *
 *   npm run import-ard
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const RB = 'https://de1.api.radio-browser.info';

// Canonical ARD channels we'd want to ship. Each entry has:
//   broadcaster — the key in data/broadcasters.yaml
//   name        — canonical display name (also the YAML name field)
//   match       — array of lowercased name patterns RB might use
//                 (substring match against `rb.name.toLowerCase()`).
//                 First pattern wins; others let us catch variants.
const CANONICAL = [
  // ─── BR (Bayern 1 Oberbayern is already curated as builtin-br-bayern1) ───
  { broadcaster: 'br', name: 'Bayern 2',     match: ['bayern 2', 'bayern2'] },
  { broadcaster: 'br', name: 'Bayern 3',     match: ['bayern 3', 'bayern3'] },
  { broadcaster: 'br', name: 'BR-Klassik',   match: ['br-klassik', 'br klassik'] },
  { broadcaster: 'br', name: 'B5 aktuell',   match: ['b5 aktuell'] },
  { broadcaster: 'br', name: 'BR Heimat',    match: ['br heimat'] },
  { broadcaster: 'br', name: 'BR Schlager',  match: ['br schlager'] },
  { broadcaster: 'br', name: 'BR24',         match: ['br24', 'br 24'], avoid: ['br24live'] },
  { broadcaster: 'br', name: 'Puls',         match: ['puls'] },

  // ─── WDR ───
  { broadcaster: 'wdr', name: '1Live',        match: ['1live'], avoid: ['diggi'] },
  { broadcaster: 'wdr', name: '1Live Diggi',  match: ['1live diggi'] },
  { broadcaster: 'wdr', name: 'WDR 2',        match: ['wdr 2', 'wdr2'], avoid: ['ruhr', 'rheinland'] },
  { broadcaster: 'wdr', name: 'WDR 3',        match: ['wdr 3', 'wdr3'] },
  { broadcaster: 'wdr', name: 'WDR 4',        match: ['wdr 4', 'wdr4'] },
  { broadcaster: 'wdr', name: 'WDR 5',        match: ['wdr 5', 'wdr5'], avoid: ['nachricht'] },
  { broadcaster: 'wdr', name: 'COSMO',        match: ['cosmo'] },
  { broadcaster: 'wdr', name: 'Die Maus',     match: ['die maus', 'maus radio'] },

  // ─── NDR ───
  { broadcaster: 'ndr', name: 'NDR Info',                match: ['ndr info'], avoid: ['schleswig'] },
  { broadcaster: 'ndr', name: 'NDR 90,3',                match: ['ndr 90,3', 'ndr 90.3'] },
  { broadcaster: 'ndr', name: 'NDR 2',                   match: ['ndr 2'], avoid: ['hamburg'] },
  { broadcaster: 'ndr', name: 'NDR Kultur',              match: ['ndr kultur'] },
  { broadcaster: 'ndr', name: 'NDR 1 Niedersachsen',     match: ['ndr 1 niedersachsen'] },
  { broadcaster: 'ndr', name: 'NDR 1 Welle Nord',        match: ['welle nord'] },
  { broadcaster: 'ndr', name: 'N-JOY',                   match: ['n-joy', 'njoy'] },
  { broadcaster: 'ndr', name: 'NDR Schlager',            match: ['ndr schlager'] },

  // ─── MDR ───
  { broadcaster: 'mdr', name: 'MDR Aktuell',         match: ['mdr aktuell'] },
  { broadcaster: 'mdr', name: 'MDR Sachsen',         match: ['mdr sachsen'], avoid: ['anhalt'] },
  { broadcaster: 'mdr', name: 'MDR Sachsen-Anhalt',  match: ['sachsen-anhalt', 'sachsen anhalt'] },
  { broadcaster: 'mdr', name: 'MDR Thüringen',       match: ['mdr thüringen', 'mdr thueringen'] },
  { broadcaster: 'mdr', name: 'MDR Kultur',          match: ['mdr kultur'] },
  { broadcaster: 'mdr', name: 'MDR Jump',            match: ['mdr jump'] },
  { broadcaster: 'mdr', name: 'MDR Sputnik',         match: ['mdr sputnik', 'sputnik'] },
  { broadcaster: 'mdr', name: 'MDR Klassik',         match: ['mdr klassik'] },
  { broadcaster: 'mdr', name: 'MDR Schlagerwelt',    match: ['schlagerwelt'] },

  // ─── SWR ───
  { broadcaster: 'swr', name: 'SWR1 Baden-Württemberg', match: ['swr1 bw', 'swr1 baden'], avoid: ['neu'] },
  { broadcaster: 'swr', name: 'SWR1 Rheinland-Pfalz',   match: ['swr1 rheinland', 'swr1 rp'] },
  { broadcaster: 'swr', name: 'SWR2',                   match: ['swr2', 'swr 2'] },
  { broadcaster: 'swr', name: 'SWR3',                   match: ['swr3', 'swr 3'] },
  { broadcaster: 'swr', name: 'SWR4 Baden-Württemberg', match: ['swr4 bw', 'swr4 baden'] },
  { broadcaster: 'swr', name: 'SWR4 Rheinland-Pfalz',   match: ['swr4 rheinland', 'swr4 rp'] },
  { broadcaster: 'swr', name: 'DASDING',                match: ['dasding'] },
  { broadcaster: 'swr', name: 'SWR Aktuell',            match: ['swr aktuell'] },

  // ─── HR ───
  { broadcaster: 'hr', name: 'hr1',     match: ['hr1', 'hr 1'] },
  { broadcaster: 'hr', name: 'hr2',     match: ['hr2', 'hr 2'] },
  { broadcaster: 'hr', name: 'hr3',     match: ['hr3', 'hr 3'] },
  { broadcaster: 'hr', name: 'hr4',     match: ['hr4', 'hr 4'] },
  { broadcaster: 'hr', name: 'You FM',  match: ['you fm', 'youfm'] },
  { broadcaster: 'hr', name: 'hr-iNFO', match: ['hr-info', 'hr info'] },

  // ─── RBB ───
  { broadcaster: 'rbb', name: 'Antenne Brandenburg',  match: ['antenne brandenburg'] },
  { broadcaster: 'rbb', name: 'Fritz',                match: ['fritz'] },
  { broadcaster: 'rbb', name: 'Inforadio',            match: ['inforadio'] },
  { broadcaster: 'rbb', name: 'rbbKultur',            match: ['kulturradio', 'rbb kultur', 'rbbkultur'] },
  { broadcaster: 'rbb', name: 'Radio Berlin 88,8',    match: ['radio berlin', 'berlin 88'] },
  { broadcaster: 'rbb', name: 'Radioeins',            match: ['radioeins'] },

  // ─── SR ───
  { broadcaster: 'sr', name: 'SR 1',         match: ['sr 1', 'sr1'] },
  { broadcaster: 'sr', name: 'SR 2',         match: ['sr 2', 'sr2'] },
  { broadcaster: 'sr', name: 'SR 3',         match: ['sr 3', 'sr3'] },
  { broadcaster: 'sr', name: 'AntenneSaar',  match: ['antenne saar', 'antennesaar'] },
  { broadcaster: 'sr', name: 'UnserDing',    match: ['unser ding', 'unserding'] },

  // ─── Radio Bremen ───
  { broadcaster: 'rb', name: 'Bremen Eins',  match: ['bremen eins', 'bremen 1'] },
  { broadcaster: 'rb', name: 'Bremen Zwei',  match: ['bremen zwei', 'bremen 2'] },
  { broadcaster: 'rb', name: 'Bremen Vier',  match: ['bremen vier', 'bremen 4'] },
  { broadcaster: 'rb', name: 'Bremen NEXT',  match: ['bremen next'] },

  // ─── Deutschlandradio (formally separate from ARD but same family for our purposes) ───
  { broadcaster: 'dlf', name: 'Deutschlandfunk',        match: ['deutschlandfunk |', 'deutschlandfunk dlf'], avoid: ['kultur', 'nova', 'opus 24k'] },
  { broadcaster: 'dlf', name: 'Deutschlandfunk Kultur', match: ['deutschlandfunk kultur'] },
  { broadcaster: 'dlf', name: 'Deutschlandfunk Nova',   match: ['deutschlandfunk nova'] },
];

// Strict ARD-affiliated host detection
const HOST_RULES = [
  { re: /(^|\.)br\.de$/i, key: 'br' },
  { re: /(^|\.)wdr\.de$/i, key: 'wdr' },
  { re: /(^|\.)ndr\.de$/i, key: 'ndr' },
  { re: /(^|\.)mdr\.de$/i, key: 'mdr' },
  { re: /(^|\.)swr(?:[1-4])?\.de$/i, key: 'swr' },
  { re: /(^|\.)dasding\.de$/i, key: 'swr' },
  { re: /(^|\.)hr-online\.de$/i, key: 'hr' },
  { re: /(^|\.)hr\.de$/i, key: 'hr' },
  { re: /(^|\.)hr[1-4]\.de$/i, key: 'hr' },
  { re: /(^|\.)youfm\.de$/i, key: 'hr' },
  { re: /(^|\.)rbb-online\.de$/i, key: 'rbb' },
  { re: /(^|\.)rbb24\.de$/i, key: 'rbb' },
  { re: /(^|\.)radioeins\.de$/i, key: 'rbb' },
  { re: /(^|\.)fritz\.de$/i, key: 'rbb' },
  { re: /(^|\.)sr-online\.de$/i, key: 'sr' },
  { re: /(^|\.)sr\.de$/i, key: 'sr' },
  { re: /(^|\.)radiobremen\.de$/i, key: 'rb' },
  { re: /(^|\.)deutschlandfunk\.de$/i, key: 'dlf' },
  { re: /(^|\.)deutschlandradio\.de$/i, key: 'dlf' },
  { re: /(^|\.)dlf\.de$/i, key: 'dlf' },
];

function broadcasterFromHosts(...urls) {
  for (const u of urls) {
    if (!u) continue;
    let host;
    try { host = new URL(u).hostname; } catch { continue; }
    for (const rule of HOST_RULES) if (rule.re.test(host)) return rule.key;
  }
  return null;
}

function slugify(s) {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
}

function quote(s) {
  return /[:#&*!|>'"%@`,\[\]{}]/.test(s) || /^\s|\s$/.test(s) ? JSON.stringify(s) : s;
}

function normaliseTags(tags) {
  if (!tags) return [];
  return tags.split(/[,;]/).map((t) => t.trim().toLowerCase()).filter(Boolean).filter((t, i, a) => a.indexOf(t) === i).slice(0, 6);
}

// ─────────────────────────────────────────────────────────────
// Fetch + filter to ARD-affiliated stations
// ─────────────────────────────────────────────────────────────

const params = new URLSearchParams({
  country: 'Germany', hidebroken: 'true', order: 'clickcount', reverse: 'true', limit: '500',
});
const res = await fetch(`${RB}/json/stations/search?${params}`, {
  headers: { 'User-Agent': 'rrradio-import-ard/1.0' },
});
if (!res.ok) {
  console.error(`import-ard: RB fetch failed ${res.status}`);
  process.exit(1);
}
const all = await res.json();

const ardOnly = [];
for (const s of all) {
  const url = s.url_resolved || s.url || '';
  if (!/^https:\/\//i.test(url)) continue;
  const broadcaster = broadcasterFromHosts(s.homepage || '', url);
  if (!broadcaster) continue;
  ardOnly.push({ rb: s, broadcaster });
}

// For each canonical channel, pick the best-scoring RB entry that
// matches one of its name patterns and belongs to the right broadcaster.
function score(rb) {
  return (rb.lastcheckok ? 100000 : 0) + (rb.clickcount ?? 0);
}
function nameMatches(rbName, canonical) {
  const lc = rbName.toLowerCase();
  if (canonical.avoid && canonical.avoid.some((a) => lc.includes(a))) return false;
  return canonical.match.some((pat) => lc.includes(pat));
}

const matched = [];
const unmatched = [];
for (const c of CANONICAL) {
  const matches = ardOnly.filter((a) => a.broadcaster === c.broadcaster && nameMatches(a.rb.name, c));
  if (matches.length === 0) {
    unmatched.push(c);
    continue;
  }
  matches.sort((a, b) => score(b.rb) - score(a.rb));
  matched.push({ canonical: c, rb: matches[0].rb });
}

// Skip already-curated by name
const stationsPath = join(root, 'data/stations.yaml');
const stationsText = readFileSync(stationsPath, 'utf8');
const existing = parseYaml(stationsText);
const knownNames = new Set(
  (Array.isArray(existing) ? existing : []).map((s) => (s?.name ?? '').toLowerCase()).filter(Boolean),
);
const knownIds = new Set(
  (Array.isArray(existing) ? existing : []).map((s) => s?.id).filter(Boolean),
);

const fresh = matched.filter((m) => !knownNames.has(m.canonical.name.toLowerCase()));
const dupes = matched.filter((m) => knownNames.has(m.canonical.name.toLowerCase()));

console.log('ARD canonical import report');
console.log(`  canonical channels  : ${CANONICAL.length}`);
console.log(`  matched in RB        : ${matched.length}`);
console.log(`  already in YAML      : ${dupes.length}`);
console.log(`  to import            : ${fresh.length}`);
console.log(`  not found in RB     : ${unmatched.length}`);
if (unmatched.length > 0) {
  console.log('  not found:');
  for (const u of unmatched) console.log(`    · ${u.broadcaster} / ${u.name}`);
}
console.log('');

if (fresh.length === 0) {
  console.log('Nothing to import.');
  process.exit(0);
}

const lines = [
  '',
  `# ─── ARD bulk import (${new Date().toISOString().slice(0, 10)}) ───`,
  '# tools/import-ard.mjs : canonical channels matched against Radio Browser.',
  '# Each starts at status:stream-only — promote to icy-only/working as the',
  "# broadcaster's metadata API is wired in src/builtins.ts.",
  '',
];

const acceptedIds = new Set(knownIds);
const accepted = [];
for (const m of fresh) {
  let id = `${m.canonical.broadcaster}-${slugify(m.canonical.name)}`;
  let n = 2;
  while (acceptedIds.has(id)) id = `${m.canonical.broadcaster}-${slugify(m.canonical.name)}-${n++}`;
  acceptedIds.add(id);

  const url = m.rb.url_resolved || m.rb.url;
  const tags = normaliseTags(m.rb.tags);
  const block = [];
  block.push(`- id: ${id}`);
  block.push(`  broadcaster: ${m.canonical.broadcaster}`);
  block.push(`  name: ${quote(m.canonical.name)}`);
  block.push(`  streamUrl: ${url}`);
  if (m.rb.bitrate && m.rb.bitrate > 0) block.push(`  bitrate: ${m.rb.bitrate}`);
  if (m.rb.codec) block.push(`  codec: ${m.rb.codec.toUpperCase()}`);
  if (tags.length > 0) block.push(`  tags: [${tags.join(', ')}]`);
  if (m.rb.favicon) block.push(`  favicon: ${m.rb.favicon}`);
  if (m.rb.homepage) block.push(`  homepage: ${m.rb.homepage}`);
  block.push(`  status: stream-only`);
  lines.push(block.join('\n'));
  lines.push('');
  accepted.push({ id, name: m.canonical.name, broadcaster: m.canonical.broadcaster });
}

const trailing = stationsText.endsWith('\n') ? '' : '\n';
writeFileSync(stationsPath, stationsText + trailing + lines.join('\n'));

console.log('Appended:');
const byBc = {};
for (const a of accepted) (byBc[a.broadcaster] ??= []).push(a);
for (const bc of Object.keys(byBc).sort()) {
  console.log(`  ${bc} (${byBc[bc].length})`);
  for (const a of byBc[bc]) console.log(`    + ${a.id}  ${a.name}`);
}
