#!/usr/bin/env node
/**
 * Phase 2 logo finder, layered on top of `scrape-logos.mjs`.
 *
 *   Phase A (audit)   HEAD every existing `favicon` URL in stations.yaml.
 *                     Flag the ones that 4xx/5xx/timeout — those are
 *                     dead links masquerading as "has logo" (e.g. a
 *                     Wikimedia file got renamed; see SRF 3's broken
 *                     `Radio_SRF_3_logo.svg` which the curator wrote on
 *                     2026-05-02 and Commons has since deleted).
 *
 *   Phase B (fill)    For every station that either has no favicon or
 *                     was just flagged dead, ask Wikipedia REST for its
 *                     summary image. The infobox lead image is usually
 *                     the canonical logo, structured and CC-licensed.
 *                     Tries `en` first, then the country's native lang
 *                     (CH/AT/DE → de, IT → it, FR → fr, …). HEAD-checks
 *                     the result is `image/*` before writing.
 *
 * Pure deterministic — no LLM tokens. Mirrors the surgical-insert
 * pattern in `wire-metadata.mjs` / `scrape-logos.mjs` so the existing
 * hand-formatted YAML structure stays intact.
 *
 * Usage:
 *   node tools/wiki-logos.mjs                          # full sweep
 *   node tools/wiki-logos.mjs --limit 50               # validation run
 *   node tools/wiki-logos.mjs --limit 50 --dry-run     # don't mutate yaml
 *   node tools/wiki-logos.mjs --concurrency 12         # default 8
 *   node tools/wiki-logos.mjs --skip-audit             # skip Phase A
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// ─── args ──────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const argFlag = (n) => argv.includes(n);
const argVal = (n, fb) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fb;
};
const LIMIT = Number(argVal('--limit', Infinity));
const CONCURRENCY = Math.max(1, Math.min(20, Number(argVal('--concurrency', 8))));
const DRY_RUN = argFlag('--dry-run');
const SKIP_AUDIT = argFlag('--skip-audit');
const FETCH_TIMEOUT_MS = 8_000;
const UA =
  'rrradio-logo-bot/1.0 (https://github.com/MarkusSteinbrecher/rrradio; redsukramst@gmail.com)';

// ─── load yaml ─────────────────────────────────────────────────────
const stationsPath = join(root, 'data/stations.yaml');
let text = readFileSync(stationsPath, 'utf8');
const list = parseYaml(text);
if (!Array.isArray(list)) {
  console.error('wiki-logos: stations.yaml is not a list');
  process.exit(1);
}

// ─── network helpers ───────────────────────────────────────────────
async function fetchWithTimeout(url, opts = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...opts,
      signal: ctl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: '*/*', ...(opts.headers ?? {}) },
    });
  } finally {
    clearTimeout(t);
  }
}

async function isImageAlive(url) {
  // HEAD first; CDNs that 405 HEAD get a ranged GET fallback.
  try {
    const head = await fetchWithTimeout(url, { method: 'HEAD' });
    if (head.ok && (head.headers.get('content-type') ?? '').startsWith('image/')) return true;
    if (head.status === 405) {
      const get = await fetchWithTimeout(url, { headers: { Range: 'bytes=0-15' } });
      return get.ok && (get.headers.get('content-type') ?? '').startsWith('image/');
    }
    return false;
  } catch {
    return false;
  }
}

async function runPool(items, worker, concurrency) {
  let i = 0;
  const lanes = Array.from({ length: concurrency }, async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx], idx);
    }
  });
  await Promise.all(lanes);
}

// ─── phase A: audit existing favicon URLs ─────────────────────────
const dead = new Set(); // station ids whose current favicon doesn't load

