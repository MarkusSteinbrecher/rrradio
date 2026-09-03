/**
 * Pure classification for the stream health probe (ADR 002 — catalog
 * quality loop).
 *
 * These verdicts used to live inside `tools/health-probe.mjs`, where they
 * closed over module-level sets built from `src/fetchers.json` and were
 * therefore untestable. The manifest-dependent classifiers now come from
 * `createClassifiers(manifest)`; the rest are plain functions.
 *
 * Verdict vocabulary: ok | warn | bad | na, with a stable `d` detail
 * string. That detail vocabulary is shared with the health record and the
 * observation log — never put a station-specific value (a stream title, a
 * URL) in it.
 */

/** Bad details that mean "this will not fix itself" (ADR 002 table). */
export const HARD_DETAILS = Object.freeze(new Set(['HTTP 404', 'HTTP 410', 'dns', 'refused', 'no-url']));

// Some fetchers store a broadcaster slug in metadataUrl instead of a URL.
const SLUG_NOT_URL = new Set(['bbc', 'ffh', 'laut-fm', 'npo', 'soma-fm']);
// A few valid metadata feeds are plain text, XML, or HTML fragments.
const NON_JSON_METADATA = new Set(['wdr', 'mr', 'rb-bremen', 'sr']);

/**
 * @typedef {{v: 'ok'|'warn'|'bad'|'na', d?: string}} Verdict
 * @typedef {{status: number|'failed', contentType?: string, errorToken?: string,
 *            metaintAdvertised?: boolean, icySeen?: boolean, ms?: number}} StreamProbe
 */

/** @param {StreamProbe} probe @returns {Verdict} */
export function classifyStream(probe) {
  if (probe.status === 'failed') return { v: 'bad', d: probe.errorToken };
  if (typeof probe.status === 'number' && probe.status >= 400) return { v: 'bad', d: `HTTP ${probe.status}` };
  const ct = probe.contentType || '';
  const audioLike = ct.startsWith('audio/') || ct.includes('mpegurl') || ct.includes('octet-stream');
  if (!audioLike) return { v: 'warn', d: `content-type "${ct || '?'}"` };
  return { v: 'ok', d: ct };
}

/** @param {string|null|undefined} streamUrl @returns {Verdict} */
export function classifyHttps(streamUrl) {
  return /^https:\/\//i.test(streamUrl ?? '')
    ? { v: 'ok' }
    : { v: 'bad', d: 'http (mixed content)' };
}

/** @param {StreamProbe} probe @param {string|null|undefined} codec @returns {Verdict} */
export function classifyIcy(probe, codec) {
  if ((codec ?? '').toUpperCase() === 'HLS') return { v: 'na', d: 'HLS — metadata via manifest' };
  if (probe.icySeen) return { v: 'ok', d: 'StreamTitle present' };
  if (probe.metaintAdvertised) return { v: 'warn', d: 'icy-metaint advertised, no StreamTitle in 64 KB' };
  return { v: 'bad', d: 'no ICY metadata' };
}

/**
 * Hard/soft split for a bad stream verdict — the input to phase-2
 * hysteresis. Hard means "will not fix itself" (act sooner); soft means
 * "the internet was busy" (retry, then wait for a streak).
 *
 * Accepts either the detail string of a verdict already known to be bad,
 * or a whole verdict object — a non-`bad` verdict has no class.
 *
 * @param {string|null|Verdict} input
 * @returns {'hard'|'soft'|null}
 */
export function failureClass(input) {
  if (input && typeof input === 'object') {
    return input.v === 'bad' ? failureClass(input.d ?? null) : null;
  }
  // An unknown or missing detail is soft on purpose: soft only ever costs
  // a retry, while a wrong `hard` would drive an unpublish in phase 2.
  return HARD_DETAILS.has(input ?? '') ? 'hard' : 'soft';
}

