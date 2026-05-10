#!/usr/bin/env node
/**
 * Builds the bundled iOS SQLite FTS5 station index from public/stations.json.
 * The full catalog pipeline invokes this after regenerating stations.json;
 * it can also be run directly when only the iOS search index needs refresh.
 */

import { readFileSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function fail(msg) {
  console.error(`build-catalog-fts: ${msg}`);
  process.exit(1);
}

function sqlString(value) {
  return `'${String(value ?? '').replaceAll("'", "''")}'`;
}

export function buildFtsDatabase(stations, { log = true } = {}) {
  const dbPath = join(root, 'ios/rrradio/Resources/stations.fts5.db');
  const tmpPath = `${dbPath}.tmp`;
  mkdirSync(dirname(dbPath), { recursive: true });
  try {
    unlinkSync(tmpPath);
  } catch {
    // No stale temp file to remove.
  }

  const statements = [
    'PRAGMA journal_mode=OFF;',
    'PRAGMA synchronous=OFF;',
    "CREATE VIRTUAL TABLE stations_fts USING fts5(name, tags, country, surface, tokenize='unicode61 remove_diacritics 2');",
    'CREATE TABLE stations_meta(rowid INTEGER PRIMARY KEY, station_id TEXT NOT NULL UNIQUE, has_logo INTEGER NOT NULL, recents_rank_hint INTEGER NOT NULL);',
    'BEGIN;',
  ];
  stations.forEach((station, index) => {
    const rowid = index + 1;
    const tags = Array.isArray(station.tags) ? station.tags.join(' ') : '';
    const surface = [
      station.broadcaster,
      station.streamUrl,
      station.homepage,
    ].filter(Boolean).join(' ');
    statements.push(
      `INSERT INTO stations_fts(rowid, name, tags, country, surface) VALUES(${rowid}, ${sqlString(station.name)}, ${sqlString(tags)}, ${sqlString(station.country)}, ${sqlString(surface)});`,
    );
    statements.push(
      `INSERT INTO stations_meta(rowid, station_id, has_logo, recents_rank_hint) VALUES(${rowid}, ${sqlString(station.id)}, ${station.favicon ? 1 : 0}, ${index});`,
    );
  });
  statements.push(
    'COMMIT;',
    "INSERT INTO stations_fts(stations_fts) VALUES('optimize');",
    'VACUUM;',
    'PRAGMA optimize;',
  );

  const result = spawnSync('sqlite3', [tmpPath], {
    input: `${statements.join('\n')}\n`,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    try {
      unlinkSync(tmpPath);
    } catch {
      // Best-effort cleanup only.
    }
    const detail = result.stderr || result.stdout || `exit ${result.status}`;
    fail(`failed to build SQLite FTS catalog: ${detail.trim()}`);
  }
  renameSync(tmpPath, dbPath);
  if (log) console.log(`catalog: SQLite FTS5 index -> ${dbPath.replace(`${root}/`, '')}`);
  return dbPath;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const payload = JSON.parse(readFileSync(join(root, 'public/stations.json'), 'utf8'));
  if (!Array.isArray(payload.stations)) fail('public/stations.json missing stations[]');
  buildFtsDatabase(payload.stations);
}
