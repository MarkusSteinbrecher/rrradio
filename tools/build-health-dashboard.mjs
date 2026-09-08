#!/usr/bin/env node
/**
 * Build the public catalog-health dashboard artifact (docs/station-health.md,
 * "Public dashboard") from the health-data branch + the published catalog.
 *
 *   node tools/build-health-dashboard.mjs --data health-data \
 *        [--catalog public/stations.json] [--out health-data/dashboard.json]
 *
 * In CI the station-probe merge job runs this right after derive-health and
 * commits the result onto health-data, where the page fetches it directly
 * (raw.githubusercontent.com) so a reader sees today's probe without waiting
 * for a site deploy. Locally, point --out at public/catalog-health.json
 * (gitignored) to feed `npm run dev`.
 *
 * Every input except the catalog is optional — a missing streaks/plan/metrics
 * file degrades the artifact, it never fails the build.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { buildDashboard, serialiseDashboard } from './lib/health-dashboard.mjs';

function parseArgs(argv) {
  const out = { data: 'health-data', catalog: 'public/stations.json', out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--data') out.data = argv[++i];
    else if (a === '--catalog') out.catalog = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log('usage: build-health-dashboard --data <dir> [--catalog <stations.json>] [--out <file>]');
      process.exit(0);
    } else {
      console.error(`build-health-dashboard: unknown argument ${a}`);
      process.exit(1);
    }
  }
  if (!out.out) out.out = join(out.data, 'dashboard.json');
  return out;
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readNdjson(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

const args = parseArgs(process.argv.slice(2));
const data = resolve(args.data);

const catalogRaw = readJson(resolve(args.catalog), null);
if (!catalogRaw) {
  console.error(`build-health-dashboard: catalog not found at ${args.catalog}`);
  process.exit(1);
}
const catalog = Array.isArray(catalogRaw) ? catalogRaw : catalogRaw.stations ?? [];

const dashboard = buildDashboard({
  catalog,
  record: readJson(join(data, 'station-health.json'), null),
  streaks: readJson(join(data, 'streaks.json'), {}),
  plan: readJson(join(data, 'plan.json'), {}),
  metrics: readJson(join(data, 'metrics.json'), null),
  history: readNdjson(join(data, 'metrics-history.ndjson')),
});

const outPath = resolve(args.out);
mkdirSync(dirname(outPath), { recursive: true });
const text = serialiseDashboard(dashboard);
writeFileSync(outPath, text, 'utf8');
console.log(
  `build-health-dashboard: ${dashboard.rows.length} rows (${dashboard.counts.curated} curated), ` +
    `${dashboard.history.length} history points, ${(text.length / 1024 / 1024).toFixed(1)} MB → ${args.out}`,
);
