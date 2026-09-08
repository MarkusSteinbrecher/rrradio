/**
 * Derive the health record, streaks and metrics from the observation log
 * (ADR 002 — catalog quality loop, "Decide" inputs).
 *
 * Pure functions only: everything here takes rows / catalog / plan and
 * returns plain data, so the CLI (`tools/derive-health.mjs`) owns all I/O
 * and the tests need no filesystem and no network.
 *
 * @typedef {{id: string, at: string, v: string, f: string, o: string,
 *            c: string|null, s: number|null, ct: string|null, ms: number|null,
 *            d: string|null, icy?: string, r: boolean}} Observation
 * @typedef {{id: string, name?: string, status?: string}} CatalogStation
 * @typedef {{o: string, c: string|null, n: number, first: string, last: string}} Streak
 */

import { dayOf } from './observations.mjs';

const DAY_MS = 86_400_000;

/**
 * ICY detail vocabulary. Copied verbatim from `classifyIcy` in
 * tools/health-probe.mjs — the observation row carries only the verdict, and
 * the record's detail strings must stay byte-identical across writers or
 * every station's `since` date churns on the first derive run.
 */
export const ICY_DETAILS = Object.freeze({
  ok: 'StreamTitle present',
  warn: 'icy-metaint advertised, no StreamTitle in 64 KB',
  bad: 'no ICY metadata',
  na: 'HLS — metadata via manifest',
});

/**
 * Ids the health record keeps: the published catalog plus every station the
 * plan still observes while it is unpublished (`plan.extra`, ADR 002 phase
 * 2). Without the extras a bot-unpublished station would be pruned the day
 * after its unpublish and come back with a fresh `since` on republish.
 *
 * @param {CatalogStation[]} catalog
 * @param {{extra?: {id?: string}[]}|null} plan
 * @returns {Set<string>}
 */
export function observedIds(catalog, plan) {
  const ids = new Set(catalog.map((s) => s.id));
  for (const e of plan?.extra ?? []) if (e && typeof e.id === 'string') ids.add(e.id);
  return ids;
}

/**
 * Latest observation per station per facet.
 *
 * "Latest" is by `at`; rows sharing a timestamp are resolved by file order
 * (the last one read wins), which is also append order — a retry row (`r`)
 * is appended after the first attempt, so the retry is the verdict.
 *
 * @param {Observation[]} rows
 * @returns {Map<string, Map<string, Observation>>} id → facet → row
 */
export function latestByStationFacet(rows) {
  /** @type {Map<string, Map<string, Observation>>} */
  const byStation = new Map();
  for (const row of rows) {
    let facets = byStation.get(row.id);
    if (!facets) byStation.set(row.id, (facets = new Map()));
    const prev = facets.get(row.f);
    if (!prev || row.at >= prev.at) facets.set(row.f, row);
  }
  return byStation;
}

/**
 * Turn the latest rows into `applyFacet` updates.
 *
 * `stream` maps straight through (`o` → verdict, `d` → detail). `icy` has no
 * rows of its own: it rides along on the stream row's `icy` field, and its
 * detail is reconstructed from ICY_DETAILS. Facets with no rows produce an
 * empty map — never derive a verdict you did not observe.
 *
 * @param {Map<string, Map<string, Observation>>} latest
 * @param {'stream'|'icy'} facet
 * @returns {Map<string, {v: string, d: string|null}>}
 */
export function toFacetUpdates(latest, facet) {
  /** @type {Map<string, {v: string, d: string|null}>} */
  const updates = new Map();
  for (const [id, facets] of latest) {
    if (facet === 'stream') {
      const row = facets.get('stream');
      if (row) updates.set(id, { v: row.o, d: row.d ?? null });
      continue;
    }
    if (facet === 'icy') {
      const row = facets.get('stream');
      const v = row?.icy;
      if (v && v in ICY_DETAILS) updates.set(id, { v, d: ICY_DETAILS[v] });
      continue;
    }
    throw new Error(`toFacetUpdates: unsupported facet "${facet}"`);
  }
  return updates;
}

/**
 * Streaks: the consecutive run of an identical `(o, c)` verdict ending at
 * the latest observation, counted in **distinct UTC days**. Several probes
 * on one day (shard reruns, manual sweeps) count once, and the last row of
 * that day supplies the verdict — otherwise a station re-probed hourly would
 * cross the "bad for 3 days" threshold before a day has passed.
 *
 * Shape (this file owns it; `stream` is written first, see serialiseStreaks):
 *   { "<id>": { "stream": { o, c, n, first, last }, "icy": { … } } }
 * `first` / `last` are UTC days (`YYYY-MM-DD`), the bounds of the run.
 *
 * @param {Observation[]} rows
 * @returns {Record<string, Record<string, Streak>>}
 */
