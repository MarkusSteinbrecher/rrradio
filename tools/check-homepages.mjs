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
 *
 * Daily loop (ADR 002 — station-probe.yml), one shard of the probe plan:
 *
 *   node tools/check-homepages.mjs --plan plan.json --shard 0 \
 *        --observations obs-hp-0.ndjson --no-record --budget 360
 *
 * Probes the homepages of that shard's published targets (same tiering as
 * the stream probe), appends one `homepage` observation row per station and
 * leaves the record to derive-health. No cache in this mode — every row is a
 * fresh measurement. `--budget` (seconds) stops starting new probes so the
 * step ends with the rows it has instead of being killed by the job timeout.
 *
 * Politeness: one probe per unique URL, HEAD before GET, never two requests
 * in flight to the same host, bounded concurrency.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CLASS,
  STRICT_FAIL,
  homepageVerdict,
  hostOf,
  probeHomepage,
  runPolitePool,
  toHomepageObservation,
} from './lib/homepage-status.mjs';
import { appendObservations } from './lib/observations.mjs';
import { loadHealth, saveHealth, applyFacet } from './lib/health-record.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CATALOG = path.join(ROOT, 'public', 'stations.json');
const CACHE_DIR = path.join(ROOT, '.cache');
const OUT = path.join(CACHE_DIR, 'homepage-status.json');

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';

const PUBLISHABLE = new Set(['working', 'stream-only', 'icy-only']);
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
    plan: null,
    shard: null,
    observations: null,
    record: true,
    budget: 0,
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
    else if (a === '--plan') out.plan = String(argv[++i] ?? '');
    else if (a === '--shard') out.shard = Number(argv[++i]);
    else if (a === '--observations') out.observations = String(argv[++i] ?? '');
    else if (a === '--no-record') out.record = false;
    else if (a === '--budget') out.budget = Math.max(0, Number(argv[++i]) || 0);
    else if (a === '--help' || a === '-h') {
      console.log('usage: check-homepages [--cc XX] [--only id,…] [--limit N] [--concurrency N] [--timeout MS] [--stale-days N] [--no-cache|--force] [--strict] [--json]');
      console.log('                       [--plan plan.json --shard i] [--observations path.ndjson] [--no-record] [--budget SECONDS]');
      process.exit(0);
    } else {
      console.error(`unknown arg: ${a}`);
      process.exit(2);
    }
  }
  if ((out.plan === null) !== (out.shard === null)) {
    console.error('check-homepages: --plan and --shard go together');
    process.exit(2);
  }
  if (out.shard !== null && (!Number.isInteger(out.shard) || out.shard < 0)) {
    console.error('check-homepages: --shard must be a non-negative integer');
    process.exit(2);
  }
  if (out.plan && (out.cc || out.only.size || out.limit > 0)) {
    console.error('check-homepages: --plan/--shard cannot be combined with --cc/--only/--limit');
    process.exit(2);
  }
  // A plan run is a fresh measurement for the observation log, never a
  // replay of a local cache.
  if (out.plan) out.cache = false;
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

async function probeUrl(url) {
  const row = await probeHomepage(url, {
    fetch,
    timeout: args.timeout,
    retries: RETRIES,
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*' },
  });
  return { ...row, checkedAt: new Date().toISOString() };
}

/** Pool with a per-host lock and an optional deadline (see runPolitePool). */
async function runPool(items, worker, concurrency) {
  let done = 0;
  const total = items.length;
  const deadline = args.budget > 0 ? Date.now() + args.budget * 1000 : null;
  const res = await runPolitePool(
    items,
    hostOf,
    async (item) => {
      await worker(item);
      done += 1;
      if (!args.plan && (done % 25 === 0 || done === total)) process.stderr.write(`\r  checked ${done}/${total}`);
    },
    { concurrency, deadline },
  );
  if (total && !args.plan) process.stderr.write('\n');
  if (res.skipped.length) console.log(`  budget of ${args.budget}s reached — ${res.skipped.length} URL(s) left unprobed`);
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
  if (args.plan) {
    // Same targets as this shard's stream probe. plan.extra rows carry no
    // homepage, and ids that left the catalog are simply not found.
    const plan = JSON.parse(fs.readFileSync(path.resolve(args.plan), 'utf8'));
    const shardIds = plan?.targets?.[args.shard];
    if (!Array.isArray(shardIds)) {
      console.error(`check-homepages: plan has no shard ${args.shard} (shards: ${plan?.targets?.length ?? 0})`);
      process.exit(1);
    }
    const wanted = new Set(shardIds);
    stations = stations.filter((s) => wanted.has(s.id) && PUBLISHABLE.has(s.status));
  }
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

  const generatedAt = new Date().toISOString();
  if (!args.plan) {
    // Persist a fresh cache (merge: keep untouched cached URLs so big runs are
    // resumable across country batches) plus a curation-facing stations list.
    const urlsOut = {};
    for (const [url, row] of cache) urlsOut[url] = row; // carry over prior runs
    for (const [url, row] of results) urlsOut[url] = row; // overwrite with this run
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(
      OUT,
      JSON.stringify({ generatedAt, staleDays: args.staleDays, stations: stationRows, urls: urlsOut }, null, 2),
    );
  }

  if (args.observations) {
    const rows = stations
      .filter((s) => results.has(s.homepage))
      .map((s) => toHomepageObservation({ station: s, result: results.get(s.homepage), at: generatedAt }));
    appendObservations(path.resolve(args.observations), rows);
    console.log(`  appended ${rows.length} homepage observation(s) to ${args.observations}`);
  }

  // Mirror into the unified health record (docs/station-health.md) so the
  // verdicts outlive this gitignored cache. ok → ok, blocked/redirect → warn,
  // dead / server-error / network error → bad; no homepage at all → na.
  if (args.record) {
    const updates = new Map();
    for (const r of stationRows) updates.set(r.id, homepageVerdict(r));
    const fullSweep = !args.cc && args.only.size === 0 && !(args.limit > 0) && !args.plan;
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
    if (!args.plan) console.log(`\n  report → ${path.relative(ROOT, OUT)}`);
  }

  const strictFails = stationRows.filter((r) => STRICT_FAIL.has(r.class)).length;
  if (args.strict && strictFails > 0) {
    console.error(`check-homepages: ${strictFails} dead homepage(s) — strict gate failed`);
    process.exit(1);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
