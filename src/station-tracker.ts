import { countryName } from './country';
import fetcherManifest from './fetchers.json';
import type { Station } from './types';

const BASE = import.meta.env.BASE_URL;
const PAGE_SIZE = 200;

interface CatalogPayload {
  stations?: unknown[];
}

interface LogoStatusStation {
  id: string;
  country?: string;
  source?: string;
  tier?: string;
  state?: string;
  reason?: string;
  action?: string;
  faviconSource?: string;
}

interface LogoStatusReport {
  generatedAt?: string;
  stations?: LogoStatusStation[];
}

/** From tools/probe-logo-sizes.mjs — real pixel size + bucket per station. */
interface LogoQualityStation {
  id: string;
  favicon?: string;
  source?: 'local' | 'remote' | 'skipped';
  format?: string;
  width?: number;
  height?: number;
  bytes?: number;
  aspect?: number;
  bucket?: 'good' | 'acceptable' | 'poor' | 'vector' | 'unknown';
  error?: string;
}

interface LogoQualityReport {
  generatedAt?: string;
  stations?: LogoQualityStation[];
}

/** NP-quality filter bucket — vector is rolled into 'good' for filtering and
 *  donut display because SVGs render crisp at any size. */
type NpQuality = 'all' | 'good' | 'acceptable' | 'poor' | 'unknown';

type SourceType = 'bundle' | 'api' | 'cdn' | 'none';

interface FetcherManifest {
  fetchers: Record<string, {
    broadcaster: string | null;
    schedule: boolean;
    program: boolean;
    providerCover: boolean;
    selfContained: boolean;
    notes: string;
  }>;
  wireableBroadcasters: string[];
}

const FETCHER_MANIFEST = fetcherManifest as FetcherManifest;
const KNOWN_METADATA_FETCHERS = new Set(Object.keys(FETCHER_MANIFEST.fetchers));
const SELF_CONTAINED_METADATA_FETCHERS = new Set(
  Object.entries(FETCHER_MANIFEST.fetchers)
    .filter(([, entry]) => entry.selfContained)
    .map(([key]) => key),
);
const PROGRAM_METADATA_FETCHERS = new Set(
  Object.entries(FETCHER_MANIFEST.fetchers)
    .filter(([, entry]) => entry.program)
    .map(([key]) => key),
);
const WIREABLE_BROADCASTERS = new Set(FETCHER_MANIFEST.wireableBroadcasters);

interface MatrixRow {
  id: string;
  name: string;
  broadcaster?: string;
  country?: string;
  status?: string;
  favicon?: string;
  faviconSource?: string;
  faviconSourceUrl?: string;
  faviconLicense: string;
  /** Where we *got the URL from* (provenance). Prefers YAML `faviconSource`,
   *  falls back to the logo-status report, defaults to `unknown`. */
  source: string;
  /** What *kind of asset* the URL points at (api/cdn/bundle/none). Heuristic
   *  from URL pattern unless `faviconSourceType` is set in YAML. */
  sourceType: SourceType;
  metadata?: string;
  metadataUrl?: string;
  /** Resolved upstream URL — YAML faviconSourceUrl when set; otherwise the favicon URL when remote. */
  originalUrl?: string;
  tier: string;
  state: 'ok' | 'warn' | 'bad' | 'na';
  action: string;
  reason?: string;
  /** Real pixel/byte metrics from probe-logo-sizes.mjs (missing when no probe yet). */
  probeFormat?: string;
  probeWidth?: number;
  probeHeight?: number;
  probeBytes?: number;
  /** Filter-facing bucket (vector folds into 'good'). 'unknown' when no probe. */
  npQuality: NpQuality;
}

type ImageState = 'all' | 'ok' | 'warn' | 'bad';

type SortKey = 'name' | 'country' | 'status' | 'favicon' | 'sourceType' | 'source'
             | 'license' | 'tier' | 'state' | 'size';
type SortDir = 'asc' | 'desc';

const state: {
  rows: MatrixRow[];
  rowById: Map<string, MatrixRow>;
  filtered: MatrixRow[];
  page: number;
  generatedAt?: string;
  logoGeneratedAt?: string;
  filters: {
    query: string;
    country: string;
    status: string;
    imageState: ImageState;
    license: string;
    npQuality: NpQuality;
  };
  /** Active sort. `null` = catalog order (the default). Clicking a header
   *  cycles: catalog → asc → desc → catalog. */
  sort: { key: SortKey; dir: SortDir } | null;
  collapsedGroups: Set<string>;
} = {
  rows: [],
  rowById: new Map(),
  filtered: [],
  page: 0,
  filters: { query: '', country: 'all', status: 'all', imageState: 'all', license: 'all', npQuality: 'all' },
  sort: null,
  collapsedGroups: new Set(),
};

const refs = {
  generated: byId('tracker-generated'),
  logoGenerated: byId('logo-generated'),
  query: byId<HTMLInputElement>('filter-query-top'),
  country: byId<HTMLSelectElement>('filter-country'),
  status: byId<HTMLSelectElement>('filter-status'),
  imageState: byId<HTMLSelectElement>('filter-image-state'),
  license: byId<HTMLSelectElement>('filter-license'),
  summary: byId('matrix-summary'),
  pagePrev: byId<HTMLButtonElement>('matrix-page-prev'),
  pageNext: byId<HTMLButtonElement>('matrix-page-next'),
  pageLabel: byId('matrix-page-label'),
  table: byId<HTMLTableElement>('matrix-table'),
  rows: byId<HTMLTableSectionElement>('matrix-rows'),
  donutCoverage: byId('donut-coverage'),
  donutState: byId('donut-state'),
  donutNp: byId('donut-np'),
  donutLicense: byId('donut-license'),
  npQuality: byId<HTMLSelectElement>('filter-np-quality'),
  sourcesSummary: byId('sources-summary'),
  sourcesOverviewTile: byId('sources-overview-tile'),
  sourcesDetail: byId('sources-detail'),
  sourcesXdup: byId('sources-xdup'),
  sourcesTablePanel: byId('sources-table-panel'),
  sourcesTableTitle: byId('sources-table-title'),
  sourcesTableSummary: byId('sources-table-summary'),
  sourcesQuery: byId<HTMLInputElement>('sources-filter-query'),
  sourcesSource: byId<HTMLSelectElement>('sources-filter-source'),
  sourcesCountry: byId<HTMLSelectElement>('sources-filter-country'),
  sourcesDisposition: byId<HTMLSelectElement>('sources-filter-disposition'),
  sourcesSort: byId<HTMLSelectElement>('sources-filter-sort'),
  sourcesTable: byId<HTMLTableElement>('sources-table'),
  sourcesTableRows: byId<HTMLTableSectionElement>('sources-table-rows'),
  sourcesPageSummary: byId('sources-page-summary'),
  sourcesPagePrev: byId<HTMLButtonElement>('sources-page-prev'),
  sourcesPageNext: byId<HTMLButtonElement>('sources-page-next'),
  sourcesPageLabel: byId('sources-page-label'),
};

// ─── Sources tab types ──────────────────────────────────────────────
type SourceKind = 'radio-browser' | 'manual' | string;

interface SourceSummary {
  id: string;
  name: string;
  abbr?: string;
  kind: SourceKind;
  homepage: string | null;
  description: string | null;
  candidateCount: number;
  importedCount: number;
  availableCount: number;
  extra: Record<string, unknown>;
  detailUrl: string;
}

interface SourcesSummary {
  generatedAt: string;
  catalogTotal: number;
  unclassifiedCatalogEntries: number;
  sources: SourceSummary[];
  crossSourceDuplicates: Array<{
    streamUrl: string;
    entries: Array<{ source: string; catalogId: string; name?: string; country?: string }>;
  }>;
}

interface RBCountryRollup {
  country: string;
  total: number;
  candidatesIndexed: number;
  imported: number;
  importedRows: number;
  available: number;
  playable: number;
  broken: number;
  duplicatesInUpstream: number;
  generatedAt: string | null;
  detailUrl: string;
}

interface RBTopCandidate {
  stationuuid: string;
  name?: string;
  country?: string;
  streamUrl?: string;
  homepage?: string;
  votes: number;
  clickcount: number;
  verdict?: string;
  matchedCatalogId: string | null;
}

interface RBOrphan {
  catalogId: string;
  stationuuid: string;
  name?: string;
  country?: string;
  streamUrl?: string;
}

interface RBSourceDetail {
  generatedAt: string;
  source: { id: string; name: string; kind: 'radio-browser'; homepage: string | null; description: string | null };
  counts: { candidateTotal: number; imported: number; importedCandidateRows: number; available: number };
  analyzedCountries: string[];
  countriesAnalyzed: number;
  perCountry: Record<string, RBCountryRollup>;
  verdictTotals: Record<string, number>;
  topByVotes: RBTopCandidate[];
  topUnimportedByVotes: RBTopCandidate[];
  importedWithoutCountryAnalysis: RBOrphan[];
}

interface ManualSourceItem {
  catalogId: string;
  name?: string;
  country?: string;
  broadcaster?: string;
  streamUrl?: string;
  homepage?: string;
  favicon?: string;
  codec?: string;
  bitrate?: number;
  status?: string;
  matchedCatalogId: string;
}

interface ManualDupGroup {
  kind: string;
  key: string;
  entries: Array<{ catalogId: string; name?: string; country?: string; streamUrl?: string }>;
}

interface ManualSourceDetail {
  generatedAt: string;
  source: { id: string; name: string; kind: 'manual'; homepage: string | null; description: string | null };
  counts: { candidateTotal: number; imported: number; importedCandidateRows: number; available: number };
  items: ManualSourceItem[];
  duplicateGroups: ManualDupGroup[];
  duplicateGroupsTotal?: number;
}

type ActiveTab = 'matrix' | 'sources';

// One row per upstream station — RB or manual. Shipped by
// tools/build-sources.mjs as /sources/<source-id>-candidates.json.
interface SourceCandidate {
  stationuuid: string;       // RB uuid OR catalog id for manual
  name: string;
  country: string;
  votes: number;
  clickcount: number;
  verdict: string | null;
  duplicateOf: string | null;
  duplicateOfName?: string | null;
  duplicateVia?: string | null;
  matchedCatalogId: string | null;
  streamHost: string;
  streamUrl?: string | null;
  homepage?: string | null;
  favicon?: string | null;
  // 1 = RB's own probe says playable, 0 = RB says broken, null = no data.
  // When our verdict says broken but rbCheckOk === 1, the row is worth
  // a curator look — often means there's a working URL we missed.
  rbCheckOk?: number | null;
  // Manual-only enrichments
  broadcaster?: string | null;
  status?: string | null;
  // Orphan marker for RB-bound rows whose country wasn't analyzed.
  note?: string;
  // Filled in client-side after loading so per-row source attribution
  // survives merging across multiple source files.
  sourceId?: string;
}

interface SourceCandidatesFile {
  generatedAt: string;
  sourceId: string;
  count: number;
  candidates: SourceCandidate[];
}

interface ByteProbeResult {
  stationuuid: string;
  sourceId?: string | null;
  name?: string | null;
  country?: string | null;
  streamUrl?: string | null;
  streamHost?: string | null;
  fetchVerdict?: string | null;
  rbCheckOk?: number | null;
  byteVerdict: string;
  byteOk: boolean;
  reason?: string | null;
  status?: number | null;
  contentType?: string | null;
  bytesRead?: number | null;
  signature?: string | null;
  elapsedMs?: number | null;
  finalUrl?: string | null;
  resolvedFrom?: string | null;
  probedAt?: string | null;
}

interface ByteProbeReport {
  generatedAt?: string;
  input?: string;
  scope?: string;
  count?: number;
  okCount?: number;
  byByteVerdict?: Record<string, number>;
  results?: ByteProbeResult[];
}

type Disposition =
  | 'imported'
  | 'duplicate'
  | 'byte-ok'
  | 'broken'
  | 'available'
  | 'http-only'
  | 'needs-playlist'
  | 'other';
// `unplayable` is a meta-filter — it's not a disposition a candidate
// can hold directly, but the donut's "Broken / no audio bytes" bucket
// maps to it for click-to-filter. It excludes HTTP-only rows, which are
// split into their own source-health bucket because native apps can test
// them while the web catalog cannot publish them by default.
// `playable` is the matching source-health meta-filter: imported,
// analyzer-ok, or byte-probe-ok, excluding HTTP-only candidates.
// `actionable` = the broken sub-buckets where curator effort can plausibly
// fix or remove the station: bad URL (4xx), cert problem (tls), server
// error (5xx), host gone (dns), refused. Skips broken-mixed (structural
// http→https limitation we can't fix) and broken-timeout (mostly flaky).
type DispositionFilter = 'all' | Disposition | 'playable' | 'unplayable' | 'actionable';
type CatalogApiCheck = 'metadataApi' | 'fetcher' | 'program';
type CatalogApiCheckState = 'ok' | 'warn' | 'bad' | 'na';
type CatalogImageFilterState = 'ok' | 'warn' | 'bad' | 'source' | 'missing' | 'na';

type SourceOverviewFilter =
  | { kind: 'disposition'; value: DispositionFilter }
  | { kind: 'catalogImage'; value: CatalogImageFilterState }
  | { kind: 'catalogApi'; check: CatalogApiCheck; value: CatalogApiCheckState };

// Bucket id used by the donut: a coarser grouping than Disposition.
// Each donut segment maps to one bucket; clicking sets the matching
// DispositionFilter so the table re-filters consistently.
type DonutBucket = 'imported' | 'available' | 'byte-ok' | 'http-only' | 'duplicate' | 'unplayable' | 'other';

function donutBucketOf(c: SourceCandidate): DonutBucket {
  const d = dispositionOf(c);
  if (d === 'imported') return 'imported';
  if (d === 'available') return 'available';
  if (d === 'byte-ok') return 'byte-ok';
  if (d === 'http-only') return 'http-only';
  if (d === 'duplicate') return 'duplicate';
  if (d === 'broken' || d === 'needs-playlist') return 'unplayable';
  return 'other';
}
type SourcesSortKey = 'votes-desc' | 'votes-asc' | 'clicks-desc' | 'name-asc' | 'name-desc' | 'country-asc';

