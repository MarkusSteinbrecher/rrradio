#!/usr/bin/env node
/**
 * Scrape logo candidates from station homepages and write `favicon:`
 * overrides into data/stations.yaml.
 *
 *   node tools/scrape-logos.mjs
 *   node tools/scrape-logos.mjs --mode missing --limit 50 --dry-run
 *   node tools/scrape-logos.mjs --mode upgrade --concurrency 12
 *   node tools/scrape-logos.mjs --mode all --replace-good --dry-run
 *   node tools/scrape-logos.mjs --id de-deutschrap,de-total-instrumental --dry-run
 *
 * Modes:
 *   missing  only stations with no favicon (default, historical behavior)
 *   upgrade  stations whose current favicon is weak/generic/http/missing
 *   all      any non-local station with a homepage
 *
 * Per station:
 *   1. GET the station homepage HTML (8s timeout, 256 KB cap).
 *   2. Parse icons, apple-touch-icon, og/twitter images, itemprop logo,
 *      JSON-LD logo/image fields, and web app manifest icons.
 *   3. Resolve relative URLs against the homepage.
 *   4. Drop non-HTTPS candidates.
 *   5. Score candidates and verify the best few return usable image bytes.
 *   6. Insert or replace the row's `favicon:` line.
 *
 * The script never replaces curated local assets (`stations/...`). It
 * mirrors the surgical-insert pattern in wire-metadata/wiki-logos so the
 * hand-formatted YAML structure stays intact.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import {
  classifyLogoUrl,
  isLocalLogo,
  parseIconSize,
  scoreLogoCandidate,
  shouldReplaceLogo,
} from './logo-quality.mjs';
import { bucketForNp, parseImageHeader } from './lib/image-header.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const argv = process.argv.slice(2);
const argFlag = (name) => argv.includes(name);
const argVal = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const argVals = (name) => {
  const vals = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name && argv[i + 1]) vals.push(...argv[i + 1].split(','));
  }
  return vals.map((v) => v.trim()).filter(Boolean);
};

const MODE = argVal('--mode', 'missing');
if (!['missing', 'upgrade', 'all'].includes(MODE)) {
  console.error('scrape-logos: --mode must be one of: missing, upgrade, all');
  process.exit(1);
}

const LIMIT = Number(argVal('--limit', Infinity));
const CONCURRENCY = Math.max(1, Math.min(20, Number(argVal('--concurrency', 8))));
const DRY_RUN = argFlag('--dry-run');
const REPLACE_GOOD = argFlag('--replace-good');
const ONLY_IDS = new Set(argVals('--id'));
const FETCH_TIMEOUT_MS = 8_000;
const IMAGE_PROBE_BYTES = 64 * 1024;
const LOGO_FIELD_RE = /^  (faviconSource|faviconSourceUrl|faviconLicense|faviconSourceType|faviconOk):/;
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';

const stationsPath = join(root, 'data/stations.yaml');
let text = readFileSync(stationsPath, 'utf8');
const list = parseYaml(text);
if (!Array.isArray(list)) {
  console.error('scrape-logos: stations.yaml is not a list');
  process.exit(1);
}

function loadCatalogById() {
  const raw = JSON.parse(readFileSync(join(root, 'public', 'stations.json'), 'utf8'));
  const stations = Array.isArray(raw) ? raw : raw?.stations;
  const byId = new Map();
  for (const station of Array.isArray(stations) ? stations : []) {
    if (station?.id) byId.set(station.id, station);
  }
  return byId;
}

function loadLogoStatusById() {
  try {
    const raw = JSON.parse(readFileSync(join(root, 'public', 'station-logo-status.json'), 'utf8'));
    const byId = new Map();
    for (const row of raw?.stations ?? []) {
      if (row?.id) byId.set(row.id, row);
    }
    return byId;
  } catch {
    return new Map();
  }
}

const catalogById = loadCatalogById();
const logoStatusById = loadLogoStatusById();

function streamSlug(station) {
  if (station.metadataUrl) return String(station.metadataUrl);
  try {
    const url = new URL(station.streamUrl);
    const parts = url.pathname.split('/').filter(Boolean);
    return parts.at(-1) || null;
  } catch {
    return null;
  }
}

function derivedStreamHomepages(station) {
  if (!station.streamUrl) return [];
  try {
    const url = new URL(station.streamUrl);
    if (!url.hostname.includes('.')) return [];
    const hosts = [url.hostname.replace(/^stream\./, 'www.'), url.hostname.replace(/^stream\./, '')];
    return [...new Set(hosts)].map((host) => `https://${host}/`);
  } catch {
    return [];
  }
}

function isGenericCatalogHomepage(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '') === 'radio-browser.info';
  } catch {
    return false;
  }
}

function isGenericScrapePage(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host === 'zeno.fm' ||
      host === 'www.zeno.fm' ||
      host === 'radio.co' ||
      host === 'www.radio.co' ||
      host.endsWith('.streampanel.cloud') ||
      host.endsWith('.streaming.broadcast.radio') ||
      host.endsWith('.sp.radio.fm') ||
      host.startsWith('icecast.') ||
      /^ip\d+[.-]/.test(host)
    );
  } catch {
    return true;
  }
}

function homepageCandidates(station, catalogStation) {
  const merged = { ...(catalogStation ?? {}), ...station };
  const urls = [];
  const slug = streamSlug(merged);
  if (merged.broadcaster === 'laut-fm' && slug) {
    urls.push(`https://laut.fm/${slug}`);
    urls.push(`https://www.laut.fm/${slug}`);
  }
  urls.push(station.homepage, catalogStation?.homepage);
  urls.push(...originHomepages(station.homepage));
  urls.push(...originHomepages(catalogStation?.homepage));
  urls.push(...derivedStreamHomepages(merged));
  return [...new Set(urls.filter((url) => url && !isGenericCatalogHomepage(url)))];
}

function originHomepages(raw) {
  if (!raw) return [];
  try {
    const url = new URL(raw);
    const out = [`${url.protocol}//${url.host}/`];
    if (url.hostname.startsWith('www.')) {
      out.push(`${url.protocol}//${url.hostname.slice(4)}/`);
    } else {
      out.push(`${url.protocol}//www.${url.hostname}/`);
    }
    return out;
  } catch {
    return [];
  }
}

function targetReason(station) {
  if (!station || typeof station.id !== 'string') return null;
  const catalogStation = catalogById.get(station.id);
  if (homepageCandidates(station, catalogStation).length === 0) return null;
  const effectiveFavicon = station.favicon ?? catalogStation?.favicon ?? null;
  if (isLocalLogo(effectiveFavicon)) return null;
  const statusRow = logoStatusById.get(station.id);
  if (statusRow?.action) {
    if (MODE === 'missing') {
      return statusRow.action === 'scrape-missing' ? (statusRow.tier ?? 'scrape-missing') : null;
    }
    if (MODE === 'upgrade') {
      return statusRow.action === 'scrape-upgrade' ? (statusRow.tier ?? 'scrape-upgrade') : null;
    }
    return statusRow.tier ?? statusRow.action;
  }
  const logo = classifyLogoUrl(effectiveFavicon);
  if (MODE === 'missing') return logo.tier === 'missing' ? 'missing' : null;
  if (MODE === 'upgrade') return logo.upgradeRecommended ? logo.tier : null;
  return logo.tier;
}

const candidates = list
  .filter((station) => ONLY_IDS.size === 0 || ONLY_IDS.has(station.id))
  .map((station) => {
    const catalogStation = catalogById.get(station.id);
    return {
      station: {
        ...station,
        effectiveFavicon: station.favicon ?? catalogStation?.favicon ?? null,
        homepageCandidates: homepageCandidates(station, catalogStation),
        logoStatusAction: logoStatusById.get(station.id)?.action ?? null,
      },
      reason: targetReason(station),
    };
  })
  .filter((item) => item.reason)
  .slice(0, Number.isFinite(LIMIT) ? LIMIT : list.length);

console.log(
  `scrape-logos: ${candidates.length} candidate(s) ` +
    `(mode=${MODE}, concurrency=${CONCURRENCY}${REPLACE_GOOD ? ', replace-good' : ''})` +
    (ONLY_IDS.size > 0 ? `, ids=${[...ONLY_IDS].join(',')}` : '') +
    (DRY_RUN ? ' — DRY RUN, no YAML writes' : ''),
);
if (ONLY_IDS.size > 0) {
  const foundIds = new Set(candidates.map(({ station }) => station.id));
  for (const id of ONLY_IDS) {
    if (!foundIds.has(id)) console.log(`scrape-logos: ${id} is not targetable in mode=${MODE}`);
  }
}

function parseAttrs(raw) {
  const attrs = {};
  const re = /([a-zA-Z][a-zA-Z0-9_:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s/>]+)))?/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const key = m[1].toLowerCase();
    const val = m[2] ?? m[3] ?? m[4] ?? '';
    attrs[key] = val;
  }
  return attrs;
}

function resolveCandidate(c, baseUrl) {
  try {
    return { ...c, url: new URL(c.url, baseUrl).href };
  } catch {
    return null;
  }
}

function extractHtmlCandidates(html, baseUrl) {
  const out = [];

  const linkRe = /<link\s+([^>]*?)\/?>/gi;
  let m;
  while ((m = linkRe.exec(html)) !== null) {
    const a = parseAttrs(m[1]);
    if (!a.rel || !a.href) continue;
    const rel = a.rel.toLowerCase().trim();
    if (/manifest/.test(rel)) {
      out.push({ rel: 'manifest', url: a.href, size: 0 });
      continue;
    }
    if (!/icon/.test(rel)) continue;
    out.push({ rel, url: a.href, size: parseIconSize(a.sizes), discoveredOn: baseUrl });
  }

  const metaRe = /<meta\s+([^>]*?)\/?>/gi;
  while ((m = metaRe.exec(html)) !== null) {
    const a = parseAttrs(m[1]);
    const key = (a.property || a.name || a.itemprop || '').toLowerCase().trim();
    if (!a.content) continue;
    if (
      key === 'og:image' ||
      key === 'og:image:secure_url' ||
      key === 'og:logo' ||
      key === 'twitter:image' ||
      key === 'twitter:image:src' ||
      key === 'logo' ||
      key === 'image'
    ) {
      out.push({
        rel: key === 'logo' || key === 'image' ? `itemprop:${key}` : key,
        url: a.content,
        size: 0,
        discoveredOn: baseUrl,
      });
    }
  }

  const imgRe = /<img\s+([^>]*?)\/?>/gi;
  while ((m = imgRe.exec(html)) !== null) {
    const a = parseAttrs(m[1]);
    const src = a.src || a['data-src'] || a['data-lazy-src'];
    if (!src) continue;
    const hay = [
      a.class,
      a.id,
      a.alt,
      a.title,
      a['aria-label'],
      src,
    ].filter(Boolean).join(' ').toLowerCase();
    if (!/(^|[\s_-])(tdb-logo-img|custom-logo|site-logo|header-logo|logo)([\s_.-]|$)/i.test(hay)) continue;
    out.push({
      rel: /header|tdb-logo|site-logo|custom-logo/.test(hay) ? 'header-logo' : 'html-logo',
      url: src,
      size: Math.max(Number(a.width) || 0, Number(a.height) || 0, parseIconSize(a.sizes)),
      discoveredOn: baseUrl,
    });
  }

  for (const c of extractJsonLdCandidates(html)) out.push(c);

  return out
    .map((c) => resolveCandidate(c, baseUrl))
    .map((c) => (c ? { ...c, discoveredOn: c.discoveredOn ?? baseUrl } : null))
    .filter((c) => c && c.url);
}

function extractJsonLdCandidates(html) {
  const out = [];
  const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = scriptRe.exec(html)) !== null) {
    const attrs = parseAttrs(m[1]);
    if ((attrs.type || '').toLowerCase() !== 'application/ld+json') continue;
    try {
      collectJsonLdImages(JSON.parse(m[2]), out);
    } catch {
      /* ignore malformed site JSON */
    }
  }
  return out;
}

