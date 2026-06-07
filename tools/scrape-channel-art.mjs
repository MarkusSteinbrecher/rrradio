#!/usr/bin/env node
/**
 * Per-channel cover art for multi-channel broadcasters.
 *
 *   node tools/scrape-channel-art.mjs --host radiogong.de --dry-run
 *   node tools/scrape-channel-art.mjs --id de-radio-gong-96-3-top-50-gong-top-50 --dry-run
 *   node tools/scrape-channel-art.mjs --cc DE --min-family 3 --replace
 *
 * The homepage logo scraper (scrape-logos.mjs) finds ONE logo per homepage, so
 * every sibling channel of a broadcaster gets the same brand mark. Multi-channel
 * broadcasters instead publish a grid/slider of per-channel cover images, each
 * labelled with the channel name (alt text or filename). This tool groups
 * stations into brand families (COUNTRY|homepage-host, same key the dedupe family
 * model uses), fetches each broadcaster's listing page, and matches each image to
 * the right channel by name — assigning art only on a confident, unambiguous,
 * byte-verified match. Unmatched channels are left for the brand/homepage logo
 * fallback; we never guess.
 *
 * Self-contained by house convention (mirrors scrape-logos / wiki-logos): the
 * small fetch/verify/YAML-write helpers are local; only genuinely shared logic
 * (family bucketing, name tokenisation, image-header probing, channel matching)
 * is imported.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { familyBucketKey } from './lib/station-family.mjs';
import { extractLabeledImages, matchChannelArt } from './lib/channel-art-match.mjs';
import { isLocalLogo } from './logo-quality.mjs';
import { bucketForNp, parseImageHeader } from './lib/image-header.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const argv = process.argv.slice(2);
const argFlag = (n) => argv.includes(n);
const argVal = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const argVals = (n) => {
  const out = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === n && argv[i + 1]) out.push(...argv[i + 1].split(','));
  return out.map((v) => v.trim()).filter(Boolean);
};

const ONLY_IDS = new Set(argVals('--id'));
const ONLY_HOST = (argVal('--host', '') || '').replace(/^www\./, '').toLowerCase();
const ONLY_CC = (argVal('--cc', '') || '').toUpperCase();
const MIN_FAMILY = Math.max(1, Number(argVal('--min-family', 2)));
const CONCURRENCY = Math.max(1, Math.min(12, Number(argVal('--concurrency', 6))));
const DRY_RUN = argFlag('--dry-run');
const REPLACE = argFlag('--replace');
const EXTRA_PAGES = Math.max(0, Number(argVal('--streams-pages', 2)));

const FETCH_TIMEOUT_MS = 8_000;
const HTML_CAP = 512 * 1024;
const IMAGE_PROBE_BYTES = 64 * 1024;
const LOGO_FIELD_RE = /^  (faviconSource|faviconSourceUrl|faviconLicense|faviconSourceType|faviconOk):/;
const STREAMS_LINK_RE = /stream|webradio|webchannel|kan(a|ä)l|sender|programm/i;
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';

const stationsPath = join(root, 'data/stations.yaml');
let text = readFileSync(stationsPath, 'utf8');
const list = parseYaml(text);
if (!Array.isArray(list)) {
  console.error('scrape-channel-art: stations.yaml is not a list');
  process.exit(1);
}

const catalogById = (() => {
  const raw = JSON.parse(readFileSync(join(root, 'public', 'stations.json'), 'utf8'));
  const arr = Array.isArray(raw) ? raw : raw?.stations ?? [];
  return new Map(arr.filter((s) => s?.id).map((s) => [s.id, s]));
})();

function bareHost(homepage) {
  try {
    return new URL(homepage).hostname.replace(/^www\./, '').replace(/:\d+$/, '').toLowerCase();
  } catch {
    return '';
  }
}

// Merge YAML + catalog into the fields we match on.
const merged = list.map((s) => {
  const cat = catalogById.get(s.id) ?? {};
  const homepage = s.homepage ?? cat.homepage ?? null;
  return {
    id: s.id,
    name: s.name ?? cat.name ?? '',
    shortName: cat.shortName ?? null,
    country: s.country ?? cat.country ?? '',
    homepage,
    host: bareHost(homepage),
    effectiveFavicon: s.favicon ?? cat.favicon ?? null,
    hasYamlFavicon: Boolean(s.favicon),
    bucket: familyBucketKey({ country: s.country ?? cat.country, homepage }),
  };
});

// Group into brand families (only bucketable, non-aggregator stations).
const buckets = new Map();
for (const s of merged) {
  if (!s.bucket) continue;
  if (!buckets.has(s.bucket)) buckets.set(s.bucket, []);
  buckets.get(s.bucket).push(s);
}

// Which buckets to process. --id / --host / --cc narrow the set; otherwise every
// bucket with >= MIN_FAMILY members. Explicit --id/--host lifts the size floor.
const explicit = ONLY_IDS.size > 0 || ONLY_HOST;
const targetBuckets = [...buckets.entries()].filter(([key, members]) => {
  if (ONLY_CC && !key.startsWith(`${ONLY_CC}|`)) return false;
  if (ONLY_HOST && !members.some((m) => m.host === ONLY_HOST)) return false;
  if (ONLY_IDS.size && !members.some((m) => ONLY_IDS.has(m.id))) return false;
  if (!explicit && members.length < MIN_FAMILY) return false;
  return true;
});

console.log(
  `scrape-channel-art: ${targetBuckets.length} family bucket(s) ` +
    `(min-family=${MIN_FAMILY}, concurrency=${CONCURRENCY}${REPLACE ? ', replace' : ', fill-missing'})` +
    (ONLY_HOST ? `, host=${ONLY_HOST}` : '') +
    (ONLY_CC ? `, cc=${ONLY_CC}` : '') +
    (ONLY_IDS.size ? `, ids=${[...ONLY_IDS].join(',')}` : '') +
    (DRY_RUN ? ' — DRY RUN, no YAML writes' : ''),
);

// ─── network ──────────────────────────────────────────────────────────────────

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

async function fetchHtml(url) {
  const res = await fetchWithTimeout(url, { headers: { Accept: 'text/html,application/xhtml+xml' } });
  if (!res.ok) throw new Error(`http ${res.status}`);
  return (await readPrefix(res, HTML_CAP)).toString('utf8');
}

async function verifyImage(url) {
  try {
    let get = await fetchWithTimeout(url, {
      headers: { Range: `bytes=0-${IMAGE_PROBE_BYTES - 1}`, Accept: 'image/*,*/*' },
    });
    if (get.status === 416) get = await fetchWithTimeout(url, { headers: { Accept: 'image/*,*/*' } });
    if (!get.ok && get.status !== 206) return { ok: false, rejectReason: `image-http-${get.status}` };
    const contentType = get.headers.get('content-type') || '';
    const header = parseImageHeader(await readPrefix(get, IMAGE_PROBE_BYTES));
    if (!(contentType.startsWith('image/') || header?.format)) return { ok: false, rejectReason: 'not-image-content' };
    const bucket = bucketForNp(header);
    if (bucket === 'poor' || bucket === 'unknown') {
      return { ok: false, rejectReason: bucket === 'poor' ? 'poor-image-quality' : 'unknown-image-size', width: header?.width, height: header?.height };
    }
    return { ok: true, contentType, format: header?.format, width: header?.width, height: header?.height, bucket };
  } catch (e) {
    return { ok: false, rejectReason: e?.name === 'AbortError' ? 'timeout' : e?.message || 'fetch-failed' };
  }
}