const SOURCES_PAGE_SIZE = 200;

const sourcesState: {
  summary: SourcesSummary | null;
  detailCache: Map<string, RBSourceDetail | ManualSourceDetail>;
  candidatesCache: Map<string, SourceCandidate[]>;
  candidatesLoading: Map<string, Promise<void>>;
  byteProbeLoaded: boolean;
  byteProbeGeneratedAt: string | null;
  byteProbeByKey: Map<string, ByteProbeResult>;
  byteProbeByUuid: Map<string, ByteProbeResult>;
  loaded: boolean;
  loadError: string | null;
  // Filter state for the per-station table.
  filters: {
    query: string;
    source: string;        // source id, or 'all'
    country: string;
    disposition: DispositionFilter;
    catalogImage: 'all' | CatalogImageFilterState;
    catalogApi: Record<CatalogApiCheck, 'all' | CatalogApiCheckState>;
    sort: SourcesSortKey;
  };
  page: number;
  filtered: SourceCandidate[];
  collapsedGroups: Set<string>;
} = {
  summary: null,
  detailCache: new Map(),
  candidatesCache: new Map(),
  candidatesLoading: new Map(),
  byteProbeLoaded: false,
  byteProbeGeneratedAt: null,
  byteProbeByKey: new Map(),
  byteProbeByUuid: new Map(),
  loaded: false,
  loadError: null,
  filters: {
    query: '',
    source: 'all',
    country: 'all',
    disposition: 'all',
    catalogImage: 'all',
    catalogApi: { metadataApi: 'all', fetcher: 'all', program: 'all' },
    sort: 'votes-desc',
  },
  page: 0,
  filtered: [],
  collapsedGroups: new Set(),
};
let activeTab: ActiveTab = 'matrix';

const KNOWN_LICENSES = new Set([
  'broadcaster',
  'wikipedia',
  'cc-by',
  'cc-by-sa',
  'cc0',
  'public-domain',
]);

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeStation(raw: unknown): Station | null {
  if (!isRecord(raw)) return null;
  const id = optionalString(raw.id);
  const name = optionalString(raw.name);
  const streamUrl = optionalString(raw.streamUrl);
  if (!id || !name || !streamUrl) return null;
  const status = optionalString(raw.status);
  const sourceType = optionalString(raw.faviconSourceType);
  return {
    id,
    name,
    broadcaster: optionalString(raw.broadcaster),
    streamUrl,
    homepage: optionalString(raw.homepage),
    country: optionalString(raw.country),
    favicon: optionalString(raw.favicon),
    faviconSource: optionalString(raw.faviconSource),
    faviconSourceUrl: optionalString(raw.faviconSourceUrl),
    faviconLicense: optionalString(raw.faviconLicense),
    faviconSourceType:
      sourceType === 'bundle' || sourceType === 'api' || sourceType === 'cdn' || sourceType === 'none'
        ? sourceType
        : undefined,
    bitrate: optionalNumber(raw.bitrate),
    codec: optionalString(raw.codec),
    metadata: optionalString(raw.metadata),
    metadataUrl: optionalString(raw.metadataUrl),
    status:
      status === 'working' || status === 'icy-only' || status === 'stream-only' ? status : undefined,
  };
}

// URL-pattern-based source-type heuristic. Mirrors the rules in
// tools/backfill-favicon-source.mjs so the JS view and the YAML stay
// consistent. Service endpoints (image-service, ?w=, /v3/re/, /_ipx/,
// dims4 thumbnailers…) → `api`; plain hosted assets → `cdn`.
const API_HOSTS_RE = /^(?:api\.ardmediathek\.de|audioapi\.orf\.at|images\.zeno\.fm)$/i;
const API_URL_RE =
  /(?:\/api\/|\/image-service\/|\/v3\/re\/|\/_ipx\/|\bdims\d+\b|\/dims4\/|\?ops=|\?w=|\?fit=|\?s=\d+x\d+|\?t=_\d+x\d+)/i;

function deriveSourceType(favicon: string | undefined, override?: SourceType): SourceType {
  if (override) return override;
  if (!favicon) return 'none';
  if (/^stations\//.test(favicon)) return 'bundle';
  let host: string | null = null;
  try { host = new URL(favicon).host.toLowerCase(); } catch { /* malformed → treat as cdn */ }
  if (host && API_HOSTS_RE.test(host)) return 'api';
  if (API_URL_RE.test(favicon)) return 'api';
  return 'cdn';
}

async function loadCatalog(): Promise<Station[]> {
  const res = await fetch(`${BASE}stations.json`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`stations.json HTTP ${res.status}`);
  const data = (await res.json()) as CatalogPayload;
  return (data.stations ?? []).map(normalizeStation).filter((s): s is Station => s !== null);
}

async function loadLogoStatusReport(): Promise<LogoStatusReport | null> {
  try {
    const res = await fetch(`${BASE}station-logo-status.json`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`station-logo-status.json HTTP ${res.status}`);
    return (await res.json()) as LogoStatusReport;
  } catch {
    return null;
  }
}

async function loadLogoQualityReport(): Promise<LogoQualityReport | null> {
  try {
    const res = await fetch(`${BASE}station-logo-quality.json`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`station-logo-quality.json HTTP ${res.status}`);
    return (await res.json()) as LogoQualityReport;
  } catch {
    return null;
  }
}

function probeToNpQuality(probe?: LogoQualityStation): NpQuality {
  if (!probe || !probe.bucket) return 'unknown';
  if (probe.bucket === 'vector') return 'good'; // SVG scales — visually equivalent to good
  if (probe.bucket === 'good' || probe.bucket === 'acceptable' || probe.bucket === 'poor') {
    return probe.bucket;
  }
  return 'unknown';
}

function deriveMatrixRow(
  station: Station,
  status?: LogoStatusStation,
  quality?: LogoQualityStation,
): MatrixRow {
  // After the 2026-05-15 backfill every published station carries a
  // `faviconSource` in YAML. We still fall back to logo-status for
  // anything that slipped through, and "unknown" as the last resort —
  // *not* "radio-browser", which used to be a misleading guess.
  const yamlSource = station.faviconSource;
  const reportSource = status?.faviconSource ?? status?.source;

  let source: string;
  if (yamlSource) source = yamlSource;
  else if (reportSource === 'missing') source = 'missing';
  else if (station.favicon) source = reportSource && reportSource !== 'remote' ? reportSource : 'unknown';
  else source = 'missing';

  const sourceType = deriveSourceType(station.favicon, station.faviconSourceType);

  // Original URL: prefer explicit YAML field, fall back to favicon iff it's
  // a remote URL (skip local `stations/...` paths).
  const isLocalFavicon = station.favicon ? /^stations\//.test(station.favicon) : false;
  const originalUrl =
    station.faviconSourceUrl ?? (station.favicon && !isLocalFavicon ? station.favicon : undefined);

  const reportState = status?.state;
  const rowState: MatrixRow['state'] =
    reportState === 'ok' || reportState === 'warn' || reportState === 'bad'
      ? reportState
      : station.favicon
        ? 'ok'
        : 'bad';

  return {
    id: station.id,
    name: station.name,
    broadcaster: station.broadcaster,
    country: station.country,
    status: station.status,
    favicon: station.favicon,
    faviconSource: station.faviconSource,
    faviconSourceUrl: station.faviconSourceUrl,
    faviconLicense: station.faviconLicense ?? 'unknown',
    source,
    sourceType,
    metadata: station.metadata,
    metadataUrl: station.metadataUrl,
    originalUrl,
    tier: status?.tier ?? (station.favicon ? 'ok' : 'missing'),
    state: rowState,
    action: status?.action ?? '-',
    reason: status?.reason,
    probeFormat: quality?.format,
    probeWidth: quality?.width,
    probeHeight: quality?.height,
    probeBytes: quality?.bytes,
    npQuality: probeToNpQuality(quality),
  };
}

function buildMatrix(
  catalog: Station[],
  report: LogoStatusReport | null,
  quality: LogoQualityReport | null,
): MatrixRow[] {
  const statusById = new Map<string, LogoStatusStation>();
  for (const s of report?.stations ?? []) statusById.set(s.id, s);
  const qualityById = new Map<string, LogoQualityStation>();
  for (const s of quality?.stations ?? []) qualityById.set(s.id, s);
  return catalog.map((station) =>
    deriveMatrixRow(station, statusById.get(station.id), qualityById.get(station.id)),
  );
}

function option(value: string, label: string): HTMLOptionElement {
  const opt = document.createElement('option');
  opt.value = value;
  opt.textContent = label;
  return opt;
}

function syncFilterOptions(rows: MatrixRow[]): void {
  const countries = new Set<string>();
  const statuses = new Set<string>();
  for (const r of rows) {
    if (r.country) countries.add(r.country);
    if (r.status) statuses.add(r.status);
  }
  refs.country.replaceChildren(
    option('all', 'All countries'),
    ...[...countries]
      .sort((a, b) => countryName(a).localeCompare(countryName(b)))
      .map((code) => option(code, countryName(code))),
  );
  refs.status.replaceChildren(
    option('all', 'All statuses'),
    ...[...statuses].sort().map((s) => option(s, s)),
  );
  // License filter uses the same buckets as the donut so the two views agree.
  refs.license.replaceChildren(
    option('all', 'All licenses'),
    option('known', 'Known'),
    option('implicit', 'Implicit'),
    option('unknown', 'Unknown'),
  );
}

/** Filter predicate factored out so donuts can recompute against a view that
 *  excludes their own filter dimension — otherwise clicking a segment would
 *  collapse the donut to that segment (it'd become the only thing left). */
function rowMatchesFilters(
  r: MatrixRow,
  excludeKey?: 'imageState' | 'license' | 'npQuality',
): boolean {
  const f = state.filters;
  if (f.country !== 'all' && r.country !== f.country) return false;
  if (f.status !== 'all' && r.status !== f.status) return false;
  if (excludeKey !== 'imageState' && f.imageState !== 'all' && r.state !== f.imageState) return false;
  if (excludeKey !== 'license' && f.license !== 'all' && licenseBucket(r.faviconLicense) !== f.license) return false;
  if (excludeKey !== 'npQuality' && f.npQuality !== 'all' && r.npQuality !== f.npQuality) return false;
  if (f.query) {
    const q = f.query.trim().toLowerCase();
    if (q) {
      const hay = [r.name, r.id, r.broadcaster, r.country, r.source, r.tier, r.favicon, r.originalUrl]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
  }
  return true;
}

function applyFilters(resetPage = true): void {
  if (resetPage) state.page = 0;
  state.filtered = state.rows.filter((r) => rowMatchesFilters(r));
  if (state.sort) sortRows(state.filtered, state.sort.key, state.sort.dir);
  renderMatrix();
  renderDonuts();
}

// Tie-broken comparator helpers. Strings compare via localeCompare so accents
// and umlauts land where readers expect them; missing values sort last on asc.
function cmpStr(a: string | undefined, b: string | undefined): number {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b, undefined, { sensitivity: 'base' });
}

function cmpNum(a: number | undefined, b: number | undefined): number {
  const av = Number.isFinite(a as number) ? (a as number) : Number.NEGATIVE_INFINITY;
  const bv = Number.isFinite(b as number) ? (b as number) : Number.NEGATIVE_INFINITY;
  return av - bv;
}

function rowKey(row: MatrixRow, key: SortKey): string | number | undefined {
  switch (key) {
    case 'name':       return row.name;
    case 'country':    return row.country ? countryName(row.country) : undefined;
    case 'status':     return row.status;
    case 'favicon':    return row.favicon;
    case 'sourceType': return row.sourceType;
    case 'source':     return row.source;
    case 'license':    return row.faviconLicense;
    case 'tier':       return row.tier;
    case 'state':      return row.state;
    case 'size':       return (row.probeWidth ?? 0) * (row.probeHeight ?? 0);
  }
}

function sortRows(rows: MatrixRow[], key: SortKey, dir: SortDir): void {
  const factor = dir === 'asc' ? 1 : -1;
  rows.sort((a, b) => {
    const av = rowKey(a, key);
    const bv = rowKey(b, key);
    const c = typeof av === 'number' || typeof bv === 'number'
      ? cmpNum(av as number, bv as number)
      : cmpStr(av as string, bv as string);
    // Stable tie-break on id so equal-value rows don't churn between renders.
    return (c !== 0 ? c : a.id.localeCompare(b.id)) * factor;
  });
}

/** Click → asc → desc → off cycle. Updates header aria-sort + applies sort
 *  to the existing filtered set without re-filtering. Page resets to 0. */
function cycleSort(key: SortKey): void {
  const cur = state.sort;
  let next: typeof state.sort;
  if (!cur || cur.key !== key) next = { key, dir: 'asc' };
  else if (cur.dir === 'asc')  next = { key, dir: 'desc' };
  else                          next = null;
  state.sort = next;
  // Reflect on the headers.
  for (const th of refs.table.querySelectorAll<HTMLTableCellElement>('th[data-sort-key]')) {
    if (next && th.dataset.sortKey === next.key) {
      th.setAttribute('aria-sort', next.dir === 'asc' ? 'ascending' : 'descending');
    } else {
      th.removeAttribute('aria-sort');
    }
  }
  // Re-derive from rows in catalog order so toggling 'off' restores it.
  state.filtered = state.rows.filter((r) => rowMatchesFilters(r));
  if (next) sortRows(state.filtered, next.key, next.dir);
  state.page = 0;
  renderMatrix();
}

function appendIdGroupCells(tr: HTMLTableRowElement, row: MatrixRow): void {
  // Thumb
  const thumbTd = document.createElement('td');
  thumbTd.dataset.group = 'id';
  const thumb = document.createElement('div');
  thumb.className = 'image-thumb';
  // Page CSP allows img-src 'self' https: data: only — only http:// breaks it.
  // Everything else (https:, data:, root-absolute /, or relative stations/...)
  // is renderable.
  const isHttpOnly = row.favicon ? /^http:\/\//i.test(row.favicon) : false;
  if (row.favicon && !isHttpOnly) {
    const img = document.createElement('img');
    img.src = row.favicon;
    img.alt = '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => {
      thumb.classList.add('image-thumb--missing');
      thumb.textContent = '?';
    });
    thumb.append(img);
  } else if (row.favicon) {
    thumb.classList.add('image-thumb--missing');
    thumb.textContent = 'http';
    thumb.title = 'HTTP-only favicon — not rendered under page CSP';
  } else {
    thumb.classList.add('image-thumb--missing');
    thumb.textContent = '—';
  }
  thumbTd.append(thumb);

  // Name
  const nameTd = document.createElement('td');
  nameTd.dataset.group = 'id';
  const nameWrap = document.createElement('div');
  nameWrap.className = 'station-name';
  const name = document.createElement('span');
  name.className = 'station-name__main';
  name.textContent = row.name;
  name.title = row.name;
  const sub = document.createElement('span');
  sub.className = 'station-name__sub';
  sub.textContent = [row.broadcaster, row.id].filter(Boolean).join(' / ');
  nameWrap.append(name, sub);
  nameTd.append(nameWrap);

  // Country
  const countryTd = document.createElement('td');
  countryTd.dataset.group = 'id';
  countryTd.textContent = row.country ? countryName(row.country) : '-';

  // Status
  const statusTd = document.createElement('td');
  statusTd.dataset.group = 'id';
  if (row.status) {
    const pill = document.createElement('span');
    pill.className = 'pill';
    pill.textContent = row.status;
    statusTd.append(pill);
  } else {
    statusTd.textContent = '-';
  }

  tr.append(thumbTd, nameTd, countryTd, statusTd);
}

