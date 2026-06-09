#!/usr/bin/env node
/**
 * Migrate stations off the non-free `upload.wikimedia.org/wikipedia/en/`
 * namespace onto a free Wikimedia **Commons** equivalent (#472).
 *
 * The 220 stations whose favicon sits on `/wikipedia/en/` carry fair-use /
 * non-free artwork: deletion-prone, not redistributable, and mislabeled
 * `faviconSource: wiki` (which implies a free Commons licence). The English
 * Wikipedia article's infobox image *is* that non-free upload — but the
 * station's **native-language** Wikipedia article usually points at a free
 * Commons file with the same artwork (confirmed on the SRF/DR families).
 *
 * For each non-free station this resolves a Commons replacement (native-lang
 * article summary first, then a Commons File: search), HARD-REJECTS any
 * candidate still on `/wikipedia/en/`, fetches the Commons licence, and emits
 * an `apply-logos` patch. It is network-only and NEVER mutates stations.yaml —
 * review the patch, then `npm run apply-logos -- --in <patch> --replace`.
 *
 * Usage:
 *   node tools/migrate-nonfree-logos.mjs                  # all non-free, dry patch
 *   node tools/migrate-nonfree-logos.mjs --cc DK          # one country
 *   node tools/migrate-nonfree-logos.mjs --only id1,id2   # explicit ids
 *   node tools/migrate-nonfree-logos.mjs --limit 30       # validation slice
 *   node tools/migrate-nonfree-logos.mjs --concurrency 6  # default 6
 *   node tools/migrate-nonfree-logos.mjs --out <path>     # default internal/logos/nonfree-migration.json
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isNonFreeWikiLogo } from './logo-quality.mjs';
import {
  langsForCountry,
  looksLikeRadio,
  titleMatchesStation,
  urlLooksLikeLogo,
  isCommons,
  articleSlug,
  scoreFileHit,
  FILE_HIT_MIN_SCORE,
  commonsFileName,
  normalizeLicense,
} from './lib/nonfree-migration.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// ─── args ──────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const argFlag = (n) => argv.includes(n);
const argVal = (n, fb) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fb;
};
const COUNTRY_FILTER = (argVal('--cc', '') || '').toUpperCase() || null;
const ONLY_IDS = new Set((argVal('--only', '') || '').split(',').map((s) => s.trim()).filter(Boolean));
const LIMIT = Number(argVal('--limit', Infinity));
const CONCURRENCY = Math.max(1, Math.min(12, Number(argVal('--concurrency', 6))));
const OUT_ARG = argVal('--out', 'internal/logos/nonfree-migration.json');
const OUT_PATH = isAbsolute(OUT_ARG) ? OUT_ARG : join(root, OUT_ARG);

const FETCH_TIMEOUT_MS = 12000;
const UA =
  'rrradio-logo-bot/1.0 (https://github.com/MarkusSteinbrecher/rrradio; redsukramst@gmail.com)';

// ─── network helpers (mirrors wiki-logos.mjs) ──────────────────────
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

async function fetchJson(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let res;
    try {
      res = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } });
    } catch {
      return null;
    }
    if (res.ok) {
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
    return null;
  }
  return null;
}

async function isImageAlive(url) {
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

// Matching predicates + scoring live in ./lib/nonfree-migration.mjs (pure,
// unit-tested). This module keeps only the network calls + the resolve loop.
async function searchTopTitles(lang, query, limit = 3) {
  const data = await fetchJson(
    `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&format=json` +
      `&srlimit=${limit}&srsearch=${encodeURIComponent(query)}`,
  );
  return (data?.query?.search ?? []).map((h) => h.title);
}

async function summaryFor(lang, title) {
  return fetchJson(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${articleSlug(title)}`);
}

// ─── Commons File: namespace fallback ──────────────────────────────
async function searchFileNamespace(domain, query, limit = 5) {
  const data = await fetchJson(
    `https://${domain}/w/api.php?action=query&list=search&format=json` +
      `&srnamespace=6&srlimit=${limit}&srsearch=${encodeURIComponent(query)}`,
  );
  return (data?.query?.search ?? []).map((h) => h.title);
}

// Resolve a Commons File: title to a rendered ~512px thumb URL + its source page.
async function fileThumb(domain, title) {
  const data = await fetchJson(
    `https://${domain}/w/api.php?action=query&format=json&prop=imageinfo` +
      `&iiprop=url%7Cmime%7Csize&iiurlwidth=512&titles=${encodeURIComponent(title)}`,
  );
  const page = Object.values(data?.query?.pages ?? {})[0];
  const info = page?.imageinfo?.[0];
  if (!info) return null;
  const url = info.thumburl || info.url;
  if (!url || !/^image\//.test(info.mime || '')) return null;
  return { url, descriptionUrl: info.descriptionurl || null };
}

// ─── Commons licence ───────────────────────────────────────────────
async function commonsLicense(fileName) {
  const data = await fetchJson(
    `https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo` +
      `&iiprop=extmetadata&iiextmetadatafilter=License%7CLicenseShortName` +
      `&titles=${encodeURIComponent('File:' + fileName)}`,
  );
  const page = Object.values(data?.query?.pages ?? {})[0];
  const extmeta = page?.imageinfo?.[0]?.extmetadata;
  return { license: normalizeLicense(extmeta), raw: extmeta?.LicenseShortName?.value || null };
}

// ─── resolution ────────────────────────────────────────────────────
async function resolveFreeLogo(station) {
  const langs = langsForCountry(station.country);
  const native = langs[0] !== 'en' ? langs[0] : null;

  // Path 1 — native-lang (then en) article summary infobox image.
  for (const lang of langs) {
    for (const q of [`${station.name} radio`, station.name]) {
      const titles = await searchTopTitles(lang, q, 3);
      for (const title of titles) {
        if (!titleMatchesStation(title, station.name)) continue;
        const summary = await summaryFor(lang, title);
        if (!summary || summary.type === 'disambiguation' || !looksLikeRadio(summary)) continue;
        const img = summary.thumbnail?.source || summary.originalimage?.source;
        if (!img || !urlLooksLikeLogo(img)) continue;
        if (isNonFreeWikiLogo(img) || !isCommons(img)) continue; // must be free Commons
        if (!(await isImageAlive(img))) continue;
        return { url: img, lang, title, via: 'article' };
      }
    }
  }

  // Path 2 — Commons (+ native-lang) File: namespace search.
  const domains = ['commons.wikimedia.org'];
  if (native && native !== 'en') domains.push(`${native}.wikipedia.org`);
  for (const domain of domains) {
    let best = null;
    for (const q of [`${station.name} logo`, `${station.name} radio`]) {
      for (const title of await searchFileNamespace(domain, q, 5)) {
        const score = scoreFileHit(title, station.name);
        if (score >= FILE_HIT_MIN_SCORE && (!best || score > best.score)) best = { title, score };
      }
    }
    if (!best) continue;
    const thumb = await fileThumb(domain, best.title);
    if (!thumb || isNonFreeWikiLogo(thumb.url) || !isCommons(thumb.url)) continue;
    if (!(await isImageAlive(thumb.url))) continue;
    return { url: thumb.url, lang: domain.split('.')[0], title: best.title, via: 'file', descriptionUrl: thumb.descriptionUrl };
  }

  return null;
}

// ─── main ──────────────────────────────────────────────────────────
const stations = (() => {
  const raw = JSON.parse(readFileSync(join(root, 'public/stations.json'), 'utf8'));
  return Array.isArray(raw) ? raw : raw.stations;
})();

const targets = stations.filter(
  (s) =>
    s && typeof s.id === 'string' &&
    isNonFreeWikiLogo(s.favicon) &&
    (!COUNTRY_FILTER || String(s.country || '').toUpperCase() === COUNTRY_FILTER) &&
    (ONLY_IDS.size === 0 || ONLY_IDS.has(s.id)),
).slice(0, Number.isFinite(LIMIT) ? LIMIT : undefined);

console.log(
  `migrate-nonfree-logos: ${targets.length} non-free wikipedia/en station(s)` +
    (COUNTRY_FILTER ? ` in ${COUNTRY_FILTER}` : '') +
    ` — concurrency ${CONCURRENCY}`,
);

const patch = [];
const misses = [];
const noLicense = [];

await runPool(
  targets,
  async (s, idx) => {
    const tag = `[${String(idx + 1).padStart(3)}/${targets.length}] ${s.id}`;
    try {
      const r = await resolveFreeLogo(s);
      if (!r) {
        misses.push({ id: s.id, name: s.name, country: s.country, favicon: s.favicon });
        return;
      }
      const fileName = commonsFileName(r.url);
      const { license, raw } = fileName ? await commonsLicense(fileName) : { license: null, raw: null };
      const entry = {
        id: s.id,
        url: r.url,
        source: 'wiki',
        sourceUrl: r.descriptionUrl || (fileName ? `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(fileName)}` : undefined),
        // Underscore-prefixed review metadata — apply-logos ignores unknown
        // keys. `_via: article` (native-lang infobox) is high-confidence;
        // `_via: file` (Commons File: search) can match a same-named sibling
        // station and MUST be spot-checked before applying.
        _via: r.via,
        _lang: r.lang,
        _name: s.name,
      };
      if (license) entry.license = license;
      else noLicense.push({ id: s.id, raw });
      patch.push(entry);
      console.log(`${tag}  OK  ${r.via}/${r.lang}  ${license || '??license'}  ${r.url}`);
    } catch (err) {
      misses.push({ id: s.id, name: s.name, country: s.country, error: String(err?.message || err) });
      console.log(`${tag}  !!  ${err?.message || err}`);
    }
  },
  CONCURRENCY,
);

patch.sort((a, b) => a.id.localeCompare(b.id));
mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, JSON.stringify(patch, null, 2) + '\n');

const viaArticle = patch.filter((e) => e._via === 'article').length;
const viaFile = patch.length - viaArticle;
console.log('');
console.log(`resolved: ${patch.length}/${targets.length}  (article: ${viaArticle}, file: ${viaFile}, miss: ${misses.length}, no-licence: ${noLicense.length})`);
console.log(`patch → ${OUT_PATH}`);
console.log(`  ⚠ review the ${viaFile} _via:file entr${viaFile === 1 ? 'y' : 'ies'} by hand — they can match a same-named sibling station.`);
if (noLicense.length) {
  console.log(`  ⚠ ${noLicense.length} resolved without a Commons licence (written without faviconLicense):`);
  for (const n of noLicense.slice(0, 20)) console.log(`    ${n.id} (raw: ${n.raw || 'none'})`);
}
if (misses.length) {
  console.log(`  ${misses.length} unresolved (need broadcaster-site / manual) — first 30:`);
  for (const m of misses.slice(0, 30)) console.log(`    ${m.id}  ${m.name}${m.error ? '  [' + m.error + ']' : ''}`);
}
