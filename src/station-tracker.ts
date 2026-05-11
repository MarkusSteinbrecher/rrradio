import { countryName } from './country';
import {
  buildStationDashboardRows,
  filterStationDashboardRows,
  stationDashboardCountries,
  stationDashboardKpis,
  stationDashboardStatuses,
  STATION_CHECKS,
  type StationCheckKey,
  type StationCheckState,
  type StationDashboardFilters,
  type StationDashboardRow,
  type StationHealthFilter,
  type StationStatusReport,
} from './station-dashboard';
import type { Station } from './types';

const BASE = import.meta.env.BASE_URL;
const PAGE_SIZE = 220;

interface CatalogPayload {
  stations?: unknown[];
}

type TrackerFilter = StationDashboardFilters & {
  check: 'all' | StationCheckKey;
};

const state: {
  rows: StationDashboardRow[];
  filtered: StationDashboardRow[];
  page: number;
  filters: TrackerFilter;
  generatedAt?: string;
  statusError?: string;
} = {
  rows: [],
  filtered: [],
  page: 0,
  filters: {
    query: '',
    country: 'all',
    status: 'all',
    health: 'all',
    check: 'all',
  },
};

const refs = {
  generated: byId('tracker-generated'),
  kpiTotal: byId('kpi-total'),
  kpiWorking: byId('kpi-working'),
  kpiRich: byId('kpi-rich'),
  kpiCountries: byId('kpi-countries'),
  kpiAttention: byId('kpi-attention'),
  qualityDonuts: byId('quality-donuts'),
  statusBars: byId('status-bars'),
  countryBars: byId('country-bars'),
  checkBars: byId('check-bars'),
  query: byId<HTMLInputElement>('filter-query'),
  country: byId<HTMLSelectElement>('filter-country'),
  status: byId<HTMLSelectElement>('filter-status'),
  health: byId<HTMLSelectElement>('filter-health'),
  check: byId<HTMLSelectElement>('filter-check'),
  summary: byId('table-summary'),
  pagePrev: byId<HTMLButtonElement>('page-prev'),
  pageNext: byId<HTMLButtonElement>('page-next'),
  pageLabel: byId('page-label'),
  rows: byId<HTMLTableSectionElement>('station-rows'),
};

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
  return {
    id,
    name,
    broadcaster: optionalString(raw.broadcaster),
    streamUrl,
    homepage: optionalString(raw.homepage),
    country: optionalString(raw.country),
    tags: Array.isArray(raw.tags)
      ? raw.tags.map((tag) => String(tag)).filter((tag) => tag.length > 0)
      : undefined,
    favicon: optionalString(raw.favicon),
    bitrate: optionalNumber(raw.bitrate),
    codec: optionalString(raw.codec),
    metadata: optionalString(raw.metadata),
    metadataUrl: optionalString(raw.metadataUrl),
    status: status === 'working' || status === 'icy-only' || status === 'stream-only'
      ? status
      : undefined,
  };
}

async function loadCatalog(): Promise<Station[]> {
  const res = await fetch(`${BASE}stations.json`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`stations.json HTTP ${res.status}`);
  const data = (await res.json()) as CatalogPayload;
  return (data.stations ?? []).map(normalizeStation).filter((s): s is Station => s !== null);
}

async function loadStatusReport(): Promise<StationStatusReport | null> {
  try {
    const res = await fetch(`${BASE}station-status.json`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`station-status.json HTTP ${res.status}`);
    return (await res.json()) as StationStatusReport;
  } catch (err) {
    state.statusError = err instanceof Error ? err.message : String(err);
    return null;
  }
}

function setText(el: HTMLElement, value: number | string): void {
  el.textContent = typeof value === 'number' ? value.toLocaleString() : value;
}

function option(value: string, label: string): HTMLOptionElement {
  const opt = document.createElement('option');
  opt.value = value;
  opt.textContent = label;
  return opt;
}

function syncFilterOptions(): void {
  refs.country.replaceChildren(
    option('all', 'All countries'),
    ...stationDashboardCountries(state.rows)
      .sort((a, b) => countryName(a).localeCompare(countryName(b)))
      .map((code) => option(code, countryName(code))),
  );
  refs.status.replaceChildren(
    option('all', 'All statuses'),
    ...stationDashboardStatuses(state.rows).map((status) => option(status, status)),
  );
}

function renderKpis(): void {
  const kpis = stationDashboardKpis(state.rows);
  setText(refs.kpiTotal, kpis.total);
  setText(refs.kpiWorking, kpis.working);
  setText(refs.kpiRich, kpis.richMetadata);
  setText(refs.kpiCountries, kpis.countries);
  setText(refs.kpiAttention, kpis.attention);
}

function qualityCounts(rows: StationDashboardRow[], check: StationCheckKey): Record<StationCheckState, number> {
  return rows.reduce<Record<StationCheckState, number>>(
    (counts, row) => {
      counts[row.checks[check].state]++;
      return counts;
    },
    { ok: 0, warn: 0, bad: 0, na: 0 },
  );
}