if (!SKIP_AUDIT) {
  const withFav = list.filter(
    (s) => s && typeof s.id === 'string' && typeof s.favicon === 'string' && /^https?:\/\//.test(s.favicon),
  );
  console.log(`wiki-logos: Phase A — auditing ${withFav.length} existing favicon URL(s)`);
  const t0 = Date.now();
  let checked = 0;
  await runPool(
    withFav,
    async (s) => {
      const ok = await isImageAlive(s.favicon);
      if (!ok) dead.add(s.id);
      checked++;
      if (checked % 500 === 0) {
        process.stdout.write(`  audited ${checked}/${withFav.length}, dead: ${dead.size}\n`);
      }
    },
    CONCURRENCY,
  );
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`Phase A done in ${elapsed}s — ${dead.size} dead favicon URL(s) of ${withFav.length}`);
  // Snapshot the dead list so re-runs of Phase B can skip the 8-min audit.
  writeFileSync(join(root, '.cache/dead-favicons.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), dead: [...dead] }, null, 2));
  console.log('  cached → .cache/dead-favicons.json');
} else {
  console.log('wiki-logos: Phase A — skipped (--skip-audit)');
  // Reuse previous Phase A output if cached, so --skip-audit doesn't
  // also lose the dead-URL replacement signal.
  try {
    const cache = JSON.parse(readFileSync(join(root, '.cache/dead-favicons.json'), 'utf8'));
    for (const id of cache.dead) dead.add(id);
    console.log(`  loaded ${dead.size} dead favicon id(s) from .cache/dead-favicons.json`);
  } catch { /* no cache, fine */ }
}

// ─── phase B: fill gaps via Wikipedia REST ─────────────────────────
// Country → likely Wikipedia language to try after en. The native
// Wikipedia is much more likely to have a local broadcaster's article
// than en is.
const COUNTRY_LANG = {
  AT: 'de', CH: 'de', DE: 'de', LI: 'de',
  IT: 'it', FR: 'fr', BE: 'fr', LU: 'fr', MC: 'fr',
  ES: 'es', AR: 'es', CL: 'es', CO: 'es', MX: 'es', PE: 'es', UY: 'es', VE: 'es', EC: 'es',
  PT: 'pt', BR: 'pt',
  NL: 'nl',
  PL: 'pl', CZ: 'cs', SK: 'sk', HU: 'hu', RO: 'ro', BG: 'bg', HR: 'hr', RS: 'sr', UA: 'uk',
  RU: 'ru', SE: 'sv', NO: 'no', FI: 'fi', DK: 'da',
  JP: 'ja', CN: 'zh', TW: 'zh', GR: 'el', TR: 'tr', IL: 'he',
  ID: 'id', PH: 'tl', IN: 'hi', AE: 'ar',
};

function articleSlug(name) {
  // Wikipedia article titles use underscores, no special encoding needed
  // for ASCII names. encodeURIComponent handles the rest (umlauts etc.).
  return encodeURIComponent(name.replace(/\s+/g, '_'));
}

// Track Wikipedia API responses we couldn't use, so misses don't all
// look the same. If we're getting 429s the operator can lower
// concurrency; if we're getting 404s the title just doesn't exist.
const apiOutcomes = { ok: 0, notFound: 0, rateLimited: 0, other: 0, network: 0 };

async function fetchJsonWithRetry(url) {
  // Wikipedia rate-limits the REST endpoints aggressively. On 429 we
  // back off using the Retry-After header (or 1s default) and try
  // once more — most 429s clear within a second of pause. Fail-soft
  // returns null for everything beyond that so the caller can move on.
  for (let attempt = 0; attempt < 2; attempt++) {
    let res;
    try {
      res = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } });
    } catch {
      apiOutcomes.network++;
      return null;
    }
    if (res.ok) {
      apiOutcomes.ok++;
      try {
        return await res.json();
      } catch {
        return null;
      }
    }
    if (res.status === 429 && attempt === 0) {
      const retryAfter = Number(res.headers.get('retry-after')) || 1;
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      continue;
    }
    if (res.status === 404) apiOutcomes.notFound++;
    else if (res.status === 429) apiOutcomes.rateLimited++;
    else apiOutcomes.other++;
    return null;
  }
  return null;
}

const fetchJson = fetchJsonWithRetry;

