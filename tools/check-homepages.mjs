#!/usr/bin/env node
/**
 * Homepage liveness gate (issue #470).
 *
 * `check-catalog.mjs` validates that `homepage` is a syntactically valid
 * http(s) URL, but never fetches it — so a dead homepage sails through. That
 * bites twice: the link is broken for users, and it silently disables
 * `scrape-logos`, which derives a broadcaster logo *from* the homepage. The
 * SRF family (#469) had all six `/audio/<slug>` homepages 404-ing for exactly
 * this reason.
 *
 * This tool fetches each publishable station's homepage (deduped by URL),
 * follows redirects with a real browser User-Agent, and classifies the result.
 * It is a PERIODIC / CURATION gate, not a per-build CI check: ~18.5k unique
 * homepages means a full run is a real network job. Non-blocking by default;
 * `--strict` exits non-zero when any homepage is genuinely dead (4xx).
 *
 *   npm run check-homepages -- --cc CH            # one country
 *   npm run check-homepages -- --only id1,id2     # specific stations
 *   npm run check-homepages -- --cc DE --strict   # gate a country
 *   npm run check-homepages -- --limit 500        # quick sample
 *   npm run check-homepages -- --force            # ignore cache, recheck all
 *
 * Reads `public/stations.json`. Caches results in `.cache/homepage-status.json`
 * (gitignored); cached rows younger than `--stale-days` (default 7) are reused.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CLASS, STRICT_FAIL, classifyStatus, classifyError, isRetryable } from './lib/homepage-status.mjs';
import { loadHealth, saveHealth, applyFacet } from './lib/health-record.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CATALOG = path.join(ROOT, 'public', 'stations.json');
const CACHE_DIR = path.join(ROOT, '.cache');
const OUT = path.join(CACHE_DIR, 'homepage-status.json');

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';

const RETRIES = 2; // extra attempts on transient failures (5xx / timeout / 429)

const args = parseArgs(process.argv.slice(2));

function parseArgs(argv) {
  const out = {
    cc: null,
    only: new Set(),
    limit: 0,
    concurrency: 16,
    timeout: 10000,
    staleDays: 7,
    cache: true,
    strict: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cc') out.cc = String(argv[++i] ?? '').toUpperCase();
    else if (a === '--only' || a === '--id') for (const id of (argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean)) out.only.add(id);
    else if (a === '--limit') out.limit = Number(argv[++i]) || 0;
    else if (a === '--concurrency') out.concurrency = Math.max(1, Number(argv[++i]) || 16);
    else if (a === '--timeout') out.timeout = Math.max(1000, Number(argv[++i]) || 10000);
    else if (a === '--stale-days') out.staleDays = Math.max(0, Number(argv[++i]) || 0);
    else if (a === '--no-cache' || a === '--force') out.cache = false;
    else if (a === '--strict') out.strict = true;
    else if (a === '--json') out.json = true;
    else if (a === '--help' || a === '-h') {
      console.log('usage: check-homepages [--cc XX] [--only id,…] [--limit N] [--concurrency N] [--timeout MS] [--stale-days N] [--no-cache|--force] [--strict] [--json]');
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
  if (!args.cache || !fs.existsSync(OUT)) return new Map();
  try {
    const raw = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    const map = new Map();
    for (const [url, row] of Object.entries(raw.urls ?? {})) map.set(url, row);
    return map;
  } catch {
    return new Map();
  }
}

function isFresh(row, nowMs) {
  if (!row?.checkedAt) return false;
  const age = nowMs - Date.parse(row.checkedAt);
  return Number.isFinite(age) && age >= 0 && age < args.staleDays * 86400_000;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function probeUrl(url) {
  for (let attempt = 0; ; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), args.timeout);
    try {
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: ctl.signal,
        headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*' },
      });
      clearTimeout(timer);
      try { await res.body?.cancel(); } catch { /* already consumed */ }
      const klass = classifyStatus(res.status);
      if (isRetryable(klass, res.status) && attempt < RETRIES) {
        await sleep(300 * (attempt + 1) + Math.floor(Math.random() * 200));
        continue;
      }
      const row = { status: res.status, class: klass, checkedAt: new Date().toISOString() };
      if (res.redirected && res.url && res.url !== url) row.finalUrl = res.url;
      return row;
    } catch (e) {
      clearTimeout(timer);
      const reason = classifyError(e);
      if (attempt < RETRIES) {
        await sleep(300 * (attempt + 1) + Math.floor(Math.random() * 200));
        continue;
      }
      return { status: 0, class: CLASS.ERROR, reason, checkedAt: new Date().toISOString() };
    }
  }
}

async function runPool(items, worker, concurrency) {
  let next = 0;
  let done = 0;
  const total = items.length;
  const lanes = Array.from({ length: Math.min(concurrency, total) }, async () => {
    while (true) {
      const i = next++;
      if (i >= total) return;
      await worker(items[i], i);
      done++;
      if (done % 25 === 0 || done === total) process.stderr.write(`\r  checked ${done}/${total}`);
    }
  });
  await Promise.all(lanes);
  if (total) process.stderr.write('\n');
}

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