export function computeStreaks(rows) {
  /** @type {Map<string, Map<string, Map<string, Observation>>>} id → facet → day → row */
  const byDay = new Map();
  for (const row of rows) {
    let facets = byDay.get(row.id);
    if (!facets) byDay.set(row.id, (facets = new Map()));
    let days = facets.get(row.f);
    if (!days) facets.set(row.f, (days = new Map()));
    const day = dayOf(row.at);
    const prev = days.get(day);
    if (!prev || row.at >= prev.at) days.set(day, row);
  }

  /** @type {Record<string, Record<string, Streak>>} */
  const out = {};
  for (const [id, facets] of byDay) {
    /** @type {Record<string, Streak>} */
    const perFacet = {};
    for (const [facet, days] of facets) {
      const sorted = [...days.keys()].sort();
      const last = sorted[sorted.length - 1];
      const head = days.get(last);
      let n = 0;
      let first = last;
      for (let i = sorted.length - 1; i >= 0; i -= 1) {
        const row = days.get(sorted[i]);
        if (row.o !== head.o || (row.c ?? null) !== (head.c ?? null)) break;
        n += 1;
        first = sorted[i];
      }
      perFacet[facet] = { o: head.o, c: head.c ?? null, n, first, last };
    }
    out[id] = perFacet;
  }
  return out;
}

/**
 * Play-weighted metrics (ADR 002 shape, key order included).
 *
 * `plays` come from the probe plan; both the numerator and the denominator
 * are restricted to catalogued stations so a station that left the catalog
 * cannot drag availability down forever. No plays at all → `availability`
 * is `null`, never 1: an empty numerator is not a perfect score.
 *
 * @param {{catalog: CatalogStation[],
 *          latest: Map<string, Map<string, Observation>>,
 *          plan: {hot?: string[], plays?: Record<string, number>}|null,
 *          streaks?: Record<string, Record<string, Streak>>,
 *          now: string}} input
 *   `streaks` is accepted for the caller's convenience (and phase-2 metrics);
 *   phase-1 metrics are all derivable from the latest row.
 * @returns {object} metrics row
 */
export function computeMetrics({ catalog, latest, plan, now }) {
  const ids = new Set(catalog.map((s) => s.id));
  const cutoff = new Date(Date.parse(now) - 7 * DAY_MS).toISOString();

  let observed7d = 0;
  const stream = { ok: 0, warn: 0, bad: 0, hard: 0, soft: 0 };
  for (const id of ids) {
    const facets = latest.get(id);
    if (!facets) continue;
    if ([...facets.values()].some((row) => row.at >= cutoff)) observed7d += 1;
    const row = facets.get('stream');
    if (!row) continue;
    stream[row.o] += 1;
    if (row.o === 'bad' && row.c) stream[row.c] += 1;
  }

  // Availability is play-weighted over stations we actually observed
  // (any stream row, any age). A station with plays but no observation —
  // a timed-out shard, a first run — is unknown, not broken; counting it
  // as a failure would fake a collapse whenever a probe job is short.
  // `playsUnobserved` keeps that gap visible instead of hiding it.
  const plays = plan?.plays ?? {};
  let plays7d = 0;
  let playsObserved = 0;
  let playsOnOk = 0;
  for (const [id, count] of Object.entries(plays)) {
    if (!ids.has(id) || typeof count !== 'number') continue;
    plays7d += count;
    const o = latest.get(id)?.get('stream')?.o;
    if (!o) continue;
    playsObserved += count;
    if (o === 'ok') playsOnOk += count;
  }

  const hot = (plan?.hot ?? []).filter((id) => ids.has(id));
  const hotBad = hot.filter((id) => latest.get(id)?.get('stream')?.o === 'bad').length;

  return {
    at: now,
    published: ids.size,
    observed7d,
    freshness: ids.size ? round4(observed7d / ids.size) : 0,
    plays7d,
    playsObserved,
    playsUnobserved: plays7d - playsObserved,
    playsOnOk,
    availability: playsObserved ? round4(playsOnOk / playsObserved) : null,
    stream,
    hotSet: { size: hot.length, bad: hotBad },
  };
}

/** How many distinct stations were observed for a facet in the last N days. */
export function coverage(latest, facet, now, days = 7) {
  const cutoff = new Date(Date.parse(now) - days * DAY_MS).toISOString();
  let n = 0;
  for (const facets of latest.values()) {
    const row = facets.get(facet === 'icy' ? 'stream' : facet);
    if (!row || row.at < cutoff) continue;
    if (facet === 'icy' && !(row.icy in ICY_DETAILS)) continue;
    n += 1;
  }
  return n;
}

/**
 * Oldest observation day worth keeping. Files strictly older are deleted
 * once the streaks that depend on them have been persisted.
 * @param {string} now ISO
 * @param {number} [days]
 * @returns {string} `YYYY-MM-DD`
 */
export function rollupCutoffDay(now, days = 90) {
  return new Date(Date.parse(now) - days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * One station per line, ids sorted, `stream` first — same layout rationale
 * as the health record: git diffs stay per-station.
 * @param {Record<string, Record<string, Streak>>} streaks
 * @returns {string}
 */
export function serialiseStreaks(streaks) {
  const ids = Object.keys(streaks).sort();
  const lines = ['{'];
  ids.forEach((id, i) => {
    const facets = streaks[id];
    const ordered = {};
    for (const facet of ['stream', ...Object.keys(facets).filter((f) => f !== 'stream').sort()]) {
      if (facets[facet]) ordered[facet] = facets[facet];
    }
    lines.push(`${JSON.stringify(id)}: ${JSON.stringify(ordered)}${i < ids.length - 1 ? ',' : ''}`);
  });
  lines.push('}', '');
  return lines.join('\n');
}

/** @param {number} n */
function round4(n) {
  return Math.round(n * 1e4) / 1e4;
}