async function summaryFor(lang, title) {
  return fetchJson(
    `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${articleSlug(title)}`,
  );
}

// Description must mention radio / broadcasting / station in the
// target language. Without this, the search top hit is often a
// same-named entity (a federal agency, a TV channel, a song, …).
const RADIO_HINT_RE =
  /\b(radio|broadcast|broadcasting|station|sender|funk|emisora|emittente|emissora|emisión|rundfunk|rádio)\b/i;

function looksLikeRadio(summary) {
  const fields = [summary.description, summary.extract].filter(Boolean).join(' ');
  return RADIO_HINT_RE.test(fields);
}

function normalizeTitle(s) {
  return decodeURIComponent(s)
    .toLowerCase()
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Strict title↔name match: one must contain the other after
 *  normalization. Avoids "Heart" matching "Heart (organ)" by accident. */
function titleMatchesStation(title, stationName) {
  const t = normalizeTitle(title);
  const n = normalizeTitle(stationName);
  if (!t || !n) return false;
  // Strip parenthetical disambiguators from the title — "RTN (Switzerland)"
  // → "rtn", which then exactly matches "RTN".
  const tNoParen = t.replace(/\s*\([^)]*\)\s*/g, '').trim();
  return tNoParen === n || tNoParen.includes(n) || n.includes(tNoParen);
}

/** The image URL filename should look like a logo. Wikipedia's
 *  consistent convention for broadcaster logos is to include "logo"
 *  in the filename ("LBC_News_station_logo.png", "Radio_SRF_3_logo_2020.svg",
 *  …). Many false positives are concert photos, building shots,
 *  unrelated diagrams — they don't carry "logo" in the filename. */
function urlLooksLikeLogo(url) {
  const filename = decodeURIComponent(url.split('/').pop() || '').toLowerCase();
  return /(^|[\s_\-])logo(\.|[\s_\-])/i.test(filename);
}

async function searchTopTitles(lang, query, limit = 3) {
  const url =
    `https://${lang}.wikipedia.org/w/api.php` +
    `?action=query&list=search&format=json` +
    `&srlimit=${limit}` +
    `&srsearch=${encodeURIComponent(query)}`;
  const data = await fetchJson(url);
  return (data?.query?.search ?? []).map((h) => h.title);
}

async function findWikipediaLogo(station) {
  const langs = ['en'];
  const cl = COUNTRY_LANG[station.country];
  if (cl && cl !== 'en') langs.push(cl);

  for (const lang of langs) {
    // Disambiguate the search by appending "radio". Without this, "RTN"
    // pulls a Russian federal agency; "Heart" pulls the cardiac organ.
    const queries = [`${station.name} radio`, station.name];
    const seen = new Set();
    for (const q of queries) {
      const titles = await searchTopTitles(lang, q, 3);
      for (const title of titles) {
        if (seen.has(title)) continue;
        seen.add(title);
        // Cheap filter first: does the article title look like our station?
        if (!titleMatchesStation(title, station.name)) continue;
        const summary = await summaryFor(lang, title);
        if (!summary) continue;
        if (summary.type === 'disambiguation') continue;
        if (!looksLikeRadio(summary)) continue;
        const img = summary.thumbnail?.source || summary.originalimage?.source;
        if (!img) continue;
        // Strict: the image URL filename has to look like a logo.
        // This is the gate that kills the "Crystal radio" / "Zurich
        // skyline" / "RHCP concert photo" matches.
        if (!urlLooksLikeLogo(img)) continue;
        if (await isImageAlive(img)) return { url: img, lang, title };
      }
    }
  }
  return null;
}

const candidates = list
  .filter(
    (s) =>
      s &&
      typeof s.id === 'string' &&
      typeof s.name === 'string' &&
      s.name.length > 0 &&
      (!s.favicon || dead.has(s.id)),
  )
  .slice(0, Number.isFinite(LIMIT) ? LIMIT : list.length);