function collectJsonLdImages(value, out, depth = 0) {
  if (depth > 6 || !value) return;
  if (Array.isArray(value)) {
    for (const item of value) collectJsonLdImages(item, out, depth + 1);
    return;
  }
  if (typeof value === 'string') return;
  if (typeof value !== 'object') return;

  for (const key of ['logo', 'image']) {
    const raw = value[key];
    if (typeof raw === 'string') {
      out.push({ rel: key === 'logo' ? 'jsonld-logo' : 'jsonld-image', url: raw, size: 0 });
    } else if (raw && typeof raw === 'object') {
      const url = raw.url || raw.contentUrl || raw['@id'];
      const width = Number(raw.width) || 0;
      const height = Number(raw.height) || 0;
      if (typeof url === 'string') {
        out.push({
          rel: key === 'logo' ? 'jsonld-logo' : 'jsonld-image',
          url,
          size: Math.max(width, height),
        });
      }
      collectJsonLdImages(raw, out, depth + 1);
    }
  }

  if (value['@graph']) collectJsonLdImages(value['@graph'], out, depth + 1);
}

async function fetchManifestCandidates(manifestCandidates, baseUrl) {
  const out = [];
  for (const manifest of manifestCandidates.slice(0, 2)) {
    try {
      const res = await fetchWithTimeout(manifest.url, {
        headers: { Accept: 'application/manifest+json,application/json,*/*' },
      });
      if (!res.ok) continue;
      const data = await res.json();
      for (const icon of data.icons || []) {
        if (!icon?.src) continue;
        const c = resolveCandidate(
          {
            rel: 'manifest-icon',
            url: icon.src,
            size: parseIconSize(icon.sizes),
            discoveredOn: baseUrl,
            manifestUrl: manifest.url,
          },
          manifest.url || baseUrl,
        );
        if (c) out.push(c);
      }
    } catch {
      /* manifest is optional */
    }
  }
  return out;
}

