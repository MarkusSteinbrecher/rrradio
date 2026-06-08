#!/usr/bin/env node
/**
 * Probe the real pixel dimensions / bytes / format of every station logo and
 * emit `public/station-logo-quality.json`. Drives the NP-quality donut and
 * the curation queue for "logo looks bad on the NP page" — see the
 * dashboard's tracker-summary row.
 *
 *   npm run probe-logos                 # local-only (cheap, no network)
 *   npm run probe-logos -- --remote     # also probe https:// favicons
 *   npm run probe-logos -- --remote --concurrency 12 --timeout 6000
 *   npm run probe-logos -- --only id1,id2
 *   npm run probe-logos -- --limit 200  # for quick sanity passes
 *   npm run probe-logos -- --no-cache   # re-probe everything
 *
 * Cache: previous results are kept when the favicon URL is unchanged AND
 * the previous probe didn't error — keeps incremental runs fast.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { bucketForNp, parseImageHeader } from './lib/image-header.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const CATALOG = path.join(PUBLIC, 'stations.json');
const OUT = path.join(PUBLIC, 'station-logo-quality.json');

const PROBE_BYTES = 64 * 1024; // 64 KB header window — covers every format

// A real browser UA. Without it, Wikimedia (upload.wikimedia.org) and other
// UA-gating CDNs return 403 to the prober, which made every Wikimedia-hosted
// logo look broken and hid genuinely dead logos in the noise. Matches the UA
// scrape-logos.mjs / wiki-logos.mjs already send.
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';

const args = parseArgs(process.argv.slice(2));

function parseArgs(argv) {
  const out = {
    remote: false,
    concurrency: 8,
    timeout: 8000,
    cache: true,
    limit: 0,
    only: new Set(),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--remote') out.remote = true;
    else if (a === '--no-cache') out.cache = false;
    else if (a === '--concurrency') out.concurrency = Number(argv[++i]);
    else if (a === '--timeout') out.timeout = Number(argv[++i]);
    else if (a === '--limit') out.limit = Number(argv[++i]);
    else if (a === '--only') out.only = new Set((argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean));
    else if (a === '--help' || a === '-h') {
      console.log('usage: probe-logo-sizes [--remote] [--concurrency N] [--timeout MS] [--limit N] [--only id1,id2] [--no-cache]');
      process.exit(0);
    } else {
      console.error(`unknown arg: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

function loadCatalog() {
  const raw = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
  return raw.stations ?? [];
}

function loadCache() {
  if (!args.cache) return new Map();
  if (!fs.existsSync(OUT)) return new Map();
  try {
    const raw = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    const map = new Map();
    for (const s of raw.stations ?? []) map.set(s.id, s);
    return map;
  } catch (err) {
    console.warn(`cache read failed (${err.message}) — re-probing all`);
    return new Map();
  }
}

async function probeLocal(favicon) {
  const filePath = path.join(PUBLIC, favicon);
  const stat = fs.statSync(filePath);
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(Math.min(PROBE_BYTES, stat.size));
    fs.readSync(fd, buf, 0, buf.length, 0);
    const header = parseImageHeader(buf);
    return { ...(header ?? {}), bytes: stat.size, source: 'local' };
  } finally {
    fs.closeSync(fd);
  }
}

async function probeRemote(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort('timeout'), args.timeout);
  try {
    // First try a Range request — most CDNs honour it and we save bytes.
    let res = await fetch(url, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': UA, Range: `bytes=0-${PROBE_BYTES - 1}`, Accept: 'image/*,*/*' },
    });
    // 416 — server refused the range; retry with a plain GET capped by AbortController.
    if (res.status === 416) {
      res = await fetch(url, { signal: ctl.signal, redirect: 'follow', headers: { 'User-Agent': UA, Accept: 'image/*,*/*' } });
    }
    if (!res.ok && res.status !== 206) {
      return { error: `HTTP ${res.status}`, source: 'remote' };
    }
    // Read at most PROBE_BYTES so an unbounded body doesn't run away.
    const reader = res.body?.getReader();
    if (!reader) {
      const buf = new Uint8Array(await res.arrayBuffer());
      return finishRemote(buf, res);
    }
    const chunks = [];
    let total = 0;
    while (total < PROBE_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
      if (total >= PROBE_BYTES) {
        try { await reader.cancel(); } catch { /* ignore */ }
        break;
      }
    }
    const buf = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { buf.set(c.subarray(0, Math.min(c.length, buf.length - off)), off); off += c.length; }
    return finishRemote(buf, res);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: msg.includes('aborted') || msg.includes('timeout') ? 'timeout' : msg, source: 'remote' };
  } finally {
    clearTimeout(timer);
  }
}

