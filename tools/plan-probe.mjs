#!/usr/bin/env node
/**
 * Plan one day of stream probing (ADR 002 — catalog quality loop).
 *
 * Writes plan.json: the hot set (curated tier ∪ stations people actually
 * played), the day's rotation seventh, per-station tiers, and the targets
 * split into balanced shards. `tools/health-probe.mjs --plan … --shard i`
 * consumes it; the merge job keeps it for the play-weighted metrics.
 *
 *   node tools/plan-probe.mjs --out plan.json --shards 6
 *   node tools/plan-probe.mjs --out plan.json --day 2026-09-04 --offline
 *   node tools/plan-probe.mjs --out plan.json --full        # manual sweep
 *
 * The play-stats fetch is best-effort: a Worker outage must not stop the
 * probe, it only shrinks the hot set to the curated tier.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { buildPlan } from './lib/probe-plan.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const PUBLISHABLE = new Set(['working', 'stream-only', 'icy-only']);
const TOP_STATIONS_URL = 'https://stats.rrradio.org/api/public/top-stations?days=30&limit=50';
const FETCH_TIMEOUT_MS = 15000;

// ─── args ────────────────────────────────────────────────────────────

const args = parseArgs(process.argv.slice(2));
function parseArgs(argv) {
  const out = { out: null, shards: 6, day: new Date().toISOString().slice(0, 10), offline: false, full: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--out') out.out = String(argv[++i] ?? '');
    else if (a === '--shards') out.shards = Math.max(1, Number(argv[++i]) || 6);
    else if (a === '--day') out.day = String(argv[++i] ?? '');
    else if (a === '--offline') out.offline = true;
    else if (a === '--full') out.full = true;
    else if (a === '--help' || a === '-h') {
      console.log('usage: plan-probe --out plan.json [--shards 6] [--day YYYY-MM-DD] [--offline] [--full]');
      process.exit(0);
    } else {
      console.error(`plan-probe: unknown argument "${a}"`);
      process.exit(1);
    }
  }
  if (!out.out) {
    console.error('plan-probe: --out <plan.json> is required');
    process.exit(1);
  }
  return out;
}

// ─── catalog ─────────────────────────────────────────────────────────

const catalog = JSON.parse(readFileSync(join(root, 'public/stations.json'), 'utf8'));
const allStations = Array.isArray(catalog) ? catalog : catalog.stations;
if (!Array.isArray(allStations)) {
  console.error('plan-probe: public/stations.json missing stations[] (run `npm run catalog`)');
  process.exit(1);
}

// The published artifact usually carries status/featured, but it is a build
// output — the YAML is the source of truth, so fill in anything missing.
const yamlById = new Map();
for (const s of parseYaml(readFileSync(join(root, 'data/stations.yaml'), 'utf8')) ?? []) {
  if (s?.id) yamlById.set(s.id, s);
}
const stations = allStations
  .map((s) => {
    const y = yamlById.get(s.id);
    return {
      id: s.id,
      name: s.name,
      status: s.status ?? y?.status ?? null,
      featured: s.featured ?? y?.featured ?? false,
    };
  })
  .filter((s) => PUBLISHABLE.has(s.status));

const highlights = parseYaml(readFileSync(join(root, 'data/highlights.yaml'), 'utf8')) ?? [];
const highlightIds = new Set(
  (Array.isArray(highlights) ? highlights : []).map((h) => h?.station).filter((id) => typeof id === 'string'),
);

// ─── play stats (best effort) ────────────────────────────────────────

const topStations = args.offline ? [] : await fetchTopStations();

async function fetchTopStations() {
  try {
    const res = await fetch(TOP_STATIONS_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return Array.isArray(data?.items) ? data.items : [];
  } catch (err) {
    console.error(`plan-probe: top-stations fetch failed (${err.message}) — planning without play data`);
    return [];
  }
}

// ─── plan ────────────────────────────────────────────────────────────

const plan = buildPlan({
  stations,
  topStations,
  highlightIds,
  day: args.day,
  shards: args.shards,
  full: args.full,
});

const outPath = resolve(args.out);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(plan) + '\n');

const total = plan.targets.reduce((n, shard) => n + shard.length, 0);
const sizes = plan.targets.map((shard) => shard.length).join('/');
const curated = Object.values(plan.tiers).filter((t) => t === 'curated').length;
console.log(
  `plan-probe: day ${plan.day} (rotation slot ${plan.rotation.slot}/7), ` +
    `${stations.length} published (${curated} curated, ${highlightIds.size} highlighted), ` +
    `hot ${plan.hot.length} (${Object.keys(plan.plays).length} with plays), ` +
    `rotation ${plan.rotation.count}${args.full ? ', --full' : ''} → ` +
    `${total} target(s) over ${plan.shards} shard(s) [${sizes}] → ${outPath}`,
);