function uniqueCandidates(candidates) {
  const byUrl = new Map();
  for (const c of candidates) {
    if (!c.url?.startsWith('https://')) continue;
    const current = byUrl.get(c.url);
    if (!current || scoreLogoCandidate(c) > scoreLogoCandidate(current)) {
      byUrl.set(c.url, c);
    }
  }
  return [...byUrl.values()];
}

function quoteYaml(value) {
  const s = String(value);
  return /[:#&*!|>'"%@`,\[\]{}]/.test(s) ? JSON.stringify(s) : s;
}

function scrapedLogoBlock(url) {
  return (
    `  favicon: ${quoteYaml(url)}\n` +
    '  faviconSource: broadcaster-site\n' +
    '  faviconLicense: broadcaster-implicit\n'
  );
}

function findLogoMetadataBlockEnd(src, start) {
  let end = start;
  while (end < src.length) {
    const lineEnd = src.indexOf('\n', end);
    const line = src.slice(end, lineEnd === -1 ? src.length : lineEnd);
    if (!LOGO_FIELD_RE.test(line)) break;
    end = lineEnd === -1 ? src.length : lineEnd + 1;
  }
  return end;
}

function candidateProvenance(candidate, verified = null) {
  const classified = classifyLogoUrl(candidate.url);
  return {
    url: candidate.url,
    rel: candidate.rel,
    scrapedPage: candidate.discoveredOn ?? null,
    manifestUrl: candidate.manifestUrl ?? null,
    sizeHint: Number(candidate.size) || 0,
    score: scoreLogoCandidate(candidate),
    logoTier: classified.tier,
    logoState: classified.state,
    logoReason: classified.reason,
    contentType: verified?.contentType ?? null,
    contentLength: verified?.contentLength ?? null,
    format: verified?.format ?? null,
    width: verified?.width ?? null,
    height: verified?.height ?? null,
    npQuality: verified?.bucket ?? null,
  };
}

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

async function fetchHomepage(url) {
  const res = await fetchWithTimeout(url, {
    headers: { Accept: 'text/html,application/xhtml+xml' },
  });
  if (!res.ok) throw new Error(`homepage ${res.status}`);
  const reader = res.body?.getReader();
  if (!reader) return await res.text();
  const chunks = [];
  let total = 0;
  while (total < 256 * 1024) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    total += value.byteLength;
  }
  try { reader.cancel(); } catch { /* fine */ }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

function parkedPageReason(html) {
  const text = html.slice(0, 64 * 1024).toLowerCase();
  if (text.includes('hugedomains.com') || text.includes('this domain is for sale')) {
    return 'parked-domain';
  }
  if (text.includes('buy this domain') || text.includes('domain parking')) {
    return 'parked-domain';
  }
  return null;
}

async function readPrefix(res, limit) {
  const reader = res.body?.getReader();
  if (!reader) return Buffer.from(await res.arrayBuffer()).subarray(0, limit);
  const chunks = [];
  let total = 0;
  try {
    while (total < limit) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      const buf = Buffer.from(value);
      chunks.push(buf);
      total += buf.length;
    }
  } finally {
    try { await reader.cancel(); } catch { /* ignore */ }
  }
  return Buffer.concat(chunks, Math.min(total, limit)).subarray(0, limit);
}

