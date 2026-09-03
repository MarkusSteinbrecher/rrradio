#!/usr/bin/env node
/**
 * Render the weekly catalog-quality digest (ADR 002 — "Report").
 *
 *   node tools/health-digest.mjs --data health-data/ --out body.md \
 *     [--days 7] [--catalog public/stations.json] [--now ISO]
 *
 * Exit code is always 0 and the file is always written: a digest that fails
 * would turn the probe workflow red, and in this loop red must mean "the
 * tooling broke", never "some streams are dead". An unreadable input yields
 * a short digest naming what was missing.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readObservations, parseObservations } from './lib/observations.mjs';
import { renderDigest, renderMissingDigest } from './lib/health-digest.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const args = parseArgs(process.argv.slice(2));
function parseArgs(argv) {
  const out = { data: null, out: null, days: 7, catalog: 'public/stations.json', now: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--data') out.data = String(argv[++i] ?? '');
    else if (a === '--out') out.out = String(argv[++i] ?? '');
    else if (a === '--days') out.days = Math.max(1, Number(argv[++i]) || 7);
    else if (a === '--catalog') out.catalog = String(argv[++i] ?? '');
    else if (a === '--now') out.now = String(argv[++i] ?? '');
    else if (a === '--help' || a === '-h') {
      console.log('usage: health-digest --data <dir> --out body.md [--days 7] [--catalog p] [--now ISO]');
      process.exit(0);
    } else {
      console.error(`health-digest: unknown argument "${a}"`);
      process.exit(0); // see the header: this tool never fails the workflow
    }
  }
  return out;
}

const now = args.now ? new Date(args.now).toISOString() : new Date().toISOString();
const resolve = (p) => (p.startsWith('/') ? p : join(root, p));
const missing = [];

function readJson(path, label) {
  try {
    if (!existsSync(path)) throw new Error('not found');
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    missing.push(label);
    return null;
  }
}

let body;
try {
  const dataDir = args.data ? resolve(args.data) : null;
  if (!dataDir) missing.push('--data');

  const record = dataDir ? readJson(join(dataDir, 'station-health.json'), 'station-health.json') : null;
  const streaks = dataDir ? readJson(join(dataDir, 'streaks.json'), 'streaks.json') : null;
  const metrics = dataDir ? readJson(join(dataDir, 'metrics.json'), 'metrics.json') : null;
  const plan = dataDir ? readJson(join(dataDir, 'plan.json'), 'plan.json') : null;
  const catalogRaw = readJson(resolve(args.catalog), args.catalog);
  const catalog = Array.isArray(catalogRaw) ? catalogRaw : (catalogRaw?.stations ?? []);

  let history = null;
  try {
    const path = join(dataDir ?? '', 'metrics-history.ndjson');
    history = existsSync(path) ? parseObservations(readFileSync(path, 'utf8')) : [];
  } catch {
    history = [];
  }

  // Only the window's rows are needed — recovery looks back `days`, no further.
  let rows = [];
  try {
    const sinceDay = new Date(Date.parse(now) - args.days * 86_400_000).toISOString().slice(0, 10);
    rows = dataDir ? readObservations(dataDir, { sinceDay }) : [];
  } catch {
    rows = [];
  }

  // A digest without the record, the streaks or the metrics has nothing to
  // say; missing plan / history / observations only thin it out.
  body =
    record && streaks && metrics
      ? renderDigest({ record, streaks, metrics, history, plan, catalog, rows, days: args.days, now })
      : renderMissingDigest(missing, now);
} catch (err) {
  body = renderMissingDigest([...missing, `unexpected: ${err.message}`], now);
}

if (args.out) {
  const path = resolve(args.out);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
  console.log(`health-digest: wrote ${path} (${body.length} bytes)${missing.length ? `; missing ${missing.join(', ')}` : ''}`);
} else {
  process.stdout.write(body);
}
process.exit(0);
