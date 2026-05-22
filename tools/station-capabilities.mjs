const VALID_STATUS = new Set(['working', 'icy-only', 'stream-only']);

export const METADATA_STRATEGIES = ['api', 'icy', 'hls', 'none'];
export const BACKGROUND_POLL_PRIORITIES = ['normal', 'low', 'never'];

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isHlsStation(station) {
  const codec = text(station.codec).toUpperCase();
  const streamUrl = text(station.streamUrl);
  return codec === 'HLS' || /\.m3u8(?:[?#]|$)/i.test(streamUrl);
}

function metadataStrategy(station, fetchers) {
  const status = text(station.status);
  const metadataKey = text(station.metadata);
  if (metadataKey && fetchers[metadataKey]) return 'api';

  // `working` without a known fetcher is a curation mismatch, but we
  // keep native clients conservative: background work is still low
  // priority and bounded, not completely suppressed.
  if (status === 'working' || status === 'icy-only') {
    return isHlsStation(station) ? 'hls' : 'icy';
  }
  return 'none';
}

function backgroundPollPriority(strategy) {
  if (strategy === 'api') return 'normal';
  if (strategy === 'icy' || strategy === 'hls') return 'low';
  return 'never';
}

function increment(map, key) {
  map[key] = (map[key] ?? 0) + 1;
}

export function buildStationCapabilities(stations, fetcherManifest) {
  if (!Array.isArray(stations)) {
    throw new TypeError('buildStationCapabilities: stations must be an array');
  }
  const fetchers = fetcherManifest?.fetchers;
  if (!fetchers || typeof fetchers !== 'object' || Array.isArray(fetchers)) {
    throw new TypeError('buildStationCapabilities: fetcherManifest.fetchers must be an object');
  }

  const counts = {
    stations: 0,
    byStatus: {},
    byMetadataStrategy: Object.fromEntries(METADATA_STRATEGIES.map((key) => [key, 0])),
    byBackgroundPollPriority: Object.fromEntries(BACKGROUND_POLL_PRIORITIES.map((key) => [key, 0])),
    knownFetcherStations: 0,
    unknownFetcherStations: 0,
  };

  const capabilities = [];
  for (const station of stations) {
    if (!station || typeof station !== 'object') continue;
    const id = text(station.id);
    if (!id) continue;

    const rawStatus = text(station.status);
    const status = VALID_STATUS.has(rawStatus) ? rawStatus : null;
    const metadataKey = text(station.metadata) || null;
    const fetcher = metadataKey ? fetchers[metadataKey] : undefined;
    const strategy = metadataStrategy(station, fetchers);
    const priority = backgroundPollPriority(strategy);

    counts.stations++;
    increment(counts.byStatus, status ?? 'unknown');
    increment(counts.byMetadataStrategy, strategy);
    increment(counts.byBackgroundPollPriority, priority);
    if (metadataKey && fetcher) counts.knownFetcherStations++;
    if (metadataKey && !fetcher) counts.unknownFetcherStations++;

    capabilities.push({
      id,
      status,
      metadataKey,
      metadataUrl: text(station.metadataUrl) || null,
      metadataStrategy: strategy,
      backgroundPollPriority: priority,
      hasProgram: Boolean(fetcher?.program),
      hasSchedule: Boolean(fetcher?.schedule),
      hasProviderCover: Boolean(fetcher?.providerCover),
    });
  }

  return { counts, stations: capabilities };
}

export function buildStationCapabilitiesPayload(stations, fetcherManifest, options = {}) {
  const built = buildStationCapabilities(stations, fetcherManifest);
  return {
    $schema: options.schema ?? 'generated station metadata capabilities',
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    sourceCatalog: options.sourceCatalog ?? null,
    sourceManifest: options.sourceManifest ?? 'src/fetchers.json',
    counts: built.counts,
    stations: built.stations,
  };
}
