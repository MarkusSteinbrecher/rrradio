/**
 * Probe planning (ADR 002 — catalog quality loop).
 *
 * The daily probe covers the hot set plus one seventh of the catalog. Which
 * seventh is a pure function of the station id and the day, so the rotation
 * needs no state: every published station is visited exactly once per week
 * whatever happened to yesterday's run.
 *
 * Everything here is pure — the CLI (`tools/plan-probe.mjs`) does the I/O.
 */

const encoder = new TextEncoder();

/** FNV-1a, 32-bit, over the UTF-8 bytes of `str`. Cheap and stable across runs. */
export function fnv1a32(str) {
  let h = 0x811c9dc5;
  for (const byte of encoder.encode(str)) {
    h ^= byte;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const DAY_MS = 86400000;

/** Days since the Unix epoch (UTC) for a `YYYY-MM-DD` day. */
export function daysSinceEpoch(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day));
  if (!m) throw new Error(`probe-plan: bad day "${day}" (expected YYYY-MM-DD)`);
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS);
}

/** Which of the 7 rotation slots a day falls in. */
export function rotationSlot(day) {
  return ((daysSinceEpoch(day) % 7) + 7) % 7;
}

/** Whether a station id belongs to the given day's rotation slot. */
export function inRotation(id, day) {
  return fnv1a32(id) % 7 === rotationSlot(day);
}

const CURATED_STATUSES = new Set(['working', 'icy-only']);

/**
 * Curated stations are hand-maintained and always probed; the long tail is
 * the bulk `stream-only` import that phase 2 may unpublish automatically.
 *
 * @param {{id: string, status?: string, featured?: boolean}} station
 * @param {{highlightIds?: Set<string>}} [ctx]
 * @returns {'curated'|'long-tail'}
 */
export function tierOf(station, { highlightIds } = {}) {
  if (CURATED_STATUSES.has(station?.status)) return 'curated';
  if (station?.featured === true) return 'curated';
  if (highlightIds?.has(station?.id)) return 'curated';
  return 'long-tail';
}

const nameKey = (name) => String(name ?? '').trim().toLowerCase();

/**
 * Hot set = curated tier ∪ every station whose name matches a `play:` label
 * from the stats Worker. The Worker only knows names, so a name shared by
 * several catalog entries lights up all of them — deliberately: we cannot
 * tell which one the listener played, and probing a few extra is cheap.
 *
 * @param {{stations: object[], topStations?: {name: string, count?: number}[],
 *          highlightIds?: Set<string>}} input
 * @returns {{hot: string[], plays: Record<string, number>}} hot ids sorted
 */
export function resolveHotSet({ stations, topStations = [], highlightIds }) {
  const byName = new Map();
  for (const s of stations) {
    const key = nameKey(s.name);
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(s.id);
  }

  const plays = {};
  const hot = new Set();
  for (const s of stations) {
    if (tierOf(s, { highlightIds }) === 'curated') hot.add(s.id);
  }
  for (const item of topStations) {
    const ids = byName.get(nameKey(item?.name));
    if (!ids) continue;
    const count = Number(item?.count) || 0;
    for (const id of ids) {
      hot.add(id);
      plays[id] = (plays[id] ?? 0) + count;
    }
  }
  return { hot: [...hot].sort(), plays };
}

/**
 * Split ids round-robin so shards stay balanced even when the input is
 * sorted by id (which clusters countries).
 * @param {string[]} ids sorted
 * @param {number} shards
 * @returns {string[][]}
 */
export function shardTargets(ids, shards) {
  const n = Math.max(1, Math.floor(shards) || 1);
  const out = Array.from({ length: n }, () => []);
  ids.forEach((id, i) => out[i % n].push(id));
  return out;
}

/**
 * Build the plan object written to plan.json (ADR 002 shape).
 *
 * @param {{stations: object[], topStations?: object[], highlightIds?: Set<string>,
 *          day: string, shards?: number, full?: boolean, now?: string}} input
 *   `stations` are the published stations. `now` is injectable so tests can
 *   compare two plans byte for byte.
 */
export function buildPlan({ stations, topStations = [], highlightIds = new Set(), day, shards = 6, full = false, now }) {
  const { hot, plays } = resolveHotSet({ stations, topStations, highlightIds });
  const slot = rotationSlot(day);

  const tiers = {};
  const rotation = [];
  for (const s of stations) {
    tiers[s.id] = tierOf(s, { highlightIds });
    if (inRotation(s.id, day)) rotation.push(s.id);
  }

  const targetIds = full
    ? stations.map((s) => s.id)
    : [...new Set([...hot, ...rotation])];
  targetIds.sort();

  return {
    day,
    generatedAt: now ?? new Date().toISOString(),
    shards: Math.max(1, Math.floor(shards) || 1),
    hot,
    plays,
    rotation: { slot, of: 7, count: rotation.length },
    tiers,
    targets: shardTargets(targetIds, shards),
  };
}
