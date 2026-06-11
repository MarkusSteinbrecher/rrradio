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
 *   npm run health -- --strict           # exit 2 if any stream is bad (CI)
 *   npm run health -- --concurrency 24 --timeout 5000
 *
 * Writes:
 *   public/station-health.json   stream/https/icy/metadata/fetcher/program
 *                                facets via tools/lib/health-record.mjs
 *   public/station-status.json   admin-dashboard artifact — same row shape
 *                                analyze.mjs emitted, but problems-only
 *                                (full sweeps only; scoped runs skip it)
 *
 * Reads public/stations.json (the merged artifact) so RB-bound entries get
 * their resolved streamUrl — the audit-#68 class of false BROKEN.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyLogoUrl } from './logo-quality.mjs';
import { classifyError } from './lib/homepage-status.mjs';
import { loadHealth, saveHealth, applyFacet, pruneStations } from './lib/health-record.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const PUBLISHABLE = new Set(['working', 'stream-only', 'icy-only']);
const ORIGIN = 'https://rrradio.org';
import { lenientProbe } from './playable-check.mjs';

const STATUS_PROBLEM_CAP = 1000;

// ─── args ────────────────────────────────────────────────────────────

const args = parseArgs(process.argv.slice(2));
function parseArgs(argv) {
  const out = { concurrency: 16, timeout: 8000, strict: false, quiet: false, cc: null, only: null, limit: 0 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--cc') out.cc = String(argv[++i] ?? '').toUpperCase();
    else if (a === '--only') out.only = new Set(String(argv[++i] ?? '').split(',').filter(Boolean));
    else if (a === '--limit') out.limit = Number(argv[++i]) || 0;
    else if (a === '--concurrency') out.concurrency = Math.max(1, Number(argv[++i]) || 16);
    else if (a === '--timeout') out.timeout = Math.max(1000, Number(argv[++i]) || 8000);
    else if (a === '--strict') out.strict = true;
    else if (a === '--quiet') out.quiet = true;
    else if (a === '--help' || a === '-h') {
      console.log('usage: health-probe [--cc XX] [--only id,…] [--limit N] [--concurrency N] [--timeout MS] [--strict] [--quiet]');
      process.exit(0);
    } else {
      console.error(`health-probe: unknown argument "${a}"`);
      process.exit(1);
    }
  }
  return out;
}

// ─── fetcher manifest (same source of truth as analyze.mjs used) ────

const fetcherManifest = JSON.parse(readFileSync(join(root, 'src/fetchers.json'), 'utf8'));
const KNOWN_FETCHERS = new Set(Object.keys(fetcherManifest.fetchers));
const PROGRAM_CAPABLE = new Set(
  Object.entries(fetcherManifest.fetchers).filter(([, v]) => v.program).map(([k]) => k),
);
const SELF_CONTAINED_FETCHERS = new Set(
  Object.entries(fetcherManifest.fetchers).filter(([, v]) => v.selfContained).map(([k]) => k),
);
const WIREABLE_BROADCASTERS = new Set(fetcherManifest.wireableBroadcasters);

// Some fetchers store a broadcaster slug in metadataUrl instead of a URL.
const SLUG_NOT_URL = new Set(['bbc', 'ffh', 'laut-fm', 'npo', 'soma-fm']);
// A few valid metadata feeds are plain text, XML, or HTML fragments.
const NON_JSON_METADATA = new Set(['wdr', 'mr', 'rb-bremen', 'sr']);

function isMetadataSlug(metadataUrl, metadataKey) {
  return !!metadataKey && SLUG_NOT_URL.has(metadataKey) && !/^https?:\/\//i.test(metadataUrl);
}

// ─── probes ──────────────────────────────────────────────────────────

function timed(promise) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), args.timeout);
  return [promise(ctrl.signal), () => clearTimeout(timer)];
}

async function probeStream(url) {
  if (!url) return { status: 'failed', errorToken: 'no-url' };
  const [p, done] = timed((signal) =>
    fetch(url, { signal, headers: { Origin: ORIGIN, 'Icy-MetaData': '1' } }),
  );
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
    return { status: res.status, contentType: ct, metaintAdvertised: !!metaint, icySeen };
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
        };
      }
    }
    return { status: 'failed', errorToken: classifyError(err) };
  } finally {
    done();
  }
}

