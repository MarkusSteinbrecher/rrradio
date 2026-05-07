#!/usr/bin/env node
/**
 * Scrape favicons / og:images from broadcaster homepages for stations
 * that have no `favicon` field yet. Pure deterministic — no LLM, no
 * external API beyond the broadcaster's own homepage.
 *
 *   node tools/scrape-logos.mjs                # full sweep
 *   node tools/scrape-logos.mjs --limit 50     # first 50 (validation run)
 *   node tools/scrape-logos.mjs --limit 50 --dry-run   # don't mutate yaml
 *   node tools/scrape-logos.mjs --concurrency 12       # default 8
 *
 * Per station:
 *   1. GET the station's `homepage` HTML (5s timeout, real-ish UA).
 *   2. Parse <link rel="icon|apple-touch-icon|...">, <meta property="og:image">,
 *      <meta name="twitter:image"> tags.
 *   3. Resolve relative URLs against the homepage.
 *   4. Drop non-HTTPS candidates (mixed-content blocks them in the player).
 *   5. Score & pick the best candidate (apple-touch-icon > og:image > sized icon > plain icon).
 *   6. HEAD the chosen URL — must return 2xx + content-type starting with `image/`.
 *   7. Surgical YAML insert: `  favicon: <url>` after the row's `id:` line.
 *
 * Read-only on the network side except for the final writeFileSync.
 * Mirrors the surgical-insert pattern in tools/wire-metadata.mjs so the
 * existing hand-formatted YAML structure stays intact.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// ─── args ──────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const argFlag = (name) => argv.includes(name);
const argVal = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const LIMIT = Number(argVal('--limit', Infinity));
const CONCURRENCY = Math.max(1, Math.min(20, Number(argVal('--concurrency', 8))));
const DRY_RUN = argFlag('--dry-run');
const FETCH_TIMEOUT_MS = 8_000;
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';

// ─── load YAML ─────────────────────────────────────────────────────
const stationsPath = join(root, 'data/stations.yaml');
let text = readFileSync(stationsPath, 'utf8');
const list = parseYaml(text);
if (!Array.isArray(list)) {
  console.error('scrape-logos: stations.yaml is not a list');
  process.exit(1);
}

const candidates = list
  .filter((s) => s && typeof s.id === 'string' && !s.favicon && s.homepage)
  .slice(0, Number.isFinite(LIMIT) ? LIMIT : list.length);

console.log(
  `scrape-logos: ${candidates.length} candidate(s) (no favicon, has homepage)` +
    (DRY_RUN ? ' — DRY RUN, no YAML writes' : '') +
    ` — concurrency ${CONCURRENCY}`,
);

// ─── HTML parsing ──────────────────────────────────────────────────
function parseAttrs(raw) {
  // Tolerant attribute extractor for <link>/<meta>. Handles single quotes,
  // double quotes, unquoted, and attribute-name-only forms. Not a full
  // HTML parser — we only need rel/href/sizes/property/name/content.
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

function parseSize(sizes) {
  // "180x180" / "32x32 16x16" / "any" → numeric max-edge or 0.
  if (!sizes) return 0;
  const parts = String(sizes).toLowerCase().split(/\s+/);
  let max = 0;
  for (const p of parts) {
    if (p === 'any') return 1024;
    const m = /^(\d+)x(\d+)$/.exec(p);
    if (m) max = Math.max(max, Number(m[1]), Number(m[2]));
  }
  return max;
}

function scoreCandidate(c) {
  // Higher is better. Apple touch icons are usually 180×180 PNGs and
  // the closest thing broadcasters publish to a "real" logo. og:image
  // is similarly intentional content. Mask icons (Safari pinned tab)
  // are typically monochrome SVGs — usable but not ideal.
  let base;
  switch (c.rel) {
    case 'apple-touch-icon-precomposed': base = 1000; break;
    case 'apple-touch-icon': base = 950; break;
    case 'og:image':
    case 'og:image:secure_url': base = 800; break;
    case 'twitter:image':
    case 'twitter:image:src': base = 700; break;
    case 'mask-icon': base = 200; break;
    case 'shortcut icon':
    case 'icon': base = 400; break;
    default: base = 100;
  }
  base += Math.min(c.size, 512); // up to +512 for explicit larger sizes
  if (c.url.startsWith('https://')) base += 50;
  return base;
}

function extractCandidates(html, baseUrl) {
  const out = [];

  // <link …> tags
  const linkRe = /<link\s+([^>]*?)\/?>/gi;
  let m;
  while ((m = linkRe.exec(html)) !== null) {
    const a = parseAttrs(m[1]);
    if (!a.rel || !a.href) continue;
    const rel = a.rel.toLowerCase().trim();
    if (!/icon/.test(rel)) continue;
    out.push({ rel, url: a.href, size: parseSize(a.sizes) });
  }

  // <meta property="og:image" content="…"> and twitter variants
  const metaRe = /<meta\s+([^>]*?)\/?>/gi;
  while ((m = metaRe.exec(html)) !== null) {
    const a = parseAttrs(m[1]);
    const key = (a.property || a.name || '').toLowerCase().trim();
    if (!a.content) continue;
    if (
      key === 'og:image' ||
      key === 'og:image:secure_url' ||
      key === 'twitter:image' ||
      key === 'twitter:image:src'
    ) {
      out.push({ rel: key, url: a.content, size: 0 });
    }
  }

  // Resolve relative URLs against the homepage. Drop unparseable.
  return out
    .map((c) => {
      try {
        c.url = new URL(c.url, baseUrl).href;
        return c;
      } catch {
        return null;
      }
    })
    .filter((c) => c && c.url);
}

// ─── network ───────────────────────────────────────────────────────
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
  // Cap at 256KB — favicons are always in <head>; no need for the body.
  const reader = res.body?.getReader();
  if (!reader) return await res.text();
  const chunks = [];
  let total = 0;
  while (total < 256 * 1024) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  try { reader.cancel(); } catch { /* fine */ }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