console.log(
  `\nwiki-logos: Phase B — ${candidates.length} candidate(s) (no favicon or dead favicon)` +
    (DRY_RUN ? ' — DRY RUN' : '') +
    ` — concurrency ${CONCURRENCY}`,
);

const counters = { ok: 0, miss: 0, fail: 0 };
const writes = []; // { id, url, action: 'insert' | 'replace' }

const t0 = Date.now();
await runPool(
  candidates,
  async (s, idx) => {
    const tag = `[${String(idx + 1).padStart(4)}/${candidates.length}] ${s.id}`;
    try {
      const r = await findWikipediaLogo(s);
      if (r) {
        counters.ok++;
        writes.push({
          id: s.id,
          url: r.url,
          action: dead.has(s.id) ? 'replace' : 'insert',
        });
        const tag2 = dead.has(s.id) ? 'REPL' : 'OK  ';
        console.log(`${tag}  ${tag2} ${r.lang}.wiki  ${r.url}`);
      } else {
        counters.miss++;
        // Quiet the misses — too many to log every one
      }
    } catch (err) {
      counters.fail++;
      console.log(`${tag}  !!  ${err?.message || err}`);
    }
  },
  CONCURRENCY,
);
const wallS = ((Date.now() - t0) / 1000).toFixed(1);

console.log('');
console.log(
  `wiki-logos done in ${wallS}s — OK: ${counters.ok}, miss: ${counters.miss}, fail: ${counters.fail}`,
);
const hitRate = candidates.length > 0 ? ((counters.ok / candidates.length) * 100).toFixed(1) : '0';
console.log(`hit rate: ${hitRate}% (${counters.ok}/${candidates.length})`);
console.log(
  `api outcomes — ok=${apiOutcomes.ok} notFound=${apiOutcomes.notFound} ` +
    `rateLimited=${apiOutcomes.rateLimited} other=${apiOutcomes.other} network=${apiOutcomes.network}`,
);
if (apiOutcomes.rateLimited > 0) {
  console.log('  → 429s present; lower --concurrency or add a sleep between calls.');
}

// ─── write back to YAML ────────────────────────────────────────────
if (DRY_RUN) {
  console.log('\n--dry-run: not writing data/stations.yaml');
  process.exit(0);
}
if (writes.length === 0) {
  console.log('\nnothing to write');
  process.exit(0);
}

let inserted = 0;
let replaced = 0;
let missLine = 0;

for (const w of writes) {
  const idLine = `- id: ${w.id}\n`;
  const idIdx = text.indexOf(idLine);
  if (idIdx === -1) {
    missLine++;
    console.warn(`  ! couldn't locate id line for ${w.id}`);
    continue;
  }
  const quoted = /[:#&*!|>'"%@`,\[\]{}]/.test(w.url) ? JSON.stringify(w.url) : w.url;

  if (w.action === 'replace') {
    // Find the existing favicon line for this row. Search forward from
    // the id line until we hit either `  favicon:` or the next `- id:`.
    let p = idIdx + idLine.length;
    while (p < text.length) {
      const lineEnd = text.indexOf('\n', p);
      const line = text.slice(p, lineEnd === -1 ? text.length : lineEnd);
      if (line.startsWith('- id:')) break;
      if (line.startsWith('  favicon:')) {
        const next = lineEnd === -1 ? text.length : lineEnd + 1;
        text = text.slice(0, p) + `  favicon: ${quoted}\n` + text.slice(next);
        replaced++;
        break;
      }
      if (lineEnd === -1) break;
      p = lineEnd + 1;
    }
  } else {
    // Plain insert directly after the id line, same as scrape-logos.
    const insertAt = idIdx + idLine.length;
    text = text.slice(0, insertAt) + `  favicon: ${quoted}\n` + text.slice(insertAt);
    inserted++;
  }
}

writeFileSync(stationsPath, text);
console.log(
  `\nstations.yaml updated: ${inserted} inserted, ${replaced} replaced` +
    (missLine > 0 ? `, ${missLine} id line(s) missing` : ''),
);
