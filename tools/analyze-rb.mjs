#!/usr/bin/env node
/**
 * Playability probe for every Radio Browser station in a country.
 *
 *   npm run analyze-rb -- CH
 *   npm run analyze-rb -- DE --concurrency 8
 *   npm run analyze-rb -- DE --resume
 *
 * Inputs:
 *   data/sources/radio-browser/by-country/<CC>.json   — raw snapshot
 *   data/stations.yaml                                — to flag curated rows
 *
 * Reads the raw snapshot (no upstream RB call here — refresh via
 * `npm run fetch-rb-raw` if you need newer data). Probes each station
 * with bounded concurrency, then writes:
 *
 *   public/rb-analysis-<CC>.json
 *
 * Output is verdict-only — duplicate decisions live in the cross-country
 * dedupe DB (`data/sources/radio-browser/dedupe.json`, owned by
 * `tools/dedupe-raw.mjs`). The two layers join by stationuuid in
 * `tools/build-sources.mjs`.
 *
 * Verdicts come from tools/playable-check.mjs — `ok` / `ok-hls` /
 * `broken-mixed` / `broken-network` / `broken-format` / `needs-playlist` /
 * `redirect-downgrade` / `broken-url` / `probe-inconclusive`.
 *
 * Politeness: default 5 concurrent probes. Same-broadcaster channels
 * often share an origin; pushing concurrency too high gets rate-limited.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { probeStream } from './playable-check.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const RAW_DIR = join(ROOT, 'data', 'sources', 'radio-browser', 'by-country');

const args = process.argv.slice(2);
const cc = (args[0] || '').toUpperCase();
if (!/^[A-Z]{2}$/.test(cc)) {
  console.error('usage: node tools/analyze-rb.mjs <ISO 3166-1 country code> [--concurrency N] [--resume] [--reprobe-verdicts <v1,v2>]');
  process.exit(1);
}
const concurrency = Math.max(
  1,
  Math.min(20, Number(args[args.indexOf('--concurrency') + 1]) || 5),
);
const resume = args.includes('--resume');
// Verdicts in this set always get re-probed, even when --resume would
// otherwise reuse them. Used to refresh stale verdicts (e.g. after
// probe logic changes) without re-running every station in the country.
const reprobeIdx = args.indexOf('--reprobe-verdicts');
const reprobeSet = new Set(
  reprobeIdx >= 0 && args[reprobeIdx + 1] ? args[reprobeIdx + 1].split(',').map((s) => s.trim()).filter(Boolean) : [],
);

const outPath = join(ROOT, `public/rb-analysis-${cc}.json`);
mkdirSync(dirname(outPath), { recursive: true });

// ─── 1. Load raw snapshot ──────────────────────────────────────
const snapshotPath = join(RAW_DIR, `${cc}.json`);
if (!existsSync(snapshotPath)) {
  console.error(
    `analyze-rb: no raw snapshot at ${snapshotPath.replace(ROOT + '/', '')}\n` +
    `            run \`npm run fetch-rb-raw -- ${cc}\` first`,
  );
  process.exit(1);
}
const raw = JSON.parse(readFileSync(snapshotPath, 'utf8'));
const stations = (raw.stations || []).slice();
if (stations.length === 0) {
  console.error(`analyze-rb: ${cc} has no stations in raw snapshot`);
  process.exit(1);
}
// Sort by votes desc so the most-wanted stations get probed first
// and `--resume` makes meaningful progress quickly.
stations.sort((a, b) => (b.votes || 0) - (a.votes || 0));
console.log(`analyze-rb: ${stations.length} stations from snapshot (concurrency ${concurrency})`);

// ─── 2. Curated-set lookup + previous report (for --resume) ────
const curatedUuids = new Set();
try {
  const yaml = parseYaml(readFileSync(join(ROOT, 'data/stations.yaml'), 'utf8'));
  for (const s of yaml || []) if (s?.stationuuid) curatedUuids.add(s.stationuuid);
} catch {
  /* fine — no curated set yet */
}

let prior = new Map();
if (resume && existsSync(outPath)) {
  try {
    const data = JSON.parse(readFileSync(outPath, 'utf8'));
    for (const r of data.stations || []) prior.set(r.stationuuid, r);
    console.log(`analyze-rb: --resume — ${prior.size} prior verdicts available`);
  } catch {
    console.warn('analyze-rb: previous report unparseable, ignoring --resume');
  }
}

// ─── 3. Probe via host-grouped workers ─────────────────────────
// Many broadcasters host multiple streams on the same Icecast /
// Shoutcast origin (e.g. icecast.walmradio.com:8443 has /jazz,
// /walm, /walm2, /jazz_opus…). Probing those in parallel from the
// same IP triggers per-host throttles and produces spurious
// broken-network verdicts.
//
// Solution: group by host first. Each worker pulls a whole host
// group off the queue, probes its stations serially with a small
// inter-probe gap, then pulls the next group. Different workers
// always operate on different hosts → never two parallel requests
// to one origin, no cross-worker locks, no fairness bug.
//
// Circuit breaker per host: after `HOST_FAILURE_CIRCUIT` consecutive
// timeout/refused/dns failures, the rest of the host's stations are
// marked probe-skipped, not broken. Stops a single dead origin
// (sometimes hundreds of stations) from burning the whole sweep without
// claiming rows we did not probe are dead.

const HOST_GAP_MS = 150;
const HOST_FAILURE_CIRCUIT = 5;
const FAILURE_VERDICTS_FOR_CIRCUIT = new Set([
  'broken-timeout', 'broken-dns', 'broken-refused', 'broken-tls',
]);

