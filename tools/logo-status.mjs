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

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
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

function loadLogoQuality() {
  const path = join(root, 'public/station-logo-quality.json');
  if (!existsSync(path)) return { available: false, byId: new Map() };
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    const byId = new Map();
    for (const row of raw.stations ?? []) {
      if (row?.id) byId.set(row.id, row);
    }
    return { available: true, byId };
  } catch (err) {
    console.warn(`logo-status: couldn't read station-logo-quality.json (${err.message})`);
    return { available: false, byId: new Map() };
  }
}

function inc(map, key) {
  map[key] = (map[key] ?? 0) + 1;
}

function countryOf(station) {
  return String(station.country || '??').toUpperCase();
}

function errorLooksDead(error) {
  return /^HTTP (?:404|410)\b/.test(String(error || ''));
}

function errorLooksUpgradable(error) {
  const e = String(error || '').toLowerCase();
  return e.includes('unsupported scheme') || /^http (?:400|403)\b/.test(e);
}

function qualityAction(station, quality) {
  if (!quality) return null;
  if (quality.error) {
    if (errorLooksDead(quality.error)) {
      return station.homepage ? 'scrape-missing' : 'needs-manual-homepage';
    }
    if (errorLooksUpgradable(quality.error)) {
      return station.homepage ? 'scrape-upgrade' : 'needs-manual-homepage';
    }
    return 'reprobe-logo';
  }
  if (quality.bucket === 'poor' || quality.bucket === 'unknown') {
    return station.homepage ? 'scrape-upgrade' : 'needs-manual-homepage';
  }
  return null;
}

function mergeLogoState(logo, quality) {
  if (!quality) return logo;
  if (quality.error) {
    return {
      ...logo,
      state: 'bad',
      tier: logo.source === 'local' ? 'curated-error' : errorLooksDead(quality.error) ? 'dead' : 'probe-error',
      reason: `probe failed: ${quality.error}`,
      upgradeRecommended: true,
    };
  }
  if (quality.bucket === 'poor' || quality.bucket === 'unknown') {
    const size = quality.width && quality.height ? `${quality.width}x${quality.height}` : 'unknown size';
    return {
      ...logo,
      state: 'warn',
      tier: quality.bucket === 'poor' ? 'poor-quality' : 'unknown-quality',
      reason: `${quality.bucket} logo quality (${size})`,
      upgradeRecommended: true,
    };
  }
  return logo;
}

function rowAction(station, logo, quality, hasQualityReport) {
  if (logo.tier === 'missing') {
    return station.homepage ? 'scrape-missing' : 'needs-manual-homepage';
  }
  if (logo.source === 'local') {
    if (quality?.error) return 'fix-local-logo';
    if (quality?.bucket === 'poor' || quality?.bucket === 'unknown') return 'improve-curated-logo';
    if (hasQualityReport && !quality) return 'probe-logo';
    return 'keep-curated';
  }
  if (quality?.error) {
    return qualityAction(station, quality);
  }
  // Explicit human approval overrides URL heuristics entirely.
  if (station.faviconOk === true) return 'keep';
  if (hasQualityReport && !quality) return 'probe-logo';
  const probeAction = qualityAction(station, quality);
  if (probeAction) return probeAction;
  // Known-provenance sources suppress URL-heuristic churn only after the
  // optional real image probe has had a chance to flag broken/poor assets —
  // EXCEPT non-free wikipedia/en logos, which carry `faviconSource: wiki` yet
  // must still be migrated off the non-free namespace (#472).
  if (station.faviconSource && logo.tier !== 'non-free-wiki') return 'keep';
  if (!station.homepage) {
    return logo.upgradeRecommended ? 'needs-manual-homepage' : 'keep';
  }
  if (logo.upgradeRecommended) return 'scrape-upgrade';
  return 'keep';
}

const stations = loadStations();
const logoQuality = loadLogoQuality();
const rows = stations.map((station) => {
  const logo = classifyLogoUrl(station.favicon);
  const quality = logoQuality.byId.get(station.id);
  const mergedLogo = mergeLogoState(logo, quality);
  return {
    id: station.id,
    name: station.name,
    country: countryOf(station),
    status: station.status,
    homepage: station.homepage ?? null,
    favicon: station.favicon ?? null,
    faviconSource: station.faviconSource ?? null,
    faviconSourceUrl: station.faviconSourceUrl ?? null,
    faviconLicense: station.faviconLicense ?? null,
    faviconOk: station.faviconOk ?? null,
    source: mergedLogo.source,
    tier: mergedLogo.tier,
    state: mergedLogo.state,
    reason: mergedLogo.reason,
    upgradeRecommended: mergedLogo.upgradeRecommended,
    npQuality: quality?.bucket ?? null,
    probeSource: quality?.source ?? null,
    probeFormat: quality?.format ?? null,
    probeWidth: quality?.width ?? null,
    probeHeight: quality?.height ?? null,
    probeBytes: quality?.bytes ?? null,
    probeError: quality?.error ?? null,
    action: rowAction(station, logo, quality, logoQuality.available),
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
    npQuality: row.npQuality,
    probeError: row.probeError,
    action: row.action,
  }));

const byTier = {};
const byState = {};
const byAction = {};
const byStatus = {};
const byCountry = {};
const byNpQuality = {};
for (const row of rows) {
  inc(byTier, row.tier);
  inc(byState, row.state);
  inc(byAction, row.action);
  inc(byStatus, row.status || 'unknown');
  inc(byCountry, row.country);
  inc(byNpQuality, row.npQuality || 'not-probed');
}

const upgradeCandidates = rows.filter((row) => row.action === 'scrape-upgrade');
const missingCandidates = rows.filter((row) => row.action === 'scrape-missing');
const trueMissingCandidates = missingCandidates.filter((row) => row.tier === 'missing');
const deadLogoCandidates = missingCandidates.filter((row) => row.tier !== 'missing');
const manualHomepage = rows.filter((row) => row.action === 'needs-manual-homepage');

const report = {
  generatedAt: new Date().toISOString(),
  totals: {
    stations: rows.length,
    ok: byState.ok ?? 0,
    warn: byState.warn ?? 0,
    bad: byState.bad ?? 0,
    localAssets: rows.filter((row) => row.source === 'local').length,
    goodRemote: byTier['good-remote'] ?? 0,
    weakRemote: byTier.weak ?? 0,
    genericRemote: byTier.generic ?? 0,
    thirdPartyRemote: byTier['third-party'] ?? 0,
    httpRemote: byTier.http ?? 0,
    missing: byTier.missing ?? 0,
    upgradeCandidates: upgradeCandidates.length,
    missingWithHomepage: trueMissingCandidates.length,
    deadLogoCandidates: deadLogoCandidates.length,
    manualHomepageNeeded: manualHomepage.length,
    probeNeeded: byAction['probe-logo'] ?? 0,
    reprobeNeeded: byAction['reprobe-logo'] ?? 0,
    poorOrUnknownQuality: (byNpQuality.poor ?? 0) + (byNpQuality.unknown ?? 0),
    probeErrors: rows.filter((row) => row.probeError).length,
  },
  byTier,
  byState,
  byAction,
  byStatus,
  byCountry,
  byNpQuality,
  examples: {
    upgrade: upgradeCandidates.slice(0, 50),
    missing: trueMissingCandidates.slice(0, 50),
    dead: deadLogoCandidates.slice(0, 50),
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
