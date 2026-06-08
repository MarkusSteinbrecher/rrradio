/**
 * Broadcaster-API logo harvesting — pure, network-free core (issue #471).
 *
 * Some broadcasters expose an authoritative, broadcaster-hosted, licence-clean
 * per-channel logo through the very same metadata API we already call for
 * now-playing data. This module codifies the *join* — station → channel record
 * → image URL — and the policy classifier, so a thin CLI
 * (`tools/harvest-broadcaster-logos.mjs`) can fetch the source documents and
 * emit an `apply-logos` patch without any business logic of its own.
 *
 * First adapter: the SRG SSR integration layer (SRF / RTS / RSI / RTR), all of
 * which share `il.srf.ch/integrationlayer/2.0/<net>/channelList/radio.json` and
 * key per-channel art by the same id we already store in `metadataUrl`.
 *
 * An adapter is `{ name, sources(stations), match(station), index(net, json),
 * resolve(station, indexByNet) }`:
 *   - sources(stations) → the channelList documents the CLI must fetch, as
 *     `[{ net, url }]`, deduped to the nets actually present in the catalog.
 *   - match(station)    → a truthy key when the station belongs to the adapter.
 *   - index(net, json)  → Map<channelId, channelRecord> from a fetched document.
 *   - resolve(...)      → an apply-logos patch entry, or null when unmatched.
 */

export const SRG_NETS = ['srf', 'rts', 'rsi', 'rtr'];

// `.../integrationlayer/2.0/<net>/songList/radio/byChannel/<channelId>.json`
const SRG_METADATA_RE =
  /^https?:\/\/il\.srf\.ch\/integrationlayer\/2\.0\/(srf|rts|rsi|rtr)\/songList\/radio\/byChannel\/([^/]+)\.json$/i;

/** Extract `{ net, channelId }` from an SRG songList metadataUrl, else null. */
export function parseSrgMetadataUrl(url) {
  if (typeof url !== 'string') return null;
  const m = url.match(SRG_METADATA_RE);
  if (!m) return null;
  return { net: m[1].toLowerCase(), channelId: m[2] };
}

/** The channelList document for a net (all per-channel art in one fetch). */
export function srgChannelListUrl(net) {
  return `https://il.srf.ch/integrationlayer/2.0/${net}/channelList/radio.json`;
}

/**
 * Build `Map<channelId, record>` from a fetched channelList document. Channels
 * without a usable string `imageUrl` (e.g. podcast placeholders) are dropped so
 * the join can only ever resolve real art.
 */
export function indexSrgChannelList(json) {
  const list = Array.isArray(json?.channelList) ? json.channelList : [];
  const out = new Map();
  for (const c of list) {
    if (c?.id == null) continue;
    if (typeof c.imageUrl !== 'string' || !c.imageUrl.trim()) continue;
    const id = String(c.id);
    out.set(id, {
      channelId: id,
      title: typeof c.title === 'string' ? c.title : '',
      imageUrl: c.imageUrl.trim(),
      imageTitle: typeof c.imageTitle === 'string' ? c.imageTitle : '',
      timeTableUrl: typeof c.timeTableUrl === 'string' ? c.timeTableUrl : '',
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Policy: is the station's current logo worth replacing?
// ─────────────────────────────────────────────────────────────────────────

/** faviconSource values that mark a non-specific, replaceable logo. */
const WEAK_FAVICON_SOURCES = new Set(['radio-browser', 'catalog-family-brand']);

/** URL tails that look like a site-wide default rather than a station mark. */
const GENERIC_FAVICON_PATH_RE = /\/(favicon(\.ico|[-._][^/]*\.(png|jpe?g|webp|gif))?|apple-touch-icon[^/]*)$/i;

/**
 * Classify a station's existing logo into the policy tiers the harvester acts
 * on: `missing` (no favicon at all), `generic` (a weak/site-default icon worth
 * upgrading), or `good` (a deliberate per-station logo we leave alone unless
 * forced). Pure — reads only `favicon` / `faviconSource`.
 */
export function faviconState(station) {
  const fav = station?.favicon;
  if (typeof fav !== 'string' || !fav.trim()) return 'missing';
  const src = typeof station?.faviconSource === 'string' ? station.faviconSource : '';
  if (!src || WEAK_FAVICON_SOURCES.has(src)) return 'generic';
  if (GENERIC_FAVICON_PATH_RE.test(fav)) return 'generic';
  return 'good';
}

/** Policy tiers in increasing aggressiveness — the CLI maps a flag to one. */
export const POLICY = {
  MISSING: 'missing', // only stations with no favicon
  GENERIC: 'generic', // + weak / site-default icons
  ALL: 'all', // every matched station (forced re-harvest)
};

/** Does `state` fall within the chosen policy's write set? */
export function policyIncludes(policy, state) {
  if (policy === POLICY.ALL) return true;
  if (policy === POLICY.GENERIC) return state === 'missing' || state === 'generic';
  return state === 'missing';
}

// ─────────────────────────────────────────────────────────────────────────
// SRG adapter
// ─────────────────────────────────────────────────────────────────────────

export const srgAdapter = {
  name: 'srg',

  match(station) {
    return parseSrgMetadataUrl(station?.metadataUrl ?? '');
  },

  /** The channelList docs to fetch — only the nets present in `stations`. */
  sources(stations) {
    const nets = new Set();
    for (const s of stations ?? []) {
      const key = this.match(s);
      if (key) nets.add(key.net);
    }
    return [...nets].sort().map((net) => ({ net, url: srgChannelListUrl(net) }));
  },

  index(_net, json) {
    return indexSrgChannelList(json);
  },

  /**
   * Resolve an apply-logos patch entry for a station, given `indexByNet`
   * (`Map<net, Map<channelId, record>>`). Returns null when the station is
   * not SRG or its channel id isn't in the fetched list.
   */
  resolve(station, indexByNet) {
    const key = this.match(station);
    if (!key) return null;
    const rec = indexByNet.get(key.net)?.get(key.channelId);
    if (!rec) return null;
    return {
      id: station.id,
      url: rec.imageUrl,
      source: 'broadcaster-api',
      sourceType: 'cdn',
      license: 'broadcaster',
      sourceUrl: srgChannelListUrl(key.net),
    };
  },
};

export const ADAPTERS = [srgAdapter];

/** Look up an adapter by name (case-insensitive), or null. */
export function getAdapter(name) {
  const n = String(name ?? '').toLowerCase();
  return ADAPTERS.find((a) => a.name === n) ?? null;
}