function donutGradient(counts: Record<StationCheckState, number>): string {
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  if (total === 0) return 'conic-gradient(var(--ink-4) 0deg 360deg)';
  const colors: Record<StationCheckState, string> = {
    ok: 'var(--ok)',
    warn: 'var(--accent)',
    bad: 'var(--bad)',
    na: 'var(--ink-4)',
  };
  let cursor = 0;
  const stops: string[] = [];
  for (const key of ['ok', 'warn', 'bad', 'na'] as const) {
    const value = counts[key];
    if (value === 0) continue;
    const start = cursor;
    cursor += (value / total) * 360;
    stops.push(`${colors[key]} ${start.toFixed(2)}deg ${cursor.toFixed(2)}deg`);
  }
  return `conic-gradient(${stops.join(', ')})`;
}

function renderQualityDonuts(): void {
  refs.qualityDonuts.replaceChildren();
  for (const check of STATION_CHECKS) {
    const counts = qualityCounts(state.rows, check);
    const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
    const okPct = total > 0 ? Math.round((counts.ok / total) * 100) : 0;
    const attention = counts.warn + counts.bad;

    const card = document.createElement('article');
    card.className = 'quality-card';

    const donut = document.createElement('div');
    donut.className = 'quality-donut';
    donut.style.background =
      `radial-gradient(circle at center, var(--bg) 0 52%, transparent 53%), ${donutGradient(counts)}`;
    donut.setAttribute(
      'aria-label',
      `${checkName(check)} quality: ${okPct}% ok, ${attention.toLocaleString()} need attention`,
    );
    const center = document.createElement('div');
    center.className = 'quality-donut__center';
    center.textContent = `${okPct}%`;
    donut.append(center);

    const body = document.createElement('div');
    body.className = 'quality-card__body';
    const title = document.createElement('div');
    title.className = 'quality-card__title';
    title.textContent = checkName(check);
    const meta = document.createElement('div');
    meta.className = 'quality-card__meta';
    meta.textContent = `${attention.toLocaleString()} attention`;
    const legend = document.createElement('div');
    legend.className = 'quality-card__legend';
    for (const key of ['ok', 'warn', 'bad', 'na'] as const) {
      const item = document.createElement('div');
      item.className = 'quality-legend-item';
      const dot = document.createElement('span');
      dot.className = 'quality-legend-dot';
      dot.dataset.state = key;
      const label = document.createElement('span');
      label.textContent = `${key} ${counts[key].toLocaleString()}`;
      item.append(dot, label);
      legend.append(item);
    }
    body.append(title, meta, legend);
    card.append(donut, body);
    refs.qualityDonuts.append(card);
  }
}

