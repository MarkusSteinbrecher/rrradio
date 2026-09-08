/**
 * Builds `dashboard.json` — the compact, public read of the catalog quality
 * loop that the /catalog-health page renders (docs/station-health.md,
 * "Public dashboard").
 *
 * Why a separate artifact: the health record is 17 MB and keyed for churn
 * control, the catalog another 17 MB. A browser page needs one row per
 * published station with the handful of facts a reader cares about — name,
 * country, tier, whether the stream plays, how now-playing arrives, the
 * logo state, the homepage state, and how long a failure has lasted. Rows
 * are arrays under a `cols` header so 31k of them stay small on the wire
 * (no favicon URLs — they alone were 1.8 MB; the logo column carries the
 * verdict, the station page carries the image).
 *
 * Pure: takes already-parsed inputs, returns the artifact object. The CLI
 * in tools/build-health-dashboard.mjs does the file I/O.
 */

export const DASHBOARD_VERSION = 1;

/** Column order of every row in `rows`. Append-only once shipped — the
 *  page reads by name via this header, so reordering is safe, but removing
 *  a column breaks older pages still cached by a browser. */
export const COLS = Object.freeze([
  'id',
  'name',
  'cc',
  'tier',
  'status',
  'stream',
  'streamDetail',
  'streamSince',
  'streakDays',
  'streakClass',
  'checked',
  'np',
  'logo',
  'logoDetail',
  'home',
]);

const CURATED_STATUS = new Set(['working', 'icy-only']);

/** Radio Browser names arrive with leading tabs and doubled spaces; a
 *  sorted public table can't have that. */
export function cleanName(name) {
  return typeof name === 'string' ? name.replace(/\s+/g, ' ').trim() : '';
}

/**
 * Probe tier. The plan is authoritative (it also knows about highlights);
 * without a plan the status/featured rule from plan-probe is reproduced.
 * @param {{id: string, status?: string, featured?: boolean}} station
 * @param {Record<string, string> | undefined} planTiers
 * @returns {'curated' | 'long-tail'}
 */
export function tierOf(station, planTiers) {
  const planned = planTiers?.[station.id];
  if (planned === 'curated' || planned === 'long-tail') return planned;
  return CURATED_STATUS.has(station.status ?? '') || station.featured === true
    ? 'curated'
    : 'long-tail';
}

/**
 * How now-playing metadata reaches the player, folded from the three
 * metadata facets into one public-facing word.
 *   api    — a broadcaster fetcher / metadata endpoint answers
 *   icy    — the stream carries inline ICY titles
 *   silent — ICY is advertised but no title arrived
 *   hls    — HLS stream, titles come via the manifest
 *   none   — no metadata source at all
 *   ''     — not observed yet
 * @param {Record<string, {v: string}>} facets
 */
export function nowPlayingKind(facets) {
  if (facets.fetcher?.v === 'ok' || facets.metadata?.v === 'ok') return 'api';
  const icy = facets.icy?.v;
  if (icy === 'ok') return 'icy';
  if (icy === 'warn') return 'silent';
  if (icy === 'na') return 'hls';
  if (icy === 'bad') return 'none';
  return '';
}

/**
 * One dashboard row (array in COLS order) for a published station.
 * @param {object} station catalog entry from stations.json
 * @param {Record<string, {v: string, since?: string, d?: string}>} facets
 * @param {{o: string, c: string | null, n: number, last: string} | undefined} streak stream streak
 * @param {'curated' | 'long-tail'} tier
 */
export function buildRow(station, facets, streak, tier) {
  const stream = facets.stream;
  const failing = streak?.o === 'bad';
  return [
    station.id,
    cleanName(station.name) || station.id,
    (station.country ?? '').toUpperCase(),
    tier,
    station.status ?? '',
    stream?.v ?? '',
    stream?.d ?? '',
    stream?.since ?? '',
    failing ? streak.n : 0,
    failing ? (streak.c ?? '') : '',
    streak?.last ?? '',
    nowPlayingKind(facets),
    facets.logo?.v ?? '',
    facets.logo?.d ?? '',
    facets.homepage?.v ?? '',
  ];
}

/**
 * Metrics history, one point per UTC day (the last derive of the day wins —
 * a manual dispatch on top of the cron would otherwise show as two points),
 * trimmed to `days` and to the fields the page plots.
 * @param {object[]} history metrics-history rows, oldest first
 * @param {number} days
 */
export function compactHistory(history, days = 90) {
  const byDay = new Map();
  for (const m of history) {
    if (!m || typeof m.at !== 'string') continue;
    byDay.set(m.at.slice(0, 10), m);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .slice(-days)
    .map(([day, m]) => ({
      day,
      published: m.published ?? null,
      availability: m.availability ?? null,
      freshness: m.freshness ?? null,
      ok: m.stream?.ok ?? null,
      warn: m.stream?.warn ?? null,
      bad: m.stream?.bad ?? null,
      hard: m.stream?.hard ?? null,
      soft: m.stream?.soft ?? null,
      hotBad: m.hotSet?.bad ?? null,
    }));
}

/**
 * @param {object} input
 * @param {object[]} input.catalog published stations (stations.json)
 * @param {{runs?: object, stations?: object}} input.record health record
 * @param {Record<string, {stream?: object}>} [input.streaks]
 * @param {{tiers?: Record<string, string>}} [input.plan]
 * @param {object | null} [input.metrics] latest metrics.json
 * @param {object[]} [input.history] metrics-history rows
 * @param {string} [input.now] ISO timestamp for generatedAt
 */
export function buildDashboard({ catalog, record, streaks = {}, plan = {}, metrics = null, history = [], now }) {
  const stations = record?.stations ?? {};
  const rows = [];
  let curated = 0;
  const countries = new Set();
  for (const s of [...catalog].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (!s?.id) continue;
    const tier = tierOf(s, plan.tiers);
    if (tier === 'curated') curated += 1;
    if (s.country) countries.add(String(s.country).toUpperCase());
    rows.push(buildRow(s, stations[s.id] ?? {}, streaks[s.id]?.stream, tier));
  }
  const runs = {};
  for (const [facet, meta] of Object.entries(record?.runs ?? {})) {
    if (meta?.lastRun) runs[facet] = meta.lastRun;
  }
  return {
    version: DASHBOARD_VERSION,
    generatedAt: now ?? new Date().toISOString(),
    counts: {
      published: rows.length,
      curated,
      longTail: rows.length - curated,
      countries: countries.size,
    },
    runs,
    metrics,
    history: compactHistory(history),
    cols: [...COLS],
    rows,
  };
}

/** One row per line so the daily commit on health-data diffs per station. */
export function serialiseDashboard(dashboard) {
  const { rows, ...head } = dashboard;
  const headJson = JSON.stringify(head, null, 1);
  // Drop the closing brace, then append rows as a line-per-row array.
  const open = headJson.replace(/\n}$/, '');
  const body = rows.map((r) => JSON.stringify(r)).join(',\n');
  return `${open},\n "rows": [\n${body}\n ]\n}\n`;
}
