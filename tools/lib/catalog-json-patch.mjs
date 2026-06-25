/**
 * Surgical patch of the built catalog artifact (public/stations.json).
 *
 * Production serves the committed stations.json as-is — deploys do NOT
 * re-run build-catalog (audit #65, keep RB fragility out of every push).
 * So a broken-station fix has to land the change in BOTH data/stations.yaml
 * (the source) and stations.json (the shipped artifact) for it to reach
 * users on the next deploy. A full `npm run catalog` rebuild needs a primed
 * RB cache / network and reflows the whole 31k-row file; instead we mutate
 * the one affected station object in place and let the caller re-stringify
 * with the same `JSON.stringify(payload, null, 2)` build-catalog uses, so
 * the diff stays minimal. The weekly catalog-watch rebuild reconciles any
 * derived-field drift (e.g. shortName) afterwards.
 *
 * Operates on the parsed `stations[]` array — no file I/O here. Used by
 * tools/propose-station-fix.mjs (issue #507, P3).
 */

// Fields the fix agent is allowed to mutate in place. Pass-through values
// (no further derivation) except `name`, whose `shortName` the caller
// recomputes and passes alongside.
const PATCHABLE = new Set([
  'streamUrl',
  'bitrate',
  'codec',
  'country',
  'tags',
  'name',
  'shortName',
  'stationuuid',
]);

const FAVICON_FIELDS = [
  'favicon',
  'favicons',
  'faviconSource',
  'faviconSourceType',
  'faviconSourceUrl',
  'faviconLicense',
  'faviconOk',
];

export function findStation(stations, stationId) {
  return stations.find((s) => s && s.id === stationId) ?? null;
}

/** Shallow value equality good enough for the scalar/array fields we set. */
function sameValue(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
}

/**
 * Apply scalar/array field changes to one station, in place (preserving
 * key order for existing keys → minimal diff). Unknown / undefined values
 * are skipped. Returns { found, changed, applied: string[] }.
 */
export function patchStationFields(stations, stationId, changes) {
  const station = findStation(stations, stationId);
  if (!station) return { found: false, changed: false, applied: [] };
  const applied = [];
  for (const [field, value] of Object.entries(changes ?? {})) {
    if (value === undefined || !PATCHABLE.has(field)) continue;
    if (sameValue(station[field], value)) continue;
    station[field] = value;
    applied.push(field);
  }
  return { found: true, changed: applied.length > 0, applied };
}

/** Drop every favicon-related field from one station (wrong-logo clear).
 *  Returns { found, changed }. */
export function clearFaviconFields(stations, stationId) {
  const station = findStation(stations, stationId);
  if (!station) return { found: false, changed: false };
  let changed = false;
  for (const f of FAVICON_FIELDS) {
    if (f in station) {
      delete station[f];
      changed = true;
    }
  }
  return { found: true, changed };
}

/** Remove a station from the published catalog (status → broken / removed).
 *  Returns { stations, removed } — a new array; caller reassigns. */
export function removeStation(stations, stationId) {
  const next = stations.filter((s) => !(s && s.id === stationId));
  return { stations: next, removed: next.length !== stations.length };
}
