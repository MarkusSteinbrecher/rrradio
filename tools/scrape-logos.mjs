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
 *   5. Score candidates and verify the best few return image/*.
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

const catalogById = loadCatalogById();

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
  urls.push(...derivedStreamHomepages(merged));
  return [...new Set(urls.filter((url) => url && !isGenericCatalogHomepage(url)))];
}

function targetReason(station) {
  if (!station || typeof station.id !== 'string') return null;
  const catalogStation = catalogById.get(station.id);
  if (homepageCandidates(station, catalogStation).length === 0) return null;
  const effectiveFavicon = station.favicon ?? catalogStation?.favicon ?? null;
  if (isLocalLogo(effectiveFavicon)) return null;
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

async function verifyImage(url) {
  try {
    const head = await fetchWithTimeout(url, { method: 'HEAD' });
    if (head.ok && (head.headers.get('content-type') ?? '').startsWith('image/')) {
      return {
        ok: true,
        contentType: head.headers.get('content-type') ?? '',
        contentLength: Number(head.headers.get('content-length')) || null,
      };
    }
  } catch {
    /* fall through */
  }
  try {
    const get = await fetchWithTimeout(url, { headers: { Range: 'bytes=0-31' } });
    return {
      ok: get.ok && (get.headers.get('content-type') ?? '').startsWith('image/'),
      contentType: get.headers.get('content-type') ?? '',
      contentLength: Number(get.headers.get('content-length')) || null,
    };
  } catch {
    return { ok: false };
  }
}

function isAcceptableScrapedLogo(candidate) {
  const logo = classifyLogoUrl(candidate.url);
  return logo.state === 'ok' || logo.tier === 'remote';
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
        if (station.effectiveFavicon && !shouldReplaceLogo(station.effectiveFavicon, c, { replaceGood: REPLACE_GOOD })) {
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
        rejected.push({ ...candidateProvenance(c, verified), rejectReason: 'not-verifiable-image' });
      }
      failures.push({ homepage, reason: 'no-verifiable-upgrade', candidates: rejected });
    } catch (err) {
      const msg = err?.name === 'AbortError' ? 'timeout' : err?.message || String(err);
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

mkdirSync(join(root, '.cache'), { recursive: true });
writeFileSync(
  join(root, '.cache/logo-scrape-report.json'),
  JSON.stringify({
    generatedAt: new Date().toISOString(),
    mode: MODE,
    dryRun: DRY_RUN,
    replaceGood: REPLACE_GOOD,
    counters,
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
  const quoted = /[:#&*!|>'"%@`,\[\]{}]/.test(w.url) ? JSON.stringify(w.url) : w.url;
  const insertAt = idIdx + idLine.length;

  if (w.action === 'replace') {
    let p = insertAt;
    let didReplace = false;
    while (p < text.length) {
      const lineEnd = text.indexOf('\n', p);
      const line = text.slice(p, lineEnd === -1 ? text.length : lineEnd);
      if (line.startsWith('- id:')) break;
      if (line.startsWith('  favicon:')) {
        const next = lineEnd === -1 ? text.length : lineEnd + 1;
        // Also consume an existing faviconSource: line immediately after.
        const srcLineEnd = text.indexOf('\n', next);
        const srcLine = text.slice(next, srcLineEnd === -1 ? text.length : srcLineEnd);
        const blockEnd = srcLine.startsWith('  faviconSource:') ? srcLineEnd + 1 : next;
        text = text.slice(0, p) + `  favicon: ${quoted}\n  faviconSource: broadcaster-site\n` + text.slice(blockEnd);
        replaced++;
        didReplace = true;
        break;
      }
      if (lineEnd === -1) break;
      p = lineEnd + 1;
    }
    if (!didReplace) missingFavLine++;
  } else {
    text = text.slice(0, insertAt) + `  favicon: ${quoted}\n  faviconSource: broadcaster-site\n` + text.slice(insertAt);
    inserted++;
  }
}

writeFileSync(stationsPath, text);
console.log(
  `\nstations.yaml updated: ${inserted} inserted, ${replaced} replaced` +
    (missLine > 0 ? `, ${missLine} id line(s) missing` : '') +
    (missingFavLine > 0 ? `, ${missingFavLine} favicon line(s) missing for replace` : ''),
);