function appendImageGroupCells(tr: HTMLTableRowElement, row: MatrixRow): void {
  // Favicon URL
  const urlTd = document.createElement('td');
  urlTd.dataset.group = 'image';
  urlTd.className = 'url-cell';
  if (row.favicon) {
    const isLocal = /^stations\//.test(row.favicon);
    if (isLocal) {
      urlTd.classList.add('url-cell--local');
      urlTd.textContent = row.favicon;
      urlTd.title = `local bundle: ${row.favicon}`;
    } else {
      const link = document.createElement('a');
      link.href = row.favicon;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = row.favicon;
      link.title = row.favicon;
      urlTd.append(link);
    }
  } else {
    urlTd.classList.add('url-cell--missing');
    urlTd.textContent = 'no favicon';
  }

  // Source type pill
  const typeTd = document.createElement('td');
  typeTd.dataset.group = 'image';
  const typePill = document.createElement('span');
  typePill.className = 'source-type-pill';
  typePill.dataset.sourceType = row.sourceType;
  typePill.textContent = row.sourceType;
  typeTd.append(typePill);

  // Provenance pill
  const sourceTd = document.createElement('td');
  sourceTd.dataset.group = 'image';
  const sourcePill = document.createElement('span');
  sourcePill.className = 'source-pill';
  sourcePill.dataset.source = row.source;
  sourcePill.textContent = row.source;
  sourceTd.append(sourcePill);

  // Original URL
  const origTd = document.createElement('td');
  origTd.dataset.group = 'image';
  origTd.className = 'url-cell';
  if (row.originalUrl) {
    const link = document.createElement('a');
    link.href = row.originalUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = row.originalUrl;
    link.title = row.originalUrl;
    origTd.append(link);
  } else if (row.favicon && /^stations\//.test(row.favicon)) {
    origTd.classList.add('url-cell--missing');
    origTd.textContent = 'unknown — bundled';
    origTd.title = 'Local PNG with no faviconSourceUrl recorded in YAML';
  } else {
    origTd.classList.add('url-cell--missing');
    origTd.textContent = '-';
  }

  // License pill
  const licenseTd = document.createElement('td');
  licenseTd.dataset.group = 'image';
  const licensePill = document.createElement('span');
  licensePill.className = 'license-pill';
  licensePill.dataset.license = row.faviconLicense;
  licensePill.textContent = row.faviconLicense;
  licenseTd.append(licensePill);

  // Tier
  const tierTd = document.createElement('td');
  tierTd.dataset.group = 'image';
  tierTd.textContent = row.tier;

  // State
  const stateTd = document.createElement('td');
  stateTd.dataset.group = 'image';
  const stateCheck = document.createElement('span');
  stateCheck.className = 'check';
  stateCheck.dataset.state = row.state;
  stateCheck.textContent = row.state;
  if (row.reason) stateCheck.title = row.reason;
  stateTd.append(stateCheck);

  // Size — real pixel dimensions from probe-logo-sizes.mjs.
  const sizeTd = document.createElement('td');
  sizeTd.dataset.group = 'image';
  sizeTd.className = 'size-cell';
  if (row.probeWidth && row.probeHeight) {
    const dim = document.createElement('span');
    dim.className = 'size-cell__dim';
    dim.textContent = `${row.probeWidth}×${row.probeHeight}`;
    const meta = document.createElement('span');
    meta.className = 'size-cell__meta';
    meta.textContent = [row.probeFormat, row.probeBytes ? formatBytes(row.probeBytes) : null]
      .filter(Boolean)
      .join(' · ');
    sizeTd.append(dim, meta);
    sizeTd.title = `aspect ${(row.probeWidth / row.probeHeight).toFixed(2)} · np-quality ${row.npQuality}`;
  } else if (row.probeFormat === 'svg') {
    const dim = document.createElement('span');
    dim.className = 'size-cell__dim size-cell__dim--vector';
    dim.textContent = 'vector';
    sizeTd.append(dim);
  } else {
    sizeTd.classList.add('size-cell--missing');
    sizeTd.textContent = '–';
  }

  // Action
  const actionTd = document.createElement('td');
  actionTd.dataset.group = 'image';
  actionTd.textContent = row.action;

  tr.append(urlTd, typeTd, sourceTd, origTd, licenseTd, tierTd, stateTd, sizeTd, actionTd);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

// ── Donut metrics ─────────────────────────────────────────────────────────
// Three filter-aware donuts above the matrix: image coverage, image state,
// license clarity. They recompute from `state.filtered` so country/status
// filters scope the view to whatever the user is curating right now.

type DonutFilter =
  | { key: 'imageState'; value: ImageState }
  | { key: 'license'; value: 'all' | 'known' | 'implicit' | 'unknown' }
  | { key: 'npQuality'; value: NpQuality };

interface DonutSegment {
  label: string;
  count: number;
  className: 'ok' | 'warn' | 'bad' | 'muted';
  /** When set, clicking the segment toggles this filter on/off. */
  filter?: DonutFilter;
}

interface DonutSpec {
  label: string;
  segments: DonutSegment[];
  /** Index into `segments` whose share is shown as the big % in the centre. */
  primary: number;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag: string, attrs: Record<string, string>): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function renderDonut(host: HTMLElement, spec: DonutSpec): void {
  host.replaceChildren();
  const total = spec.segments.reduce((s, x) => s + x.count, 0);

  const svg = svgEl('svg', { viewBox: '0 0 64 64', role: 'img' });
  const title = svgEl('title', {});
  title.textContent = `${spec.label} (${total.toLocaleString()} stations)`;
  svg.append(title);

  // Background ring + segments share the same geometry. pathLength=100 lets us
  // use the percent directly as stroke-dasharray, no circumference maths.
  const ringAttrs = {
    cx: '32', cy: '32', r: '26', fill: 'none', 'stroke-width': '10', pathLength: '100',
  };
  svg.append(svgEl('circle', { ...ringAttrs, class: 'donut__bg' }));

  if (total > 0) {
    let offset = 0;
    for (const seg of spec.segments) {
      const pct = (seg.count / total) * 100;
      if (pct <= 0) continue;
      const isActive = !!seg.filter && filterMatches(seg.filter);
      const isClickable = !!seg.filter && seg.count > 0;
      const cls = [
        'donut__seg',
        `donut__seg--${seg.className}`,
        isClickable ? 'is-clickable' : '',
        isActive ? 'is-active' : '',
      ].filter(Boolean).join(' ');
      const arc = svgEl('circle', {
        ...ringAttrs,
        class: cls,
        'stroke-dasharray': `${pct} ${100 - pct}`,
        'stroke-dashoffset': String(-offset),
        transform: 'rotate(-90 32 32)',
        'stroke-linecap': 'butt',
      });
      const hint = isClickable
        ? isActive ? ' — click to clear filter' : ' — click to filter'
        : '';
      const segTitle = svgEl('title', {});
      segTitle.textContent =
        `${seg.label}: ${seg.count.toLocaleString()} (${pct.toFixed(1)}%)${hint}`;
      arc.append(segTitle);
      if (isClickable && seg.filter) {
        const filter = seg.filter;
        arc.addEventListener('click', () => toggleDonutFilter(filter, isActive));
      }
      svg.append(arc);
      offset += pct;
    }
  }

  const primary = spec.segments[spec.primary];
  const primaryPct = total > 0 && primary ? Math.round((primary.count / total) * 100) : 0;
  const centerText = svgEl('text', {
    x: '32', y: '32',
    'text-anchor': 'middle', 'dominant-baseline': 'central',
    class: 'donut__center',
  });
  centerText.textContent = total > 0 ? `${primaryPct}%` : '–';
  svg.append(centerText);
  host.append(svg);

  const cap = document.createElement('figcaption');
  cap.className = 'donut__caption';
  const lab = document.createElement('span');
  lab.className = 'donut__label';
  lab.textContent = spec.label;
  const val = document.createElement('span');
  val.className = 'donut__value';
  val.textContent = total > 0 && primary
    ? `${primary.count.toLocaleString()} of ${total.toLocaleString()}`
    : '0 of 0';
  val.title = spec.segments
    .map((s) => `${s.label}: ${s.count.toLocaleString()}`)
    .join(' · ');

  // Compact legend so each segment is self-identifying without a hover.
  const legend = document.createElement('ul');
  legend.className = 'donut__legend';
  for (const seg of spec.segments) {
    const li = document.createElement('li');
    li.className = `donut__legend-item is-${seg.className}`;
    const dot = document.createElement('span');
    dot.className = 'donut__legend-dot';
    const txt = document.createElement('span');
    txt.className = 'donut__legend-label';
    txt.textContent = seg.label;
    li.append(dot, txt);
    legend.append(li);
  }

  cap.append(lab, val, legend);
  host.append(cap);
}

function licenseBucket(license: string): 'known' | 'implicit' | 'unknown' {
  if (KNOWN_LICENSES.has(license)) return 'known';
  if (license === 'broadcaster-implicit') return 'implicit';
  return 'unknown';
}

function filterMatches(f: DonutFilter): boolean {
  if (f.key === 'imageState') return state.filters.imageState === f.value;
  if (f.key === 'npQuality')  return state.filters.npQuality === f.value;
  return state.filters.license === f.value;
}

function toggleDonutFilter(f: DonutFilter, isActive: boolean): void {
  if (f.key === 'imageState') {
    const next: ImageState = isActive ? 'all' : f.value;
    state.filters.imageState = next;
    refs.imageState.value = next;
  } else if (f.key === 'npQuality') {
    const next: NpQuality = isActive ? 'all' : f.value;
    state.filters.npQuality = next;
    refs.npQuality.value = next;
  } else {
    const next = isActive ? 'all' : f.value;
    state.filters.license = next;
    refs.license.value = next;
  }
  applyFilters();
}

interface DonutCounts {
  withLogo: number;
  missing: number;
  ok: number;
  warn: number;
  bad: number;
  licKnown: number;
  licImplicit: number;
  licUnknown: number;
  npGood: number;
  npAcceptable: number;
  npPoor: number;
  npUnknown: number;
}

function countRows(rows: MatrixRow[]): DonutCounts {
  let withLogo = 0;
  let ok = 0, warn = 0, bad = 0;
  let licKnown = 0, licImplicit = 0, licUnknown = 0;
  let npGood = 0, npAcceptable = 0, npPoor = 0, npUnknown = 0;
  for (const r of rows) {
    if (r.favicon) withLogo++;
    if (r.state === 'ok') ok++;
    else if (r.state === 'warn') warn++;
    else if (r.state === 'bad') bad++;
    const bucket = licenseBucket(r.faviconLicense);
    if (bucket === 'known') licKnown++;
    else if (bucket === 'implicit') licImplicit++;
    else licUnknown++;
    if (r.npQuality === 'good') npGood++;
    else if (r.npQuality === 'acceptable') npAcceptable++;
    else if (r.npQuality === 'poor') npPoor++;
    else npUnknown++;
  }
  return {
    withLogo, missing: rows.length - withLogo, ok, warn, bad,
    licKnown, licImplicit, licUnknown,
    npGood, npAcceptable, npPoor, npUnknown,
  };
}

function buildDonutSpecs(imageRows: MatrixRow[], licenseRows: MatrixRow[], npRows: MatrixRow[]): {
  coverage: DonutSpec; state: DonutSpec; license: DonutSpec; np: DonutSpec;
} {
  // Each donut sees the catalog filtered by everything EXCEPT its own
  // dimension — otherwise self-clicking a slice would collapse the donut.
  const img = countRows(imageRows);
  const lic = countRows(licenseRows);
  const np  = countRows(npRows);
  const { withLogo, missing, ok, warn, bad } = img;
  const { licKnown, licImplicit, licUnknown } = lic;
  const { npGood, npAcceptable, npPoor, npUnknown } = np;

  return {
    coverage: {
      label: 'With logo',
      primary: 0,
      segments: [
        // "With logo" has no exact filter target — image-state=ok would
        // exclude logos flagged warn — so the positive slice stays inert.
        { label: 'with logo', count: withLogo, className: 'ok' },
        // "Missing" maps to image-state=bad: every no-favicon row is
        // classified bad by deriveMatrixRow, plus a few flagged remote
        // logos. Operationally both are "needs work."
        { label: 'missing',   count: missing,  className: 'bad',
          filter: { key: 'imageState', value: 'bad' } },
      ],
    },
    state: {
      label: 'Image state',
      primary: 0,
      segments: [
        { label: 'ok',   count: ok,   className: 'ok',
          filter: { key: 'imageState', value: 'ok' } },
        { label: 'warn', count: warn, className: 'warn',
          filter: { key: 'imageState', value: 'warn' } },
        { label: 'bad',  count: bad,  className: 'bad',
          filter: { key: 'imageState', value: 'bad' } },
      ],
    },
    license: {
      label: 'License known',
      primary: 0,
      segments: [
        { label: 'known',    count: licKnown,    className: 'ok',
          filter: { key: 'license', value: 'known' } },
        { label: 'implicit', count: licImplicit, className: 'warn',
          filter: { key: 'license', value: 'implicit' } },
        { label: 'unknown',  count: licUnknown,  className: 'muted',
          filter: { key: 'license', value: 'unknown' } },
      ],
    },
    np: {
      // Driven by tools/probe-logo-sizes.mjs — real pixel/byte metrics. The
      // "good" bucket includes SVG (vector) since SVGs render crisp at any
      // size. Stations without a probe entry land in "unknown".
      label: 'NP quality',
      primary: 0,
      segments: [
        { label: 'good',       count: npGood,       className: 'ok',
          filter: { key: 'npQuality', value: 'good' } },
        { label: 'acceptable', count: npAcceptable, className: 'warn',
          filter: { key: 'npQuality', value: 'acceptable' } },
        { label: 'poor',       count: npPoor,       className: 'bad',
          filter: { key: 'npQuality', value: 'poor' } },
        { label: 'unknown',    count: npUnknown,    className: 'muted',
          filter: { key: 'npQuality', value: 'unknown' } },
      ],
    },
  };
}

function renderDonuts(): void {
  // Each donut sees the rows scoped to all filters EXCEPT its own dimension
  // so self-click only highlights — it never collapses the donut.
  const imageRows = state.rows.filter((r) => rowMatchesFilters(r, 'imageState'));
  const licenseRows = state.rows.filter((r) => rowMatchesFilters(r, 'license'));
  const npRows = state.rows.filter((r) => rowMatchesFilters(r, 'npQuality'));
  const specs = buildDonutSpecs(imageRows, licenseRows, npRows);
  renderDonut(refs.donutCoverage, specs.coverage);
  renderDonut(refs.donutState, specs.state);
  renderDonut(refs.donutNp, specs.np);
  renderDonut(refs.donutLicense, specs.license);
}

function renderMatrix(): void {
  refs.rows.replaceChildren();
  const start = state.page * PAGE_SIZE;
  const pageRows = state.filtered.slice(start, start + PAGE_SIZE);
  if (pageRows.length === 0) {
    const tr = document.createElement('tr');
    tr.className = 'empty-row';
    const td = document.createElement('td');
    td.colSpan = 13;
    td.textContent = 'No stations match these filters.';
    tr.append(td);
    refs.rows.append(tr);
  }
  for (const row of pageRows) {
    const tr = document.createElement('tr');
    appendIdGroupCells(tr, row);
    appendImageGroupCells(tr, row);
    refs.rows.append(tr);
  }

  const pageCount = Math.max(1, Math.ceil(state.filtered.length / PAGE_SIZE));
  refs.pagePrev.disabled = state.page <= 0;
  refs.pageNext.disabled = state.page >= pageCount - 1;
  refs.pageLabel.textContent = `Page ${state.page + 1} of ${pageCount}`;
  const end = Math.min(start + PAGE_SIZE, state.filtered.length);
  refs.summary.textContent =
    `${state.filtered.length.toLocaleString()} of ${state.rows.length.toLocaleString()} stations` +
    (state.filtered.length > 0 ? ` · showing ${start + 1}-${end}` : '');
}

function toggleGroup(group: string): void {
  if (state.collapsedGroups.has(group)) state.collapsedGroups.delete(group);
  else state.collapsedGroups.add(group);

  refs.table.classList.toggle(`is-collapsed-${group}`, state.collapsedGroups.has(group));

  const groupTh = refs.table.querySelector<HTMLTableCellElement>(`.matrix-group[data-group="${group}"]`);
  const toggleBtn = refs.table.querySelector<HTMLButtonElement>(`[data-toggle-group="${group}"]`);
  if (groupTh) {
    const fullColspan = Number(groupTh.dataset.fullColspan ?? '1');
    groupTh.colSpan = state.collapsedGroups.has(group) ? 1 : fullColspan;
  }
  if (toggleBtn) {
    toggleBtn.setAttribute('aria-expanded', state.collapsedGroups.has(group) ? 'false' : 'true');
  }
}

function toggleSourcesGroup(group: string): void {
  if (sourcesState.collapsedGroups.has(group)) sourcesState.collapsedGroups.delete(group);
  else sourcesState.collapsedGroups.add(group);

  const collapsed = sourcesState.collapsedGroups.has(group);
  refs.sourcesTable.classList.toggle(`is-collapsed-${group}`, collapsed);

  const groupTh = refs.sourcesTable.querySelector<HTMLTableCellElement>(`.sources-table__group[data-source-group="${group}"]`);
  const toggleBtn = refs.sourcesTable.querySelector<HTMLButtonElement>(`[data-toggle-source-group="${group}"]`);
  if (groupTh) {
    const fullColspan = Number(groupTh.dataset.fullColspan ?? '1');
    groupTh.colSpan = collapsed ? 1 : fullColspan;
  }
  if (toggleBtn) {
    toggleBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  }
}

function bindEvents(): void {
  refs.query.addEventListener('input', () => {
    state.filters.query = refs.query.value;
    applyFilters();
  });
  refs.country.addEventListener('change', () => {
    state.filters.country = refs.country.value;
    applyFilters();
  });
  refs.status.addEventListener('change', () => {
    state.filters.status = refs.status.value;
    applyFilters();
  });
  refs.imageState.addEventListener('change', () => {
    state.filters.imageState = refs.imageState.value as ImageState;
    applyFilters();
  });
  refs.npQuality.addEventListener('change', () => {
    state.filters.npQuality = refs.npQuality.value as NpQuality;
    applyFilters();
  });
  refs.license.addEventListener('change', () => {
    state.filters.license = refs.license.value;
    applyFilters();
  });
  refs.pagePrev.addEventListener('click', () => {
    if (state.page <= 0) return;
    state.page--;
    renderMatrix();
  });
  refs.pageNext.addEventListener('click', () => {
    const pageCount = Math.max(1, Math.ceil(state.filtered.length / PAGE_SIZE));
    if (state.page >= pageCount - 1) return;
    state.page++;
    renderMatrix();
  });
  for (const btn of refs.table.querySelectorAll<HTMLButtonElement>('[data-toggle-group]')) {
    btn.addEventListener('click', () => {
      const group = btn.dataset.toggleGroup;
      if (group) toggleGroup(group);
    });
  }
  for (const btn of refs.sourcesTable.querySelectorAll<HTMLButtonElement>('[data-toggle-source-group]')) {
    btn.addEventListener('click', () => {
      const group = btn.dataset.toggleSourceGroup;
      if (group) toggleSourcesGroup(group);
    });
  }
  for (const th of refs.table.querySelectorAll<HTMLTableCellElement>('th[data-sort-key]')) {
    th.addEventListener('click', () => {
      const key = th.dataset.sortKey as SortKey | undefined;
      if (key) cycleSort(key);
    });
  }
  for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-tab-btn]')) {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tabBtn as ActiveTab | undefined;
      if (tab) setActiveTab(tab);
    });
  }
  window.addEventListener('hashchange', () => {
    const fromHash = initialTabFromHash();
    if (fromHash !== activeTab) setActiveTab(fromHash);
  });

  // Sources filters (per-station table)
  let queryDebounce: number | null = null;
  refs.sourcesQuery.addEventListener('input', () => {
    if (queryDebounce !== null) window.clearTimeout(queryDebounce);
    queryDebounce = window.setTimeout(() => {
      sourcesState.filters.query = refs.sourcesQuery.value;
      applySourcesFilters();
    }, 150);
  });
  refs.sourcesSource.addEventListener('change', () => {
    sourcesState.filters.source = refs.sourcesSource.value;
    applySourcesFilters();
  });
  refs.sourcesCountry.addEventListener('change', () => {
    sourcesState.filters.country = refs.sourcesCountry.value;
    applySourcesFilters();
  });
  refs.sourcesDisposition.addEventListener('change', () => {
    sourcesState.filters.disposition = refs.sourcesDisposition.value as DispositionFilter;
    applySourcesFilters();
  });
  refs.sourcesSort.addEventListener('change', () => {
    sourcesState.filters.sort = refs.sourcesSort.value as SourcesSortKey;
    applySourcesFilters();
  });
  refs.sourcesPagePrev.addEventListener('click', () => {
    if (sourcesState.page <= 0) return;
    sourcesState.page--;
    renderSourcesTable();
  });
  refs.sourcesPageNext.addEventListener('click', () => {
    const pages = Math.max(1, Math.ceil(sourcesState.filtered.length / SOURCES_PAGE_SIZE));
    if (sourcesState.page >= pages - 1) return;
    sourcesState.page++;
    renderSourcesTable();
  });
}

