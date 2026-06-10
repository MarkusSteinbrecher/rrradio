#!/usr/bin/env node
/**
 * Bootstrap the unified health record from whatever check artifacts already
 * exist (docs/station-health.md). One-shot migration helper: each source's
 * own generatedAt becomes that facet's lastRun, so a month-old report shows
 * up as a month old in the tracker instead of masquerading as fresh.
 *
 *   node tools/health-import.mjs
 *
 * Sources (each skipped when missing, or when the record already holds a
 * fresher run for that facet):
 *   public/station-status.json     → stream/https/icy/metadata/fetcher/program
 *   public/station-drift.json      → drift   (clean set reconstructed from YAML)
 *   .cache/homepage-status.json    → homepage
 *
 * The duplicate and logo facets are NOT imported — `npm run check-duplicates`
 * and `npm run logo-status` are offline and fast; run them instead.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { loadHealth, saveHealth, applyFacet } from './lib/health-record.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const PUBLISHABLE = new Set(['working', 'stream-only', 'icy-only']);

const record = loadHealth(root);

function readJson(rel) {
  const path = join(root, rel);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function fresherExists(facet, sourceAt) {
  const run = record.runs[facet];
  return !!run && run.lastRun >= sourceAt;
}

// ─── station-status.json → probe facets ──────────────────────────────

const status = readJson('public/station-status.json');
if (status?.stations && status.generatedAt) {
  // Old analyze.mjs rows and new health-probe rows share the per-check
  // {state, detail} shape; `metadataApi` maps onto the `metadata` facet.
  const KEY_MAP = {
    stream: 'stream',
    https: 'https',
    icy: 'icy',
    metadataApi: 'metadata',
    fetcher: 'fetcher',
    program: 'program',
  };
  for (const [checkKey, facet] of Object.entries(KEY_MAP)) {
    if (fresherExists(facet, status.generatedAt)) {
      console.log(`skip ${facet}: record already has a fresher run`);
      continue;
    }
    const updates = new Map();
    for (const s of status.stations) {
      const c = s.checks?.[checkKey];
      if (!c?.state) continue;
      updates.set(s.id, c.detail == null ? { v: c.state } : { v: c.state, d: c.detail });
    }
    if (updates.size === 0) continue;
    const res = applyFacet(record, facet, updates, {
      tool: 'health-import(station-status)',
      scope: 'partial',
      at: status.generatedAt,
    });
    console.log(`imported ${facet}: ${res.checked} station(s) from station-status.json (${status.generatedAt})`);
  }
} else {
  console.log('no station-status.json to import');
}

// ─── station-drift.json → drift facet ────────────────────────────────

const driftReport = readJson('public/station-drift.json');
if (driftReport?.checkedAt && !fresherExists('drift', driftReport.checkedAt)) {
  const stations = parseYaml(readFileSync(join(root, 'data/stations.yaml'), 'utf8'));
  const driftById = new Map((driftReport.drift ?? []).map((d) => [d.id, d.reason]));
  const missingIds = new Set((driftReport.missing ?? []).map((m) => m.id));
  const updates = new Map();
  for (const s of stations) {
    if (!PUBLISHABLE.has(s?.status)) continue;
    if (!s.stationuuid) updates.set(s.id, { v: 'na', d: 'not RB-bound' });
    else if (missingIds.has(s.id)) updates.set(s.id, { v: 'bad', d: 'record gone upstream' });
    else if (driftById.has(s.id)) updates.set(s.id, { v: 'warn', d: driftById.get(s.id) });
    else updates.set(s.id, { v: 'ok' });
  }
  const res = applyFacet(record, 'drift', updates, {
    tool: 'health-import(station-drift)',
    scope: 'full',
    at: driftReport.checkedAt,
  });
  console.log(`imported drift: ${res.checked} station(s) from station-drift.json (${driftReport.checkedAt})`);
} else {
  console.log(driftReport ? 'skip drift: record already has a fresher run' : 'no station-drift.json to import');
}

// ─── .cache/homepage-status.json → homepage facet ────────────────────

const homepages = readJson('.cache/homepage-status.json');
if (homepages?.stations && homepages.generatedAt && !fresherExists('homepage', homepages.generatedAt)) {
  const VERDICT_BY_CLASS = {
    ok: 'ok',
    blocked: 'warn',
    redirect: 'warn',
    dead: 'bad',
    'server-error': 'bad',
    error: 'bad',
  };
  const updates = new Map();
  for (const r of homepages.stations) {
    const v = VERDICT_BY_CLASS[r.class];
    if (!v) continue;
    const d = r.class === 'error' ? (r.reason ?? 'network') : r.class === 'ok' ? null : `HTTP ${r.status}`;
    updates.set(r.id, d == null ? { v } : { v, d });
  }
  if (updates.size > 0) {
    const res = applyFacet(record, 'homepage', updates, {
      tool: 'health-import(homepage-cache)',
      scope: 'partial',
      at: homepages.generatedAt,
    });
    console.log(`imported homepage: ${res.checked} station(s) from .cache/homepage-status.json (${homepages.generatedAt})`);
  }
} else {
  console.log(homepages ? 'skip homepage: record already has a fresher run' : 'no homepage cache to import');
}

saveHealth(root, record);
console.log(`wrote public/station-health.json (${Object.keys(record.stations).length} station(s))`);