async function verifyImage(url) {
  // Try HEAD first; some CDNs don't allow it, fall back to ranged GET.
  try {
    const head = await fetchWithTimeout(url, { method: 'HEAD' });
    if (head.ok && (head.headers.get('content-type') ?? '').startsWith('image/')) {
      return true;
    }
  } catch { /* fall through */ }
  try {
    const get = await fetchWithTimeout(url, { headers: { Range: 'bytes=0-15' } });
    return get.ok && (get.headers.get('content-type') ?? '').startsWith('image/');
  } catch {
    return false;
  }
}

// ─── per-station pipeline ──────────────────────────────────────────
async function discover(station) {
  const html = await fetchHomepage(station.homepage);
  const cands = extractCandidates(html, station.homepage)
    .filter((c) => c.url.startsWith('https://')); // mixed-content rule
  if (cands.length === 0) return { ok: false, reason: 'no-https-candidates' };
  cands.sort((a, b) => scoreCandidate(b) - scoreCandidate(a));
  for (const c of cands.slice(0, 5)) {
    if (await verifyImage(c.url)) return { ok: true, url: c.url, picked: c };
  }
  return { ok: false, reason: 'no-verifiable-image' };
}

// ─── concurrency runner ────────────────────────────────────────────
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

const counters = { ok: 0, noCands: 0, noImage: 0, fetchFail: 0 };
const writes = []; // { id, url } pairs

const t0 = Date.now();
await runPool(
  candidates,
  async (s, idx) => {
    const tag = `[${String(idx + 1).padStart(4)}/${candidates.length}] ${s.id}`;
    try {
      const r = await discover(s);
      if (r.ok) {
        counters.ok++;
        writes.push({ id: s.id, url: r.url });
        console.log(`${tag}  OK  ${r.picked.rel} ${r.url}`);
      } else if (r.reason === 'no-https-candidates') {
        counters.noCands++;
        console.log(`${tag}  --  no https candidates`);
      } else {
        counters.noImage++;
        console.log(`${tag}  --  no verifiable image`);
      }
    } catch (err) {
      counters.fetchFail++;
      const msg = err?.name === 'AbortError' ? 'timeout' : err?.message || String(err);
      console.log(`${tag}  !!  fetch failed: ${msg}`);
    }
  },
  CONCURRENCY,
);
const wallS = ((Date.now() - t0) / 1000).toFixed(1);

console.log('');
console.log(
  `scrape-logos done in ${wallS}s — ` +
    `OK: ${counters.ok}, no-https-cands: ${counters.noCands}, ` +
    `no-verifiable-image: ${counters.noImage}, fetch-failed: ${counters.fetchFail}`,
);
const hitRate = candidates.length > 0 ? ((counters.ok / candidates.length) * 100).toFixed(1) : '0';
console.log(`hit rate: ${hitRate}% (${counters.ok}/${candidates.length})`);

// ─── YAML write (surgical insert) ──────────────────────────────────
if (DRY_RUN) {
  console.log('\n--dry-run: not writing data/stations.yaml');
  process.exit(0);
}
if (writes.length === 0) {
  console.log('\nnothing to write');
  process.exit(0);
}

let inserted = 0;
let missLine = 0;
for (const w of writes) {
  const idLine = `- id: ${w.id}\n`;
  const idx = text.indexOf(idLine);
  if (idx === -1) {
    missLine++;
    console.warn(`  ! couldn't locate id line for ${w.id}`);
    continue;
  }
  const insertAt = idx + idLine.length;
  // Quote the URL only when it contains YAML-special chars; the URL
  // formats RB and broadcasters emit don't normally need it, but the
  // insert is conservative because a stray `:` or `#` would corrupt
  // the file silently.
  const quoted = /[:#&*!|>'"%@`,\[\]{}]/.test(w.url) ? JSON.stringify(w.url) : w.url;
  text = text.slice(0, insertAt) + `  favicon: ${quoted}\n` + text.slice(insertAt);
  inserted++;
}

writeFileSync(stationsPath, text);
console.log(
  `\nstations.yaml updated: ${inserted} favicon line(s) inserted` +
    (missLine > 0 ? `, ${missLine} id line(s) missing` : ''),
);