// ─── Sources tab ────────────────────────────────────────────────────

async function loadSourcesSummary(): Promise<void> {
  if (sourcesState.loaded || sourcesState.loadError) return;
  try {
    const res = await fetch(`${BASE}sources.json`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`sources.json HTTP ${res.status}`);
    sourcesState.summary = (await res.json()) as SourcesSummary;
    sourcesState.loaded = true;
  } catch (err) {
    sourcesState.loadError = err instanceof Error ? err.message : String(err);
  }
}

async function loadSourceDetail(src: SourceSummary): Promise<RBSourceDetail | ManualSourceDetail | null> {
  const cached = sourcesState.detailCache.get(src.id);
  if (cached) return cached;
  try {
    const res = await fetch(`${BASE}${src.detailUrl.replace(/^\//, '')}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${src.detailUrl} HTTP ${res.status}`);
    const data = (await res.json()) as RBSourceDetail | ManualSourceDetail;
    sourcesState.detailCache.set(src.id, data);
    return data;
  } catch {
    return null;
  }
}

function safeHost(u?: string): string {
  if (!u) return '';
  try { return new URL(u).host; } catch { return ''; }
}

function fmtN(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toLocaleString();
}

function renderSourcesTab(): void {
  if (sourcesState.loadError) {
    refs.sourcesSummary.textContent = `Failed to load sources.json — ${sourcesState.loadError}`;
    refs.sourcesOverviewTile.replaceChildren();
    refs.sourcesDetail.replaceChildren();
    refs.sourcesXdup.hidden = true;
    return;
  }
  const summary = sourcesState.summary;
  if (!summary) {
    refs.sourcesSummary.textContent = 'Loading…';
    return;
  }

  refs.sourcesSummary.textContent =
    `${fmtN(summary.catalogTotal)} catalog rows · generated ${new Date(summary.generatedAt).toLocaleString()}`;

  // Source filter dropdown — kept in sync with the registered sources.
  syncSourceFilterOptions(summary.sources);

  // Single aggregated donut across all sources (rendered once
  // candidates load; here we render a loading placeholder).
  refs.sourcesOverviewTile.replaceChildren(buildAggregateOverviewTile());

  // Cross-source duplicates panel (rare; collapsed when none).
  if (summary.crossSourceDuplicates.length === 0) {
    refs.sourcesXdup.hidden = true;
    refs.sourcesXdup.replaceChildren();
  } else {
    refs.sourcesXdup.hidden = false;
    refs.sourcesXdup.replaceChildren(
      buildEl('h3', { class: 'sources-detail__heading' },
        `Cross-source duplicates · ${summary.crossSourceDuplicates.length}`),
      buildEl('p', { class: 'sources-tile__desc' },
        'One stream URL imported under more than one source. Almost always a mis-classification — investigate.'),
      buildXdupTable(summary.crossSourceDuplicates),
    );
  }

  // Trigger the candidates load + table render. Always-on table now;
  // it pulls from one source or merges all.
  refs.sourcesTableTitle.textContent = candidatesTableTitle();
  refs.sourcesTableSummary.textContent = 'Loading candidates…';
  refs.sourcesTableRows.replaceChildren();
  refs.sourcesPageSummary.textContent = '';
  refs.sourcesPagePrev.disabled = true;
  refs.sourcesPageNext.disabled = true;
  refs.sourcesPageLabel.textContent = '';

  // Pick a default source for the overview drilldown (first one).
  const overviewSrc = summary.sources[0];
  if (overviewSrc) {
    refs.sourcesDetail.replaceChildren(buildEl('h3', {}, `${overviewSrc.name} · loading overview…`));
    void loadAndRenderDetail(overviewSrc);
  }

  void loadAndApplyCandidates();
}

function syncSourceFilterOptions(sources: SourceSummary[]): void {
  const current = refs.sourcesSource.value || sourcesState.filters.source;
  refs.sourcesSource.replaceChildren(option('all', 'All sources'));
  for (const s of sources) refs.sourcesSource.append(option(s.id, s.name));
  if (current && [...refs.sourcesSource.options].some((o) => o.value === current)) {
    refs.sourcesSource.value = current;
    sourcesState.filters.source = current;
  } else {
    refs.sourcesSource.value = 'all';
    sourcesState.filters.source = 'all';
  }
}

function candidatesTableTitle(): string {
  const f = sourcesState.filters;
  if (f.source === 'all') return 'Stations · all sources';
  const src = sourcesState.summary?.sources.find((s) => s.id === f.source);
  return src ? `Stations · ${src.name}` : 'Stations';
}