function makeProbeRecord(s, probe, reused) {
  return {
    stationuuid: s.stationuuid,
    changeuuid: s.changeuuid,
    name: s.name,
    country: s.countrycode || cc,
    streamUrl: s.url_resolved || s.url,
    homepage: s.homepage || undefined,
    favicon: s.favicon || undefined,
    codec: s.codec || undefined,
    bitrate: s.bitrate || undefined,
    votes: s.votes || 0,
    clickcount: s.clickcount || 0,
    lastcheckok: s.lastcheckok ?? null,
    verdict: probe.verdict,
    verdictReason: probe.reason,
    finalUrl: probe.finalUrl,
    isCurated: curatedUuids.has(s.stationuuid),
    probedAt: reused && probe === reused ? reused.probedAt : new Date().toISOString(),
  };
}

function shouldReuse(s, reused) {
  if (!reused) return false;
  if (reprobeSet.has(reused.verdict)) return false;
  return reused.changeuuid === s.changeuuid &&
         reused.streamUrl === (s.url_resolved || s.url);
}

// Group by host. Stations without a parseable URL get a sentinel
// host so they go through the normal probe path (which will return
// broken-url) without interfering with anyone.
const byHost = new Map();
for (let i = 0; i < stations.length; i++) {
  const s = stations[i];
  let host = '__no-host__';
  try { host = new URL(s.url_resolved || s.url).host || '__no-host__'; } catch { /* malformed */ }
  if (!byHost.has(host)) byHost.set(host, []);
  byHost.get(host).push({ s, originalIdx: i });
}
// Largest hosts first so the slow ones run while we still have
// other workers chewing through the long tail.
const hostGroups = [...byHost.entries()].sort((a, b) => b[1].length - a[1].length);
console.log(`analyze-rb: ${hostGroups.length} distinct host(s)`);

const verdicts = new Array(stations.length);
let nextGroup = 0;
let done = 0;
let reusedCount = 0;
let circuitTripCount = 0;
const startTs = Date.now();

const tick = () => {
  if (done % 25 === 0 || done === stations.length) {
    const pct = Math.round((done / stations.length) * 100);
    const elapsed = Math.round((Date.now() - startTs) / 1000);
    process.stdout.write(
      `\r  ${done}/${stations.length} (${pct}%) ${elapsed}s` +
      `${reusedCount ? ` reused=${reusedCount}` : ''}` +
      `${circuitTripCount ? ` circuit=${circuitTripCount}` : ''}`,
    );
  }
};

async function processHostGroup(items) {
  let consecutiveFailures = 0;
  let circuitOpen = false;
  let circuitReason = '';
  for (const { s, originalIdx } of items) {
    const url = s.url_resolved || s.url;
    const reused = prior.get(s.stationuuid);
    let probe;

    if (shouldReuse(s, reused)) {
      probe = {
        verdict: reused.verdict,
        reason: reused.verdictReason,
        finalUrl: reused.finalUrl,
      };
      reusedCount++;
    } else if (circuitOpen) {
      probe = {
        verdict: 'probe-skipped',
        reason: `host circuit-open after ${HOST_FAILURE_CIRCUIT} consecutive failures: ${circuitReason}`,
        finalUrl: url,
      };
    } else {
      probe = await probeStream(url);
      if (FAILURE_VERDICTS_FOR_CIRCUIT.has(probe.verdict)) {
        consecutiveFailures++;
        if (consecutiveFailures >= HOST_FAILURE_CIRCUIT) {
          circuitOpen = true;
          circuitReason = `${probe.verdict} (${probe.reason || ''})`.slice(0, 80);
          circuitTripCount++;
        }
      } else {
        consecutiveFailures = 0;
      }
      // Small inter-probe gap so the upstream Icecast doesn't see
      // back-to-back requests inside one second.
      await new Promise((r) => setTimeout(r, HOST_GAP_MS));
    }

    verdicts[originalIdx] = makeProbeRecord(s, probe, reused);
    done++;
    tick();
  }
}

await Promise.all(
  Array.from({ length: concurrency }, async () => {
    for (;;) {
      const i = nextGroup++;
      if (i >= hostGroups.length) return;
      const [, items] = hostGroups[i];
      await processHostGroup(items);
    }
  }),
);
process.stdout.write('\n');

// ─── 4. Roll-up summary + write the report ─────────────────────
const counts = {};
for (const v of verdicts) {
  counts[v.verdict] = (counts[v.verdict] || 0) + 1;
}
const playable = (counts.ok || 0) + (counts['ok-hls'] || 0);
const broken = Object.entries(counts)
  .filter(([k]) => k.startsWith('broken') || k === 'redirect-downgrade' || k === 'needs-playlist')
  .reduce((sum, [, n]) => sum + n, 0);

// Stable order so git diffs only change where data actually changed.
verdicts.sort((a, b) => a.stationuuid.localeCompare(b.stationuuid));

const report = {
  generatedAt: new Date().toISOString(),
  country: cc,
  rawSnapshotAt: raw.fetchedAt || null,
  total: verdicts.length,
  playable,
  broken,
  curated: verdicts.filter((v) => v.isCurated).length,
  byVerdict: counts,
  stations: verdicts,
};

writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
console.log(`analyze-rb: → ${outPath.replace(ROOT + '/', '')}`);
console.log(
  `  total=${report.total} playable=${report.playable} broken=${report.broken} curated=${report.curated}`,
);
console.log(
  `  by verdict: ${Object.entries(counts)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ')}`,
);