function finishRemote(buf, res) {
  const header = parseImageHeader(buf);
  const cl = res.headers.get('content-length');
  // For Range responses (206), prefer Content-Range total when present.
  const cr = res.headers.get('content-range'); // "bytes 0-65535/213411"
  let bytes;
  const m = cr ? /\/(\d+)$/.exec(cr) : null;
  if (m) bytes = Number(m[1]);
  else if (cl && res.status !== 206) bytes = Number(cl);
  return { ...(header ?? {}), bytes, source: 'remote' };
}

async function probeStation(station, cache) {
  const fav = station.favicon;
  if (!fav) return null;
  const cached = cache.get(station.id);
  if (cached && cached.favicon === fav && !cached.error) {
    return cached;
  }
  if (/^stations\//.test(fav)) {
    try {
      const probe = await probeLocal(fav);
      return finalise(station, fav, probe);
    } catch (err) {
      return finalise(station, fav, { error: err.message, source: 'local' });
    }
  }
  if (/^https:/i.test(fav)) {
    if (!args.remote) {
      // Preserve any prior remote entry so a local-only pass doesn't drop data.
      return cached ?? null;
    }
    const probe = await probeRemote(fav);
    return finalise(station, fav, probe);
  }
  // http:// (CSP-blocked) and weird schemes — skip but record.
  return finalise(station, fav, { error: 'unsupported scheme', source: 'skipped' });
}

function finalise(station, favicon, probe) {
  const { format, width, height, bytes, error, source } = probe;
  const bucket = bucketForNp(probe.error ? null : probe);
  return {
    id: station.id,
    favicon,
    source,
    format,
    width,
    height,
    bytes,
    aspect: width && height ? Number((width / height).toFixed(3)) : undefined,
    bucket,
    error,
  };
}

async function runPool(items, worker, concurrency) {
  let next = 0;
  let done = 0;
  const total = items.length;
  const out = new Array(total);
  const lanes = Array.from({ length: Math.min(concurrency, total) }, async () => {
    while (true) {
      const i = next++;
      if (i >= total) return;
      out[i] = await worker(items[i], i);
      done++;
      if (done % 50 === 0 || done === total) {
        process.stderr.write(`\r  probed ${done}/${total}`);
      }
    }
  });
  await Promise.all(lanes);
  process.stderr.write('\n');
  return out;
}

async function main() {
  const catalog = loadCatalog();
  const cache = loadCache();

  let targets = catalog.filter((s) => s.favicon);
  if (args.only.size > 0) targets = targets.filter((s) => args.only.has(s.id));
  if (args.limit > 0) targets = targets.slice(0, args.limit);

  console.log(`probing ${targets.length} stations · remote=${args.remote} concurrency=${args.concurrency} cache=${args.cache}`);
  const results = await runPool(targets, (s) => probeStation(s, cache), args.concurrency);
  const entries = results.filter(Boolean);

  // Carry over cache entries for stations we didn't touch (e.g. local-only
  // pass keeping previously-probed remote rows alive) — but drop any cached
  // entries for stations no longer in the favicon-bearing target set, so
  // blocked / removed stations don't linger with stale data.
  const seen = new Set(entries.map((e) => e.id));
  const targetIds = new Set(targets.map((s) => s.id));
  // When --only / --limit narrows the target set we'd otherwise mass-evict
  // cached entries — keep cached rows for any station that still has a
  // favicon in the full catalog.
  const faviconHavingIds = new Set(catalog.filter((s) => s.favicon).map((s) => s.id));
  for (const [id, prev] of cache) {
    if (seen.has(id)) continue;
    if (!targetIds.has(id) && !faviconHavingIds.has(id)) continue;
    entries.push(prev);
  }

  const counts = {};
  for (const e of entries) counts[e.bucket] = (counts[e.bucket] ?? 0) + 1;
  console.log('buckets:', counts);

  const payload = { generatedAt: new Date().toISOString(), stations: entries };
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2));
  console.log(`wrote ${entries.length} entries → ${path.relative(ROOT, OUT)}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