async function probeMetadataUrl(url) {
  const [p, done] = timed((signal) => fetch(url, { signal, headers: { Origin: ORIGIN } }));
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

// ─── classification (verdicts: ok | warn | bad | na) ─────────────────

function classifyStream(probe) {
  if (probe.status === 'failed') return { v: 'bad', d: probe.errorToken };
  if (typeof probe.status === 'number' && probe.status >= 400) return { v: 'bad', d: `HTTP ${probe.status}` };
  const ct = probe.contentType || '';
  const audioLike = ct.startsWith('audio/') || ct.includes('mpegurl') || ct.includes('octet-stream');
  if (!audioLike) return { v: 'warn', d: `content-type "${ct || '?'}"` };
  return { v: 'ok', d: ct };
}

function classifyHttps(streamUrl) {
  return /^https:\/\//i.test(streamUrl ?? '')
    ? { v: 'ok' }
    : { v: 'bad', d: 'http (mixed content)' };
}

function classifyIcy(probe, codec) {
  if ((codec ?? '').toUpperCase() === 'HLS') return { v: 'na', d: 'HLS — metadata via manifest' };
  if (probe.icySeen) return { v: 'ok', d: 'StreamTitle present' };
  if (probe.metaintAdvertised) return { v: 'warn', d: 'icy-metaint advertised, no StreamTitle in 64 KB' };
  return { v: 'bad', d: 'no ICY metadata' };
}

function classifyMetadataApi(metadataUrl, probe, metadataKey, broadcaster) {
  if (!metadataUrl) {
    if (metadataKey && SELF_CONTAINED_FETCHERS.has(metadataKey)) {
      return { v: 'ok', d: `built into ${metadataKey} fetcher` };
    }
    if (broadcaster && WIREABLE_BROADCASTERS.has(broadcaster)) {
      return { v: 'warn', d: 'auto-discoverable — run `npm run wire-metadata`' };
    }
    return { v: 'na', d: 'not declared' };
  }
  if (isMetadataSlug(metadataUrl, metadataKey)) {
    return { v: 'ok', d: `slug=${metadataUrl} (proxied)` };
  }
  if (!probe || probe.status === 'failed') return { v: 'bad', d: probe?.errorToken ?? 'unreachable' };
  if (typeof probe.status === 'number' && probe.status >= 400) return { v: 'bad', d: `HTTP ${probe.status}` };
  if (!probe.contentType?.includes('json')) {
    if (metadataKey && NON_JSON_METADATA.has(metadataKey)) {
      return { v: 'ok', d: probe.contentType || 'non-json metadata' };
    }
    return { v: 'warn', d: `content-type "${probe.contentType || '?'}"` };
  }
  return { v: 'ok' };
}

function classifyFetcher(metadataKey) {
  if (!metadataKey) return { v: 'na', d: 'generic' };
  if (KNOWN_FETCHERS.has(metadataKey)) return { v: 'ok', d: metadataKey };
  return { v: 'bad', d: `unknown key "${metadataKey}"` };
}

function classifyProgram(metadataKey) {
  if (!metadataKey) return { v: 'na' };
  return PROGRAM_CAPABLE.has(metadataKey)
    ? { v: 'ok' }
    : { v: 'warn', d: 'fetcher does not expose program info' };
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
if (args.cc) targets = targets.filter((s) => String(s.country ?? '').toUpperCase() === args.cc);
if (args.only) targets = targets.filter((s) => args.only.has(s.id));
if (args.limit > 0) targets = targets.slice(0, args.limit);

const fullSweep = !args.cc && !args.only && !(args.limit > 0);
const scope = fullSweep ? 'full' : args.cc ? `cc:${args.cc}` : 'partial';

if (targets.length === 0) {
  console.error('health-probe: no stations match the given scope');
  process.exit(1);
}

console.log(`health-probe: ${targets.length} station(s), scope=${scope}, concurrency=${args.concurrency}, timeout=${args.timeout}ms`);

// ─── probe pool ──────────────────────────────────────────────────────

const startedAt = Date.now();
const rows = new Array(targets.length);
let nextIndex = 0;
let probedCount = 0;

async function worker() {
  for (;;) {
    const i = nextIndex++;
    if (i >= targets.length) return;
    const s = targets[i];
    const metadataKey = s.metadata ?? null;
    const streamProbe = await probeStream(s.streamUrl);
    const metaProbe =
      s.metadataUrl && !isMetadataSlug(s.metadataUrl, metadataKey)
        ? await probeMetadataUrl(s.metadataUrl)
        : null;
    rows[i] = {
      station: s,
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
      const etaMin = Math.round((targets.length - probedCount) / rate / 60);
      console.log(`  …${probedCount}/${targets.length} (${rate.toFixed(1)}/s, ~${etaMin} min left)`);
    }
  }
}

await Promise.all(Array.from({ length: Math.min(args.concurrency, targets.length) }, worker));

// ─── write the health record ─────────────────────────────────────────

const at = new Date().toISOString();
const record = loadHealth(root);
const FACET_KEYS = ['stream', 'https', 'icy', 'metadata', 'fetcher', 'program'];
const summaries = {};
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

// ─── dashboard artifact (full sweeps only) ───────────────────────────

if (fullSweep) {
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
  console.log('scoped run — leaving public/station-status.json untouched');
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
console.log('');
console.log(`stream:   ${t.ok} ok · ${t.warn} warn · ${t.bad} bad`);
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