async function loadAndApplyCandidates(): Promise<void> {
  const summary = sourcesState.summary;
  if (!summary) return;
  // The donut tiles need totals from every source we've ever loaded
  // — so default behavior is "load all sources on first visit". The
  // payloads are small enough (RB ~3.4 MB gzipped, manual <2 KB)
  // and the user has explicitly opened the Sources tab.
  await Promise.all([
    Promise.all(summary.sources.map((s) => loadCandidates(s))),
    loadByteProbeReport(),
  ]);

  // Build country dropdown from the union of currently-loaded sources.
  const allLoaded = summary.sources.map((s) => s.id);
  syncCountryOptions(mergeCandidates(allLoaded));

  // Refresh the aggregated donut now that we have data.
  refs.sourcesOverviewTile.replaceChildren(buildAggregateOverviewTile());

  sourcesState.page = 0;
  applySourcesFilters();
}

function mergeCandidates(sourceIds: string[]): SourceCandidate[] {
  const out: SourceCandidate[] = [];
  for (const id of sourceIds) {
    const list = sourcesState.candidatesCache.get(id);
    if (!list) continue;
    for (const c of list) {
      // sourceId is stamped here so multi-source merge keeps row attribution.
      if (!c.sourceId) c.sourceId = id;
      out.push(c);
    }
  }
  return out;
}

function catalogRowForCandidate(c: SourceCandidate): MatrixRow | undefined {
  return c.matchedCatalogId ? state.rowById.get(c.matchedCatalogId) : undefined;
}

function catalogRowsForCandidates(candidates: SourceCandidate[]): MatrixRow[] {
  const rows: MatrixRow[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    const row = catalogRowForCandidate(c);
    if (!row || seen.has(row.id)) continue;
    seen.add(row.id);
    rows.push(row);
  }
  return rows;
}

function buildAggregateOverviewTile(): HTMLElement {
  const summary = sourcesState.summary;
  if (!summary) return buildEl('span', {}, 'loading…');

  // Donut scope follows the top-row Sources filters so the overview and
  // table describe the same working set. Catalog/API donuts count the
  // unique imported catalog rows represented by those filtered candidates.
  const sourceFilter = sourcesState.filters.source;
  const includedSources = sourceFilter === 'all'
    ? summary.sources
    : summary.sources.filter((s) => s.id === sourceFilter);

  const pool: SourceCandidate[] = [];
  for (const s of includedSources) {
    const list = sourcesState.candidatesCache.get(s.id);
    if (!list) continue;
    for (const c of list) {
      if (!c.sourceId) c.sourceId = s.id;
      pool.push(c);
    }
  }

  const overviewCandidates = pool.filter((c) => candidateMatchesFilter(c, sourcesState.filters));
  const catalogRows = catalogRowsForCandidates(overviewCandidates);
  const catalogImageEntries = catalogImageEntriesForCandidates(overviewCandidates);
  const totalsForRender = pool.length > 0 ? bucketCandidates(overviewCandidates) : null;
  const segs = totalsForRender ? donutSegments(totalsForRender) : [];
  const headlineName = sourceFilter === 'all' ? 'All sources' : (includedSources[0]?.name ?? sourceFilter);
  const headlineKind = sourceFilter === 'all'
    ? `${summary.sources.length} registered`
    : (includedSources[0]?.kind ?? '');
  const wrap = buildEl('div', { class: 'source-tile-set' });
  wrap.append(
    buildOverviewDonutTile({
      title: headlineName,
      kicker: headlineKind,
      total: totalsForRender?.total ?? 0,
      totalLabel: 'candidates',
      segments: segs,
    }),
    buildCatalogImageStatusDonutTile(catalogImageEntries),
    buildCatalogApiCheckDonutTile('metadataApi', catalogRows),
    buildCatalogApiCheckDonutTile('fetcher', catalogRows),
    buildCatalogApiCheckDonutTile('program', catalogRows),
  );
  return wrap;
}

function buildOverviewDonutTile(opts: {
  title: string;
  kicker: string;
  total: number;
  totalLabel: string;
  segments: DonutSegmentSpec[];
}): HTMLElement {
  const tile = buildEl('article', { class: 'source-tile' });
  const donutHost = buildEl('div', { class: 'source-tile__donut' });
  if (opts.total > 0) {
    donutHost.append(buildDonutSvg(opts.total, opts.segments));
    donutHost.append(buildEl('div', { class: 'source-tile__center' },
      buildEl('div', { class: 'source-tile__total' }, fmtN(opts.total)),
      buildEl('div', { class: 'source-tile__total-label' }, opts.totalLabel),
    ));
  } else {
    donutHost.append(buildEl('div', { class: 'source-tile__center' },
      buildEl('div', { class: 'source-tile__total' }, fmtN(opts.total)),
      buildEl('div', { class: 'source-tile__total-label' }, opts.totalLabel),
    ));
  }

  const body = buildEl('div', { class: 'source-tile__body' },
    buildEl('div', { class: 'source-tile__head' },
      buildEl('span', { class: 'source-tile__name' }, opts.title),
      buildEl('span', { class: 'source-tile__kind' }, opts.kicker),
    ),
  );

  const legendSegments = opts.segments.filter((s) =>
    s.n > 0 || (!!s.filter && isSourceOverviewFilterActive(s.filter)),
  );
  if (legendSegments.length > 0) {
    const legend = buildEl('ul', { class: 'source-tile__legend' });
    for (const s of legendSegments) {
      const isActive = !!s.filter && isSourceOverviewFilterActive(s.filter);
      const isClickable = !!s.filter && (s.n > 0 || isActive);
      const li = buildEl('li', {
        class: 'source-tile__legend-row'
          + (isClickable ? ' is-clickable' : '')
          + (isActive ? ' is-active' : ''),
        ...(isClickable ? { tabindex: '0', role: 'button' } : {}),
        title: isClickable
          ? (isActive ? 'Click to clear filter' : `Click to filter the table to "${s.label}"`)
          : '',
      },
        buildEl('span', { class: `dot ${s.cls}` }),
        buildEl('span', {}, s.label),
        buildEl('span', { class: 'num' }, fmtN(s.n)),
      );
      if (isClickable && s.filter) {
        li.addEventListener('click', () => toggleSourceOverviewFilter(s.filter!));
        li.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); li.click(); }
        });
      }
      legend.append(li);
    }
    body.append(legend);
  }

  tile.append(donutHost, body);
  return tile;
}

function buildCatalogImageStatusDonutTile(entries: CatalogImageEntry[]): HTMLElement {
  const totals = bucketCatalogImageEntries(entries);
  return buildOverviewDonutTile({
    title: 'Catalog logos',
    kicker: 'image status',
    total: totals.total,
    totalLabel: 'catalog matches',
    segments: catalogImageSegments(totals),
  });
}

interface CandidateBuckets {
  total: number;
  playable: number;
  httpOnly: number;
  duplicate: number;
  broken: number;        // donut "Broken / no audio bytes" bucket
  unknown: number;
}

function bucketCandidates(rows: SourceCandidate[]): CandidateBuckets {
  let playable = 0, httpOnly = 0, duplicate = 0, broken = 0, unknown = 0;
  for (const c of rows) {
    const b = donutBucketOf(c);
    if (b === 'imported' || b === 'available' || b === 'byte-ok') playable++;
    else if (b === 'http-only') httpOnly++;
    else if (b === 'duplicate') duplicate++;
    else if (b === 'unplayable') broken++;
    else unknown++;
  }
  return { total: rows.length, playable, httpOnly, duplicate, broken, unknown };
}

interface CatalogImageBuckets {
  total: number;
  ok: number;
  warn: number;
  bad: number;
  source: number;
  missing: number;
  na: number;
}

interface CatalogImageEntry {
  row: MatrixRow;
  sourceFavicon: string | null;
}

function bucketCatalogImageEntries(entries: CatalogImageEntry[]): CatalogImageBuckets {
  let ok = 0, warn = 0, bad = 0, source = 0, missing = 0, na = 0;
  for (const entry of entries) {
    const state = catalogImageStateForEntry(entry);
    if (state === 'ok') ok++;
    else if (state === 'warn') warn++;
    else if (state === 'bad') bad++;
    else if (state === 'source') source++;
    else if (state === 'missing') missing++;
    else na++;
  }
  return { total: entries.length, ok, warn, bad, source, missing, na };
}

function catalogImageEntriesForCandidates(candidates: SourceCandidate[]): CatalogImageEntry[] {
  const byId = new Map<string, CatalogImageEntry>();
  for (const c of candidates) {
    const row = catalogRowForCandidate(c);
    if (!row) continue;
    const existing = byId.get(row.id);
    const sourceFavicon = cleanCandidateFavicon(c.favicon);
    if (existing) {
      if (!existing.sourceFavicon && sourceFavicon) existing.sourceFavicon = sourceFavicon;
      continue;
    }
    byId.set(row.id, { row, sourceFavicon });
  }
  return [...byId.values()];
}

function catalogImageStateForEntry(entry: CatalogImageEntry): CatalogImageFilterState {
  if (entry.row.favicon) return entry.row.state;
  if (entry.sourceFavicon) return 'source';
  return 'missing';
}

function catalogImageStateForCandidate(c: SourceCandidate): CatalogImageFilterState | null {
  const row = catalogRowForCandidate(c);
  if (!row) return null;
  if (row.favicon) return row.state;
  if (cleanCandidateFavicon(c.favicon)) return 'source';
  return 'missing';
}

interface CatalogApiCheckBuckets {
  total: number;
  ok: number;
  warn: number;
  bad: number;
  na: number;
}

function buildCatalogApiCheckDonutTile(check: CatalogApiCheck, rows: MatrixRow[]): HTMLElement {
  const buckets = bucketCatalogApiCheckRows(rows, check);
  const labels: Record<CatalogApiCheck, { title: string; kicker: string }> = {
    metadataApi: { title: 'Metadata API', kicker: 'endpoint status' },
    fetcher: { title: 'Fetcher', kicker: 'runtime support' },
    program: { title: 'Program API', kicker: 'schedule support' },
  };
  return buildOverviewDonutTile({
    title: labels[check].title,
    kicker: labels[check].kicker,
    total: buckets.total,
    totalLabel: 'catalog matches',
    segments: catalogApiCheckSegments(buckets, check),
  });
}

function bucketCatalogApiCheckRows(rows: MatrixRow[], check: CatalogApiCheck): CatalogApiCheckBuckets {
  let ok = 0, warn = 0, bad = 0, na = 0;
  for (const row of rows) {
    const state = catalogApiCheckState(row, check);
    if (state === 'ok') ok++;
    else if (state === 'warn') warn++;
    else if (state === 'bad') bad++;
    else na++;
  }
  return { total: rows.length, ok, warn, bad, na };
}

function catalogApiCheckState(row: MatrixRow, check: CatalogApiCheck): CatalogApiCheckState {
  const key = row.metadata;
  if (check === 'metadataApi') {
    if (!key) {
      return row.broadcaster && WIREABLE_BROADCASTERS.has(row.broadcaster) ? 'warn' : 'na';
    }
    if (!KNOWN_METADATA_FETCHERS.has(key)) return 'bad';
    if (row.metadataUrl || SELF_CONTAINED_METADATA_FETCHERS.has(key)) return 'ok';
    return 'warn';
  }

  if (check === 'fetcher') {
    if (!key) return 'na';
    return KNOWN_METADATA_FETCHERS.has(key) ? 'ok' : 'bad';
  }

  if (!key) return 'na';
  if (!KNOWN_METADATA_FETCHERS.has(key)) return 'bad';
  return PROGRAM_METADATA_FETCHERS.has(key) ? 'ok' : 'warn';
}

function catalogApiCheckSegments(b: CatalogApiCheckBuckets, check: CatalogApiCheck): DonutSegmentSpec[] {
  return [
    { cls: 'api-ok',   label: 'Available', n: b.ok,   filter: { kind: 'catalogApi', check, value: 'ok' } },
    { cls: 'api-warn', label: 'Review',    n: b.warn, filter: { kind: 'catalogApi', check, value: 'warn' } },
    { cls: 'api-bad',  label: 'Broken',    n: b.bad,  filter: { kind: 'catalogApi', check, value: 'bad' } },
    { cls: 'api-na',   label: 'Not wired', n: b.na,   filter: { kind: 'catalogApi', check, value: 'na' } },
  ];
}

// One row in the donut legend / one arc on the SVG. `filter` is the
// Sources-table filter toggled when the segment is clicked. Disposition
// filters mirror the visible dropdown; catalog/API filters are kept in
// state and surfaced through the active donut segment.
interface DonutSegmentSpec {
  cls: string;
  label: string;
  n: number;
  filter?: SourceOverviewFilter;
}

function donutSegments(b: CandidateBuckets): DonutSegmentSpec[] {
  return [
    { cls: 'playable',  label: 'Playable',             n: b.playable,  filter: { kind: 'disposition', value: 'playable' } },
    { cls: 'http-only', label: 'HTTP-only',            n: b.httpOnly,  filter: { kind: 'disposition', value: 'http-only' } },
    { cls: 'duplicate', label: 'Duplicate',            n: b.duplicate, filter: { kind: 'disposition', value: 'duplicate' } },
    { cls: 'broken',    label: 'Broken / no audio',    n: b.broken,    filter: { kind: 'disposition', value: 'unplayable' } },
    { cls: 'unknown',   label: 'Inconclusive / unknown', n: b.unknown, filter: { kind: 'disposition', value: 'other' } },
  ];
}

function catalogImageSegments(b: CatalogImageBuckets): DonutSegmentSpec[] {
  return [
    { cls: 'image-ok',      label: 'OK',          n: b.ok,      filter: { kind: 'catalogImage', value: 'ok' } },
    { cls: 'image-warn',    label: 'Review',      n: b.warn,    filter: { kind: 'catalogImage', value: 'warn' } },
    { cls: 'image-source',  label: 'Source logo', n: b.source,  filter: { kind: 'catalogImage', value: 'source' } },
    { cls: 'image-bad',     label: 'Bad',         n: b.bad,     filter: { kind: 'catalogImage', value: 'bad' } },
    { cls: 'image-missing', label: 'Missing',     n: b.missing, filter: { kind: 'catalogImage', value: 'missing' } },
    { cls: 'unknown',       label: 'N/A',         n: b.na,      filter: { kind: 'catalogImage', value: 'na' } },
  ];
}

