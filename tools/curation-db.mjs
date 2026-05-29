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
 *   node tools/curation-db.mjs dedupe         # score pairwise duplicate candidates
 *   node tools/curation-db.mjs dedupe-report  # print pending candidates
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { classifyLogoUrl } from './logo-quality.mjs';
import { nameTokens, NAME_NOISE_TOKENS } from './lib/station-name-signature.mjs';
import { streamHost, normalizeHomepage } from './lib/dedupe-normalize.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const dbPath = process.env.RRRADIO_CURATION_DB || join(root, '.local', 'curation.db');

const command = process.argv[2] || 'summary';
const valid = new Set(['init', 'ingest', 'summary', 'reset', 'dedupe', 'dedupe-report']);
if (!valid.has(command)) {
  console.error(
    'usage: node tools/curation-db.mjs <init|ingest|summary|reset|dedupe|dedupe-report>',
  );
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
  scraped_page TEXT,
  rel TEXT,
  target_reason TEXT,
  score INTEGER,
  content_type TEXT,
  content_length INTEGER,
  result_reason TEXT,
  candidate_json TEXT,
  attempts_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Pairwise duplicate candidates surfaced by \`dedupe\`. left_id < right_id
-- always (canonical ordering) so each unordered pair has one row.
-- Curator disposition (status, note, decided_at) is preserved across
-- re-runs; only score/signals/generated_at update on the next pass.
CREATE TABLE IF NOT EXISTS duplicate_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  left_id TEXT NOT NULL,
  right_id TEXT NOT NULL,
  score REAL NOT NULL,
  signals_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  disposition_note TEXT,
  generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at TEXT,
  UNIQUE(left_id, right_id),
  CHECK(left_id < right_id),
  CHECK(status IN ('pending', 'duplicate', 'not-duplicate', 'merged'))
);

CREATE INDEX IF NOT EXISTS dup_candidates_status_idx ON duplicate_candidates(status);
CREATE INDEX IF NOT EXISTS dup_candidates_score_idx ON duplicate_candidates(score DESC);
`;

function init() {
  ensureSqlite();
  runSql(schema);
  ensureColumn('logo_candidates', 'scraped_page', 'TEXT');
  ensureColumn('logo_candidates', 'content_type', 'TEXT');
  ensureColumn('logo_candidates', 'content_length', 'INTEGER');
  ensureColumn('logo_candidates', 'candidate_json', 'TEXT');
  ensureColumn('logo_candidates', 'attempts_json', 'TEXT');
  console.log(`curation-db: initialized ${dbPath}`);
}

function ensureColumn(table, column, definition) {
  const raw = runSql(`PRAGMA table_info(${table});`, { mode: 'csv' });
  const exists = raw
    .trim()
    .split('\n')
    .slice(1)
    .some((line) => line.split(',')[1]?.replace(/^"|"$/g, '') === column);
  if (!exists) runSql(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
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
      run_id, station_id, action, source_url, candidate_url, scraped_page, rel,
      target_reason, score, content_type, content_length, result_reason, candidate_json, attempts_json
    ) VALUES (
      (SELECT id FROM _last_run_id),
      ${sqlString(row.id)},
      ${sqlString(row.action ?? 'none')},
      ${sqlString(row.from ?? null)},
      ${sqlString(row.to ?? null)},
      ${sqlString(row.scrapedPage ?? row.candidate?.scrapedPage ?? null)},
      ${sqlString(row.rel ?? null)},
      ${sqlString(row.targetReason ?? null)},
      ${sqlNumber(row.score)},
      ${sqlString(row.candidate?.contentType ?? null)},
      ${sqlNumber(row.candidate?.contentLength ?? null)},
      ${sqlString(row.reason ?? null)},
      ${sqlString(jsonText(row.candidate ?? null))},
      ${sqlString(jsonText(row.attempts ?? row.rejectedCandidates ?? null))}
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

// ───────────────────────────────────────────────────────────────────
// Dedupe: pairwise near-duplicate detection
//
// Phase 1 (check-duplicates.mjs) catches collisions on exact keys
// (stationuuid, streamUrl, name+country, homepage+favicon+country+
// stripped-name-signature). Phase 2 lives here because the work needs
// pair-level state — the curator's "this is a duplicate" / "these are
// distinct" decisions must persist across runs so re-scoring never
// re-prompts already-resolved pairs.
//
// Algorithm: token-blocking + within-bucket pairwise scoring.
//   1. For each station, compute the noise-stripped name signature
//      (same logic as check-duplicates.mjs).
//   2. Index every (station, token) pair: token → list of station ids
//      that contain it. Drop tokens shared by too many stations (>200);
//      they're not discriminative.
//   3. For each token's posting list, enumerate unique station pairs
//      where the two stations have the same country code.
//   4. Score each candidate pair on name + homepage + favicon + stream
//      signals. Pairs that already exact-match on stationuuid or
//      streamUrl are skipped (caught by check-duplicates).
//   5. Pairs above DUP_SCORE_THRESHOLD upsert into duplicate_candidates,
//      preserving any existing curator disposition.
// ───────────────────────────────────────────────────────────────────

const DUP_SCORE_THRESHOLD = 0.5;
const DUP_TOKEN_POSTING_CAP = 200; // skip ultra-common tokens

// Name tokenisation is shared with the rest of the dedupe tooling (incl. the
// Unicode fix that keeps non-Latin channels distinct).
const dupNameTokens = nameTokens;

function dupNameSignature(tokens) {
  return [...tokens].sort().join(' ');
}

function dupJaccard(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersect = 0;
  for (const x of setA) if (setB.has(x)) intersect++;
  const union = setA.size + setB.size - intersect;
  return union === 0 ? 0 : intersect / union;
}

const dupStreamHost = streamHost;

function dupStreamPathTokens(url) {
  try {
    return new Set(
      new URL(String(url)).pathname
        .split('/')
        .filter((s) => s && !NAME_NOISE_TOKENS.has(s.toLowerCase())),
    );
  } catch {
    return new Set();
  }
}

const dupHomepageKey = (url) => normalizeHomepage(url, { includePath: true });
const dupHomepageHost = (url) => normalizeHomepage(url);

function dupScorePair(a, b) {
  const aTokens = new Set(a._tokens);
  const bTokens = new Set(b._tokens);
  const nameSigMatch = a._signature !== '' && a._signature === b._signature;
  const nameJaccard = dupJaccard(aTokens, bTokens);

  // Name contribution. Signature equality is the strongest signal we
  // can extract from names alone; fuzzy jaccard contributes less.
  let nameScore = 0;
  if (nameSigMatch) nameScore = 0.45;
  else if (nameJaccard >= 0.7) nameScore = 0.30;
  else if (nameJaccard >= 0.5) nameScore = 0.15;
  // jaccard < 0.5 contributes nothing — too noisy

  const aHomepage = dupHomepageKey(a.homepage);
  const bHomepage = dupHomepageKey(b.homepage);
  const aHomeHost = dupHomepageHost(a.homepage);
  const bHomeHost = dupHomepageHost(b.homepage);
  const homepageMatch = aHomepage !== '' && aHomepage === bHomepage;
  const homepageHostMatch = !homepageMatch && aHomeHost !== '' && aHomeHost === bHomeHost;

  const aFav = String(a.favicon ?? '').toLowerCase().trim();
  const bFav = String(b.favicon ?? '').toLowerCase().trim();
  const faviconMatch = aFav !== '' && aFav === bFav;

  const aStreamHost = dupStreamHost(a.stream_url);
  const bStreamHost = dupStreamHost(b.stream_url);
  const streamHostMatch = aStreamHost !== '' && aStreamHost === bStreamHost;

  const aPath = dupStreamPathTokens(a.stream_url);
  const bPath = dupStreamPathTokens(b.stream_url);
  const streamPathJaccard = dupJaccard(aPath, bPath);

  let corroboration = 0;
  if (homepageMatch) corroboration += 0.25;
  else if (homepageHostMatch) corroboration += 0.10;
  if (faviconMatch) corroboration += 0.20;
  if (streamHostMatch) corroboration += 0.15;
  if (streamPathJaccard >= 0.5) corroboration += 0.05;

  const score = Math.min(1, nameScore + corroboration);
  return {
    score,
    signals: {
      name_sig_match: nameSigMatch,
      name_jaccard: Math.round(nameJaccard * 1000) / 1000,
      homepage_match: homepageMatch,
      homepage_host_match: homepageHostMatch,
      favicon_match: faviconMatch,
      stream_host_match: streamHostMatch,
      stream_path_jaccard: Math.round(streamPathJaccard * 1000) / 1000,
    },
  };
}

function loadStationsForDedupe() {
  // SQLite's JSON mode emits a proper JSON array — robust against
  // station names that contain tabs, pipes, or quotes.
  const sql = `
.mode json
SELECT id, name, country, stationuuid, broadcaster, stream_url, homepage, favicon
FROM stations
WHERE status IN ('working','icy-only','stream-only');`;
  const raw = runSql(sql).trim();
  if (!raw) return [];
  return JSON.parse(raw);
}

function dedupe() {
  if (!existsSync(dbPath)) {
    console.error(`curation-db: ${dbPath} does not exist. Run npm run curation-db:ingest first.`);
    process.exit(2);
  }
  ensureSqlite();
  // Make sure the table exists even on old DBs.
  runSql(schema);

  const stations = loadStationsForDedupe();
  console.log(`curation-db: dedupe scoring across ${stations.length} publishable station(s)…`);

  // Precompute tokens + signature; build token-posting list.
  const byId = new Map();
  const tokenPostings = new Map(); // token → [id, …]
  for (const s of stations) {
    const tokens = dupNameTokens(s.name);
    s._tokens = tokens;
    s._signature = dupNameSignature(tokens);
    byId.set(s.id, s);
    const seen = new Set();
    for (const t of tokens) {
      if (seen.has(t)) continue;
      seen.add(t);
      const arr = tokenPostings.get(t) ?? [];
      arr.push(s.id);
      tokenPostings.set(t, arr);
    }
  }

  // Enumerate candidate pairs. Same country, distinct ids, at least
  // one shared token, and not already caught by exact-key matches.
  const seenPair = new Set();
  const candidates = [];
  let skippedExact = 0;
  for (const [token, ids] of tokenPostings) {
    if (ids.length < 2 || ids.length > DUP_TOKEN_POSTING_CAP) continue;
    for (let i = 0; i < ids.length; i++) {
      const a = byId.get(ids[i]);
      for (let j = i + 1; j < ids.length; j++) {
        const b = byId.get(ids[j]);
        if (a.country !== b.country) continue;
        const [left, right] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
        const pairKey = `${left}|${right}`;
        if (seenPair.has(pairKey)) continue;
        seenPair.add(pairKey);
        // Skip pairs already definitively caught by check-duplicates'
        // blocking kinds — phase 2 is about everything *else*.
        if (a.stationuuid && a.stationuuid === b.stationuuid) {
          skippedExact++;
          continue;
        }
        if (a.stream_url && a.stream_url === b.stream_url) {
          skippedExact++;
          continue;
        }
        const left_obj = byId.get(left);
        const right_obj = byId.get(right);
        const { score, signals } = dupScorePair(left_obj, right_obj);
        if (score >= DUP_SCORE_THRESHOLD) {
          candidates.push({ left, right, score, signals });
        }
      }
    }
  }

  console.log(
    `curation-db: ${candidates.length.toLocaleString()} pair(s) at score ≥ ${DUP_SCORE_THRESHOLD}` +
      ` (${seenPair.size.toLocaleString()} pairs evaluated, ${skippedExact} skipped as exact matches)`,
  );

  // Upsert. Preserve status / disposition_note / decided_at across runs.
  const chunks = ['BEGIN;'];
  for (const c of candidates) {
    chunks.push(
      `INSERT INTO duplicate_candidates (left_id, right_id, score, signals_json, status, generated_at)
       VALUES (
         ${sqlString(c.left)},
         ${sqlString(c.right)},
         ${sqlNumber(c.score)},
         ${sqlString(JSON.stringify(c.signals))},
         'pending',
         CURRENT_TIMESTAMP
       )
       ON CONFLICT(left_id, right_id) DO UPDATE SET
         score = excluded.score,
         signals_json = excluded.signals_json,
         generated_at = CURRENT_TIMESTAMP;`,
    );
  }
  chunks.push(
    `INSERT INTO meta (key, value, updated_at) VALUES
       ('dedupe_run_at', ${sqlString(new Date().toISOString())}, CURRENT_TIMESTAMP),
       ('dedupe_candidate_count', ${sqlString(String(candidates.length))}, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP;`,
  );
  chunks.push('COMMIT;');
  runSql(chunks.join('\n'));
}

function dedupeReport() {
  if (!existsSync(dbPath)) {
    console.error(`curation-db: ${dbPath} does not exist.`);
    process.exit(2);
  }
  const summarySql = `
.mode column
.headers on
SELECT status, COUNT(*) AS pairs, ROUND(AVG(score), 3) AS avg_score,
       ROUND(MIN(score), 3) AS min_score, ROUND(MAX(score), 3) AS max_score
FROM duplicate_candidates
GROUP BY status
ORDER BY pairs DESC;
`;
  process.stdout.write('=== duplicate_candidates summary ===\n');
  process.stdout.write(runSql(summarySql));

  // Argv: dedupe-report [limit] [min-score]
  const limit = Number(process.argv[3] ?? 25);
  const minScore = Number(process.argv[4] ?? 0.7);
  const detailSql = `
.mode json
SELECT
  dc.score,
  l.country,
  l.id AS left_id, l.name AS left_name,
  r.id AS right_id, r.name AS right_name,
  dc.signals_json
FROM duplicate_candidates dc
JOIN stations l ON l.id = dc.left_id
JOIN stations r ON r.id = dc.right_id
WHERE dc.status = 'pending' AND dc.score >= ${minScore}
ORDER BY dc.score DESC, l.country, l.id
LIMIT ${Number.isFinite(limit) ? limit : 25};
`;
  const raw = runSql(detailSql).trim();
  const rows = raw ? JSON.parse(raw) : [];
  process.stdout.write(
    `\n=== top pending candidates (limit=${limit}, score ≥ ${minScore}) ===\n`,
  );
  for (const row of rows) {
    process.stdout.write(
      `  [${row.score.toFixed(2)}] ${row.country}  ` +
        `${row.left_id} "${row.left_name}"  ↔  ${row.right_id} "${row.right_name}"\n`,
    );
    process.stdout.write(`         ${row.signals_json}\n`);
  }
  process.stdout.write(`\n${rows.length} of pending-with-score-≥-${minScore} shown.\n`);
}

if (command === 'init') init();
else if (command === 'ingest') ingest();
else if (command === 'summary') summary();
else if (command === 'reset') reset();
else if (command === 'dedupe') dedupe();
else if (command === 'dedupe-report') dedupeReport();
