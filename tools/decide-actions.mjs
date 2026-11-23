#!/usr/bin/env node
/**
 * Decide catalog actions from the health-data streaks (ADR 002 phase 2 —
 * "Decide").
 *
 *   node tools/decide-actions.mjs --data health-data/ [--catalog public/stations.json]
 *        [--yaml data/stations.yaml] [--out actions.json] [--now ISO]
 *        [--no-edge] [--no-rb] [--max-edge 300] [--max-rb 100]
 *        [--no-logo-upgrade] [--max-logo 300]
 *        [--no-logo-fill] [--max-fill 150]
 *
 * Reads streaks / plan / metrics / record from the health-data checkout,
 * the published catalog, the YAML (lifecycle fields), the dedup report
 * and the highlights; asks the stats Worker for a second opinion on soft
 * failures (`STATS_ADMIN_TOKEN`); asks Radio Browser for a replacement
 * URL before unpublishing an RB-bound row; probes the https twin of every
 * plain-http favicon the record flags `http` (rule 8b); looks for a logo on
 * the homepage of stations that have none, queues it for the judging session
 * and acts on the verdicts that session left (rule 9). The policy itself is pure
 * (tools/lib/health-policy.mjs) — this file is the I/O around it.
 *
 * Writes `--out` and `<data>/actions/<day>.json` (audit trail), appends
 * the edge answers to today's observation file, and keeps the logo-fill
 * queue and memory under `<data>/logo-fill/` (candidates awaiting a verdict,
 * who was tried when, which pictures are platform defaults). Exit 0 unless an input
 * is unreadable: bad streams are data, a broken tool is a red run.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { appendObservations, dayOf, observationPath } from './lib/observations.mjs';
import { edgeProbeMany, toEdgeObservation } from './lib/edge-probe.mjs';
import { applySwaps, candidateEdgeIds, candidateLogoUpgradeIds, candidateSwapIds, decide, DEFAULT_CAPS, isBotUnpublished } from './lib/health-policy.mjs';
import { classifyLogo, httpsVariant, probeLogo } from './lib/logo-probe.mjs';
import { dropPlatformDefaults, fillTargets } from './lib/logo-fill.mjs';
import { findLogos } from './lib/logo-fill-fetch.mjs';
import { closeQueue, PENDING_MAX, settleQueue } from './lib/logo-fill-queue.mjs';
import { fetchByUuid } from './rb-client.mjs';
import { lenientProbe } from './playable-check.mjs';
import { streamFingerprint } from './lib/dedupe-normalize.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const log = (msg) => console.error(`decide-actions: ${msg}`);

// ─── args ────────────────────────────────────────────────────────────

const args = parseArgs(process.argv.slice(2));
function parseArgs(argv) {
  const out = {
    data: null,
    catalog: 'public/stations.json',
    yaml: 'data/stations.yaml',
    dedup: 'public/dedup-report.json',
    highlights: 'data/highlights.yaml',
    out: 'actions.json',
    now: null,
    edge: true,
    rb: true,
    maxEdge: 300,
    maxRb: 100,
    logoUpgrade: true,
    maxLogo: 300,
    logoFill: true,
    maxFill: 150,
    cap: DEFAULT_CAPS.auto,
    edgeBase: undefined,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--data') out.data = String(argv[++i] ?? '');
    else if (a === '--catalog') out.catalog = String(argv[++i] ?? '');
    else if (a === '--yaml') out.yaml = String(argv[++i] ?? '');
    else if (a === '--dedup') out.dedup = String(argv[++i] ?? '');
    else if (a === '--highlights') out.highlights = String(argv[++i] ?? '');
    else if (a === '--out') out.out = String(argv[++i] ?? '');
    else if (a === '--now') out.now = String(argv[++i] ?? '');
    else if (a === '--no-edge') out.edge = false;
    else if (a === '--no-rb') out.rb = false;
    else if (a === '--max-edge') out.maxEdge = Math.max(0, Number(argv[++i]) || 0);
    else if (a === '--max-rb') out.maxRb = Math.max(0, Number(argv[++i]) || 0);
    else if (a === '--no-logo-upgrade') out.logoUpgrade = false;
    else if (a === '--max-logo') out.maxLogo = Math.max(0, Number(argv[++i]) || 0);
    else if (a === '--no-logo-fill') out.logoFill = false;
    else if (a === '--max-fill') out.maxFill = Math.max(0, Number(argv[++i]) || 0);
    else if (a === '--cap') out.cap = Math.max(0, Number(argv[++i]) || 0);
    else if (a === '--edge-base') out.edgeBase = String(argv[++i] ?? '');
    else if (a === '--help' || a === '-h') {
      console.log(
        'usage: decide-actions --data health-data/ [--catalog p] [--yaml p] [--out actions.json] [--now ISO]\n' +
          '                      [--no-edge] [--no-rb] [--max-edge 300] [--max-rb 100] [--cap 200]\n' +
          '                      [--no-logo-upgrade] [--max-logo 300]\n' +
          '                      [--no-logo-fill] [--max-fill 150]\n' +
          '                      [--dedup public/dedup-report.json] [--highlights data/highlights.yaml] [--edge-base URL]',
      );
      process.exit(0);
    } else {
      log(`unknown argument "${a}"`);
      process.exit(1);
    }
  }
  if (!out.data) {
    log('--data <health-data dir> is required');
    process.exit(1);
  }
  return out;
}

const rel = (p) => (p.startsWith('/') ? p : join(root, p));
const dataDir = resolve(args.data);
const now = args.now ? new Date(args.now).toISOString() : new Date().toISOString();
const day = dayOf(now);

// ─── inputs ──────────────────────────────────────────────────────────

/** Required input: unreadable → exit 1 (the only failure mode of this tool). */
function mustJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    log(`cannot read ${label} (${path}): ${err.message}`);
    process.exit(1);
  }
}
/** Optional input: unreadable → logged, treated as absent. */
function mayJson(path, label) {
  if (!existsSync(path)) {
    log(`no ${label} at ${path} — continuing without it`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    log(`cannot parse ${label} (${path}): ${err.message} — continuing without it`);
    return null;
  }
}

const streaks = mustJson(join(dataDir, 'streaks.json'), 'streaks.json');
const plan = mustJson(join(dataDir, 'plan.json'), 'plan.json');
const metrics = mustJson(join(dataDir, 'metrics.json'), 'metrics.json');
const record = mayJson(join(dataDir, 'station-health.json'), 'station-health.json');

const catalogRaw = mustJson(rel(args.catalog), args.catalog);
const catalog = Array.isArray(catalogRaw) ? catalogRaw : catalogRaw?.stations;
if (!Array.isArray(catalog)) {
  log(`${args.catalog} has no stations[]`);
  process.exit(1);
}
const publishedById = new Map(catalog.filter((s) => s?.id).map((s) => [s.id, s]));
const publishedIds = new Set(publishedById.keys());

/** @type {Map<string, object>} */
const yamlById = new Map();
try {
  for (const row of parseYaml(readFileSync(rel(args.yaml), 'utf8')) ?? []) {
    if (row?.id) yamlById.set(row.id, row);
  }
} catch (err) {
  log(`cannot read ${args.yaml}: ${err.message}`);
  process.exit(1);
}

// A fold canonical is a dedup group's survivor with at least one other
// member folded into it; removing it would orphan the fold.
const dedup = mayJson(rel(args.dedup), 'dedup-report.json');
const foldCanonicals = new Set(
  (dedup?.groups ?? [])
    .filter((g) => typeof g?.canonicalId === 'string' && (g.members ?? []).some((m) => m?.id && m.id !== g.canonicalId))
    .map((g) => g.canonicalId),
);

let highlightIds = new Set();
try {
  const hl = existsSync(rel(args.highlights)) ? parseYaml(readFileSync(rel(args.highlights), 'utf8')) : [];
  highlightIds = new Set((Array.isArray(hl) ? hl : []).map((h) => h?.station).filter((id) => typeof id === 'string'));
} catch (err) {
  log(`cannot read ${args.highlights}: ${err.message} — continuing without highlights`);
}

// Latest stream detail per station — the streak carries only (o, c).
/** @type {Map<string, string|null>} */
const latestDetail = new Map();
for (const [id, facets] of Object.entries(record?.stations ?? {})) {
  if (facets?.stream && 'd' in facets.stream) latestDetail.set(id, facets.stream.d ?? null);
}

// Same for the logo facet (phase 3 rule 8): `missing` must never become a
// clear-logo, so the policy needs the detail behind the streak.
/** @type {Map<string, string|null>} */
const latestLogoDetail = new Map();
for (const [id, facets] of Object.entries(record?.stations ?? {})) {
  if (facets?.logo && 'd' in facets.logo) latestLogoDetail.set(id, facets.logo.d ?? null);
}

const streamUrlOf = (id) => publishedById.get(id)?.streamUrl ?? yamlById.get(id)?.streamUrl ?? null;

// ─── edge second opinion (rule 3) ────────────────────────────────────

/** @type {Map<string, object|null>} */
const edge = new Map();
const token = process.env.STATS_ADMIN_TOKEN;
let edgeNote = 'edge: skipped (--no-edge)';
if (args.edge && !token) {
  edgeNote = 'edge: skipped (STATS_ADMIN_TOKEN unset)';
  log('STATS_ADMIN_TOKEN is not set — running as --no-edge');
} else if (args.edge) {
  try {
    const ids = candidateEdgeIds(streaks, plan.tiers ?? {}, yamlById, publishedIds);
    const urlOf = new Map(ids.map((id) => [id, streamUrlOf(id)]).filter(([, u]) => typeof u === 'string' && u));
    const answers = await edgeProbeMany([...urlOf.values()], { token, base: args.edgeBase }, { concurrency: 4, max: args.maxEdge });
    const rows = [];
    for (const [id, url] of urlOf) {
      if (!answers.has(url)) continue; // beyond --max-edge → no opinion
      const answer = answers.get(url);
      edge.set(id, answer);
      if (answer) rows.push(toEdgeObservation(id, answer, now));
    }
    appendObservations(observationPath(dataDir, day), rows);
    const answered = [...edge.values()].filter(Boolean).length;
    edgeNote = `edge: asked ${urlOf.size}/${ids.length}, answered ${answered}, logged ${rows.length} row(s)`;
  } catch (err) {
    edgeNote = `edge: failed (${err.message}) — no opinions this run`;
    log(edgeNote);
  }
}

// ─── https twin of http favicons (rule 8b, #701) ─────────────────────

/** @type {Map<string, {favicon: string, newFavicon: string}>} */
const logoUpgrades = new Map();
let logoNote = 'logo-upgrade: skipped (--no-logo-upgrade)';
if (args.logoUpgrade) {
  try {
    const ids = candidateLogoUpgradeIds(streaks, latestLogoDetail, yamlById, publishedIds);
    const todo = ids
      .map((id) => ({ id, favicon: publishedById.get(id)?.favicon }))
      .filter((c) => typeof c.favicon === 'string' && httpsVariant(c.favicon))
      .slice(0, args.maxLogo);
    let next = 0;
    const worker = async () => {
      while (next < todo.length) {
        const { id, favicon } = todo[next++];
        const twin = httpsVariant(favicon);
        const verdict = classifyLogo(twin, await probeLogo(twin, { timeout: 8000 }));
        if (verdict.v !== 'bad') logoUpgrades.set(id, { favicon, newFavicon: twin });
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
    logoNote = `logo-upgrade: ${ids.length} http favicon(s), probed ${todo.length}, ${logoUpgrades.size} https twin(s) load`;
  } catch (err) {
    logoNote = `logo-upgrade: failed (${err.message}) — no upgrades this run`;
    log(logoNote);
  }
}

// ─── a logo for stations that have none (rule 9) ─────────────────────
//
// Two halves that meet on health-data/logo-fill/ (tools/lib/logo-fill-queue.mjs):
// this run settles the verdicts the judging session left since yesterday,
// then finds and guards new candidates and queues them for it. Nothing here
// calls a model.

const fillDir = join(dataDir, 'logo-fill');
const fillPaths = {
  attempts: join(fillDir, 'attempts.json'),
  generic: join(fillDir, 'generic-hashes.json'),
  candidates: join(fillDir, 'candidates.json'),
  verdicts: join(fillDir, 'verdicts.json'),
};
const readFill = (key, fallback) => (existsSync(fillPaths[key]) ? mayJson(fillPaths[key], `logo-fill ${key}`) : null) ?? fallback;
/** @type {Map<string, {newFavicon: string, sourceUrl: string, kind: string, judge: {verdict: string, why: string}|null}>} */
let logoFills = new Map();
/** Everything the write step needs; null when the fill step did not run. */
let fill = null;
let fillNote = 'logo-fill: skipped (--no-logo-fill)';
if (args.logoFill) {
  try {
    const attempts = readFill('attempts', {});
    const candidates = readFill('candidates', {});
    const verdicts = readFill('verdicts', {});
    const settled = settleQueue({ candidates, verdicts, day });
    // A station that got a logo some other way since it was queued is done.
    logoFills = new Map([...settled.fills].filter(([id]) => !publishedById.get(id)?.favicon));
    const outcomes = new Map(settled.outcomes);
    let generic = [...new Set([...readFill('generic', []), ...settled.generic])];

    // Queue new candidates while the judge keeps up.
    const room = Math.max(0, PENDING_MAX - settled.pending);
    const homepageVerdict = new Map(Object.entries(record?.stations ?? {}).map(([id, f]) => [id, f?.homepage?.v ?? '']));
    const targets = fillTargets({
      published: catalog.filter((s) => !candidates[s.id]),
      latestLogoDetail,
      homepageVerdict,
      tiers: plan.tiers ?? {},
      plays: plan.plays ?? {},
      hot: plan.hot ?? [],
      attempts,
      day,
      max: room > 0 ? args.maxFill : 0,
    }).filter((t) => !isBotUnpublished(yamlById.get(t.id)));
    const results = await findLogos(targets, { concurrency: 8 });
    for (const r of results) if (r.outcome !== 'found') outcomes.set(r.id, { o: r.outcome, d: r.detail });
    const found = results.filter((r) => r.outcome === 'found').map((r) => r.find);
    const sifted = dropPlatformDefaults(found, generic);
    generic = sifted.generic;
    for (const f of sifted.dropped) outcomes.set(f.id, { o: 'rejected', d: 'platform-default' });
    const added = {};
    for (const f of sifted.kept.slice(0, room)) {
      added[f.id] = { url: f.url, sourceUrl: f.homepage, kind: f.kind, site: f.site, hash: f.hash, size: `${f.width}x${f.height}`, day };
    }
    fill = { attempts, candidates, verdicts, settled, outcomes, generic, added };
    fillNote = `logo-fill: judged yes ${settled.fills.size} / no ${settled.outcomes.size}, expired ${settled.expired.length} · ` +
      `tried ${targets.length}, found ${found.length}, platform-default ${sifted.dropped.length}, queued ${Object.keys(added).length} · ` +
      `${settled.pending + Object.keys(added).length} awaiting the judge` + (room === 0 ? ' (queue full — finder paused)' : '');
  } catch (err) {
    fillNote = `logo-fill: failed (${err.message}) — no fills this run`;
    log(fillNote);
  }
}

// ─── decide (rules 1–5, 7, 8, 8b, 9) ─────────────────────────────────

let result = decide({
  streaks,
  latestDetail,
  latestLogoDetail,
  tiers: plan.tiers ?? {},
  yamlById,
  publishedIds,
  foldCanonicals,
  highlightIds,
  edge,
  logoUpgrades,
  logoFills,
  metrics,
  now,
  caps: { auto: args.cap },
});

// ─── RB swap (rule 6) ────────────────────────────────────────────────

let rbNote = 'rb: skipped (--no-rb)';
if (args.rb && !result.circuitBreaker) {
  try {
    const bound = candidateSwapIds(result.actions)
      .map((id) => ({ id, uuid: yamlById.get(id)?.stationuuid }))
      .filter((c) => typeof c.uuid === 'string' && c.uuid)
      .slice(0, args.maxRb);
    const swaps = new Map();
    let differing = 0;
    let duplicating = 0;
    // A swap onto a URL that fingerprints like another published row ships
    // an incomplete collapse group and fails check-duplicates in CI (SomaFM
    // bitrate siblings, 2026-11-14→21). Leave those to a curator.
    const fpOwner = new Map();
    for (const s of catalog) {
      const fp = s?.id ? streamFingerprint(s.streamUrl) : '';
      if (fp && !fpOwner.has(fp)) fpOwner.set(fp, s.id);
      else if (fp && fpOwner.get(fp) !== s.id) fpOwner.set(fp, '*');
    }
    const duplicatesAnother = (id, url) => {
      const fp = streamFingerprint(url);
      const owner = fp ? fpOwner.get(fp) : undefined;
      return owner !== undefined && owner !== id;
    };
    if (bound.length) {
      const records = await fetchByUuid(bound.map((c) => c.uuid));
      const byUuid = new Map(records.map((r) => [r.stationuuid, r]));
      for (const { id, uuid } of bound) {
        const rb = byUuid.get(uuid);
        const candidate = typeof rb?.url_resolved === 'string' ? rb.url_resolved.trim() : '';
        if (!/^https:\/\//i.test(candidate) || candidate === streamUrlOf(id)) continue;
        differing += 1;
        if (duplicatesAnother(id, candidate)) {
          duplicating += 1;
          continue;
        }
        let verdict = null;
        try {
          verdict = await lenientProbe(candidate);
        } catch {
          verdict = null;
        }
        if (verdict?.verdict === 'ok' || verdict?.verdict === 'ok-hls') {
          swaps.set(id, { newUrl: candidate, newCodec: rb.codec ? String(rb.codec).toUpperCase() : null });
        }
      }
    }
    result = { ...result, actions: applySwaps(result.actions, swaps) };
    rbNote = `rb: looked up ${bound.length}, ${differing} with a different https url_resolved, ` +
      `${duplicating} would duplicate another row, ${swaps.size} swap(s)`;
  } catch (err) {
    rbNote = `rb: failed (${err.message}) — no swaps this run`;
    log(rbNote);
  }
} else if (result.circuitBreaker) {
  rbNote = 'rb: skipped (circuit breaker)';
}

// ─── write ───────────────────────────────────────────────────────────

const text = JSON.stringify(result, null, 2) + '\n';
for (const path of [resolve(args.out), join(dataDir, 'actions', `${result.day}.json`)]) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

// Logo-fill memory: who was tried and what came of it (a station that came
// up empty, or that the judge turned down, waits FILL_RETRY_DAYS; a proposed
// fill is remembered too, so a PR closed unmerged is not re-proposed every
// morning), the pictures learned to be platform defaults, and the queue.
if (fill) {
  const queue = closeQueue({ candidates: fill.candidates, verdicts: fill.verdicts, settled: fill.settled, added: fill.added, result });
  for (const id of queue.proposed) fill.outcomes.set(id, { o: 'proposed', d: fill.settled.fills.get(id)?.newFavicon });
  for (const [id, { o, d }] of fill.outcomes) fill.attempts[id] = d ? { day, o, d: String(d).slice(0, 200) } : { day, o };
  mkdirSync(fillDir, { recursive: true });
  const sorted = Object.fromEntries(Object.entries(fill.attempts).sort(([a], [b]) => a.localeCompare(b)));
  const put = (key, value) => writeFileSync(fillPaths[key], JSON.stringify(value, null, 1) + '\n');
  put('attempts', sorted);
  put('generic', [...fill.generic].sort());
  put('candidates', queue.candidates);
  put('verdicts', queue.verdicts);
}

const counts = {};
for (const a of result.actions) {
  const key = a.action === 'review' ? `review(${a.proposed})` : a.action;
  counts[key] = (counts[key] ?? 0) + 1;
}
const skippedBy = {};
for (const s of result.skipped) skippedBy[s.why] = (skippedBy[s.why] ?? 0) + 1;
const fmt = (o) => (Object.keys(o).length ? Object.entries(o).map(([k, v]) => `${k} ${v}`).join(', ') : 'none');

console.log(
  `decide-actions: day ${result.day} · ${Object.keys(streaks).length} streaks, ${publishedIds.size} published, ` +
    `${foldCanonicals.size} fold canonicals, ${highlightIds.size} highlighted · ` +
    `circuit breaker ${result.circuitBreaker ? `TRIPPED (${result.circuitBreakerReason})` : 'off'} · ` +
    `actions: ${fmt(counts)} · skipped: ${fmt(skippedBy)} · ${edgeNote} · ${rbNote} · ${logoNote} · ${fillNote} · ` +
    `→ ${resolve(args.out)} and ${join(dataDir, 'actions', `${result.day}.json`)}`,
);