function contentLengthOf(res) {
  const range = res.headers.get('content-range');
  const total = range ? /\/(\d+)$/.exec(range)?.[1] : null;
  if (total) return Number(total);
  return Number(res.headers.get('content-length')) || null;
}

async function verifyImage(url) {
  let headContentType = '';
  let headContentLength = null;
  try {
    const head = await fetchWithTimeout(url, { method: 'HEAD' });
    if (head.ok) {
      headContentType = head.headers.get('content-type') ?? '';
      headContentLength = Number(head.headers.get('content-length')) || null;
    }
  } catch {
    /* HEAD is optional; fall through to byte probe */
  }
  try {
    let get = await fetchWithTimeout(url, {
      headers: { Range: `bytes=0-${IMAGE_PROBE_BYTES - 1}`, Accept: 'image/*,*/*' },
    });
    if (get.status === 416) {
      get = await fetchWithTimeout(url, { headers: { Accept: 'image/*,*/*' } });
    }
    if (!get.ok && get.status !== 206) {
      return {
        ok: false,
        contentType: headContentType || get.headers.get('content-type') || '',
        contentLength: headContentLength ?? contentLengthOf(get),
        rejectReason: `image-http-${get.status}`,
      };
    }
    const contentType = get.headers.get('content-type') || headContentType || '';
    const buf = await readPrefix(get, IMAGE_PROBE_BYTES);
    const header = parseImageHeader(buf);
    const bucket = bucketForNp(header);
    const imageLike = contentType.startsWith('image/') || !!header?.format;
    if (!imageLike) {
      return {
        ok: false,
        contentType,
        contentLength: headContentLength ?? contentLengthOf(get),
        rejectReason: 'not-image-content',
      };
    }
    if (bucket === 'poor' || bucket === 'unknown') {
      return {
        ok: false,
        contentType,
        contentLength: headContentLength ?? contentLengthOf(get),
        format: header?.format,
        width: header?.width,
        height: header?.height,
        bucket,
        rejectReason: bucket === 'poor' ? 'poor-image-quality' : 'unknown-image-size',
      };
    }
    return {
      ok: true,
      contentType,
      contentLength: headContentLength ?? contentLengthOf(get),
      format: header?.format,
      width: header?.width,
      height: header?.height,
      bucket,
    };
  } catch {
    return { ok: false, contentType: headContentType, contentLength: headContentLength };
  }
}

