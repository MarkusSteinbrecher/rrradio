#!/usr/bin/env node
/**
 * Canonical stream + metadata health probe (spec: docs/station-health.md).
 * Replaces validate-catalog.mjs and analyze.mjs, which probed the same
 * streams sequentially with two different verdict vocabularies — at 24k
 * stations neither could finish inside a CI job.
 *
 *   npm run health                       # full sweep
 *   npm run health -- --cc DE            # one country
 *   npm run health -- --only de-dlf,fr-fip
 *   npm run health -- --limit 50         # smoke run
 *   npm run health -- --strict           # exit 2 if any stream is bad (local)
 *   npm run health -- --concurrency 24 --timeout 5000
 *
 * Sharded mode (ADR 002 — catalog quality loop):
 *   node tools/health-probe.mjs --plan plan.json --shard 0 \
 *        --observations obs-0.ndjson --no-record
 *
 * Writes:
 *   public/station-health.json   stream/https/icy/metadata/fetcher/program
 *                                facets via tools/lib/health-record.mjs
 *                                (skipped with --no-record)
 *   public/station-status.json   admin-dashboard artifact — same row shape
 *                                analyze.mjs emitted, but problems-only
 *                                (full sweeps only; scoped runs skip it)
 *   <observations>.ndjson        one append-only row per probed station
 *
 * Reads public/stations.json (the merged artifact) so RB-bound entries get
 * their resolved streamUrl — the audit-#68 class of false BROKEN.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyLogoUrl } from './logo-quality.mjs';
import { classifyError } from './lib/homepage-status.mjs';
import { loadHealth, saveHealth, applyFacet, pruneStations } from './lib/health-record.mjs';
import { createClassifiers, failureClass, toObservation } from './lib/probe-classify.mjs';
import { appendObservations } from './lib/observations.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const PUBLISHABLE = new Set(['working', 'stream-only', 'icy-only']);
const ORIGIN = 'https://rrradio.org';
import { lenientProbe } from './playable-check.mjs';

const STATUS_PROBLEM_CAP = 1000;

// ─── args ────────────────────────────────────────────────────────────

const args = parseArgs(process.argv.slice(2));
function parseArgs(argv) {
  const out = {
    concurrency: 16, timeout: 8000, strict: false, quiet: false,
    cc: null, only: null, limit: 0,
    plan: null, shard: null, observations: null, record: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--cc') out.cc = String(argv[++i] ?? '').toUpperCase();
    else if (a === '--only') out.only = new Set(String(argv[++i] ?? '').split(',').filter(Boolean));
    else if (a === '--limit') out.limit = Number(argv[++i]) || 0;
    else if (a === '--concurrency') out.concurrency = Math.max(1, Number(argv[++i]) || 16);
    else if (a === '--timeout') out.timeout = Math.max(1000, Number(argv[++i]) || 8000);
    else if (a === '--plan') out.plan = String(argv[++i] ?? '');
    else if (a === '--shard') out.shard = Number(argv[++i]);
    else if (a === '--observations') out.observations = String(argv[++i] ?? '');
    else if (a === '--no-record') out.record = false;
    else if (a === '--strict') out.strict = true;
    else if (a === '--quiet') out.quiet = true;
    else if (a === '--help' || a === '-h') {
      console.log('usage: health-probe [--cc XX] [--only id,…] [--limit N] [--plan plan.json --shard i]');
      console.log('                    [--observations path.ndjson] [--no-record]');
      console.log('                    [--concurrency N] [--timeout MS] [--strict] [--quiet]');
      process.exit(0);
    } else {
      console.error(`health-probe: unknown argument "${a}"`);
      process.exit(1);
    }
  }
  if (out.plan && (out.cc || out.only || out.limit > 0)) {
    console.error('health-probe: --plan/--shard cannot be combined with --cc/--only/--limit');
    process.exit(1);
  }
  if ((out.plan === null) !== (out.shard === null)) {
    console.error('health-probe: --plan and --shard go together');
    process.exit(1);
  }
  if (out.shard !== null && (!Number.isInteger(out.shard) || out.shard < 0)) {
    console.error('health-probe: --shard must be a non-negative integer');
    process.exit(1);
  }
  return out;
}

// ─── classification (verdicts: ok | warn | bad | na) ─────────────────
// Pure logic lives in tools/lib/probe-classify.mjs; the fetcher manifest
// (src/fetchers.json) is injected so it stays testable.

const fetcherManifest = JSON.parse(readFileSync(join(root, 'src/fetchers.json'), 'utf8'));
const {
  classifyStream,
  classifyHttps,
  classifyIcy,
  classifyMetadataApi,
  classifyFetcher,
  classifyProgram,
  isMetadataSlug,
} = createClassifiers(fetcherManifest);

// ─── probes ──────────────────────────────────────────────────────────

function timed(promise, timeout) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  return [promise(ctrl.signal), () => clearTimeout(timer)];
}

async function probeStream(url, timeout) {
  const t0 = Date.now();
  if (!url) return { status: 'failed', errorToken: 'no-url', ms: 0 };
  const [p, done] = timed((signal) =>
    fetch(url, { signal, headers: { Origin: ORIGIN, 'Icy-MetaData': '1' } }),
  timeout);
  try {
    const res = await p;
    const ct = (res.headers.get('content-type') ?? '').toLowerCase();
    const metaint = res.headers.get('icy-metaint');
    let icySeen = false;
    if (res.ok && res.body) {
      // Scan up to 64 KB for StreamTitle — same brute-force fallback the
      // runtime uses. We only record *that* a title was seen, never the
      // title itself: details in the health record must be stable.
      const PREFIX = Buffer.from("StreamTitle='", 'utf8');
      const reader = res.body.getReader();
      let buf = Buffer.alloc(0);
      try {
        while (buf.length < 64 * 1024) {
          const { value, done: rdDone } = await reader.read();
          if (rdDone) break;
          if (!value) continue;
          buf = Buffer.concat([buf, Buffer.from(value)]);
          if (buf.indexOf(PREFIX) >= 0) {
            icySeen = true;
            break;
          }
        }
      } finally {
        try { await reader.cancel(); } catch {}
      }
    }
    try { await res.body?.cancel(); } catch {}
    return { status: res.status, contentType: ct, metaintAdvertised: !!metaint, icySeen, ms: Date.now() - t0 };
  } catch (err) {
    // undici rejects responses browsers accept (bare-LF status lines —
    // the regiocast/streamabc family). Re-check with the lenient
    // raw-socket prober before recording a bad verdict (#498).
    const msg = String(err) + ' ' + String(err?.cause ?? '');
    if (/HTTPParserError|Response does not match the HTTP\/1\.1|Missing expected CR|Parse Error/i.test(msg)) {
      const lenient = await lenientProbe(url).catch(() => null);
      if (lenient && (lenient.verdict === 'ok' || lenient.verdict === 'ok-hls')) {
        return {
          status: 200,
          contentType: (lenient.contentType ?? '').toLowerCase(),
          metaintAdvertised: !!lenient.icyMetaint,
          icySeen: false,
          lenientParse: true,
          ms: Date.now() - t0,
        };
      }
    }
    return { status: 'failed', errorToken: classifyError(err), ms: Date.now() - t0 };
  } finally {
    done();
  }
}

async function probeMetadataUrl(url, timeout) {
  const [p, done] = timed((signal) => fetch(url, { signal, headers: { Origin: ORIGIN } }), timeout);
  try {
    const res = await p;
    const ct = (res.headers.get('content-type') ?? '').toLowerCase();
    try { await res.body?.cancel(); } catch {}
    return { status: res.status, contentType: ct };
  } catch (err) {
    return { status: 'failed', errorToken: classifyError(err) };
  } finally {
    done();
  }
}

// ─── target selection ────────────────────────────────────────────────

const catalog = JSON.parse(readFileSync(join(root, 'public/stations.json'), 'utf8'));
const allStations = Array.isArray(catalog) ? catalog : catalog.stations;
if (!Array.isArray(allStations)) {
  console.error('health-probe: public/stations.json missing stations[] (run `npm run catalog`)');
  process.exit(1);
}
const published = allStations.filter((s) => PUBLISHABLE.has(s?.status));

let targets = published;
let scope;
let fullSweep = false;

if (args.plan) {
  // Sharded mode: the plan decides what this runner probes. Ids the plan
  // knows and the catalog no longer does are skipped, not fatal — plan and
  // catalog can be a commit apart.
  const plan = JSON.parse(readFileSync(resolve(args.plan), 'utf8'));
  const shardIds = plan?.targets?.[args.shard];
  if (!Array.isArray(shardIds)) {
    console.error(`health-probe: plan has no shard ${args.shard} (shards: ${plan?.targets?.length ?? 0})`);
    process.exit(1);
  }
  const byId = new Map(published.map((s) => [s.id, s]));
  const missing = shardIds.filter((id) => !byId.has(id));
  targets = shardIds.map((id) => byId.get(id)).filter(Boolean);
  if (missing.length > 0) {
    console.log(`plan: ${missing.length} id(s) not in the published catalog, skipped (${missing.slice(0, 5).join(', ')}…)`);
  }
  scope = `shard:${args.shard}/${plan.targets.length}`;
} else {
  if (args.cc) targets = targets.filter((s) => String(s.country ?? '').toUpperCase() === args.cc);
  if (args.only) targets = targets.filter((s) => args.only.has(s.id));
  if (args.limit > 0) targets = targets.slice(0, args.limit);
  fullSweep = !args.cc && !args.only && !(args.limit > 0);
  scope = fullSweep ? 'full' : args.cc ? `cc:${args.cc}` : 'partial';
}

if (targets.length === 0) {
  console.error('health-probe: no stations match the given scope');
  process.exit(1);
}

console.log(`health-probe: ${targets.length} station(s), scope=${scope}, concurrency=${args.concurrency}, timeout=${args.timeout}ms`);

// ─── probe pool ──────────────────────────────────────────────────────

const startedAt = Date.now();

/**
 * Probe a list of stations with a bounded worker pool.
 * @param {object[]} list stations
 * @param {number} timeout per-request timeout in ms
 * @returns {Promise<object[]>} rows aligned to `list`
 */
