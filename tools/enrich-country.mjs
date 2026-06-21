#!/usr/bin/env node
/**
 * enrich-country.mjs — per-country catalog enrichment dossier.
 *
 * Radio Browser (our existing sweep) is only one source of truth, and the
 * weakest: it carries dead streams, no logos/provenance, no now-playing
 * APIs, and lots of internet-only filler. This tool pulls the *additional*
 * sources that generalise across countries and diffs them against our
 * catalog to produce an actionable dossier:
 *
 *   1. National Radioplayer directory  — official HTTPS streams + 600px
 *      square logos + genres, CORS-open JSON. Swap `rpCountry` per country.
 *      (play.radioplayer.org/api/live-stations?countryCode=<ISO-3166-numeric>)
 *   2. Wikidata SPARQL                  — identity layer: official website,
 *      Commons logo, language, owner. Swap `wikidataQid` per country.
 *   3. Regulator open-data              — authoritative on-air roster + geo.
 *      CH: BAKOM transmitter GeoJSON (geo.admin.ch). The `program` field is
 *      the broadcasting-station name → a strong liveness signal.
 *
 * Output: .cache/<cc>-enrich/dossier-<CC>.json + a console summary.
 *   - upgrades[]  : existing rows we can improve (streamUrl / logo / metadata)
 *   - imports[]   : Radioplayer stations absent from our catalog
 *   - retire[]    : our rows absent from Radioplayer AND the regulator roster
 *   - dupes[]     : same-station rows already in our catalog
 *   - wikidata[]  : website/logo backfill candidates
 *
 * This is the Tier-0 (deterministic, no-LLM) harvest. A per-country agent
 * reviews the dossier and a human approves the PR. Read-only: writes only
 * to .cache/. Source fetches are cached so reruns are offline-safe.
 *
 *   node tools/enrich-country.mjs CH [--refresh]
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// Per-country wiring. Adding a country = one entry here (plus a regulator
// loader if its open-data shape differs). rpCountry is ISO-3166 numeric.
const COUNTRIES = {
  CH: {
    qid: 'Q39',
    rpCountry: '756',
    regulator: {
      label: 'BAKOM transmitter GeoJSON',
      url: 'https://data.geo.admin.ch/ch.bakom.radio-fernsehsender/radio-fernsehsender/radio-fernsehsender_2056_de.json',
      // program names that are known multiplex/operator codes, not stations
      noise: /^(SRG|SMC|DIG|ROM|DAB)\b|\bD0\d|\bF0\d|\bI0\d|\bR0\d/i,
    },
    // Stream-platform fingerprints → broadcaster/fetcher family.
    platforms: [
      { re: /stream\.streambase\.ch\//i, family: 'CH Media', fetcher: 'ch-media' },
      { re: /\.ice\.infomaniak\.ch\//i, family: 'Infomaniak (Romandie)', fetcher: null },
      { re: /bnj\.blob\.core\.windows\.net/i, family: 'BNJ', fetcher: 'bnj' },
    ],
  },
};

const CC = (process.argv[2] || 'CH').toUpperCase();
const REFRESH = process.argv.includes('--refresh');
const conf = COUNTRIES[CC];
if (!conf) {
  console.error(`enrich-country: no config for ${CC}. Known: ${Object.keys(COUNTRIES).join(', ')}`);
  process.exit(1);
}

const cacheDir = join(root, '.cache', `${CC.toLowerCase()}-enrich`);
mkdirSync(cacheDir, { recursive: true });

async function cachedJson(name, url, init) {
  const path = join(cacheDir, name);
  if (!REFRESH && existsSync(path)) return JSON.parse(readFileSync(path, 'utf8'));
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status} from ${url}`);
  const text = await res.text();
  writeFileSync(path, text);
  return JSON.parse(text);
}

// ---- normalisation + matching helpers ----
const norm = (s) =>
  (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
// stricter key for equality: drop generic words + all spaces
const key = (s) =>
  norm(s)
    .replace(/\b(radio|fm|the|switzerland|schweiz|suisse|svizzera|swiss)\b/g, '')
    .replace(/\s+/g, '');
const host = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
};

// ---- load our catalog (CH rows) ----
const stations = parseYaml(readFileSync(join(root, 'data/stations.yaml'), 'utf8'));
const ours = stations.filter((s) => (s.country || '').toUpperCase() === CC);
const oursByKey = new Map();
const oursByHost = new Map();
for (const s of ours) {
  const k = key(s.name);
  if (!oursByKey.has(k)) oursByKey.set(k, []);
  oursByKey.get(k).push(s);
  const h = host(s.homepage);
  if (h && !oursByHost.has(h)) oursByHost.set(h, s);
}

function matchOurs(name, homepage) {
  const h = host(homepage);
  if (h && oursByHost.has(h)) return oursByHost.get(h);
  const hits = oursByKey.get(key(name));
  if (hits && hits.length === 1) return hits[0];
  return null;
}

// ---- Radioplayer ----
const rp = await cachedJson(`radioplayer-${CC.toLowerCase()}.json`, `https://play.radioplayer.org/api/live-stations?countryCode=${conf.rpCountry}`);

function rpHomepage(s) {
  const links = s.links || [];
  const view = links.find((l) => l.type === 'rp-handheld-station-view');
  return (view || links.find((l) => /web-player/.test(l.type)) || links[0] || {}).url || '';
}
function rpBestStream(s) {
  // Prefer https; upgrade http→https (streambase/infomaniak both serve TLS);
  // strip the rp_source attribution param. Prefer higher bitrate.
  const audio = (s.liveStreams || []).flatMap((ls) => ls.audioStreams || []);
  const cands = audio
    .map((a) => ({ url: (a.streamSource?.url || '').replace(/[?&]rp_source=\d+/i, ''), br: a.bitRate?.target || 0 }))
    .filter((c) => c.url)
    .map((c) => ({ ...c, url: c.url.replace(/^http:\/\//i, 'https://') }))
    .sort((a, b) => b.br - a.br);
  return cands[0]?.url || '';
}
function rpLogo(s) {
  const logos = (s.multimedia || []).filter((m) => /logo/.test(m.type) && /image\/(png|jpeg)/.test(m.mimeValue || ''));
  const square = logos.filter((m) => m.width === m.height).sort((a, b) => b.width - a.width);
  return (square[0] || logos.sort((a, b) => b.width - a.width)[0] || {}).url || '';
}
function platformOf(url) {
  for (const p of conf.platforms) if (p.re.test(url)) return p;
  return null;
}

// ---- Wikidata ----
let wd = { results: { bindings: [] } };
try {
  const q = `SELECT ?s ?sLabel ?web ?logo ?langLabel ?ownerLabel WHERE { ?s wdt:P31/wdt:P279* wd:Q14350 ; wdt:P17 wd:${conf.qid} . OPTIONAL{?s wdt:P856 ?web} OPTIONAL{?s wdt:P154 ?logo} OPTIONAL{?s wdt:P407 ?lang} OPTIONAL{?s wdt:P127 ?owner} SERVICE wikibase:label { bd:serviceParam wikibase:language "en,de,fr,it" } }`;
  wd = await cachedJson(`wikidata-${CC.toLowerCase()}.json`, `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`, {
    headers: { Accept: 'application/sparql-results+json', 'User-Agent': 'rrradio-curation/1.0 (https://rrradio.org)' },
  });
} catch (e) {
  console.warn('wikidata fetch skipped:', e.message);
}
const wdByHost = new Map();
const wdByKey = new Map();
for (const b of wd.results.bindings) {
  const rec = {
    name: b.sLabel?.value,
    web: b.web?.value,
    logo: b.logo?.value ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(b.logo.value.split('/').pop())}` : null,
    lang: b.langLabel?.value,
    owner: b.ownerLabel?.value,
  };
  const h = host(rec.web);
  if (h && !wdByHost.has(h)) wdByHost.set(h, rec);
  if (rec.name && !wdByKey.has(key(rec.name))) wdByKey.set(key(rec.name), rec);
}
const wdFor = (s) => wdByHost.get(host(s.homepage)) || wdByKey.get(key(s.name)) || null;

// ---- Regulator (liveness roster) ----
const live = new Set();
try {
  const geo = await cachedJson(`regulator-${CC.toLowerCase()}.json`, conf.regulator.url);
  for (const f of geo.features || []) {
    const prog = f.properties?.program || '';
    for (const part of prog.split(',')) {
      const name = part.replace(/\s*-\s*BNJ$/i, '').trim();
      if (name && !conf.regulator.noise.test(name)) live.add(key(name));
    }
  }
} catch (e) {
  console.warn('regulator fetch skipped:', e.message);
}

// ---- build dossier ----
const matchedIds = new Set();
const upgrades = [];
const imports = [];
for (const s of rp) {
  const home = rpHomepage(s);
  const stream = rpBestStream(s);
  const logo = rpLogo(s);
  const ours0 = matchOurs(s.name, home);
  const plat = platformOf(stream);
  if (ours0) {
    matchedIds.add(ours0.id);
    const change = { id: ours0.id, name: ours0.name, rpName: s.name, platform: plat?.family || null, fetcher: plat?.fetcher || null };
    if (stream && stream !== ours0.streamUrl && /^https:/.test(stream)) change.streamUrl = { from: ours0.streamUrl, to: stream };
    if (logo && logo !== ours0.favicon) change.logo = { from: ours0.favicon, to: logo };
    if (change.streamUrl || change.logo || change.fetcher) upgrades.push(change);
  } else {
    imports.push({ rpName: s.name, group: s.groupName, homepage: home, streamUrl: stream, logo, genres: (s.genres || []).map((g) => g.name), platform: plat?.family || null });
  }
}

// dupes within our own catalog (same key)
const dupes = [];
for (const [k, arr] of oursByKey) if (arr.length > 1) dupes.push({ key: k, ids: arr.map((s) => s.id), names: arr.map((s) => s.name) });

// retire candidates: not in Radioplayer AND not in regulator roster
const retire = ours
  .filter((s) => !matchedIds.has(s.id) && !live.has(key(s.name)))
  .map((s) => ({ id: s.id, name: s.name, status: s.status, homepage: s.homepage }));

// wikidata backfill: our rows missing homepage or favicon that WD has
const wikidata = [];
for (const s of ours) {
  const rec = wdFor(s);
  if (!rec) continue;
  const add = {};
  if (!s.homepage && rec.web) add.homepage = rec.web;
  if (!s.favicon && rec.logo) add.logo = rec.logo;
  if (rec.lang || rec.owner) add.meta = { lang: rec.lang, owner: rec.owner };
  if (Object.keys(add).length) wikidata.push({ id: s.id, name: s.name, ...add });
}

const dossier = {
  country: CC,
  generatedAt: '(stamp after run)',
  sources: { radioplayer: rp.length, wikidata: wd.results.bindings.length, regulatorRoster: live.size, ourRows: ours.length },
  counts: { upgrades: upgrades.length, imports: imports.length, retire: retire.length, dupes: dupes.length, wikidataBackfill: wikidata.length },
  upgrades,
  imports,
  retire,
  dupes,
  wikidata,
};
const outPath = join(cacheDir, `dossier-${CC}.json`);
writeFileSync(outPath, JSON.stringify(dossier, null, 2));

// ---- console summary ----
console.log(`\n=== ${CC} enrichment dossier ===`);
console.log('sources:', dossier.sources);
console.log('counts :', dossier.counts);
const onPlatform = upgrades.filter((u) => u.fetcher);
console.log(`\nNow-playing fetcher candidates (matched + on a known platform): ${onPlatform.length}`);
for (const u of onPlatform) console.log(`  [${u.fetcher}] ${u.id}  (${u.name})`);
console.log(`\nStream/logo upgrades: ${upgrades.length} rows`);
console.log(`Imports (in Radioplayer, not in catalog): ${imports.length}`);
console.log(`Retire candidates (absent from Radioplayer + regulator): ${retire.length}`);
for (const r of retire.slice(0, 25)) console.log(`  ${r.id}  (${r.name})`);
console.log(`\nDupes in our catalog: ${dupes.length}`);
for (const d of dupes) console.log(`  ${d.ids.join('  ==  ')}`);
console.log(`\nWritten: ${outPath}`);