function buildDonutSvg(total: number, segs: DonutSegmentSpec[]): SVGElement {
  const svg = svgEl('svg', { viewBox: '0 0 64 64', role: 'img' });
  svg.append(svgEl('circle', {
    class: 'ring-bg', cx: '32', cy: '32', r: '26',
    pathLength: '100',
  }));
  if (total > 0) {
    let offset = 0;
    for (const s of segs) {
      const pct = (s.n / total) * 100;
      if (pct <= 0) continue;
      const isActive = !!s.filter && isSourceOverviewFilterActive(s.filter);
      const classes = ['ring-seg', s.cls];
      if (s.filter && s.n > 0) classes.push('is-clickable');
      if (isActive) classes.push('is-active');
      const arc = svgEl('circle', {
        class: classes.join(' '),
        cx: '32', cy: '32', r: '26',
        pathLength: '100',
        'stroke-dasharray': `${pct} ${100 - pct}`,
        'stroke-dashoffset': String(-offset),
        transform: 'rotate(-90 32 32)',
      });
      const title = svgEl('title', {});
      title.textContent =
        `${s.label}: ${fmtN(s.n)} (${pct.toFixed(1)}%)` +
        (s.filter && s.n > 0 ? (isActive ? ' — click to clear filter' : ' — click to filter') : '');
      arc.append(title);
      if (s.filter && s.n > 0) {
        arc.addEventListener('click', () => toggleSourceOverviewFilter(s.filter!));
      }
      svg.append(arc);
      offset += pct;
    }
  }
  return svg;
}

function isSourceOverviewFilterActive(filter: SourceOverviewFilter): boolean {
  if (filter.kind === 'disposition') return sourcesState.filters.disposition === filter.value;
  if (filter.kind === 'catalogImage') return sourcesState.filters.catalogImage === filter.value;
  return sourcesState.filters.catalogApi[filter.check] === filter.value;
}

function toggleSourceOverviewFilter(filter: SourceOverviewFilter): void {
  if (filter.kind === 'disposition') {
    const next = sourcesState.filters.disposition === filter.value ? 'all' : filter.value;
    sourcesState.filters.disposition = next;
    refs.sourcesDisposition.value = next;
  } else if (filter.kind === 'catalogImage') {
    sourcesState.filters.catalogImage =
      sourcesState.filters.catalogImage === filter.value ? 'all' : filter.value;
  } else {
    sourcesState.filters.catalogApi[filter.check] =
      sourcesState.filters.catalogApi[filter.check] === filter.value ? 'all' : filter.value;
  }
  applySourcesFilters();
}

async function loadCandidates(src: SourceSummary): Promise<SourceCandidate[] | null> {
  const cached = sourcesState.candidatesCache.get(src.id);
  if (cached) return cached;
  const inflight = sourcesState.candidatesLoading.get(src.id);
  if (inflight) { await inflight; return sourcesState.candidatesCache.get(src.id) ?? null; }
  const url = `${BASE}sources/${src.id}-candidates.json`;
  const p = (async () => {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
      const data = (await res.json()) as SourceCandidatesFile;
      sourcesState.candidatesCache.set(src.id, data.candidates || []);
    } catch (err) {
      console.error('sources: candidate load failed', err);
    }
  })();
  sourcesState.candidatesLoading.set(src.id, p);
  await p;
  sourcesState.candidatesLoading.delete(src.id);
  return sourcesState.candidatesCache.get(src.id) ?? null;
}

async function loadByteProbeReport(): Promise<void> {
  if (sourcesState.byteProbeLoaded) return;
  try {
    const res = await fetch(`${BASE}sources/radio-browser-byte-probes.json`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`radio-browser-byte-probes.json HTTP ${res.status}`);
    const data = (await res.json()) as ByteProbeReport;
    sourcesState.byteProbeGeneratedAt = data.generatedAt ?? null;
    for (const result of data.results ?? []) {
      if (!result.stationuuid) continue;
      sourcesState.byteProbeByUuid.set(result.stationuuid, result);
      sourcesState.byteProbeByKey.set(byteProbeKey(result.stationuuid, result.streamUrl), result);
    }
  } catch (err) {
    console.info('sources: byte probe report not loaded', err);
  } finally {
    sourcesState.byteProbeLoaded = true;
  }
}

function byteProbeKey(stationuuid: string, streamUrl?: string | null): string {
  return `${stationuuid}\u0000${streamUrl ?? ''}`;
}

function byteProbeFor(c: SourceCandidate): ByteProbeResult | undefined {
  return sourcesState.byteProbeByKey.get(byteProbeKey(c.stationuuid, c.streamUrl))
    ?? sourcesState.byteProbeByUuid.get(c.stationuuid);
}

function syncCountryOptions(candidates: SourceCandidate[]): void {
  const countries = new Set<string>();
  for (const c of candidates) if (c.country) countries.add(c.country);
  const sorted = [...countries].sort((a, b) =>
    countryName(a).localeCompare(countryName(b)));
  const current = refs.sourcesCountry.value;
  refs.sourcesCountry.replaceChildren(option('all', 'All countries'));
  for (const cc of sorted) refs.sourcesCountry.append(option(cc, `${cc} · ${countryName(cc)}`));
  if (current && [...refs.sourcesCountry.options].some((o) => o.value === current)) {
    refs.sourcesCountry.value = current;
  } else {
    refs.sourcesCountry.value = 'all';
    sourcesState.filters.country = 'all';
  }
}

function fetchDispositionOf(c: SourceCandidate): Exclude<Disposition, 'byte-ok'> {
  if (c.matchedCatalogId) return 'imported';
  if (c.duplicateOf) return 'duplicate';
  const v = c.verdict;
  if (!v) return 'other';
  if ((v === 'ok' || v === 'ok-hls') && isHttpStreamCandidate(c)) return 'http-only';
  if (v === 'ok' || v === 'ok-hls') return 'available';
  if (v.startsWith('broken')) return 'broken';
  if (v === 'redirect-downgrade') return 'http-only';
  if (v === 'needs-playlist') return 'needs-playlist';
  return 'other';
}

function dispositionOf(c: SourceCandidate): Disposition {
  const d = fetchDispositionOf(c);
  if (d === 'http-only') return d;
  if (isFetchUnplayableDisposition(d) && byteProbeFor(c)?.byteOk === true) {
    if (isHttpStreamCandidate(c)) return 'http-only';
    return 'byte-ok';
  }
  return d;
}

function isFetchUnplayableDisposition(d: Disposition): boolean {
  return d === 'broken' || d === 'http-only' || d === 'needs-playlist';
}

function isHttpStreamCandidate(c: SourceCandidate): boolean {
  return /^http:\/\//i.test(c.streamUrl || '');
}

function candidateMatchesFilter(c: SourceCandidate, f: typeof sourcesState.filters): boolean {
  if (f.source !== 'all' && c.sourceId && c.sourceId !== f.source) return false;
  if (f.country !== 'all' && c.country !== f.country) return false;
  if (f.disposition !== 'all') {
    if (f.disposition === 'playable') {
      const bucket = donutBucketOf(c);
      if (bucket !== 'imported' && bucket !== 'available' && bucket !== 'byte-ok') return false;
    } else if (f.disposition === 'unplayable') {
      if (donutBucketOf(c) !== 'unplayable') return false;
    } else if (f.disposition === 'actionable') {
      // Curation-friendly subset of unplayable: probes a curator can
      // act on. Skips broken-mixed (structural) and broken-timeout
      // (flaky).
      const v = c.verdict;
      if (!v || !/^broken-(4xx|5xx|tls|dns|refused)$/.test(v)) return false;
      if (byteProbeFor(c)?.byteOk === true) return false;
      // Don't include already-imported stations — they're not awaiting curation.
      if (c.matchedCatalogId) return false;
    } else if (dispositionOf(c) !== f.disposition) {
      return false;
    }
  }
  if (f.catalogImage !== 'all' && catalogImageStateForCandidate(c) !== f.catalogImage) return false;
  const catalogRow = catalogRowForCandidate(c);
  for (const check of ['metadataApi', 'fetcher', 'program'] as const) {
    const expected = f.catalogApi[check];
    if (expected !== 'all' && (!catalogRow || catalogApiCheckState(catalogRow, check) !== expected)) {
      return false;
    }
  }
  if (f.query) {
    const q = f.query.trim().toLowerCase();
    if (q) {
      const hay = [c.name, c.stationuuid, c.streamHost, c.matchedCatalogId, c.duplicateOfName, c.broadcaster]
        .filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
  }
  return true;
}

function sortCandidates(rows: SourceCandidate[], key: SourcesSortKey): void {
  switch (key) {
    case 'votes-desc':   rows.sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0)); break;
    case 'votes-asc':    rows.sort((a, b) => (a.votes ?? 0) - (b.votes ?? 0)); break;
    case 'clicks-desc':  rows.sort((a, b) => (b.clickcount ?? 0) - (a.clickcount ?? 0)); break;
    case 'name-asc':     rows.sort((a, b) => (a.name || '').localeCompare(b.name || '')); break;
    case 'name-desc':    rows.sort((a, b) => (b.name || '').localeCompare(a.name || '')); break;
    case 'country-asc':  rows.sort((a, b) =>
      (a.country || '').localeCompare(b.country || '')
      || (b.votes ?? 0) - (a.votes ?? 0)); break;
  }
}

function applySourcesFilters(resetPage = true): void {
  if (resetPage) sourcesState.page = 0;
  const summary = sourcesState.summary;
  if (!summary) return;
  // Pool: every source currently loaded into the cache. The Source
  // filter then narrows further. We don't auto-fetch on every change
  // — only when the user actually picks a source — so the loaded
  // set is whatever the previous select event triggered.
  const loadedIds = summary.sources.map((s) => s.id)
    .filter((id) => sourcesState.candidatesCache.has(id));
  const pool = mergeCandidates(loadedIds);
  sourcesState.filtered = pool.filter((c) => candidateMatchesFilter(c, sourcesState.filters));
  sortCandidates(sourcesState.filtered, sourcesState.filters.sort);
  renderSourcesTable();
  refs.sourcesOverviewTile.replaceChildren(buildAggregateOverviewTile());
}

function renderSourcesTable(): void {
  const total = sourcesState.filtered.length;
  const pageSize = SOURCES_PAGE_SIZE;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(sourcesState.page, pages - 1);
  const start = page * pageSize;
  const slice = sourcesState.filtered.slice(start, start + pageSize);

  refs.sourcesTableRows.replaceChildren();
  if (slice.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 14;
    td.style.padding = '24px';
    td.style.color = 'var(--ink-4)';
    td.style.fontFamily = 'var(--mono)';
    td.style.textAlign = 'center';
    td.textContent = 'No stations match these filters.';
    tr.append(td);
    refs.sourcesTableRows.append(tr);
  } else {
    for (const c of slice) refs.sourcesTableRows.append(buildCandidateRow(c));
  }

  refs.sourcesPagePrev.disabled = page <= 0;
  refs.sourcesPageNext.disabled = page >= pages - 1;
  refs.sourcesPageLabel.textContent = `Page ${page + 1} of ${pages}`;
  // Pool size = every candidate currently loaded (across all sources
  // the user has touched). Filter ratio is reported against that pool.
  const summary = sourcesState.summary;
  const loadedTotal = summary
    ? summary.sources.reduce((s, src) =>
        s + (sourcesState.candidatesCache.get(src.id)?.length ?? 0), 0)
    : 0;
  refs.sourcesTableTitle.textContent = candidatesTableTitle();
  const byteMeta = sourcesState.byteProbeGeneratedAt
    ? ` · byte probe ${new Date(sourcesState.byteProbeGeneratedAt).toLocaleString()}`
    : '';
  refs.sourcesTableSummary.textContent =
    `${fmtN(total)} of ${fmtN(loadedTotal)} candidates match${byteMeta}`;
  refs.sourcesPageSummary.textContent = total === 0
    ? ''
    : `Showing ${fmtN(start + 1)}–${fmtN(Math.min(start + pageSize, total))} of ${fmtN(total)}`;
}

