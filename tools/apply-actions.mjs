#!/usr/bin/env node
/**
 * Apply catalog actions (ADR 002 phase 2 — the "act" stage).
 *
 *   node tools/apply-actions.mjs --actions actions.json --data health-data/ \
 *        --mode auto|review [--dry-run] [--summary-out body.md]
 *
 * Reads `actions.json` from tools/decide-actions.mjs, edits
 * `data/stations.yaml` + `public/stations.json` through the pure core in
 * tools/lib/catalog-actions.mjs, writes/deletes the row snapshots under
 * `<data>/unpublished/<id>.json`, then runs the check-catalog gate so the
 * PR the workflow opens from the diff is green by construction.
 *
 * `--mode auto` applies `auto: true` actions (long tail, auto-merged PR);
 * `--mode review` applies `auto: false` ones — the proposal is materialised
 * as a diff because the PR is the review surface. `--dry-run` prints the
 * summary and what would change, writes nothing, skips the gate.
 *
 * The summary (Markdown PR body) always goes to stdout and, when given, to
 * `--summary-out` — also when there was nothing to do, so the workflow can
 * always `cat` it. Exit 0 with nothing to do; the gate's exit code when it
 * fails; 1 on bad input.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyActions, renderSummary } from './lib/catalog-actions.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const args = parseArgs(process.argv.slice(2));
function parseArgs(argv) {
  const out = { actions: null, data: null, mode: null, dryRun: false, summaryOut: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--actions') out.actions = String(argv[++i] ?? '');
    else if (a === '--data') out.data = String(argv[++i] ?? '');
    else if (a === '--mode') out.mode = String(argv[++i] ?? '');
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--summary-out') out.summaryOut = String(argv[++i] ?? '');
    else if (a === '--help' || a === '-h') {
      console.log('usage: apply-actions --actions actions.json --data health-data/ --mode auto|review [--dry-run] [--summary-out body.md]');
      process.exit(0);
    } else {
      console.error(`apply-actions: unknown argument "${a}"`);
      process.exit(1);
    }
  }
  const missing = ['actions', 'data', 'mode'].filter((k) => !out[k]);
  if (missing.length) {
    console.error(`apply-actions: --${missing.join(', --')} required`);
    process.exit(1);
  }
  if (out.mode !== 'auto' && out.mode !== 'review') {
    console.error(`apply-actions: --mode must be auto or review, got "${out.mode}"`);
    process.exit(1);
  }
  return out;
}

/** Paths are relative to the repo root unless absolute (as derive-health does). */
function resolve(p) {
  return p.startsWith('/') ? p : join(root, p);
}

// ─── inputs ──────────────────────────────────────────────────────────

const doc = JSON.parse(readFileSync(resolve(args.actions), 'utf8'));
const actions = Array.isArray(doc?.actions) ? doc.actions : [];
const day = /^\d{4}-\d{2}-\d{2}$/.test(String(doc?.day)) ? doc.day : new Date().toISOString().slice(0, 10);

const yamlPath = join(root, 'data/stations.yaml');
const jsonPath = join(root, 'public/stations.json');
const yamlText = readFileSync(yamlPath, 'utf8');
const payload = JSON.parse(readFileSync(jsonPath, 'utf8'));
const stationsIn = Array.isArray(payload) ? payload : payload?.stations;
if (!Array.isArray(stationsIn)) {
  console.error('apply-actions: public/stations.json missing stations[] (run `npm run catalog`)');
  process.exit(1);
}

// Snapshots are only needed for republishes; read just those, missing
// files stay missing so the core refuses the republish with a clear reason.
const unpublishedDir = join(resolve(args.data), 'unpublished');
const snapshots = {};
for (const a of actions) {
  const kind = a?.action === 'review' ? a.proposed : a?.action;
  if (kind !== 'republish' || typeof a.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(a.id)) continue;
  const p = join(unpublishedDir, `${a.id}.json`);
  if (existsSync(p)) snapshots[a.id] = JSON.parse(readFileSync(p, 'utf8'));
}

// ─── apply ───────────────────────────────────────────────────────────

// Fold canonicals from the dedup report: unpublishing one strands its
// collapsed variants, so the actuator refuses even if a hand-written
// actions file asks for it (the policy already skips them).
const dedupPath = resolve('public/dedup-report.json');
const foldCanonicals = new Set(
  (existsSync(dedupPath) ? JSON.parse(readFileSync(dedupPath, 'utf8')).groups ?? [] : [])
    .filter((g) => Array.isArray(g.members) && g.members.length > 1)
    .map((g) => g.canonicalId),
);
const result = applyActions({ yamlText, stations: stationsIn, actions, snapshots, day, mode: args.mode, foldCanonicals });
const summary = renderSummary({ ...result, mode: args.mode, day });

process.stdout.write(summary);
if (args.summaryOut) {
  const out = resolve(args.summaryOut);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, summary);
}

const written = Object.keys(result.snapshotsWritten);
const log = (msg) => console.error(`apply-actions: ${msg}`);

if (result.applied.length === 0) {
  log(`nothing to do in --mode ${args.mode} (${actions.length} action(s) in file, ${result.errors.length} skipped)`);
  process.exit(0);
}

if (args.dryRun) {
  log(`DRY RUN — ${result.applied.length} action(s) would change data/stations.yaml + public/stations.json ` +
    `(${stationsIn.length} → ${result.stations.length} published rows); ${result.errors.length} skipped`);
  for (const id of written) log(`  would write   ${join(unpublishedDir, `${id}.json`)}`);
  for (const id of result.snapshotsDeleted) log(`  would delete  ${join(unpublishedDir, `${id}.json`)}`);
  log('check-catalog skipped (dry run)');
  process.exit(0);
}

// ─── write ───────────────────────────────────────────────────────────

writeFileSync(yamlPath, result.yamlText);
// Re-stringify exactly as build-catalog does so the diff is the rows we touched.
const nextPayload = Array.isArray(payload) ? result.stations : { ...payload, stations: result.stations };
writeFileSync(jsonPath, `${JSON.stringify(nextPayload, null, 2)}\n`);

if (written.length) mkdirSync(unpublishedDir, { recursive: true });
for (const id of written) {
  writeFileSync(join(unpublishedDir, `${id}.json`), `${JSON.stringify(result.snapshotsWritten[id], null, 2)}\n`);
}
for (const id of result.snapshotsDeleted) rmSync(join(unpublishedDir, `${id}.json`), { force: true });

log(`applied ${result.applied.length} action(s), skipped ${result.errors.length}; ` +
  `${written.length} snapshot(s) written, ${result.snapshotsDeleted.length} deleted; ` +
  `${stationsIn.length} → ${result.stations.length} published rows`);

// ─── gate ────────────────────────────────────────────────────────────

const gate = spawnSync(process.execPath, [join(root, 'tools/check-catalog.mjs')], { cwd: root, stdio: 'inherit' });
if (gate.status !== 0) {
  log('check-catalog failed — the rejected change is still in the working tree; ' +
    '`git checkout -- data/stations.yaml public/stations.json` discards it');
  process.exit(gate.status ?? 1);
}
