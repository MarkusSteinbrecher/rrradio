#!/usr/bin/env node
/**
 * Derive the health record, streaks and metrics from the observation log
 * (ADR 002 — catalog quality loop, the "merge" step of station-probe.yml).
 *
 *   node tools/derive-health.mjs --data health-data/ \
 *     [--catalog public/stations.json] [--record public/station-health.json] \
 *     [--now ISO]
 *
 * Reads every `<data>/observations/*.ndjson` plus `<data>/plan.json`, then
 * writes: the health record (through tools/lib/health-record.mjs, the only
 * writer), `<data>/streaks.json`, `<data>/metrics.json`, one appended row in
 * `<data>/metrics-history.ndjson`, and deletes observation files older than
 * the 90-day rollup cutoff.
 *
 * Idempotent: running it twice on the same inputs leaves the same bytes.
 */

import { existsSync, readFileSync, readdirSync, rmSync, appendFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readObservations } from './lib/observations.mjs';
import { loadHealthFrom, saveHealthTo, applyFacet, pruneStations } from './lib/health-record.mjs';
import {
  latestByStationFacet,
  toFacetUpdates,
  computeStreaks,
  computeMetrics,
  coverage,
  rollupCutoffDay,
  serialiseStreaks,
} from './lib/derive-health.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const args = parseArgs(process.argv.slice(2));
function parseArgs(argv) {
  const out = { data: null, catalog: 'public/stations.json', record: 'public/station-health.json', now: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--data') out.data = String(argv[++i] ?? '');
    else if (a === '--catalog') out.catalog = String(argv[++i] ?? '');
    else if (a === '--record') out.record = String(argv[++i] ?? '');
    else if (a === '--now') out.now = String(argv[++i] ?? '');
    else if (a === '--help' || a === '-h') {
      console.log('usage: derive-health --data <dir> [--catalog p] [--record p] [--now ISO]');
      process.exit(0);
    } else {
      console.error(`derive-health: unknown argument "${a}"`);
      process.exit(1);
    }
  }
  if (!out.data) {
    console.error('derive-health: --data <health-data dir> is required');
    process.exit(1);
  }
  return out;
}

const now = args.now ? new Date(args.now).toISOString() : new Date().toISOString();
const dataDir = resolve(args.data);
const catalogPath = resolve(args.catalog);
const recordPath = resolve(args.record);

/** Paths are relative to the repo root unless already absolute. */
function resolve(p) {
  return p.startsWith('/') ? p : join(root, p);
}

// ─── inputs ──────────────────────────────────────────────────────────

const rows = readObservations(dataDir);
const parsedCatalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
const catalog = Array.isArray(parsedCatalog) ? parsedCatalog : parsedCatalog.stations;
const planPath = join(dataDir, 'plan.json');
const plan = existsSync(planPath) ? JSON.parse(readFileSync(planPath, 'utf8')) : null;

const ids = new Set(catalog.map((s) => s.id));
// The record, its run tallies and the metrics all describe the published
// catalog, so they see only catalogued stations. Streaks describe the log
// itself and keep every observed station — the log is already bounded by the
// 90-day rollup, and phase-2 republish decisions need the history of a
// station that is currently unpublished.
const latest = latestByStationFacet(rows.filter((row) => ids.has(row.id)));
const streaks = computeStreaks(rows);
const metrics = computeMetrics({ catalog, latest, plan, streaks, now });

// ─── health record ───────────────────────────────────────────────────

const record = loadHealthFrom(recordPath);
const runMeta = { tool: 'derive-health', scope: 'rolling', at: now };
const applied = [];
for (const facet of ['stream', 'icy']) {
  const updates = toFacetUpdates(latest, facet);
  if (!updates.size) continue; // never invent a run for a facet with no rows
  const res = applyFacet(record, facet, updates, runMeta);
  // applyFacet counts the updates it was handed; the ADR wants `checked` to
  // read as 7-day coverage of the rolling sweep, which is a property of the
  // log, not of this call. Overriding here keeps applyFacet's semantics.
  record.runs[facet].checked = coverage(latest, facet, now);
  applied.push(`${facet} ${res.transitions} transitions`);
}
const pruned = pruneStations(record, ids);
saveHealthTo(recordPath, record);

// ─── derived artifacts ───────────────────────────────────────────────

mkdirSync(dataDir, { recursive: true });
writeFileSync(join(dataDir, 'streaks.json'), serialiseStreaks(streaks));
writeFileSync(join(dataDir, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
appendFileSync(join(dataDir, 'metrics-history.ndjson'), `${JSON.stringify(metrics)}\n`);

// ─── rollup ──────────────────────────────────────────────────────────

const cutoff = rollupCutoffDay(now);
const obsDir = join(dataDir, 'observations');
let rolledUp = 0;
if (existsSync(obsDir)) {
  for (const file of readdirSync(obsDir)) {
    if (!/^\d{4}-\d{2}-\d{2}\.ndjson$/.test(file) || file.slice(0, 10) >= cutoff) continue;
    rmSync(join(obsDir, file));
    rolledUp += 1;
  }
}

const availability = metrics.availability === null ? 'n/a' : `${(metrics.availability * 100).toFixed(1)}%`;
console.log(
  `derive-health: ${rows.length} observations over ${latest.size} stations → ` +
    `${applied.join(', ') || 'no facets applied'}; ${pruned} pruned; ` +
    `freshness ${(metrics.freshness * 100).toFixed(1)}% (${metrics.observed7d}/${metrics.published}), ` +
    `availability ${availability}, stream ok/warn/bad ${metrics.stream.ok}/${metrics.stream.warn}/${metrics.stream.bad} ` +
    `(${metrics.stream.hard} hard, ${metrics.stream.soft} soft), hot set ${metrics.hotSet.bad}/${metrics.hotSet.size} bad; ` +
    `${rolledUp} observation file(s) older than ${cutoff} rolled up.`,
);
