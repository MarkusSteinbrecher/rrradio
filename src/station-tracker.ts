import { countryName } from './country';
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

const state: {
  rows: MatrixRow[];
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
  collapsedGroups: Set<string>;
} = {
  rows: [],
  filtered: [],
  page: 0,
  filters: { query: '', country: 'all', status: 'all', imageState: 'all', license: 'all', npQuality: 'all' },
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
};

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
  renderMatrix();
  renderDonuts();
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
}

function updateGeneratedText(): void {
  refs.generated.textContent = state.generatedAt
    ? `Logo status ${new Date(state.generatedAt).toLocaleString()}`
    : 'Logo status unavailable';
}

async function main(): Promise<void> {
  bindEvents();
  try {
    const [catalog, logoReport, qualityReport] = await Promise.all([
      loadCatalog(),
      loadLogoStatusReport(),
      loadLogoQualityReport(),
    ]);
    state.rows = buildMatrix(catalog, logoReport, qualityReport);
    state.generatedAt = logoReport?.generatedAt;
    syncFilterOptions(state.rows);
    updateGeneratedText();
    applyFilters();
  } catch (err) {
    refs.generated.textContent = err instanceof Error ? err.message : String(err);
    refs.summary.textContent = 'Failed to load station catalog.';
  }
}

void main();
