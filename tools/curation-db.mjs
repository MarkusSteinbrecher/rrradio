#!/usr/bin/env node
/**
 * Local SQLite curation database for station-quality work.
 *
 * The database is a gitignored working memory at `.local/curation.db`.
 * It is not the production source of truth. Git remains the publish
 * surface via data/stations.yaml + generated public artifacts.
 *
 * Usage:
 *   node tools/curation-db.mjs init
 *   node tools/curation-db.mjs ingest
 *   node tools/curation-db.mjs summary
 *   node tools/curation-db.mjs reset
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { classifyLogoUrl } from './logo-quality.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const dbPath = process.env.RRRADIO_CURATION_DB || join(root, '.local', 'curation.db');

const command = process.argv[2] || 'summary';
const valid = new Set(['init', 'ingest', 'summary', 'reset']);
if (!valid.has(command)) {
  console.error('usage: node tools/curation-db.mjs <init|ingest|summary|reset>');
  process.exit(2);
}

function ensureSqlite() {
  const found = spawnSync('sqlite3', ['--version'], { encoding: 'utf8' });
  if (found.status !== 0) {
    console.error('curation-db: sqlite3 CLI not found. Install SQLite or add sqlite3 to PATH.');
    process.exit(2);
  }
}

function runSql(sql, { mode = 'exec' } = {}) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const args = mode === 'csv' ? ['-csv', '-header', dbPath] : [dbPath];
  const res = spawnSync('sqlite3', args, { input: sql, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
  if (res.status !== 0) {
    if (res.stdout) process.stdout.write(res.stdout);
    if (res.stderr) process.stderr.write(res.stderr);
    process.exit(res.status || 1);
  }
  return res.stdout;
}

function sqlString(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : 'NULL';
}

function sqlBool(value) {
  return value ? '1' : '0';
}

function jsonText(value) {
  if (value === null || value === undefined) return null;
  return JSON.stringify(value);
}

const schema = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS stations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  country TEXT,
  status TEXT,
  broadcaster TEXT,
  stream_url TEXT,
  homepage TEXT,
  favicon TEXT,
  logo_tier TEXT,
  logo_state TEXT,
  logo_action TEXT,
  logo_reason TEXT,
  stationuuid TEXT,
  changeuuid TEXT,
  reviewed_at TEXT,
  tags_json TEXT,
  codec TEXT,
  bitrate INTEGER,
  metadata_key TEXT,
  metadata_url TEXT,
  geo_lat REAL,
  geo_lon REAL,
  source_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS stations_country_idx ON stations(country);
CREATE INDEX IF NOT EXISTS stations_status_idx ON stations(status);
CREATE INDEX IF NOT EXISTS stations_logo_action_idx ON stations(logo_action);
CREATE INDEX IF NOT EXISTS stations_stationuuid_idx ON stations(stationuuid);

CREATE TABLE IF NOT EXISTS logo_scrape_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  generated_at TEXT NOT NULL,
  mode TEXT,
  dry_run INTEGER NOT NULL,
  replace_good INTEGER NOT NULL,
  counters_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS logo_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES logo_scrape_runs(id) ON DELETE CASCADE,
  station_id TEXT NOT NULL,
  action TEXT NOT NULL,
  source_url TEXT,
  candidate_url TEXT,
  rel TEXT,
  target_reason TEXT,
  score INTEGER,
  result_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`;

function init() {
  ensureSqlite();
  runSql(schema);
  console.log(`curation-db: initialized ${dbPath}`);
}

function loadJson(path, fallback = null) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function loadCatalogStations() {
  const raw = loadJson(join(root, 'public', 'stations.json'));
  const stations = Array.isArray(raw) ? raw : raw?.stations;
  if (!Array.isArray(stations)) {
    console.error('curation-db: public/stations.json missing stations[]; run npm run catalog first.');
    process.exit(2);
  }
  return stations;
}

function loadYamlById() {
  const yaml = parseYaml(readFileSync(join(root, 'data', 'stations.yaml'), 'utf8'));
  const byId = new Map();
  for (const row of Array.isArray(yaml) ? yaml : []) {
    if (row?.id) byId.set(row.id, row);
  }
  return byId;
}

function loadLogoStatusById() {
  const raw = loadJson(join(root, 'public', 'station-logo-status.json'), { stations: [] });
  const byId = new Map();
  for (const row of raw?.stations || []) {
    if (row?.id) byId.set(row.id, row);
  }
  return { report: raw, byId };
}

function countryOf(station) {
  return String(station.country || '??').toUpperCase();
}

function logoAction(station, logo) {
  if (logo.source === 'local') return 'keep-curated';
  if (!station.homepage) {
    return logo.upgradeRecommended ? 'needs-manual-homepage' : 'keep';
  }
  if (logo.tier === 'missing') return 'scrape-missing';
  if (logo.upgradeRecommended) return 'scrape-upgrade';
  return 'keep';
}

function logoStateFor(station, reportRow) {
  if (reportRow) return reportRow;
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
    action: logoAction(station, logo),
  };
}

function stationSql(station, yamlRow, logoRow) {
  const geo = Array.isArray(station.geo) && station.geo.length === 2 ? station.geo : [];
  return `INSERT INTO stations (
    id, name, country, status, broadcaster, stream_url, homepage, favicon,
    logo_tier, logo_state, logo_action, logo_reason,
    stationuuid, changeuuid, reviewed_at, tags_json, codec, bitrate,
    metadata_key, metadata_url, geo_lat, geo_lon, source_json, updated_at
  ) VALUES (
    ${sqlString(station.id)},
    ${sqlString(station.name)},
    ${sqlString(station.country)},
    ${sqlString(station.status)},
    ${sqlString(station.broadcaster)},
    ${sqlString(station.streamUrl)},
    ${sqlString(station.homepage)},
    ${sqlString(station.favicon)},
    ${sqlString(logoRow?.tier ?? null)},
    ${sqlString(logoRow?.state ?? null)},
    ${sqlString(logoRow?.action ?? null)},
    ${sqlString(logoRow?.reason ?? null)},
    ${sqlString(yamlRow?.stationuuid ?? station.stationuuid ?? null)},
    ${sqlString(yamlRow?.changeuuid ?? station.changeuuid ?? null)},
    ${sqlString(yamlRow?.reviewedAt ?? null)},
    ${sqlString(jsonText(station.tags ?? yamlRow?.tags ?? null))},
    ${sqlString(station.codec)},
    ${sqlNumber(station.bitrate)},
    ${sqlString(station.metadata)},
    ${sqlString(station.metadataUrl)},
    ${sqlNumber(geo[0])},
    ${sqlNumber(geo[1])},
    ${sqlString(JSON.stringify({ catalog: station, yaml: yamlRow ?? null, logo: logoRow ?? null }))},
    CURRENT_TIMESTAMP
  )
  ON CONFLICT(id) DO UPDATE SET
    name=excluded.name,
    country=excluded.country,
    status=excluded.status,
    broadcaster=excluded.broadcaster,
    stream_url=excluded.stream_url,
    homepage=excluded.homepage,
    favicon=excluded.favicon,
    logo_tier=excluded.logo_tier,
    logo_state=excluded.logo_state,
    logo_action=excluded.logo_action,
    logo_reason=excluded.logo_reason,
    stationuuid=excluded.stationuuid,
    changeuuid=excluded.changeuuid,
    reviewed_at=excluded.reviewed_at,
    tags_json=excluded.tags_json,
    codec=excluded.codec,
    bitrate=excluded.bitrate,
    metadata_key=excluded.metadata_key,
    metadata_url=excluded.metadata_url,
    geo_lat=excluded.geo_lat,
    geo_lon=excluded.geo_lon,
    source_json=excluded.source_json,
    updated_at=CURRENT_TIMESTAMP;`;
}

function ingestLogoScrapeReport() {
  const path = join(root, '.cache', 'logo-scrape-report.json');
  const report = loadJson(path);
  if (!report) return 0;

  const sql = [];
  sql.push(`INSERT INTO logo_scrape_runs (generated_at, mode, dry_run, replace_good, counters_json)
    VALUES (
      ${sqlString(report.generatedAt ?? new Date().toISOString())},
      ${sqlString(report.mode ?? null)},
      ${sqlBool(report.dryRun)},
      ${sqlBool(report.replaceGood)},
      ${sqlString(JSON.stringify(report.counters ?? {}))}
    );`);
  sql.push('CREATE TEMP TABLE _last_run_id AS SELECT last_insert_rowid() AS id;');
  for (const row of report.rows || []) {
    sql.push(`INSERT INTO logo_candidates (
      run_id, station_id, action, source_url, candidate_url, rel, target_reason, score, result_reason
    ) VALUES (
      (SELECT id FROM _last_run_id),
      ${sqlString(row.id)},
      ${sqlString(row.action ?? 'none')},
      ${sqlString(row.from ?? null)},
      ${sqlString(row.to ?? null)},
      ${sqlString(row.rel ?? null)},
      ${sqlString(row.targetReason ?? null)},
      ${sqlNumber(row.score)},
      ${sqlString(row.reason ?? null)}
    );`);
  }
  runSql(`BEGIN;\n${sql.join('\n')}\nCOMMIT;`);
  return report.rows?.length ?? 0;
}

function ingest() {
  init();
  const catalog = loadCatalogStations();
  const yamlById = loadYamlById();
  const { report: logoStatus, byId: logoById } = loadLogoStatusById();

  const chunks = ['BEGIN;', 'DELETE FROM stations;'];
  for (const station of catalog) {
    chunks.push(stationSql(station, yamlById.get(station.id), logoStateFor(station, logoById.get(station.id))));
  }
  chunks.push(
    `INSERT INTO meta (key, value, updated_at) VALUES
      ('catalog_ingested_at', ${sqlString(new Date().toISOString())}, CURRENT_TIMESTAMP),
      ('station_count', ${sqlString(String(catalog.length))}, CURRENT_TIMESTAMP),
      ('logo_status_generated_at', ${sqlString(logoStatus?.generatedAt ?? '')}, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP;`,
  );
  chunks.push('COMMIT;');
  runSql(chunks.join('\n'));

  const scrapeRows = ingestLogoScrapeReport();
  console.log(`curation-db: ingested ${catalog.length.toLocaleString()} station(s)`);
  if (logoStatus?.totals) {
    console.log(
      `curation-db: logo status ok=${logoStatus.totals.ok} warn=${logoStatus.totals.warn} bad=${logoStatus.totals.bad}`,
    );
  }
  if (scrapeRows > 0) console.log(`curation-db: ingested ${scrapeRows} logo scrape candidate row(s)`);
}

function summary() {
  if (!existsSync(dbPath)) {
    console.error(`curation-db: ${dbPath} does not exist. Run npm run curation-db:init first.`);
    process.exit(2);
  }
  const sql = `
.mode column
.headers on
SELECT 'stations' AS metric, COUNT(*) AS value FROM stations
UNION ALL SELECT 'logo_ok', COUNT(*) FROM stations WHERE logo_state = 'ok'
UNION ALL SELECT 'logo_warn', COUNT(*) FROM stations WHERE logo_state = 'warn'
UNION ALL SELECT 'logo_bad', COUNT(*) FROM stations WHERE logo_state = 'bad'
UNION ALL SELECT 'scrape_upgrade', COUNT(*) FROM stations WHERE logo_action = 'scrape-upgrade'
UNION ALL SELECT 'scrape_missing', COUNT(*) FROM stations WHERE logo_action = 'scrape-missing'
UNION ALL SELECT 'curated_local_assets', COUNT(*) FROM stations WHERE logo_tier = 'curated';

SELECT logo_action, COUNT(*) AS stations
FROM stations
GROUP BY logo_action
ORDER BY stations DESC;

SELECT country, COUNT(*) AS stations
FROM stations
WHERE logo_action IN ('scrape-upgrade', 'scrape-missing')
GROUP BY country
ORDER BY stations DESC
LIMIT 20;
`;
  process.stdout.write(runSql(sql));
}

function reset() {
  if (existsSync(dbPath)) unlinkSync(dbPath);
  init();
}

if (command === 'init') init();
else if (command === 'ingest') ingest();
else if (command === 'summary') summary();
else if (command === 'reset') reset();