function isAcceptableScrapedLogo(candidate) {
  const logo = classifyLogoUrl(candidate.url);
  return logo.state === 'ok' || logo.tier === 'remote';
}

function sameLogoUrl(a, b) {
  if (!a || !b) return false;
  try {
    const au = new URL(a);
    const bu = new URL(b);
    au.hash = '';
    bu.hash = '';
    au.hostname = au.hostname.toLowerCase();
    bu.hostname = bu.hostname.toLowerCase();
    return au.href === bu.href;
  } catch {
    return String(a) === String(b);
  }
}

async function discover(station) {
  const failures = [];
  for (const homepage of station.homepageCandidates || [station.homepage]) {
    try {
      if (isGenericScrapePage(homepage)) {
        failures.push({ homepage, reason: 'generic-scrape-page', candidates: [] });
        continue;
      }
      const html = await fetchHomepage(homepage);
      const parkedReason = parkedPageReason(html);
      if (parkedReason) {
        failures.push({ homepage, reason: parkedReason, candidates: [] });
        continue;
      }
      const htmlCandidates = extractHtmlCandidates(html, homepage);
      const manifests = htmlCandidates.filter((c) => c.rel === 'manifest');
      const manifestCandidates = await fetchManifestCandidates(manifests, homepage);
      const all = uniqueCandidates([
        ...htmlCandidates.filter((c) => c.rel !== 'manifest'),
        ...manifestCandidates,
      ]).sort((a, b) => scoreLogoCandidate(b) - scoreLogoCandidate(a));
      const rejected = [];

      if (all.length === 0) {
        failures.push({ homepage, reason: 'no-https-candidates', candidates: [] });
        continue;
      }

      for (const c of all.slice(0, 8)) {
        if (!isAcceptableScrapedLogo(c)) {
          rejected.push({ ...candidateProvenance(c), rejectReason: 'generic-or-weak-candidate' });
          continue;
        }
        if (sameLogoUrl(station.effectiveFavicon, c.url)) {
          rejected.push({ ...candidateProvenance(c), rejectReason: 'same-as-existing-logo' });
          continue;
        }
        const replaceGoodForStatus =
          station.logoStatusAction === 'scrape-upgrade' || station.logoStatusAction === 'scrape-missing';
        if (
          station.effectiveFavicon &&
          !shouldReplaceLogo(station.effectiveFavicon, c, { replaceGood: REPLACE_GOOD || replaceGoodForStatus })
        ) {
          rejected.push({ ...candidateProvenance(c), rejectReason: 'does-not-improve-existing-logo' });
          continue;
        }
        const verified = await verifyImage(c.url);
        if (verified.ok) {
          return {
            ok: true,
            url: c.url,
            picked: c,
            verified,
            homepage,
            candidate: candidateProvenance(c, verified),
            rejectedCandidates: rejected,
          };
        }
        rejected.push({ ...candidateProvenance(c, verified), rejectReason: verified.rejectReason ?? 'not-verifiable-image' });
      }
      failures.push({ homepage, reason: 'no-verifiable-upgrade', candidates: rejected });
    } catch (err) {
      const cause = err?.cause?.message ? `: ${err.cause.message}` : '';
      const msg = err?.name === 'AbortError' ? 'timeout' : `${err?.message || String(err)}${cause}`;
      failures.push({ homepage, reason: msg, candidates: [] });
    }
  }
  return {
    ok: false,
    reason: failures.map((f) => `${f.homepage}: ${f.reason}`).join('; ') || 'no-verifiable-upgrade',
    attempts: failures,
  };
}