// Collect labelled https images from a family's listing page(s): the shared
// homepage plus a few same-host streams/webradio subpages it links to.
async function collectCandidates(homepage) {
  const seenPages = new Set();
  const out = [];
  const host = bareHost(homepage);

  async function scan(pageUrl) {
    if (seenPages.has(pageUrl) || seenPages.size > EXTRA_PAGES + 1) return [];
    seenPages.add(pageUrl);
    const html = await fetchHtml(pageUrl);
    for (const c of extractLabeledImages(html, pageUrl)) {
      if (c.url.startsWith('https://')) out.push({ ...c, page: pageUrl });
    }
    return html;
  }

  const html = await scan(homepage);
  if (EXTRA_PAGES > 0 && typeof html === 'string') {
    const links = [];
    const re = /<a\s+[^>]*?href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gis;
    let m;
    while ((m = re.exec(html)) !== null && links.length < 40) {
      const hay = `${m[1]} ${m[2].replace(/<[^>]*>/g, ' ')}`;
      if (!STREAMS_LINK_RE.test(hay)) continue;
      try {
        const u = new URL(m[1], homepage);
        if (bareHost(u.href) === host && u.protocol === 'https:') links.push(u.href);
      } catch { /* skip */ }
    }
    for (const link of [...new Set(links)].slice(0, EXTRA_PAGES)) {
      try { await scan(link); } catch { /* subpage optional */ }
    }
  }

  // De-dupe by URL across pages.
  const byUrl = new Map();
  for (const c of out) if (!byUrl.has(c.url)) byUrl.set(c.url, c);
  return [...byUrl.values()];
}