async function probePass(list, timeout) {
  const out = new Array(list.length);
  let nextIndex = 0;
  let probedCount = 0;

  async function worker() {
    for (;;) {
      const i = nextIndex++;
      if (i >= list.length) return;
      const s = list[i];
      const metadataKey = s.metadata ?? null;
      const streamProbe = await probeStream(s.streamUrl, timeout);
      const metaProbe =
        s.metadataUrl && !isMetadataSlug(s.metadataUrl, metadataKey)
          ? await probeMetadataUrl(s.metadataUrl, timeout)
          : null;
      out[i] = {
        station: s,
        probe: streamProbe,
        facets: {
          stream: classifyStream(streamProbe),
          https: classifyHttps(s.streamUrl),
          icy: classifyIcy(streamProbe, s.codec),
          metadata: classifyMetadataApi(s.metadataUrl, metaProbe, metadataKey, s.broadcaster),
          fetcher: classifyFetcher(metadataKey),
          program: classifyProgram(metadataKey),
        },
      };
      probedCount += 1;
      if (!args.quiet && probedCount % 500 === 0) {
        const rate = probedCount / ((Date.now() - startedAt) / 1000);
        const etaMin = Math.round((list.length - probedCount) / rate / 60);
        console.log(`  …${probedCount}/${list.length} (${rate.toFixed(1)}/s, ~${etaMin} min left)`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(args.concurrency, list.length) }, worker));
  return out;
}

const rows = await probePass(targets, args.timeout);

// ─── soft-failure retry (ADR 002) ────────────────────────────────────
// `timeout` is the most common bad detail and the sponsor has caught the
// probe calling working stations broken. Everything soft gets one more
// chance at double the budget; the retry result replaces the first.

const softIndexes = rows
  .map((r, i) => (r.facets.stream.v === 'bad' && failureClass(r.facets.stream) === 'soft' ? i : -1))
  .filter((i) => i >= 0);

let retried = 0;
let recovered = 0;
if (softIndexes.length > 0) {
  const retryTimeout = args.timeout * 2;
  console.log(`retrying ${softIndexes.length} soft failure(s) at ${retryTimeout}ms…`);
  const retryRows = await probePass(softIndexes.map((i) => rows[i].station), retryTimeout);
  softIndexes.forEach((idx, k) => {
    const row = retryRows[k];
    row.retried = true;
    if (row.facets.stream.v !== 'bad') recovered += 1;
    rows[idx] = row;
  });
  retried = softIndexes.length;
  console.log(`retried ${retried}, recovered ${recovered}`);
}

// ─── observations (append-only log) ──────────────────────────────────

const at = new Date().toISOString();

if (args.observations) {
  const observations = rows.map((r) =>
    toObservation({ station: r.station, facets: r.facets, probe: r.probe, at, retried: r.retried === true }),
  );
  appendObservations(resolve(args.observations), observations);
  console.log(`appended ${observations.length} observation(s) to ${args.observations}`);
}

// ─── write the health record ─────────────────────────────────────────

const FACET_KEYS = ['stream', 'https', 'icy', 'metadata', 'fetcher', 'program'];
const summaries = {};

if (args.record) {
  const record = loadHealth(root);
  for (const facet of FACET_KEYS) {
    const updates = new Map(rows.map((r) => [r.station.id, r.facets[facet]]));
    summaries[facet] = applyFacet(record, facet, updates, { tool: 'health-probe', scope, at });
  }
  if (fullSweep) {
    const removed = pruneStations(record, new Set(published.map((s) => s.id)));
    if (removed > 0) console.log(`pruned ${removed} station(s) no longer in the published catalog`);
  }
  saveHealth(root, record);
  console.log(`wrote public/station-health.json (${summaries.stream.transitions} stream transition(s))`);
} else {
  // Sharded runs leave the record to the merge job (derive-health).
  for (const facet of FACET_KEYS) summaries[facet] = tallyFacet(rows, facet);
  console.log('--no-record — leaving public/station-health.json untouched');
}

function tallyFacet(list, facet) {
  const tally = { ok: 0, warn: 0, bad: 0, na: 0 };
  for (const r of list) tally[r.facets[facet].v] += 1;
  return { checked: list.length, transitions: 0, tally };
}

// ─── dashboard artifact (full sweeps only) ───────────────────────────

if (fullSweep && args.record) {
  const problems = rows
    .filter((r) => Object.values(r.facets).some((f) => f.v === 'bad'))
    .sort((a, b) => {
      const badCount = (r) => Object.values(r.facets).filter((f) => f.v === 'bad').length;
      return badCount(b) - badCount(a) || a.station.id.localeCompare(b.station.id);
    });
  const status = {
    generatedAt: at,
    problemsOnly: true,
    totals: Object.fromEntries(FACET_KEYS.map((f) => [f, summaries[f].tally])),
    checked: rows.length,
    problemCount: problems.length,
    stations: problems.slice(0, STATUS_PROBLEM_CAP).map(({ station: s, facets }) => ({
      id: s.id,
      name: s.name,
      broadcaster: s.broadcaster,
      status: s.status,
      streamUrl: s.streamUrl,
      metadataUrl: s.metadataUrl ?? null,
      favicon: s.favicon ?? null,
      metadataKey: s.metadata ?? null,
      // Dashboard-compatible shape (state/detail keys, metadataApi + logo
      // columns). The health record stays the source of truth; this is a
      // rendering artifact.
      checks: {
        stream: toState(facets.stream),
        https: toState(facets.https),
        icy: toState(facets.icy),
        metadataApi: toState(facets.metadata),
        fetcher: toState(facets.fetcher),
        program: toState(facets.program),
        logo: logoState(s.favicon),
      },
    })),
  };
  const outPath = join(root, 'public/station-status.json');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(status, null, 2) + '\n');
  console.log(`wrote public/station-status.json (${problems.length} problem station(s), cap ${STATUS_PROBLEM_CAP})`);
} else {
  console.log('scoped or unrecorded run — leaving public/station-status.json untouched');
}