function buildCandidateRow(c: SourceCandidate): HTMLTableRowElement {
  const tr = document.createElement('tr');

  const nameTd = document.createElement('td');
  nameTd.dataset.group = 'name';
  const stationWrap = document.createElement('div');
  stationWrap.className = 'sources-station';
  stationWrap.append(buildSourceStationLogo(c));
  const nameWrap = document.createElement('div');
  nameWrap.className = 'sources-station__text';
  const nameSpan = document.createElement('span');
  nameSpan.className = 'name';
  nameSpan.textContent = c.name || '—';
  nameSpan.title = c.name || '';
  nameWrap.append(nameSpan);
  if (c.broadcaster || c.status) {
    const sub = document.createElement('div');
    sub.className = 'sub';
    sub.textContent = [c.broadcaster, c.status].filter(Boolean).join(' · ');
    nameWrap.append(sub);
  }
  stationWrap.append(nameWrap);
  nameTd.append(stationWrap);

  const countryTd = document.createElement('td');
  countryTd.dataset.group = 'metadata';
  countryTd.dataset.groupAnchor = 'metadata';
  countryTd.textContent = c.country ? `${c.country}` : '—';
  countryTd.title = c.country ? countryName(c.country) : '';

  const sourceTd = document.createElement('td');
  sourceTd.dataset.group = 'metadata';
  const srcMeta = c.sourceId
    ? sourcesState.summary?.sources.find((s) => s.id === c.sourceId)
    : undefined;
  sourceTd.textContent = srcMeta?.abbr ?? srcMeta?.name ?? c.sourceId ?? '—';
  if (srcMeta?.name && srcMeta?.abbr && srcMeta.abbr !== srcMeta.name) {
    sourceTd.title = srcMeta.name;
  }

  const votesTd = document.createElement('td');
  votesTd.dataset.group = 'metadata';
  votesTd.className = 'num';
  votesTd.textContent = c.votes ? fmtN(c.votes) : '—';

  const clicksTd = document.createElement('td');
  clicksTd.dataset.group = 'metadata';
  clicksTd.className = 'num';
  clicksTd.textContent = c.clickcount ? fmtN(c.clickcount) : '—';

  // Pipeline columns ───────────────────────────────────────────────
  // Each cell is a small status pill answering "what did this station
  // do at this step?". Together they read left-to-right as the order
  // we run the checks: dedupe → fetch probe → byte probe → catalog match.
  const dedupeTd = buildPipelineCell(pipelineDedupe(c));
  dedupeTd.dataset.group = 'pipeline';
  dedupeTd.dataset.groupAnchor = 'pipeline';
  const fetchTd = buildPipelineCell(pipelineFetch(c));
  fetchTd.dataset.group = 'pipeline';
  const bytesTd = buildPipelineCell(pipelineBytes(c));
  bytesTd.dataset.group = 'pipeline';
  const catalogTd = buildPipelineCell(pipelineCatalog(c));
  catalogTd.dataset.group = 'catalog';
  catalogTd.dataset.groupAnchor = 'catalog';
  const logoTd = buildPipelineCell(pipelineLogo(c));
  logoTd.dataset.group = 'catalog';
  const manualLogoTd = buildManualLogoCell(c);
  manualLogoTd.dataset.group = 'catalog';

  // Homepage link as a compact icon (separate from stream link).
  // Lets the curator jump to the broadcaster's site in one click —
  // critical for the actionable-broken workflow where the next step
  // is often "find the current stream URL on the broadcaster's page".
  const homeTd = document.createElement('td');
  homeTd.dataset.group = 'catalog';
  homeTd.className = 'stream-link-cell';
  if (c.homepage) {
    const a = document.createElement('a');
    a.href = c.homepage;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.className = 'stream-link';
    a.title = c.homepage;
    a.setAttribute('aria-label', `Broadcaster homepage: ${c.homepage}`);
    a.innerHTML = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">'
      + '<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" '
      + 'd="M2 7l6-5 6 5v7a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z M6 14V9h4v5"/>'
      + '</svg>';
    homeTd.append(a);
  } else {
    homeTd.textContent = '—';
    homeTd.title = 'No homepage';
  }

  // Stream link as a compact icon. Click opens in a new tab; hover
  // shows the full URL + host. Saves a wide text column.
  const linkTd = document.createElement('td');
  linkTd.dataset.group = 'catalog';
  linkTd.className = 'stream-link-cell';
  if (c.streamUrl) {
    const a = document.createElement('a');
    a.href = c.streamUrl;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.className = 'stream-link';
    a.setAttribute('aria-label', `Open stream in new tab: ${c.streamHost || c.streamUrl}`);
    a.title = c.streamHost
      ? `${c.streamHost}\n${c.streamUrl}`
      : c.streamUrl;
    // Inline SVG: external-link glyph. Tiny, color-inherits.
    a.innerHTML = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">'
      + '<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" '
      + 'd="M9 2h5v5M14 2l-6 6M12 9v4a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h4"/>'
      + '</svg>';
    linkTd.append(a);
  } else {
    linkTd.textContent = '—';
    linkTd.title = 'No stream URL';
  }

  const uuidTd = document.createElement('td');
  uuidTd.dataset.group = 'catalog';
  uuidTd.className = 'sub';
  uuidTd.textContent = c.matchedCatalogId
    ? `${c.matchedCatalogId} · ${c.stationuuid}`
    : c.stationuuid;
  uuidTd.title = uuidTd.textContent;

  tr.append(
    nameTd,
    countryTd,
    sourceTd,
    votesTd,
    clicksTd,
    dedupeTd,
    fetchTd,
    bytesTd,
    catalogTd,
    logoTd,
    manualLogoTd,
    homeTd,
    linkTd,
    uuidTd,
  );
  return tr;
}

// ─── Pipeline cell helpers ─────────────────────────────────────────

function buildManualLogoCell(c: SourceCandidate): HTMLTableCellElement {
  const td = document.createElement('td');
  const catalogId = c.matchedCatalogId;
  const form = document.createElement('form');
  form.className = 'manual-logo';

  const input = document.createElement('input');
  input.type = 'url';
  input.placeholder = 'https://…';
  input.autocomplete = 'off';
  input.inputMode = 'url';
  input.disabled = !catalogId;
  input.setAttribute('aria-label', `Manual logo URL for ${c.name || catalogId || 'station'}`);

  const button = document.createElement('button');
  button.type = 'submit';
  button.textContent = 'Queue';
  button.disabled = !catalogId;

  const status = document.createElement('span');
  status.className = 'manual-logo__status';
  status.setAttribute('aria-live', 'polite');
  if (!catalogId) {
    status.textContent = 'not cataloged';
    form.title = 'Manual logo patches can only target imported catalog rows.';
  }

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (!catalogId) return;
    void queueManualLogoPatch(catalogId, input, button, status);
  });

  form.append(input, button, status);
  td.append(form);
  return td;
}

async function queueManualLogoPatch(
  catalogId: string,
  input: HTMLInputElement,
  button: HTMLButtonElement,
  status: HTMLElement,
): Promise<void> {
  const url = input.value.trim();
  if (!url) {
    status.textContent = 'empty';
    return;
  }
  if (!url.startsWith('https://') && !url.startsWith('stations/')) {
    status.textContent = 'https only';
    return;
  }

  button.disabled = true;
  status.textContent = 'queueing…';
  try {
    const res = await fetch('/api/local/logo-patches', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: catalogId, url }),
    });
    const body = await res.json().catch(() => null) as { ok?: boolean; error?: string; count?: number } | null;
    if (!res.ok || !body?.ok) {
      status.textContent = body?.error ?? `HTTP ${res.status}`;
      return;
    }
    status.textContent = `queued ${body.count ?? 1}`;
    input.value = '';
  } catch {
    status.textContent = 'local endpoint unavailable';
  } finally {
    button.disabled = false;
  }
}

function buildSourceStationLogo(c: SourceCandidate): HTMLDivElement {
  const row = catalogRowForCandidate(c);
  const catalogFavicon = row?.favicon;
  const sourceFavicon = cleanCandidateFavicon(c.favicon);
  const favicon = catalogFavicon || sourceFavicon;
  const logo = document.createElement('div');
  logo.className = 'sources-station__logo';

  if (!favicon) {
    logo.classList.add('sources-station__logo--missing');
    logo.textContent = '—';
    logo.title = 'No station logo';
    return logo;
  }

  // Page CSP allows self, https:, and data: images. HTTP-only upstream
  // favicons are useful to flag, but cannot be rendered here.
  if (/^http:\/\//i.test(favicon)) {
    logo.classList.add('sources-station__logo--missing');
    logo.textContent = 'http';
    logo.title = `HTTP-only station logo — not rendered under page CSP: ${favicon}`;
    return logo;
  }

  const img = document.createElement('img');
  img.src = favicon;
  img.alt = '';
  img.loading = 'lazy';
  img.referrerPolicy = 'no-referrer';
  img.addEventListener('error', () => {
    img.remove();
    logo.classList.add('sources-station__logo--missing');
    logo.textContent = '?';
    logo.title = `Station logo failed to load: ${favicon}`;
  });
  logo.title = catalogFavicon
    ? `Catalog logo: ${favicon}`
    : row
      ? `Source favicon available; catalog logo is missing: ${favicon}`
      : `Source favicon: ${favicon}`;
  logo.append(img);
  return logo;
}

type PipelineState =
  | 'pass'        // green — step completed cleanly
  | 'fail'        // red — step rejected the station
  | 'flag'        // purple — step routed the station elsewhere (dupe)
  | 'pending'     // amber — step has not been run yet
  | 'skip';       // gray — step doesn't apply (e.g. probe a duplicate)

interface PipelineCell {
  state: PipelineState;
  label: string;       // short text shown in the pill
  detail?: string;     // longer text shown on hover
}

function pipelineDedupe(c: SourceCandidate): PipelineCell {
  if (c.duplicateOf) {
    const of = c.duplicateOfName || c.duplicateOf;
    return {
      state: 'flag',
      label: `Dup → ${truncate(of, 22)}`,
      detail: `Linked to canonical ${c.duplicateOf}` + (c.duplicateVia ? ` via ${c.duplicateVia}` : ''),
    };
  }
  return { state: 'pass', label: 'Canonical', detail: 'Not flagged as a duplicate.' };
}

function pipelineFetch(c: SourceCandidate): PipelineCell {
  // Stations linked to a canonical don't get re-probed — the canonical
  // carries the verdict that matters.
  if (c.duplicateOf) {
    return { state: 'skip', label: '—', detail: 'Skipped: row is a duplicate; probe the canonical instead.' };
  }
  const v = c.verdict;
  const rb = c.rbCheckOk;
  // RB crosscheck note appended to detail tooltip when there's a
  // disagreement worth surfacing: we say broken but RB says playable
  // (worth a curator look), or we say playable but RB says broken
  // (less critical — RB may be stale).
  const rbNote = rb === 1 && v && !/^ok/.test(v)
    ? ' · RB last-check OK (suggests a working URL exists)'
    : rb === 0 && v && /^ok/.test(v)
      ? ' · RB last-check failed'
      : '';
  if (!v) {
    return {
      state: 'pending',
      label: 'Not probed',
      detail: 'No rb-analysis verdict yet. Run `npm run analyze-rb -- <CC>`.' + rbNote,
    };
  }
  if (v === 'ok' || v === 'ok-hls') {
    return { state: 'pass', label: v === 'ok-hls' ? 'OK (HLS)' : 'OK', detail: `Verdict: ${v}${rbNote}` };
  }
  if (v.startsWith('probe-')) {
    return { state: 'pending', label: shortVerdict(v), detail: `Verdict: ${v}${rbNote}` };
  }
  // For broken-* verdicts: when RB still says ok, hint via the label
  // ("· RB?") and the pill detail. Marker stays subtle so the table
  // doesn't get noisy.
  const hint = rb === 1 ? ' · RB?' : '';
  return { state: 'fail', label: shortVerdict(v) + hint, detail: `Verdict: ${v}${rbNote}` };
}

function pipelineBytes(c: SourceCandidate): PipelineCell {
  if (c.duplicateOf) {
    return { state: 'skip', label: '—', detail: 'Skipped: row is a duplicate; byte-probe the canonical instead.' };
  }
  if (c.matchedCatalogId) {
    return { state: 'skip', label: '—', detail: 'Skipped: already imported into the catalog.' };
  }
  if (!isFetchUnplayableDisposition(fetchDispositionOf(c))) {
    return { state: 'skip', label: '—', detail: 'Byte probe currently runs for the unplayable bucket only.' };
  }
  const probe = byteProbeFor(c);
  if (!probe) {
    return {
      state: 'pending',
      label: 'Not run',
      detail: 'No byte-probe artifact yet. Run `npm run probe:bytes -- --from-candidates public/sources/radio-browser-candidates.json --only-unplayable --output public/sources/radio-browser-byte-probes.json`.',
    };
  }
  const streamChanged = !!(c.streamUrl && probe.streamUrl && c.streamUrl !== probe.streamUrl);
  if (streamChanged) {
    return {
      state: 'pending',
      label: 'Stale',
      detail: `Byte probe exists for an older stream URL. Current: ${c.streamUrl}. Probed: ${probe.streamUrl}.`,
    };
  }
  const detail = byteProbeDetail(probe);
  if (probe.byteOk) {
    return { state: 'pass', label: byteProbeLabel(probe), detail };
  }
  if (probe.byteVerdict === 'playlist' || probe.byteVerdict === 'inconclusive') {
    return { state: 'pending', label: byteProbeLabel(probe), detail };
  }
  return { state: 'fail', label: byteProbeLabel(probe), detail };
}

function pipelineCatalog(c: SourceCandidate): PipelineCell {
  if (c.matchedCatalogId) {
    return {
      state: 'pass',
      label: `→ ${truncate(c.matchedCatalogId, 24)}`,
      detail: `Imported into the catalog as ${c.matchedCatalogId}`,
    };
  }
  if (c.duplicateOf) {
    return { state: 'skip', label: '—', detail: 'Skipped: duplicate row, the canonical may or may not be imported.' };
  }
  if (c.note === 'not-in-raw-snapshot') {
    return { state: 'fail', label: 'Orphan', detail: 'Catalog row references a stationuuid no longer in the raw RB snapshot.' };
  }
  const v = c.verdict;
  if (!v) {
    return { state: 'pending', label: 'Candidate', detail: 'Probe pending — playable status unknown.' };
  }
  if (v === 'ok' || v === 'ok-hls') {
    return { state: 'pending', label: 'Candidate', detail: 'Playable but not yet curated into the catalog.' };
  }
  if (v.startsWith('probe-')) {
    return { state: 'pending', label: 'Probe unclear', detail: `Probe did not confirm playability: ${v}.` };
  }
  return { state: 'skip', label: '—', detail: `Skipped: not imported because verdict is ${v}.` };
}

function pipelineLogo(c: SourceCandidate): PipelineCell {
  const row = c.matchedCatalogId ? state.rowById.get(c.matchedCatalogId) : undefined;
  if (row) return catalogLogoCell(row, cleanCandidateFavicon(c.favicon));
  if (c.duplicateOf) {
    return { state: 'skip', label: '—', detail: 'Skipped: duplicate row; logo curation belongs to the canonical station.' };
  }
  if (c.note === 'not-in-raw-snapshot') {
    return { state: 'skip', label: '—', detail: 'Skipped: orphaned catalog row.' };
  }

  const disposition = dispositionOf(c);
  if (disposition !== 'available' && disposition !== 'byte-ok') {
    return { state: 'skip', label: '—', detail: 'Skipped until the station is playable enough to be a catalog candidate.' };
  }

  const favicon = cleanCandidateFavicon(c.favicon);
  if (!favicon) {
    return { state: 'pending', label: 'No logo', detail: 'Playable candidate has no upstream favicon; scrape the broadcaster homepage after import.' };
  }
  if (favicon.startsWith('https://')) {
    return { state: 'pending', label: 'Source logo', detail: `Upstream favicon available; import still needs provenance and pixel probe: ${favicon}` };
  }
  if (favicon.startsWith('http://')) {
    return { state: 'pending', label: 'HTTP logo', detail: `Upstream favicon is HTTP-only and needs an HTTPS replacement: ${favicon}` };
  }
  return { state: 'pending', label: 'Logo?', detail: `Upstream favicon needs review: ${favicon}` };
}