async function main() {
  const catalog = loadCatalog();
  const cache = loadCache();
  const nowMs = Date.now();

  let stations = catalog.filter((s) => s.homepage);
  if (args.cc) stations = stations.filter((s) => (s.country ?? '').toUpperCase() === args.cc);
  if (args.only.size) stations = stations.filter((s) => args.only.has(s.id));
  if (args.limit > 0) stations = stations.slice(0, args.limit);

  // Dedupe: one probe per unique homepage URL, mapped back to every station.
  const byUrl = new Map();
  for (const s of stations) {
    if (!byUrl.has(s.homepage)) byUrl.set(s.homepage, []);
    byUrl.get(s.homepage).push(s);
  }
  const urls = [...byUrl.keys()];

  const results = new Map(); // url -> row
  const toProbe = [];
  for (const url of urls) {
    const cached = cache.get(url);
    if (isFresh(cached, nowMs)) results.set(url, cached);
    else toProbe.push(url);
  }

  console.log(
    `check-homepages: ${stations.length} station(s) · ${urls.length} unique homepage(s) · ` +
      `${results.size} cached · ${toProbe.length} to probe` +
      (args.cc ? ` · cc=${args.cc}` : '') + (args.strict ? ' · STRICT' : ''),
  );

  await runPool(toProbe, async (url) => { results.set(url, await probeUrl(url)); }, args.concurrency);

  // Build station-level rows + class tallies.
  const stationRows = [];
  const classCounts = {};
  const deadByCountry = {};
  for (const s of stations) {
    const r = results.get(s.homepage);
    if (!r) continue;
    classCounts[r.class] = (classCounts[r.class] ?? 0) + 1;
    const row = { id: s.id, name: s.name, country: s.country ?? '', homepage: s.homepage, status: r.status, class: r.class };
    if (r.reason) row.reason = r.reason;
    if (r.finalUrl) row.finalUrl = r.finalUrl;
    stationRows.push(row);
    if (r.class === CLASS.DEAD) deadByCountry[row.country] = (deadByCountry[row.country] ?? 0) + 1;
  }

  // Persist a fresh cache (merge: keep untouched cached URLs so big runs are
  // resumable across country batches) plus a curation-facing stations list.
  const urlsOut = {};
  for (const [url, row] of cache) urlsOut[url] = row; // carry over prior runs
  for (const [url, row] of results) urlsOut[url] = row; // overwrite with this run
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const generatedAt = new Date().toISOString();
  fs.writeFileSync(
    OUT,
    JSON.stringify({ generatedAt, staleDays: args.staleDays, stations: stationRows, urls: urlsOut }, null, 2),
  );

  // Mirror into the unified health record (docs/station-health.md) so the
  // verdicts outlive this gitignored cache. ok → ok, blocked/redirect → warn,
  // dead / server-error / network error → bad; no homepage at all → na.
  {
    const VERDICT_BY_CLASS = {
      [CLASS.OK]: 'ok',
      [CLASS.BLOCKED]: 'warn',
      [CLASS.REDIRECT]: 'warn',
      [CLASS.DEAD]: 'bad',
      [CLASS.SERVER_ERROR]: 'bad',
      [CLASS.ERROR]: 'bad',
    };
    const updates = new Map();
    for (const r of stationRows) {
      const detail = r.class === CLASS.ERROR ? (r.reason ?? 'network') : r.class === CLASS.OK ? null : `HTTP ${r.status}`;
      updates.set(r.id, detail == null ? { v: VERDICT_BY_CLASS[r.class] } : { v: VERDICT_BY_CLASS[r.class], d: detail });
    }
    const fullSweep = !args.cc && args.only.size === 0 && !(args.limit > 0);
    if (fullSweep) {
      for (const s of catalog) {
        if (!s.homepage) updates.set(s.id, { v: 'na', d: 'no homepage' });
      }
    }
    const record = loadHealth(ROOT);
    applyFacet(record, 'homepage', updates, {
      tool: 'check-homepages',
      scope: fullSweep ? 'full' : args.cc ? `cc:${args.cc}` : 'partial',
      at: generatedAt,
    });
    saveHealth(ROOT, record);
    console.log('  updated public/station-health.json (homepage facet)');
  }

  if (args.json) {
    console.log(JSON.stringify(stationRows.filter((r) => r.class !== CLASS.OK), null, 2));
  } else {
    const order = [CLASS.OK, CLASS.DEAD, CLASS.BLOCKED, CLASS.SERVER_ERROR, CLASS.ERROR, CLASS.REDIRECT];
    console.log('  ' + order.filter((c) => classCounts[c]).map((c) => `${c} ${classCounts[c]}`).join(' · '));

    const dead = stationRows.filter((r) => r.class === CLASS.DEAD).sort((a, b) => (a.country + a.id).localeCompare(b.country + b.id));
    if (dead.length) {
      console.log(`\n  DEAD homepages (${dead.length}) — these break logo scraping:`);
      for (const r of dead.slice(0, 60)) {
        console.log(`    ${pad(r.country, 3)} ${pad(r.id, 34)} ${r.status}  ${r.homepage}`);
      }
      if (dead.length > 60) console.log(`    …and ${dead.length - 60} more (see .cache/homepage-status.json)`);
      const topCc = Object.entries(deadByCountry).sort((a, b) => b[1] - a[1]).slice(0, 12);
      if (topCc.length > 1) console.log('\n  dead by country: ' + topCc.map(([c, n]) => `${c}:${n}`).join(' '));
    }
    console.log(`\n  report → ${path.relative(ROOT, OUT)}`);
  }

  const strictFails = stationRows.filter((r) => STRICT_FAIL.has(r.class)).length;
  if (args.strict && strictFails > 0) {
    console.error(`check-homepages: ${strictFails} dead homepage(s) — strict gate failed`);
    process.exit(1);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