function toState(facet) {
  return facet.d == null ? { state: vState(facet.v) } : { state: vState(facet.v), detail: facet.d };
}
function vState(v) {
  return v; // verdicts and dashboard states share the ok|warn|bad|na vocabulary
}
function logoState(favicon) {
  const logo = classifyLogoUrl(favicon);
  return logo.reason == null ? { state: logo.state } : { state: logo.state, detail: logo.reason };
}

// ─── summary ─────────────────────────────────────────────────────────

const t = summaries.stream.tally;
const badRowsByClass = { hard: 0, soft: 0 };
for (const r of rows) {
  const cls = failureClass(r.facets.stream);
  if (cls) badRowsByClass[cls] += 1;
}
console.log('');
console.log(`stream:   ${t.ok} ok · ${t.warn} warn · ${t.bad} bad (${badRowsByClass.hard} hard, ${badRowsByClass.soft} soft)`);
if (retried > 0) console.log(`retries:  ${retried} soft failure(s) re-probed, ${recovered} recovered`);
const m = summaries.metadata.tally;
console.log(`metadata: ${m.ok} ok · ${m.warn} warn · ${m.bad} bad · ${m.na} n/a`);

const badRows = rows.filter((r) => r.facets.stream.v === 'bad');
if (badRows.length > 0) {
  console.log('');
  console.log(`broken streams (${badRows.length}):`);
  for (const r of badRows.slice(0, 50)) {
    console.log(`  ✗ ${r.station.id.padEnd(40)} ${r.facets.stream.d ?? ''}`);
  }
  if (badRows.length > 50) console.log(`  …and ${badRows.length - 50} more (see public/station-health.json)`);
}

const elapsedMin = ((Date.now() - startedAt) / 60000).toFixed(1);
console.log('');
console.log(`done in ${elapsedMin} min`);

if (args.strict && t.bad > 0) process.exit(2);