function sameUrl(a, b) {
  if (!a || !b) return false;
  try {
    const x = new URL(a), y = new URL(b);
    x.hash = y.hash = '';
    return x.href === y.href;
  } catch {
    return String(a) === String(b);
  }
}

async function runPool(items, worker, concurrency) {
  const results = [];
  let i = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await worker(items[idx], idx);
    }
  }));
  return results;
}

// ─── process buckets ────────────────────────────────────────────────────────

const counters = { buckets: 0, matched: 0, written: 0, wouldUpgrade: 0, unmatched: 0, ambiguous: 0, rejected: 0, fetchFail: 0 };
const writes = [];
const rows = [];
const t0 = Date.now();

await runPool(targetBuckets, async ([bucketKey, members], idx) => {
  const tag = `[${String(idx + 1).padStart(3)}/${targetBuckets.length}] ${bucketKey}`;
  const homepage = members.find((m) => m.homepage)?.homepage;
  if (!homepage) return;
  let candidates;
  try {
    candidates = await collectCandidates(homepage);
  } catch (e) {
    counters.fetchFail++;
    rows.push({ bucket: bucketKey, error: e?.message || String(e) });
    console.log(`${tag}  !!  fetch failed: ${e?.message || e}`);
    return;
  }
  counters.buckets++;

  const { matches, unmatched, ambiguous } = matchChannelArt({ members, candidates });
  counters.unmatched += unmatched.length;
  counters.ambiguous += ambiguous.length;

  for (const mt of matches) {
    counters.matched++;
    const station = members.find((m) => m.id === mt.id);
    const filtered = ONLY_IDS.size > 0 && !ONLY_IDS.has(mt.id);
    if (filtered) continue;
    if (isLocalLogo(station.effectiveFavicon)) continue; // never touch curated bundles
    if (sameUrl(station.effectiveFavicon, mt.url)) continue;
    if (station.effectiveFavicon && !REPLACE) {
      counters.wouldUpgrade++;
      rows.push({ bucket: bucketKey, id: mt.id, action: 'would-upgrade', to: mt.url, label: mt.label, score: mt.score });
      console.log(`${tag}  ~~  ${mt.id} would upgrade -> ${mt.label} (use --replace)`);
      continue;
    }
    const verified = await verifyImage(mt.url);
    if (!verified.ok) {
      counters.rejected++;
      rows.push({ bucket: bucketKey, id: mt.id, action: 'rejected', to: mt.url, reason: verified.rejectReason });
      console.log(`${tag}  xx  ${mt.id} ${mt.label} rejected: ${verified.rejectReason}`);
      continue;
    }
    const action = station.hasYamlFavicon ? 'replace' : 'insert';
    writes.push({ id: mt.id, url: mt.url, action });
    rows.push({ bucket: bucketKey, id: mt.id, action, to: mt.url, label: mt.label, score: mt.score, exact: mt.exact, page: candidates.find((c) => c.url === mt.url)?.page });
    console.log(`${tag}  ${action === 'replace' ? 'REPL' : 'OK  '} ${mt.id} <- ${mt.label}  ${verified.width}x${verified.height}`);
  }
  for (const id of unmatched) rows.push({ bucket: bucketKey, id, action: 'unmatched' });
  for (const a of ambiguous) rows.push({ bucket: bucketKey, id: a.id, action: 'ambiguous', label: a.label, score: a.score });
}, CONCURRENCY);

