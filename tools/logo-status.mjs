#!/usr/bin/env node
/**
 * Build a static logo-quality report for the published station catalog.
 *
 *   node tools/logo-status.mjs
 *   node tools/logo-status.mjs --json-only
 *
 * Output:
 *   public/station-logo-status.json
 *
 * This is intentionally network-free. It classifies what we can infer
 * from the catalog URL itself: curated local asset vs good-looking remote
 * logo vs weak/generic/imported favicon vs missing. Use it before running
 * `scrape-logos` to understand the status quo and to pick the next batch.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyLogoUrl } from './logo-quality.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const JSON_ONLY = process.argv.includes('--json-only');

function loadStations() {
  const raw = JSON.parse(readFileSync(join(root, 'public/stations.json'), 'utf8'));
  const stations = Array.isArray(raw) ? raw : raw.stations;
  if (!Array.isArray(stations)) {
    console.error('logo-status: public/stations.json missing stations[] (run `npm run catalog`)');
    process.exit(1);
  }
  return stations;
}

function inc(map, key) {
  map[key] = (map[key] ?? 0) + 1;
}

function countryOf(station) {
  return String(station.country || '??').toUpperCase();
}

function rowAction(station, logo) {
  if (logo.source === 'local') return 'keep-curated';
  if (!station.homepage) {
    return logo.upgradeRecommended ? 'needs-manual-homepage' : 'keep';
  }
  if (logo.tier === 'missing') return 'scrape-missing';
  if (logo.upgradeRecommended) return 'scrape-upgrade';
  return 'keep';
}

const stations = loadStations();
const rows = stations.map((station) => {
  const logo = classifyLogoUrl(station.favicon);
  return {
    id: station.id,
    name: station.name,
    country: countryOf(station),
    status: station.status,
    homepage: station.homepage ?? null,
    favicon: station.favicon ?? null,
    source: logo.source,
    tier: logo.tier,
    state: logo.state,
    reason: logo.reason,
    upgradeRecommended: logo.upgradeRecommended,
    action: rowAction(station, logo),
  };
});

const actionRows = rows
  .filter((row) => row.action !== 'keep' && row.action !== 'keep-curated')
  .map((row) => ({
    id: row.id,
    country: row.country,
    status: row.status,
    source: row.source,
    tier: row.tier,
    state: row.state,
    reason: row.reason,
    action: row.action,
  }));

const byTier = {};
const byState = {};
const byAction = {};
const byStatus = {};
const byCountry = {};
for (const row of rows) {
  inc(byTier, row.tier);
  inc(byState, row.state);
  inc(byAction, row.action);
  inc(byStatus, row.status || 'unknown');
  inc(byCountry, row.country);
}

const upgradeCandidates = rows.filter((row) => row.action === 'scrape-upgrade');
const missingCandidates = rows.filter((row) => row.action === 'scrape-missing');
const manualHomepage = rows.filter((row) => row.action === 'needs-manual-homepage');

const report = {
  generatedAt: new Date().toISOString(),
  totals: {
    stations: rows.length,
    ok: byState.ok ?? 0,
    warn: byState.warn ?? 0,
    bad: byState.bad ?? 0,
    localAssets: byTier.curated ?? 0,
    goodRemote: byTier['good-remote'] ?? 0,
    weakRemote: byTier.weak ?? 0,
    genericRemote: byTier.generic ?? 0,
    thirdPartyRemote: byTier['third-party'] ?? 0,
    httpRemote: byTier.http ?? 0,
    missing: byTier.missing ?? 0,
    upgradeCandidates: upgradeCandidates.length,
    missingWithHomepage: missingCandidates.length,
    manualHomepageNeeded: manualHomepage.length,
  },
  byTier,
  byState,
  byAction,
  byStatus,
  byCountry,
  examples: {
    upgrade: upgradeCandidates.slice(0, 50),
    missing: missingCandidates.slice(0, 50),
    manualHomepage: manualHomepage.slice(0, 50),
  },
  stations: actionRows,
};

const outPath = join(root, 'public/station-logo-status.json');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(report) + '\n');

if (!JSON_ONLY) {
  console.log(`logo-status: ${rows.length.toLocaleString()} station(s) → ${outPath}`);
  console.log('');
  console.log('Totals:');
  for (const [key, value] of Object.entries(report.totals)) {
    console.log(`  ${key.padEnd(22)} ${String(value).padStart(8)}`);
  }
  console.log('');
  console.log('Actions:');
  for (const [key, value] of Object.entries(byAction).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${key.padEnd(22)} ${String(value).padStart(8)}`);
  }
}