async function runPool(items, worker, concurrency) {
  const results = [];
  let i = 0;
  const lanes = Array.from({ length: concurrency }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(lanes);
  return results;
}

const counters = { inserted: 0, replaced: 0, noCands: 0, noImage: 0, fetchFail: 0, skipped: 0 };
const writes = [];
const runRows = [];

const t0 = Date.now();
await runPool(
  candidates,
  async ({ station, reason }, idx) => {
    const tag = `[${String(idx + 1).padStart(4)}/${candidates.length}] ${station.id}`;
    try {
      const r = await discover(station);
      if (r.ok) {
        const action = station.favicon ? 'replace' : 'insert';
        writes.push({ id: station.id, url: r.url, action });
        counters[action === 'replace' ? 'replaced' : 'inserted']++;
        runRows.push({
          id: station.id,
          action,
          from: station.favicon ?? station.effectiveFavicon ?? null,
          to: r.url,
          rel: r.picked.rel,
          scrapedPage: r.homepage,
          candidate: r.candidate,
          rejectedCandidates: r.rejectedCandidates,
          targetReason: reason,
          score: scoreLogoCandidate(r.picked),
        });
        console.log(`${tag}  ${action === 'replace' ? 'REPL' : 'OK  '} ${r.picked.rel} ${r.url} via ${r.homepage}`);
      } else if (r.reason === 'no-https-candidates') {
        counters.noCands++;
        runRows.push({ id: station.id, action: 'none', reason: r.reason, targetReason: reason, attempts: r.attempts ?? [] });
        console.log(`${tag}  --  no https candidates`);
      } else {
        counters.noImage++;
        runRows.push({ id: station.id, action: 'none', reason: r.reason, targetReason: reason, attempts: r.attempts ?? [] });
        console.log(`${tag}  --  no verifiable upgrade`);
      }
    } catch (err) {
      counters.fetchFail++;
      const msg = err?.name === 'AbortError' ? 'timeout' : err?.message || String(err);
      runRows.push({ id: station.id, action: 'none', reason: msg, targetReason: reason });
      console.log(`${tag}  !!  fetch failed: ${msg}`);
    }
  },
  CONCURRENCY,
);

const wallS = ((Date.now() - t0) / 1000).toFixed(1);
console.log('');
console.log(
  `scrape-logos done in ${wallS}s — inserted: ${counters.inserted}, replaced: ${counters.replaced}, ` +
    `no-https-cands: ${counters.noCands}, no-verifiable-upgrade: ${counters.noImage}, fetch-failed: ${counters.fetchFail}`,
);
const hitRate = candidates.length > 0
  ? (((counters.inserted + counters.replaced) / candidates.length) * 100).toFixed(1)
  : '0';
console.log(`hit rate: ${hitRate}% (${counters.inserted + counters.replaced}/${candidates.length})`);

function hostOf(raw) {
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function buildReviewSummary(rows) {
  const selected = rows.filter((row) => row.action === 'insert' || row.action === 'replace');
  const byUrl = new Map();
  const byHost = new Map();
  const lowSignal = [];

  for (const row of selected) {
    const url = row.to;
    if (!url) continue;

    const urlRows = byUrl.get(url) ?? [];
    urlRows.push(row);
    byUrl.set(url, urlRows);

    const host = hostOf(url);
    if (host) byHost.set(host, (byHost.get(host) ?? 0) + 1);

    const rel = String(row.rel || row.candidate?.rel || '');
    const tier = row.candidate?.logoTier;
    const logoState = row.candidate?.logoState;
    const flags = [];
    if (logoState === 'bad') flags.push(`state:${logoState}`);
    if (tier && tier !== 'good-remote' && tier !== 'remote') flags.push(`tier:${tier}`);
    if (rel === 'icon' || rel === 'shortcut icon' || rel === 'mask-icon') flags.push(`rel:${rel}`);
    if (row.candidate?.npQuality === 'acceptable') flags.push('np:acceptable');
    if (row.candidate?.npQuality && !['good', 'acceptable', 'vector'].includes(row.candidate.npQuality)) {
      flags.push(`np:${row.candidate.npQuality}`);
    }
    if (flags.length > 0) {
      lowSignal.push({
        id: row.id,
        action: row.action,
        url,
        rel,
        flags,
        score: row.score ?? null,
        scrapedPage: row.scrapedPage ?? null,
      });
    }
  }

  const duplicateUrls = [...byUrl.entries()]
    .filter(([, rowsForUrl]) => rowsForUrl.length >= 4)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([url, rowsForUrl]) => ({
      url,
      count: rowsForUrl.length,
      ids: rowsForUrl.slice(0, 12).map((row) => row.id),
    }));

  const topHosts = [...byHost.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([host, count]) => ({ host, count }));

  return {
    selected: selected.length,
    duplicateUrlGroups: duplicateUrls.length,
    duplicateUrls: duplicateUrls.slice(0, 20),
    lowSignalSelections: lowSignal.slice(0, 50),
    topHosts,
  };
}

function printReviewSummary(review) {
  if (review.selected === 0) return;
  console.log('');
  console.log('review gate:');
  console.log(`  selected logos        ${String(review.selected).padStart(6)}`);
  console.log(`  duplicate URL groups  ${String(review.duplicateUrlGroups).padStart(6)}  (same candidate used by 4+ stations)`);
  console.log(`  low-signal picks      ${String(review.lowSignalSelections.length).padStart(6)}  (icon rel, non-ok tier/state, or acceptable-only quality)`);
  if (review.duplicateUrls.length > 0) {
    console.log('  top duplicate URLs:');
    for (const group of review.duplicateUrls.slice(0, 5)) {
      console.log(`    ${group.count}x ${group.url}`);
      console.log(`       ${group.ids.join(', ')}`);
    }
  }
  if (review.lowSignalSelections.length > 0) {
    console.log('  sample low-signal picks:');
    for (const row of review.lowSignalSelections.slice(0, 8)) {
      console.log(`    ${row.id}: ${row.flags.join(', ')} -> ${row.url}`);
    }
  }
}

const review = buildReviewSummary(runRows);
printReviewSummary(review);

mkdirSync(join(root, '.cache'), { recursive: true });
writeFileSync(
  join(root, '.cache/logo-scrape-report.json'),
  JSON.stringify({
    generatedAt: new Date().toISOString(),
    mode: MODE,
    dryRun: DRY_RUN,
    replaceGood: REPLACE_GOOD,
    counters,
    review,
    rows: runRows,
  }, null, 2) + '\n',
);
console.log('run report: .cache/logo-scrape-report.json');

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
let missingFavLine = 0;

for (const w of writes) {
  const idLine = `- id: ${w.id}\n`;
  const idIdx = text.indexOf(idLine);
  if (idIdx === -1) {
    missLine++;
    console.warn(`  ! couldn't locate id line for ${w.id}`);
    continue;
  }
  const insertAt = idIdx + idLine.length;
  const newLogoBlock = scrapedLogoBlock(w.url);

  if (w.action === 'replace') {
    let p = insertAt;
    let didReplace = false;
    while (p < text.length) {
      const lineEnd = text.indexOf('\n', p);
      const line = text.slice(p, lineEnd === -1 ? text.length : lineEnd);
      if (line.startsWith('- id:')) break;
      if (line.startsWith('  favicon:')) {
        const next = lineEnd === -1 ? text.length : lineEnd + 1;
        // Also consume adjacent logo metadata fields immediately after.
        const blockEnd = findLogoMetadataBlockEnd(text, next);
        text = text.slice(0, p) + newLogoBlock + text.slice(blockEnd);
        replaced++;
        didReplace = true;
        break;
      }
      if (lineEnd === -1) break;
      p = lineEnd + 1;
    }
    if (!didReplace) missingFavLine++;
  } else {
    text = text.slice(0, insertAt) + newLogoBlock + text.slice(insertAt);
    inserted++;
  }
}

writeFileSync(stationsPath, text);
console.log(
  `\nstations.yaml updated: ${inserted} inserted, ${replaced} replaced` +
    (missLine > 0 ? `, ${missLine} id line(s) missing` : '') +
    (missingFavLine > 0 ? `, ${missingFavLine} favicon line(s) missing for replace` : ''),
);