const wallS = ((Date.now() - t0) / 1000).toFixed(1);
console.log(
  `\nscrape-channel-art done in ${wallS}s — matched: ${counters.matched}, ` +
    `to-write: ${writes.length}, would-upgrade: ${counters.wouldUpgrade}, ` +
    `unmatched: ${counters.unmatched}, ambiguous: ${counters.ambiguous}, ` +
    `rejected: ${counters.rejected}, fetch-failed: ${counters.fetchFail}`,
);

mkdirSync(join(root, '.cache'), { recursive: true });
writeFileSync(
  join(root, '.cache/channel-art-report.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), dryRun: DRY_RUN, replace: REPLACE, counters, rows }, null, 2) + '\n',
);
console.log('run report: .cache/channel-art-report.json');

// ─── write YAML (surgical insert/replace, mirrors scrape-logos) ───────────────

function quoteYaml(value) {
  const s = String(value);
  return /[:#&*!|>'"%@`,[\]{}]/.test(s) ? JSON.stringify(s) : s;
}
function logoBlock(url) {
  return (
    `  favicon: ${quoteYaml(url)}\n` +
    '  faviconSource: broadcaster-site\n' +
    '  faviconSourceType: cdn\n' +
    '  faviconLicense: broadcaster-implicit\n'
  );
}
function metadataBlockEnd(src, start) {
  let end = start;
  while (end < src.length) {
    const lineEnd = src.indexOf('\n', end);
    const line = src.slice(end, lineEnd === -1 ? src.length : lineEnd);
    if (!LOGO_FIELD_RE.test(line)) break;
    end = lineEnd === -1 ? src.length : lineEnd + 1;
  }
  return end;
}

if (DRY_RUN) {
  console.log('\n--dry-run: not writing data/stations.yaml');
  process.exit(0);
}
if (writes.length === 0) {
  console.log('\nnothing to write');
  process.exit(0);
}

let inserted = 0, replaced = 0, missLine = 0, missingFav = 0;
for (const w of writes) {
  const idLine = `- id: ${w.id}\n`;
  const idIdx = text.indexOf(idLine);
  if (idIdx === -1) { missLine++; console.warn(`  ! couldn't locate id line for ${w.id}`); continue; }
  const insertAt = idIdx + idLine.length;
  const block = logoBlock(w.url);
  if (w.action === 'replace') {
    let p = insertAt, done = false;
    while (p < text.length) {
      const lineEnd = text.indexOf('\n', p);
      const line = text.slice(p, lineEnd === -1 ? text.length : lineEnd);
      if (line.startsWith('- id:')) break;
      if (line.startsWith('  favicon:')) {
        const next = lineEnd === -1 ? text.length : lineEnd + 1;
        text = text.slice(0, p) + block + text.slice(metadataBlockEnd(text, next));
        replaced++; done = true; break;
      }
      if (lineEnd === -1) break;
      p = lineEnd + 1;
    }
    if (!done) missingFav++;
  } else {
    text = text.slice(0, insertAt) + block + text.slice(insertAt);
    inserted++;
  }
}
writeFileSync(stationsPath, text);
console.log(
  `\nstations.yaml updated: ${inserted} inserted, ${replaced} replaced` +
    (missLine ? `, ${missLine} id line(s) missing` : '') +
    (missingFav ? `, ${missingFav} favicon line(s) missing for replace` : ''),
);