function countBy<T extends string>(
  rows: StationDashboardRow[],
  pick: (row: StationDashboardRow) => T | undefined,
): Array<[T, number]> {
  const counts = new Map<T, number>();
  for (const row of rows) {
    const key = pick(row);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function renderBars(
  target: HTMLElement,
  entries: Array<[string, number]>,
  label: (key: string) => string = (key) => key,
  maxRows = 10,
): void {
  target.replaceChildren();
  const top = entries.slice(0, maxRows);
  const max = top[0]?.[1] ?? 1;
  for (const [key, value] of top) {
    const row = document.createElement('div');
    row.className = 'bar-row';
    const text = document.createElement('div');
    text.className = 'bar-row__label';
    text.textContent = label(key);
    text.title = text.textContent;
    const count = document.createElement('div');
    count.className = 'bar-row__value';
    count.textContent = value.toLocaleString();
    const track = document.createElement('div');
    track.className = 'bar-row__track';
    const fill = document.createElement('div');
    fill.className = 'bar-row__fill';
    fill.style.width = `${Math.max(3, (value / max) * 100)}%`;
    track.append(fill);
    row.append(text, count, track);
    target.append(row);
  }
}

function renderSidePanel(): void {
  renderBars(refs.statusBars, countBy(state.rows, (row) => row.status));
  renderBars(refs.countryBars, countBy(state.rows, (row) => row.country), countryName, 12);
  const checkCounts: Array<[string, number]> = STATION_CHECKS.map((check): [string, number] => [
    check,
    state.rows.filter((row) => {
      const checkState = row.checks[check].state;
      return checkState === 'bad' || checkState === 'warn';
    }).length,
  ]).sort((a, b) => b[1] - a[1]);
  renderBars(refs.checkBars, checkCounts, checkName, STATION_CHECKS.length);
}

function checkName(key: string): string {
  if (key === 'metadataApi') return 'Metadata API';
  return key.toUpperCase();
}

function checkLabel(stateValue: StationCheckState): string {
  if (stateValue === 'ok') return 'ok';
  if (stateValue === 'warn') return 'warn';
  if (stateValue === 'bad') return 'bad';
  return '-';
}

function checkCell(row: StationDashboardRow, key: StationCheckKey): HTMLTableCellElement {
  const td = document.createElement('td');
  const check = row.checks[key];
  const badge = document.createElement('span');
  badge.className = 'check';
  badge.dataset.state = check.state;
  badge.textContent = checkLabel(check.state);
  badge.title = check.detail ?? checkName(key);
  td.append(badge);
  return td;
}

function stationCell(row: StationDashboardRow): HTMLTableCellElement {
  const td = document.createElement('td');
  const wrap = document.createElement('div');
  wrap.className = 'station-name';
  const name = document.createElement('span');
  name.className = 'station-name__main';
  name.textContent = row.name;
  name.title = row.name;
  const sub = document.createElement('span');
  sub.className = 'station-name__sub';
  sub.textContent = [row.broadcaster, row.metadataKey, row.id].filter(Boolean).join(' / ');
  wrap.append(name, sub);
  td.append(wrap);
  return td;
}

function renderTable(): void {
  refs.rows.replaceChildren();
  const start = state.page * PAGE_SIZE;
  const pageRows = state.filtered.slice(start, start + PAGE_SIZE);
  if (pageRows.length === 0) {
    const tr = document.createElement('tr');
    tr.className = 'empty-row';
    const td = document.createElement('td');
    td.colSpan = 11;
    td.textContent = 'No stations match these filters.';
    tr.append(td);
    refs.rows.append(tr);
  }
  for (const row of pageRows) {
    const tr = document.createElement('tr');
    const country = document.createElement('td');
    country.textContent = row.country ? countryName(row.country) : '-';
    const status = document.createElement('td');
    const statusPill = document.createElement('span');
    statusPill.className = 'pill';
    statusPill.textContent = row.status;
    status.append(statusPill);
    const format = document.createElement('td');
    format.textContent = [row.codec, row.bitrate ? `${row.bitrate}kbps` : undefined]
      .filter(Boolean)
      .join(' ') || '-';

    tr.append(
      stationCell(row),
      country,
      status,
      format,
      ...STATION_CHECKS.map((check) => checkCell(row, check)),
    );
    refs.rows.append(tr);
  }

  const pageCount = Math.max(1, Math.ceil(state.filtered.length / PAGE_SIZE));
  refs.pagePrev.disabled = state.page <= 0;
  refs.pageNext.disabled = state.page >= pageCount - 1;
  refs.pageLabel.textContent = `Page ${state.page + 1} of ${pageCount}`;
  const end = Math.min(start + PAGE_SIZE, state.filtered.length);
  refs.summary.textContent =
    `${state.filtered.length.toLocaleString()} of ${state.rows.length.toLocaleString()} stations` +
    (state.filtered.length > 0 ? ` / showing ${start + 1}-${end}` : '');
}

function applyFilters(resetPage = true): void {
  if (resetPage) state.page = 0;
  state.filtered = filterStationDashboardRows(state.rows, state.filters).sort((a, b) => {
    if (b.badCount !== a.badCount) return b.badCount - a.badCount;
    if (b.warningCount !== a.warningCount) return b.warningCount - a.warningCount;
    return a.name.localeCompare(b.name);
  });
  renderTable();
}

function updateGeneratedText(): void {
  if (state.statusError) {
    refs.generated.textContent = `Status artifact unavailable: ${state.statusError}`;
    return;
  }
  if (!state.generatedAt) {
    refs.generated.textContent = 'Status artifact not timestamped';
    return;
  }
  refs.generated.textContent =
    `Status checks generated ${new Date(state.generatedAt).toLocaleString()}`;
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
  refs.health.addEventListener('change', () => {
    state.filters.health = refs.health.value as StationHealthFilter;
    applyFilters();
  });
  refs.check.addEventListener('change', () => {
    state.filters.check = refs.check.value as TrackerFilter['check'];
    applyFilters();
  });
  refs.pagePrev.addEventListener('click', () => {
    if (state.page <= 0) return;
    state.page--;
    applyFilters(false);
  });
  refs.pageNext.addEventListener('click', () => {
    const pageCount = Math.max(1, Math.ceil(state.filtered.length / PAGE_SIZE));
    if (state.page >= pageCount - 1) return;
    state.page++;
    applyFilters(false);
  });
}

async function main(): Promise<void> {
  bindEvents();
  try {
    const [catalog, report] = await Promise.all([loadCatalog(), loadStatusReport()]);
    state.rows = buildStationDashboardRows(catalog, report);
    state.generatedAt = report?.generatedAt;
    syncFilterOptions();
    renderKpis();
    renderQualityDonuts();
    renderSidePanel();
    updateGeneratedText();
    applyFilters();
  } catch (err) {
    refs.generated.textContent = err instanceof Error ? err.message : String(err);
    refs.summary.textContent = 'Failed to load station catalog.';
  }
}

void main();