function catalogLogoCell(row: MatrixRow, sourceFavicon?: string | null): PipelineCell {
  const detail = [
    row.favicon ? `favicon ${row.favicon}` : 'no favicon',
    `source ${row.source}`,
    row.faviconLicense ? `license ${row.faviconLicense}` : null,
    `quality ${row.npQuality}`,
    row.action && row.action !== '-' ? `action ${row.action}` : null,
    row.reason,
  ].filter(Boolean).join(' · ');

  if (!row.favicon) {
    if (sourceFavicon) {
      const isHttpOnly = /^http:\/\//i.test(sourceFavicon);
      return {
        state: 'pending',
        label: isHttpOnly ? 'HTTP logo' : 'Source logo',
        detail: `Catalog favicon missing; upstream source favicon available${isHttpOnly ? ' but HTTP-only' : ''}: ${sourceFavicon}`,
      };
    }
    return { state: 'fail', label: 'Missing', detail };
  }
  if (row.action === 'scrape-upgrade') return { state: 'pending', label: 'Upgrade', detail };
  if (row.action === 'improve-curated-logo') return { state: 'pending', label: 'Improve', detail };
  if (row.action === 'probe-logo' || row.action === 'reprobe-logo') return { state: 'pending', label: 'Probe', detail };
  if (row.state === 'bad') return { state: 'fail', label: 'Bad', detail };
  if (row.npQuality === 'poor') return { state: 'fail', label: 'Poor', detail };
  if (row.npQuality === 'unknown') return { state: 'pending', label: 'Probe', detail };
  if (row.state === 'warn') return { state: 'pending', label: 'Review', detail };
  return {
    state: 'pass',
    label: row.npQuality === 'acceptable' ? 'OK · acc' : 'OK',
    detail,
  };
}

function cleanCandidateFavicon(value: string | null | undefined): string | null {
  const text = value?.trim() ?? '';
  if (!text || text === 'null') return null;
  return text;
}

function byteProbeLabel(probe: ByteProbeResult): string {
  switch (probe.byteVerdict) {
    case 'audio': return probe.signature ? shortByteSignature(probe.signature) : 'audio';
    case 'hls-playlist': return 'HLS';
    case 'playlist': return 'playlist';
    case 'http-error': return probe.status ? `HTTP ${probe.status}` : 'HTTP';
    case 'network-error': return 'network';
    case 'not-audio': return 'not audio';
    case 'inconclusive': return 'unclear';
    case 'missing-url': return 'no URL';
    default: return truncate(probe.byteVerdict, 16);
  }
}

function shortByteSignature(signature: string): string {
  if (signature.startsWith('mp3-')) return 'MP3';
  if (signature === 'aac-adts') return 'AAC';
  if (signature === 'mp4-m4a') return 'MP4';
  if (signature === 'hls-playlist') return 'HLS';
  if (signature === 'm3u-playlist' || signature === 'pls-playlist') return 'playlist';
  return truncate(signature, 12);
}

function byteProbeDetail(probe: ByteProbeResult): string {
  const parts = [
    `Byte verdict: ${probe.byteVerdict}`,
    probe.reason,
    probe.status ? `HTTP ${probe.status}` : null,
    probe.contentType ? `content-type ${probe.contentType}` : null,
    typeof probe.bytesRead === 'number' ? `${fmtN(probe.bytesRead)} bytes` : null,
    probe.signature ? `signature ${probe.signature}` : null,
    typeof probe.elapsedMs === 'number' ? `${fmtN(probe.elapsedMs)} ms` : null,
    probe.finalUrl && probe.finalUrl !== probe.streamUrl ? `final URL ${probe.finalUrl}` : null,
  ].filter(Boolean);
  return parts.join(' · ');
}

function buildPipelineCell(cell: PipelineCell): HTMLTableCellElement {
  const td = document.createElement('td');
  const pill = document.createElement('span');
  pill.className = `pipeline pipeline--${cell.state}`;
  pill.textContent = cell.label;
  if (cell.detail) pill.title = cell.detail;
  td.append(pill);
  return td;
}

function shortVerdict(v: string): string {
  // Trim the `broken-` prefix; surface the discriminator (mixed,
  // timeout, dns, refused, tls, 5xx, 4xx, network, format).
  if (v.startsWith('broken-')) return v.slice('broken-'.length);
  if (v === 'probe-inconclusive') return 'probe?';
  if (v === 'probe-skipped') return 'skipped';
  if (v === 'redirect-downgrade') return 'http→';
  if (v === 'needs-playlist') return 'playlist';
  return v;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

async function loadAndRenderDetail(src: SourceSummary): Promise<void> {
  const detail = await loadSourceDetail(src);
  if (!detail) {
    refs.sourcesDetail.replaceChildren(
      buildEl('h3', {}, `${src.name} — failed to load detail`),
      buildEl('p', { class: 'sources-tile__desc' }, src.detailUrl),
    );
    return;
  }
  if (src.kind === 'radio-browser') {
    renderRBDetail(src, detail as RBSourceDetail);
  } else if (src.kind === 'manual') {
    renderManualDetail(src, detail as ManualSourceDetail);
  } else {
    refs.sourcesDetail.replaceChildren(
      buildEl('h3', {}, `${src.name} — no renderer for kind '${src.kind}'`),
    );
  }
}

function renderRBDetail(src: SourceSummary, detail: RBSourceDetail): void {
  const perCountry = Object.values(detail.perCountry || {});
  const sectionCountries = buildEl('div', { class: 'sources-detail__section' },
    buildEl('h3', {}, `Per country · ${detail.countriesAnalyzed} analyzed`),
    buildEl('div', { class: 'sources-detail__scroll' },
      buildTable(
        ['CC', 'Candidates', 'Imported', 'Available', 'Playable', 'Broken', ''],
        perCountry.map((row) => [
          row.country,
          { num: true, value: row.candidatesIndexed },
          { num: true, value: row.imported, cls: 'imp-yes' },
          { num: true, value: row.available, cls: 'imp-no' },
          { num: true, value: row.playable },
          { num: true, value: row.broken },
          link(row.detailUrl, 'raw'),
        ]),
      ),
    ),
  );

  const topRows = (detail.topUnimportedByVotes || []).slice(0, 25);
  const sectionTop = buildEl('div', { class: 'sources-detail__section' },
    buildEl('h3', {}, 'Top unimported by votes'),
    buildEl('div', { class: 'sources-detail__scroll' },
      buildTable(
        ['Name', 'CC', 'Votes', 'Verdict', 'Stream host'],
        topRows.map((c) => [
          c.name ?? '—',
          c.country ?? '—',
          { num: true, value: c.votes },
          verdictPill(c.verdict),
          safeHost(c.streamUrl),
        ]),
      ),
    ),
  );

  const verdictRows = Object.entries(detail.verdictTotals || {})
    .sort((a, b) => b[1] - a[1]);
  const sectionVerdict = buildEl('div', { class: 'sources-detail__section' },
    buildEl('h3', {}, 'Verdict totals'),
    buildTable(['Verdict', 'N'],
      verdictRows.map(([k, v]) => [verdictPill(k), { num: true, value: v }])),
  );

  const orphans = detail.importedWithoutCountryAnalysis || [];
  const sectionOrphans = orphans.length === 0
    ? null
    : buildEl('div', { class: 'sources-detail__section' },
        buildEl('h3', {}, `Imported but country not analyzed · ${orphans.length}`),
        buildEl('div', { class: 'sources-detail__scroll' },
          buildTable(
            ['Name', 'CC', 'Catalog id'],
            orphans.slice(0, 100).map((o) => [
              o.name ?? '—', o.country ?? '?', o.catalogId,
            ]),
          ),
        ),
      );

  const children: (HTMLElement | null)[] = [
    buildEl('h3', {}, src.name),
    sectionCountries,
    sectionTop,
    sectionVerdict,
    sectionOrphans,
  ];
  refs.sourcesDetail.replaceChildren(...children.filter((c): c is HTMLElement => c !== null));
}

function renderManualDetail(src: SourceSummary, detail: ManualSourceDetail): void {
  const items = detail.items || [];
  const itemsSection = buildEl('div', { class: 'sources-detail__section' },
    buildEl('h3', {}, `Entries · ${items.length}`),
    buildEl('div', { class: 'sources-detail__scroll' },
      buildTable(
        ['Name', 'CC', 'Broadcaster', 'Status', 'Stream host', 'Catalog id'],
        items.map((it) => [
          it.name ?? '—',
          it.country ?? '?',
          it.broadcaster ?? '',
          it.status ?? '',
          safeHost(it.streamUrl),
          it.catalogId,
        ]),
      ),
    ),
  );

  const dupGroups = detail.duplicateGroups || [];
  const dupSection = dupGroups.length === 0
    ? null
    : buildEl('div', { class: 'sources-detail__section' },
        buildEl('h3', {}, `Duplicate groups · ${dupGroups.length}`),
        ...dupGroups.map((g) => buildEl('div', { class: 'source-tile__desc' },
          buildEl('div', {}, `${g.kind}: ${g.key}`),
          buildEl('div', {}, g.entries.map((e) => `${e.catalogId} (${e.name ?? '—'})`).join(' · ')),
        )),
      );

  const children: (HTMLElement | null)[] = [
    buildEl('h3', {}, src.name),
    itemsSection,
    dupSection,
  ];
  refs.sourcesDetail.replaceChildren(...children.filter((c): c is HTMLElement => c !== null));
}

function buildXdupTable(groups: SourcesSummary['crossSourceDuplicates']): HTMLElement {
  return buildEl('div', { class: 'sources-detail__scroll' },
    buildTable(
      ['Stream host', 'Imports'],
      groups.map((g) => [
        safeHost(g.streamUrl) || g.streamUrl,
        g.entries.map((e) => `${e.source}:${e.catalogId}`).join(' · '),
      ]),
    ),
  );
}

type CellValue =
  | string
  | HTMLElement
  | { num: true; value: number; cls?: string };

function buildTable(headers: string[], rows: CellValue[][]): HTMLTableElement {
  const tbl = document.createElement('table');
  const thead = document.createElement('thead');
  const headTr = document.createElement('tr');
  for (const h of headers) {
    const th = document.createElement('th');
    th.textContent = h;
    headTr.append(th);
  }
  thead.append(headTr);
  tbl.append(thead);
  const tbody = document.createElement('tbody');
  for (const row of rows) {
    const tr = document.createElement('tr');
    for (const cell of row) {
      const td = document.createElement('td');
      if (typeof cell === 'string') {
        td.textContent = cell;
      } else if (cell instanceof HTMLElement) {
        td.append(cell);
      } else {
        td.className = ['num', cell.cls].filter(Boolean).join(' ');
        td.textContent = fmtN(cell.value);
      }
      tr.append(td);
    }
    tbody.append(tr);
  }
  tbl.append(tbody);
  return tbl;
}

function link(href: string, label: string): HTMLAnchorElement {
  const a = document.createElement('a');
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = label;
  return a;
}

const VERDICT_CLASS: Record<string, string> = {
  ok: 'green',
  'ok-hls': 'green',
  'broken-mixed': 'red',
  'broken-network': 'red',
  'broken-format': 'red',
  'redirect-downgrade': 'amber',
  'needs-playlist': 'amber',
  'probe-inconclusive': 'amber',
  'probe-skipped': 'amber',
};

function verdictPill(verdict?: string): HTMLElement {
  const pill = document.createElement('span');
  pill.className = 'pill ' + (verdict ? (VERDICT_CLASS[verdict] ?? '') : '');
  pill.textContent = verdict || '—';
  return pill;
}

function buildEl(tag: string, attrs: Record<string, string>, ...children: (Node | string)[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of children) el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return el;
}

// ─── Tab switching ─────────────────────────────────────────────────

function setActiveTab(tab: ActiveTab): void {
  activeTab = tab;
  for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-tab-btn]')) {
    const isActive = btn.dataset.tabBtn === tab;
    btn.classList.toggle('is-active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  }
  for (const panel of document.querySelectorAll<HTMLElement>('[data-tab]')) {
    const isActive = panel.dataset.tab === tab;
    panel.classList.toggle('is-active', isActive);
    panel.hidden = !isActive;
  }
  // Keep tab in URL hash so reloads / shared links stick.
  if (window.location.hash !== `#${tab}`) {
    history.replaceState(null, '', `#${tab}`);
  }
  if (tab === 'sources') {
    void (async () => {
      await loadSourcesSummary();
      renderSourcesTab();
    })();
  }
}

function initialTabFromHash(): ActiveTab {
  return window.location.hash === '#sources' ? 'sources' : 'matrix';
}

function updateGeneratedText(): void {
  refs.generated.textContent = state.generatedAt
    ? `Logo status ${new Date(state.generatedAt).toLocaleString()}`
    : 'Logo status unavailable';
}

async function main(): Promise<void> {
  bindEvents();
  setActiveTab(initialTabFromHash());
  try {
    const [catalog, logoReport, qualityReport] = await Promise.all([
      loadCatalog(),
      loadLogoStatusReport(),
      loadLogoQualityReport(),
    ]);
    state.rows = buildMatrix(catalog, logoReport, qualityReport);
    state.rowById = new Map(state.rows.map((row) => [row.id, row]));
    state.generatedAt = logoReport?.generatedAt;
    syncFilterOptions(state.rows);
    updateGeneratedText();
    applyFilters();
    if (activeTab === 'sources' && sourcesState.summary) {
      refs.sourcesOverviewTile.replaceChildren(buildAggregateOverviewTile());
    }
  } catch (err) {
    refs.generated.textContent = err instanceof Error ? err.message : String(err);
    refs.summary.textContent = 'Failed to load station catalog.';
  }
}

void main();