/**
 * Build one observation row (ADR 002 "Observation row") from a probe
 * result. The caller normalises/serialises it through
 * `tools/lib/observations.mjs`.
 *
 * @param {{station: {id: string}, facets: {stream: Verdict, icy?: Verdict},
 *          probe: StreamProbe, at: string, retried?: boolean}} input
 * @returns {object} observation row (not yet normalised)
 */
export function toObservation({ station, facets, probe, at, retried = false }) {
  const stream = facets.stream;
  return {
    id: station.id,
    at,
    v: 'gha',
    f: 'stream',
    o: stream.v,
    c: stream.v === 'bad' ? failureClass(stream.d ?? null) : null,
    s: typeof probe?.status === 'number' ? probe.status : null,
    ct: probe?.contentType || null,
    ms: typeof probe?.ms === 'number' ? probe.ms : null,
    d: stream.d ?? null,
    icy: facets.icy?.v ?? 'na',
    r: retried === true,
  };
}

/**
 * Classifiers that need `src/fetchers.json`. Passing the manifest in keeps
 * the module pure and lets tests use a two-entry manifest.
 *
 * @param {{fetchers: Record<string, {program?: boolean, selfContained?: boolean}>,
 *          wireableBroadcasters?: string[]}} manifest
 */
export function createClassifiers(manifest) {
  const fetchers = manifest?.fetchers ?? {};
  const known = new Set(Object.keys(fetchers));
  const programCapable = new Set(Object.entries(fetchers).filter(([, v]) => v.program).map(([k]) => k));
  const selfContained = new Set(Object.entries(fetchers).filter(([, v]) => v.selfContained).map(([k]) => k));
  const wireable = new Set(manifest?.wireableBroadcasters ?? []);

  /** A metadataUrl that is really a broadcaster slug for a proxied fetcher. */
  function isMetadataSlug(metadataUrl, metadataKey) {
    return !!metadataKey && SLUG_NOT_URL.has(metadataKey) && !/^https?:\/\//i.test(metadataUrl);
  }

  function classifyMetadataApi(metadataUrl, probe, metadataKey, broadcaster) {
    if (!metadataUrl) {
      if (metadataKey && selfContained.has(metadataKey)) {
        return { v: 'ok', d: `built into ${metadataKey} fetcher` };
      }
      if (broadcaster && wireable.has(broadcaster)) {
        return { v: 'warn', d: 'auto-discoverable — run `npm run wire-metadata`' };
      }
      return { v: 'na', d: 'not declared' };
    }
    if (isMetadataSlug(metadataUrl, metadataKey)) {
      return { v: 'ok', d: `slug=${metadataUrl} (proxied)` };
    }
    if (!probe || probe.status === 'failed') return { v: 'bad', d: probe?.errorToken ?? 'unreachable' };
    if (typeof probe.status === 'number' && probe.status >= 400) return { v: 'bad', d: `HTTP ${probe.status}` };
    if (!probe.contentType?.includes('json')) {
      if (metadataKey && NON_JSON_METADATA.has(metadataKey)) {
        return { v: 'ok', d: probe.contentType || 'non-json metadata' };
      }
      return { v: 'warn', d: `content-type "${probe.contentType || '?'}"` };
    }
    return { v: 'ok' };
  }

  function classifyFetcher(metadataKey) {
    if (!metadataKey) return { v: 'na', d: 'generic' };
    if (known.has(metadataKey)) return { v: 'ok', d: metadataKey };
    return { v: 'bad', d: `unknown key "${metadataKey}"` };
  }

  function classifyProgram(metadataKey) {
    if (!metadataKey) return { v: 'na' };
    return programCapable.has(metadataKey)
      ? { v: 'ok' }
      : { v: 'warn', d: 'fetcher does not expose program info' };
  }

  return {
    classifyStream,
    classifyHttps,
    classifyIcy,
    classifyMetadataApi,
    classifyFetcher,
    classifyProgram,
    isMetadataSlug,
  };
}
