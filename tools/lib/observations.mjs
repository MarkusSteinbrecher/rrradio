/**
 * Observation log I/O (ADR 002 — catalog quality loop).
 *
 * One NDJSON row per probe. Rows are append-only; files are one per UTC
 * day under `<data>/observations/YYYY-MM-DD.ndjson`. Both the probe
 * (writer) and derive-health / health-digest (readers) go through here so
 * the row shape has exactly one home.
 *
 * Row keys (see ADR 002 for semantics):
 *   id, at, v, f, o, c, s, ct, ms, d, icy, r
 */

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const OUTCOMES = Object.freeze(new Set(['ok', 'warn', 'bad']));
export const CLASSES = Object.freeze(new Set(['hard', 'soft']));
export const VANTAGES = Object.freeze(new Set(['gha', 'edge', 'client']));
export const FACETS = Object.freeze(new Set(['stream', 'logo']));

/**
 * Validate and normalise one row. Throws on a malformed row — a bad writer
 * should fail loudly rather than poison the log.
 * @param {object} row
 * @returns {object} the same row, key order fixed
 */
export function normaliseObservation(row) {
  if (!row || typeof row.id !== 'string' || !row.id) throw new Error('observation: missing id');
  if (typeof row.at !== 'string' || Number.isNaN(Date.parse(row.at))) {
    throw new Error(`observation ${row.id}: bad "at" ${row.at}`);
  }
  if (!VANTAGES.has(row.v)) throw new Error(`observation ${row.id}: bad vantage ${row.v}`);
  if (!FACETS.has(row.f)) throw new Error(`observation ${row.id}: bad facet ${row.f}`);
  if (!OUTCOMES.has(row.o)) throw new Error(`observation ${row.id}: bad outcome ${row.o}`);
  const c = row.o === 'bad' ? row.c : null;
  if (row.o === 'bad' && !CLASSES.has(c)) throw new Error(`observation ${row.id}: bad class ${row.c}`);
  return {
    id: row.id,
    at: new Date(row.at).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    v: row.v,
    f: row.f,
    o: row.o,
    c,
    s: typeof row.s === 'number' ? row.s : null,
    ct: typeof row.ct === 'string' && row.ct ? row.ct.toLowerCase() : null,
    ms: typeof row.ms === 'number' ? Math.round(row.ms) : null,
    d: typeof row.d === 'string' && row.d ? row.d : null,
    ...(row.f === 'stream' ? { icy: row.icy ?? 'na' } : {}),
    r: row.r === true,
  };
}

/** @param {object} row @returns {string} one NDJSON line, newline-terminated */
export function serialiseObservation(row) {
  return JSON.stringify(normaliseObservation(row)) + '\n';
}

/**
 * Append rows to an NDJSON file, creating parent directories as needed.
 * @param {string} path
 * @param {object[]} rows
 */
export function appendObservations(path, rows) {
  if (!rows.length) return;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, rows.map(serialiseObservation).join(''));
}

/** `YYYY-MM-DD` of an ISO timestamp, UTC. */
export function dayOf(iso) {
  return new Date(iso).toISOString().slice(0, 10);
}

/** Path of the per-day file inside a health-data checkout. */
export function observationPath(dataDir, day) {
  return join(dataDir, 'observations', `${day}.ndjson`);
}

/**
 * Parse NDJSON text. Blank lines are skipped; a malformed line throws with
 * its line number.
 * @param {string} text
 * @returns {object[]}
 */
export function parseObservations(text) {
  const rows = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      rows.push(JSON.parse(line));
    } catch (err) {
      throw new Error(`observations: line ${i + 1} is not JSON (${err.message})`);
    }
  }
  return rows;
}

/**
 * Read every `observations/*.ndjson` under a health-data checkout, oldest
 * file first, rows in file order. Missing directory → empty array.
 * @param {string} dataDir
 * @param {{sinceDay?: string}} [opts] inclusive lower bound on the file day
 * @returns {object[]}
 */
export function readObservations(dataDir, opts = {}) {
  const dir = join(dataDir, 'observations');
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.ndjson$/.test(f))
    .filter((f) => !opts.sinceDay || f.slice(0, 10) >= opts.sinceDay)
    .sort();
  const rows = [];
  for (const f of files) rows.push(...parseObservations(readFileSync(join(dir, f), 'utf8')));
  return rows;
}
