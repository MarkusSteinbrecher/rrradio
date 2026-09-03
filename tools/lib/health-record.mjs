/**
 * The single writer for `public/station-health.json` — the unified
 * per-station quality record (spec: docs/station-health.md).
 *
 * Every check tool (health-probe, logo-status, check-drift,
 * check-duplicates, check-homepages) funnels its verdicts through
 * `applyFacet()`. Nothing else writes the file; that is what keeps the
 * transition semantics and the line-per-station serialisation consistent.
 *
 * Churn control (the file is committed):
 *   - a station's facet entry changes only when verdict or detail change;
 *     `since` records that transition date, not "last checked"
 *   - "last checked" lives once per facet in the `runs` header
 *   - serialisation is one station per line, sorted by id, so git diffs
 *     stay per-station
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const HEALTH_PATH = 'public/station-health.json';

export const VERDICTS = Object.freeze(new Set(['ok', 'warn', 'bad', 'na']));

// Key order here is the serialisation order inside each station row.
export const FACETS = Object.freeze([
  'stream',
  'https',
  'icy',
  'metadata',
  'fetcher',
  'program',
  'logo',
  'homepage',
  'drift',
  'duplicate',
]);

/** @returns {{version: 1, runs: object, stations: object}} */
export function emptyRecord() {
  return { version: 1, runs: {}, stations: {} };
}

/**
 * Load the health record, or an empty one when the file doesn't exist yet.
 * A malformed file is an error — better to stop than to silently rebuild
 * and lose every transition date.
 * @param {string} root repo root
 */
export function loadHealth(root) {
  return loadHealthFrom(join(root, HEALTH_PATH));
}

/**
 * Same as loadHealth(), addressed by explicit path — the health record now
 * also lives outside the source tree (ADR 002: on the `health-data`
 * branch), so derive-health needs to point at a checkout of that branch.
 * @param {string} path
 */
export function loadHealthFrom(path) {
  if (!existsSync(path)) return emptyRecord();
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (parsed?.version !== 1 || typeof parsed.stations !== 'object') {
    throw new Error(`${path}: unrecognised shape (expected version 1)`);
  }
  parsed.runs ??= {};
  return parsed;
}

/**
 * Merge one facet's verdicts into the record.
 *
 * @param {object} record from loadHealth()
 * @param {string} facet one of FACETS
 * @param {Map<string, {v: string, d?: string}>|object} updates id → verdict
 * @param {{tool: string, scope?: string, at: string}} runMeta
 *   `at` is the ISO run timestamp, supplied by the caller so the lib stays
 *   deterministic under test. `scope` defaults to 'full'.
 * @returns {{checked: number, transitions: number, tally: object}}
 */
export function applyFacet(record, facet, updates, runMeta) {
  if (!FACETS.includes(facet)) throw new Error(`unknown facet "${facet}"`);
  if (!runMeta?.at || !runMeta?.tool) throw new Error('runMeta needs {tool, at}');

  const entries = updates instanceof Map ? [...updates.entries()] : Object.entries(updates);
  const since = runMeta.at.slice(0, 10);
  const tally = { ok: 0, warn: 0, bad: 0, na: 0 };
  let transitions = 0;

  for (const [id, upd] of entries) {
    if (!VERDICTS.has(upd?.v)) {
      throw new Error(`${facet}/${id}: invalid verdict "${upd?.v}"`);
    }
    tally[upd.v] += 1;
    const station = (record.stations[id] ??= {});
    const prev = station[facet];
    const detail = upd.d ?? null;
    if (prev && prev.v === upd.v && (prev.d ?? null) === detail) continue;
    station[facet] = detail === null ? { v: upd.v, since } : { v: upd.v, since, d: detail };
    transitions += 1;
  }

  record.runs[facet] = {
    lastRun: runMeta.at,
    tool: runMeta.tool,
    scope: runMeta.scope ?? 'full',
    checked: entries.length,
    tally,
  };
  return { checked: entries.length, transitions, tally };
}

/**
 * Drop stations that left the catalog. Call with the current full id set —
 * never from a scoped run.
 * @param {object} record
 * @param {Set<string>} validIds
 * @returns {number} how many stations were removed
 */
export function pruneStations(record, validIds) {
  let removed = 0;
  for (const id of Object.keys(record.stations)) {
    if (!validIds.has(id)) {
      delete record.stations[id];
      removed += 1;
    }
  }
  return removed;
}

/**
 * Serialise with one station per line, ids sorted, facet keys in FACETS
 * order — valid JSON throughout, just laid out for stable git diffs.
 * @param {string} root repo root
 * @param {object} record
 */
export function saveHealth(root, record) {
  saveHealthTo(join(root, HEALTH_PATH), record);
}

/**
 * Same as saveHealth(), addressed by explicit path (see loadHealthFrom).
 * @param {string} path
 * @param {object} record
 */
export function saveHealthTo(path, record) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serialiseHealth(record));
}

/** @param {object} record @returns {string} */
export function serialiseHealth(record) {
  const lines = ['{', '"version": 1,', '"runs": {'];

  const runFacets = FACETS.filter((f) => record.runs[f]);
  runFacets.forEach((facet, i) => {
    const comma = i < runFacets.length - 1 ? ',' : '';
    lines.push(`${JSON.stringify(facet)}: ${JSON.stringify(record.runs[facet])}${comma}`);
  });
  lines.push('},', '"stations": {');

  const ids = Object.keys(record.stations).sort();
  ids.forEach((id, i) => {
    const station = record.stations[id];
    const ordered = {};
    for (const facet of FACETS) {
      const f = station[facet];
      if (!f) continue;
      ordered[facet] = f.d == null ? { v: f.v, since: f.since } : { v: f.v, since: f.since, d: f.d };
    }
    const comma = i < ids.length - 1 ? ',' : '';
    lines.push(`${JSON.stringify(id)}: ${JSON.stringify(ordered)}${comma}`);
  });
  lines.push('}', '}', '');
  return lines.join('\n');
}
