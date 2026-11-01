/**
 * Catalog-health dashboard boot. One filter state drives everything:
 * the four KPI tiles (stream, now playing, logo, homepage), the charts and
 * the station table. Clicking a bar or a tile segment toggles a filter;
 * each chart counts the rows passing every filter except its own, so a pick
 * highlights rather than hides (filters.ts). State lives in the URL.
 *
 * The failing-streams trend and the automation chart are catalog-wide
 * history and say so; they don't change with the filters.
 *
 * Data source, in order: the live copy on the health-data branch (fresh
 * every morning without a site deploy), then the same-origin copy deploy.yml
 * overlays into dist/ (in dev: public/catalog-health.json, gitignored).
 */

import { byCountry, byCountryFailing, byLogoIssue, byNowPlaying, byReason } from './aggregate';
import { columnChart, hbarChart, hideTip, keyed, type HBarItem } from './charts';
import {
  DEFAULT_FILTERS,
  LOGO_ISSUE_LABEL,
  LOGO_ISSUES,
  NP_KINDS,
  REASON_LABEL,
  REASONS,
  activeFilters,
  failReason,
  filterRows,
  filtersFromParams,
  filtersToParams,
  sortRows,
  toggle,
  type FilterKey,
  type Filters,
  type GradePick,
  type SortKey,
} from './filters';
import { NP_LABEL, logoDetailLabel, parseDashboard, streamDetailLabel, type Dashboard, type HealthRow } from './model';
import { DIMENSION_LABEL, GRADE_LABEL, goodShare, grade, summarise, type Dimension } from './score';
import { bootstrapTheme, wireThemeToggle } from './theme';
import { countryName, el, fmtDateTime, fmtDay, fmtInt, fmtPct, gradeMark, relDay, trendChart } from './ui';

const DAY_MS = 86_400_000;
const STALE_DAYS = 8;
const PAGE = 25;
const CC_STEP = 12;

const BASE = import.meta.env.BASE_URL;
const LIVE_URL = 'https://raw.githubusercontent.com/MarkusSteinbrecher/rrradio/health-data/dashboard.json';
const LOCAL_URL = `${BASE}catalog-health.json`;

function must<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`catalog-health: shell markup missing #${id}`);
  return node as T;
}

bootstrapTheme();
wireThemeToggle(must<HTMLButtonElement>('theme-toggle'));

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

async function loadDashboard(): Promise<Dashboard> {
  // In dev the local artifact wins, so a freshly built one can be tried
  // before the live copy on health-data carries its changes.
  const [first, second] = import.meta.env.DEV ? [LOCAL_URL, LIVE_URL] : [LIVE_URL, LOCAL_URL];
  let raw: unknown;
  try {
    raw = await fetchJson(first);
  } catch {
    raw = await fetchJson(second);
  }
  return parseDashboard(raw as Parameters<typeof parseDashboard>[0]);
}

/* ── State ───────────────────────────────────────────────────────── */

interface View {
  f: Filters;
  page: number;
  ccMode: 'size' | 'failing';
  ccLimit: number;
  trend: 'bad' | 'share';
}

const view: View = {
  f: filtersFromParams(new URLSearchParams(location.search)),
  page: 0,
  ccMode: 'size',
  ccLimit: CC_STEP,
  trend: 'bad',
};

let dash: Dashboard;

function setFilters(next: Filters): void {
  view.f = next;
  view.page = 0;
  const qs = filtersToParams(next).toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
  render();
}

function pick<K extends FilterKey>(key: K, value: Filters[K]): void {
  setFilters(toggle(view.f, key, value));
}

/* ── Labels for chips and selects ────────────────────────────────── */

function gradePickLabel(dim: Dimension, g: GradePick): string {
  return g === 'all' ? 'All' : GRADE_LABEL[dim][g];
}

function filterLabel(key: FilterKey, f: Filters): string {
  switch (key) {
    case 'cc': return `Country: ${countryName(f.cc)}`;
    case 'tier': return f.tier === 'curated' ? 'Curated' : 'Long tail';
    case 'stream': return `Stream: ${gradePickLabel('stream', f.stream)}`;
    case 'why': return f.why === 'all' ? '' : `Fails: ${REASON_LABEL[f.why]}`;
    case 'np': return f.np === 'all' ? '' : `Now playing: ${NP_LABEL[f.np]}`;
    case 'logo': return `Logo: ${gradePickLabel('logo', f.logo)}`;
    case 'logoWhy': return f.logoWhy === 'all' ? '' : `Logo: ${LOGO_ISSUE_LABEL[f.logoWhy]}`;
    case 'home': return `Homepage: ${gradePickLabel('home', f.home)}`;
  }
}

/* ── Filter bar ──────────────────────────────────────────────────── */

function option(value: string, label: string): HTMLOptionElement {
  return el('option', { value }, label);
}

interface SelectSpec {
  key: Exclude<FilterKey, 'cc' | 'tier'>;
  label: string;
  options: [string, string][];
}

function gradeOptions(dim: Dimension): [string, string][] {
  return [['all', 'All'], ...(['good', 'weak', 'bad'] as const).map((g): [string, string] => [g, GRADE_LABEL[dim][g]])];
}

const MORE_SELECTS: SelectSpec[] = [
  { key: 'stream', label: 'Stream', options: gradeOptions('stream') },
  { key: 'why', label: 'Why it fails', options: [['all', 'All'], ...REASONS.map((r): [string, string] => [r, REASON_LABEL[r]])] },
  { key: 'np', label: 'Now playing', options: [['all', 'All'], ...NP_KINDS.map((k): [string, string] => [k, NP_LABEL[k]])] },
  { key: 'logo', label: 'Logo', options: gradeOptions('logo') },
  { key: 'logoWhy', label: 'Logo issue', options: [['all', 'All'], ...LOGO_ISSUES.map((k): [string, string] => [k, LOGO_ISSUE_LABEL[k]])] },
  { key: 'home', label: 'Homepage', options: gradeOptions('home') },
];
const moreSelects = new Map<SelectSpec['key'], HTMLSelectElement>();

function initFilterBar(): void {
  const q = must<HTMLInputElement>('f-q');
  q.value = view.f.q;
  let timer = 0;
  q.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => setFilters({ ...view.f, q: q.value }), 150);
  });

  const cc = must<HTMLSelectElement>('f-cc');
  const countries = byCountry(dash.rows)
    .filter((c) => c.cc)
    .sort((a, b) => countryName(a.cc).localeCompare(countryName(b.cc)));
  cc.replaceChildren(
    option('all', `All countries (${fmtInt(countries.length)})`),
    ...countries.map((c) => option(c.cc, `${countryName(c.cc)} · ${fmtInt(c.total)}`)),
  );
  cc.addEventListener('change', () => setFilters({ ...view.f, cc: cc.value }));

  for (const btn of document.querySelectorAll<HTMLButtonElement>('.seg__btn[data-tier]')) {
    btn.addEventListener('click', () => setFilters({ ...view.f, tier: btn.dataset.tier as Filters['tier'] }));
  }

  const grid = must('more-fields');
  for (const spec of MORE_SELECTS) {
    const id = `f-${spec.key}`;
    const select = el('select', { id }, ...spec.options.map(([v, l]) => option(v, l)));
    select.addEventListener('change', () => setFilters({ ...view.f, [spec.key]: select.value }));
    moreSelects.set(spec.key, select);
    grid.append(el('div', { class: 'sd-field' }, el('label', { class: 'sd-field__label', for: id }, spec.label), select));
  }

  // Popovers open in the top layer at the viewport origin; pin this one
  // under its button, right-aligned, kept on screen.
  const pop = must('more-filters');
  pop.addEventListener('toggle', (e) => {
    if ((e as ToggleEvent).newState !== 'open') return;
    const anchor = must('f-more').getBoundingClientRect();
    const width = pop.getBoundingClientRect().width;
    pop.style.top = `${anchor.bottom + 4}px`;
    pop.style.left = `${Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8))}px`;
  });

  must('f-clear').addEventListener('click', () => {
    q.value = '';
    setFilters({ ...DEFAULT_FILTERS, sort: view.f.sort, dir: view.f.dir });
  });
}

function renderFilterBar(): void {
  const f = view.f;
  const q = must<HTMLInputElement>('f-q');
  if (document.activeElement !== q && q.value !== f.q) q.value = f.q;
  must<HTMLSelectElement>('f-cc').value = f.cc;
  for (const btn of document.querySelectorAll<HTMLButtonElement>('.seg__btn[data-tier]')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.tier === f.tier));
  }
  for (const [key, select] of moreSelects) select.value = String(f[key]);

  const active = activeFilters(f);
  const moreCount = active.filter((k) => k !== 'cc' && k !== 'tier').length;
  must('f-more').textContent = moreCount ? `More filters · ${moreCount}` : 'More filters';

  must('chips').replaceChildren(
    ...active.map((key) => {
      const label = filterLabel(key, f);
      const btn = el('button', { type: 'button', class: 'chip' }, label, el('span', { class: 'chip__x', 'aria-hidden': 'true' }, '×'));
      btn.setAttribute('aria-label', `Remove filter ${label}`);
      btn.addEventListener('click', () => setFilters({ ...f, [key]: DEFAULT_FILTERS[key] }));
      return el('li', {}, btn);
    }),
  );
  must('f-clear').hidden = active.length === 0 && !f.q.trim();
}

/* ── KPI tiles ───────────────────────────────────────────────────── */

const TILE_TITLE: Record<Dimension, string> = {
  stream: 'Stations playing',
  np: 'Now playing titles',
  logo: 'Good logo',
  home: 'Homepage reachable',
};

/** When each check last ran. Now playing folds stream titles and the
 *  metadata probe, so it is as old as the older of the two. */
function lastChecked(dim: Dimension): string {
  const r = dash.runs;
  if (dim === 'stream') return r.stream ?? dash.generatedAt;
  if (dim === 'np') return [r.icy, r.metadata].filter(Boolean).sort()[0] ?? '';
  return (dim === 'logo' ? r.logo : r.homepage) ?? '';
}

/** What a tile segment filters on. Now playing's good grade spans two
 *  kinds (API, stream titles), so it isn't a filter of its own. */
function tilePick(dim: Dimension, g: 'good' | 'weak' | 'bad'): (() => void) | null {
  if (dim === 'np') {
    if (g === 'weak') return () => pick('np', 'silent');
    if (g === 'bad') return () => pick('np', 'none');
    return null;
  }
  return () => pick(dim, g);
}

function tileSelected(dim: Dimension, g: 'good' | 'weak' | 'bad'): boolean {
  if (dim === 'np') return (g === 'weak' && view.f.np === 'silent') || (g === 'bad' && view.f.np === 'none');
  return view.f[dim] === g;
}

function kpiTile(dim: Dimension, rows: HealthRow[]): HTMLElement {
  const s = summarise(rows)[dim];
  const labels = GRADE_LABEL[dim];
  const anyPicked = (['good', 'weak', 'bad'] as const).some((g) => tileSelected(dim, g));

  const meter = el('div', { class: `meter${anyPicked ? ' has-pick' : ''}`, 'aria-hidden': 'true' });
  const keys = el('ul', { class: 'tile__keys' });
  for (const g of ['good', 'weak', 'bad'] as const) {
    const n = s[g];
    const selected = tileSelected(dim, g);
    if (n > 0) {
      const seg = el('i', { class: `meter__seg meter__seg--${g}${selected ? ' is-picked' : ''}` });
      seg.style.flexGrow = String(n);
      meter.append(seg);
    }
    const action = tilePick(dim, g);
    const text = `${fmtInt(n)} ${labels[g].toLowerCase()}`;
    let key: HTMLElement;
    if (action) {
      const btn = el('button', { type: 'button', class: 'tile__key', 'aria-pressed': String(selected) }, keyed(g, text));
      btn.setAttribute('aria-label', `${text}. ${selected ? 'Selected; press to clear.' : 'Press to filter.'}`);
      btn.disabled = n === 0 && !selected;
      btn.addEventListener('click', action);
      key = btn;
    } else {
      key = el('span', { class: 'tile__key tile__key--static' }, keyed(g, text));
    }
    keys.append(el('li', {}, key));
  }

  const checked = lastChecked(dim);
  const stale = !checked || (Date.now() - new Date(checked).getTime()) / DAY_MS > STALE_DAYS;
  return el(
    'li',
    { class: 'tile' },
    el('h2', { class: 'tile__title' }, TILE_TITLE[dim]),
    el('p', { class: 'tile__value sd-num' }, fmtPct(goodShare(s), dim === 'stream' ? 1 : 0)),
    el('p', { class: 'tile__sub sd-num' }, s.checked ? `${fmtInt(s.good)} of ${fmtInt(s.checked)} checked` : 'None checked'),
    meter,
    keys,
    el(
      'p',
      { class: `tile__when${stale ? ' tile__when--stale' : ''}` },
      checked ? `Checked ${stale ? fmtDay(checked) : relDay(checked)}` : 'Not checked yet',
    ),
  );
}

function renderKpis(): void {
  must('kpis').replaceChildren(
    ...(['stream', 'np', 'logo', 'home'] as const).map((dim) => kpiTile(dim, filterRows(dash.rows, view.f, dim))),
  );
}

/* ── Charts ──────────────────────────────────────────────────────── */

const STREAM_SPLIT = { good: 'playing', weak: 'odd reply', bad: 'failing' };

function renderTrend(): void {
  // Start once the probe covered the whole catalog: before that the count
  // climbs only because more stations were being checked.
  const firstFull = dash.history.findIndex((h) => (h.freshness ?? 0) >= 0.95);
  const hist = dash.history.slice(Math.max(0, firstFull));
  let chart: HTMLElement;
  if (view.trend === 'bad') {
    const points = hist.flatMap((h) => (typeof h.bad === 'number' ? [{ day: h.day, value: h.bad }] : []));
    chart = trendChart(points, fmtInt, 'failing');
  } else {
    const points = hist.flatMap((h) => {
      const checked = (h.ok ?? 0) + (h.warn ?? 0) + (h.bad ?? 0);
      return checked > 0 ? [{ day: h.day, value: (h.ok ?? 0) / checked }] : [];
    });
    chart = trendChart(points, (v) => fmtPct(v, 1), 'playing');
  }
  must('trend-chart').replaceChildren(chart);
  must('trend-bad').setAttribute('aria-selected', String(view.trend === 'bad'));
  must('trend-share').setAttribute('aria-selected', String(view.trend === 'share'));
}

function countryRanking(): ReturnType<typeof byCountry> {
  const rows = filterRows(dash.rows, view.f, 'cc');
  return view.ccMode === 'size' ? byCountry(rows) : byCountryFailing(rows);
}

function renderCountries(): void {
  const all = countryRanking();
  const shown = all.slice(0, view.ccLimit);
  // Keep a picked country visible even when it ranks below the cut.
  if (view.f.cc !== 'all' && !shown.some((c) => c.cc === view.f.cc)) {
    const picked = all.find((c) => c.cc === view.f.cc);
    if (picked) shown.push(picked);
  }
  const items: HBarItem[] = shown.map((c) => {
    const checked = c.good + c.weak + c.bad;
    return {
      key: c.cc,
      label: c.cc ? countryName(c.cc) : 'No country',
      value: c.total,
      split: { good: c.good, weak: c.weak, bad: c.bad },
      note: view.ccMode === 'size' ? fmtPct(checked ? c.good / checked : null, 0) : `${fmtInt(c.bad + c.weak)} not playing`,
    };
  });
  must('cc-chart').replaceChildren(
    hbarChart(items, {
      selected: view.f.cc === 'all' ? null : view.f.cc,
      onSelect: (cc) => {
        if (cc) pick('cc', cc);
      },
      unit: 'stations',
      splitLabels: STREAM_SPLIT,
      empty: view.ccMode === 'failing' ? 'No failing streams match the filters.' : undefined,
    }),
  );
  must('cc-legend').replaceChildren(
    keyed('good', 'Playing'),
    keyed('weak', 'Odd reply'),
    keyed('bad', 'Failing'),
    view.ccMode === 'size' ? el('span', {}, '% = share playing') : '',
  );
  must('cc-size').setAttribute('aria-selected', String(view.ccMode === 'size'));
  must('cc-failing').setAttribute('aria-selected', String(view.ccMode === 'failing'));
  const more = must<HTMLButtonElement>('cc-more');
  more.hidden = all.length <= CC_STEP;
  more.textContent = view.ccLimit < all.length ? `Show more (${fmtInt(all.length - view.ccLimit)} left)` : 'Show fewer';
}

function renderWhy(): void {
  const rows = filterRows(dash.rows, view.f, 'why');
  must('why-chart').replaceChildren(
    hbarChart(
      byReason(rows).map((c) => ({ key: c.key, label: REASON_LABEL[c.key], value: c.value })),
      {
        selected: view.f.why === 'all' ? null : view.f.why,
        onSelect: (k) => pick('why', k as Filters['why']),
        unit: 'stations',
        empty: 'Every matching stream plays.',
      },
    ),
  );
}

function renderNowPlaying(): void {
  const rows = filterRows(dash.rows, view.f, 'np');
  must('np-chart').replaceChildren(
    hbarChart(
      byNowPlaying(rows)
        .filter((c) => c.value > 0)
        .map((c) => ({ key: c.key, label: NP_LABEL[c.key], value: c.value })),
      { selected: view.f.np === 'all' ? null : view.f.np, onSelect: (k) => pick('np', k as Filters['np']), unit: 'stations' },
    ),
  );
}

function renderLogo(): void {
  const rows = filterRows(dash.rows, view.f, 'logoWhy');
  must('logo-chart').replaceChildren(
    hbarChart(
      byLogoIssue(rows).map((c) => ({ key: c.key, label: LOGO_ISSUE_LABEL[c.key], value: c.value })),
      {
        selected: view.f.logoWhy === 'all' ? null : view.f.logoWhy,
        onSelect: (k) => pick('logoWhy', k as Filters['logoWhy']),
        unit: 'stations',
        empty: 'Every matching logo is good.',
      },
    ),
  );
}

const AUTO_KINDS = [
  ['retired', 'Retired', 'Dead streams taken out of the catalog'],
  ['recovered', 'Back on air', 'Retired stations that played again'],
  ['urlSwapped', 'Stream replaced', 'Dead URL swapped for a working one'],
  ['logoCleared', 'Dead logo removed', 'The app shows a placeholder instead'],
  ['logoUpgraded', 'Logo moved to https', 'Same image, now allowed by the app'],
  ['review', 'Sent to review', 'Curated stations wait for a human'],
] as const;

function renderAutomation(): void {
  const days = dash.automation;
  if (days.length === 0) {
    must('auto-note').textContent = 'No runs yet.';
    return;
  }
  const points = days.map((d) => {
    const total = AUTO_KINDS.reduce((n, [k]) => n + (d[k] ?? 0), 0);
    const detail = d.held
      ? ['Safety brake held every change']
      : AUTO_KINDS.filter(([k]) => d[k] > 0).map(([k, label]) => `${fmtInt(d[k])} ${label.toLowerCase()}`);
    return { day: d.day, label: fmtDay(d.day), value: total, detail, flagged: d.held };
  });
  must('auto-chart').replaceChildren(columnChart(points, 'changes'));
  const held = days.filter((d) => d.held).length;
  must('auto-note').textContent =
    `Changes per daily run, ${fmtDay(days[0].day)} to ${fmtDay(days[days.length - 1].day)}, whole catalog.` +
    (held ? ` Dashed: ${held} ${held === 1 ? 'day' : 'days'} the safety brake held every change.` : '');
  must('auto-totals').replaceChildren(
    ...AUTO_KINDS.map(([k, label, hint]) =>
      el(
        'div',
        { class: 'total', title: hint },
        el('dt', { class: 'total__label' }, label),
        el('dd', { class: 'total__value sd-num' }, fmtInt(days.reduce((n, d) => n + (d[k] ?? 0), 0))),
      ),
    ),
  );
}

/* ── Table ───────────────────────────────────────────────────────── */

const SORT_HEAD: Record<Exclude<SortKey, 'default'>, string> = {
  name: 'Station',
  country: 'Country',
  stream: 'Stream',
  streak: 'Failing for',
};

function initTable(): void {
  for (const th of document.querySelectorAll<HTMLTableCellElement>('th[data-sort]')) {
    const key = th.dataset.sort as Exclude<SortKey, 'default'>;
    const btn = el('button', { type: 'button', class: 'sort' }, SORT_HEAD[key], el('span', { class: 'sort__arrow', 'aria-hidden': 'true' }));
    btn.addEventListener('click', () => {
      const f = view.f;
      // First click: ascending (worst first for stream and streak), second flips, third resets.
      const next: Pick<Filters, 'sort' | 'dir'> =
        f.sort !== key ? { sort: key, dir: 'asc' } : f.dir === 'asc' ? { sort: key, dir: 'desc' } : { sort: 'default', dir: 'asc' };
      setFilters({ ...f, ...next });
    });
    th.append(btn);
  }
  must('page-prev').addEventListener('click', () => {
    view.page = Math.max(0, view.page - 1);
    renderTable();
  });
  must('page-next').addEventListener('click', () => {
    view.page += 1;
    renderTable();
  });
}

function dimCell(row: HealthRow, dim: Dimension, title: string): HTMLElement {
  const g = grade(row, dim);
  const label = g === 'skip' ? 'Not checked' : GRADE_LABEL[dim][g];
  return el('td', { class: 'col-dim', 'data-label': DIMENSION_LABEL[dim] }, gradeMark(g, label, title));
}

/** Codec for playing streams; a plain reason (keeping HTTP codes) otherwise. */
function streamLabel(row: HealthRow): string {
  if (row.stream === 'bad' && !/^HTTP /.test(row.streamDetail)) {
    const why = failReason(row);
    if (why) return REASON_LABEL[why];
  }
  return grade(row, 'stream') === 'skip' ? 'Not checked' : streamDetailLabel(row);
}

function stationRow(row: HealthRow): HTMLElement {
  const streamG = grade(row, 'stream');
  const homeG = grade(row, 'home');
  return el(
    'tr',
    {},
    el(
      'td',
      { class: 'col-station' },
      el('a', { class: 'station__name', href: `${BASE}station/${encodeURIComponent(row.id)}/` }, row.name),
      el('span', { class: 'station__meta' }, row.id, row.tier === 'curated' ? el('span', { class: 'sd-badge' }, 'Curated') : null),
    ),
    el('td', { class: 'col-cc', 'data-label': 'Country' }, row.cc ? countryName(row.cc) : '—'),
    el(
      'td',
      { class: 'col-stream', 'data-label': 'Stream' },
      gradeMark(streamG, streamLabel(row), streamG === 'skip' ? 'Not checked yet' : `${GRADE_LABEL.stream[streamG]}: ${row.streamDetail}`),
    ),
    el('td', { class: 'col-streak sd-num', 'data-label': 'Failing for' }, row.streakDays > 0 ? `${row.streakDays} ${row.streakDays === 1 ? 'day' : 'days'}` : '—'),
    dimCell(row, 'np', NP_LABEL[row.np]),
    dimCell(row, 'logo', logoDetailLabel(row)),
    dimCell(row, 'home', homeG === 'skip' ? 'Not checked' : GRADE_LABEL.home[homeG]),
  );
}

let tableRows: HealthRow[] = [];

function renderTable(): void {
  const total = tableRows.length;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  view.page = Math.min(view.page, pages - 1);
  const start = view.page * PAGE;
  const slice = tableRows.slice(start, start + PAGE);
  must('table-body').replaceChildren(
    ...(slice.length
      ? slice.map(stationRow)
      : [el('tr', {}, el('td', { class: 'empty', colspan: '7' }, 'No station matches these filters.'))]),
  );
  must('page-info').textContent = total ? `${fmtInt(start + 1)}–${fmtInt(start + slice.length)} of ${fmtInt(total)}` : '';
  must<HTMLButtonElement>('page-prev').disabled = view.page === 0;
  must<HTMLButtonElement>('page-next').disabled = view.page >= pages - 1;

  for (const th of document.querySelectorAll<HTMLTableCellElement>('th[data-sort]')) {
    const on = th.dataset.sort === view.f.sort;
    th.setAttribute('aria-sort', on ? (view.f.dir === 'asc' ? 'ascending' : 'descending') : 'none');
    const arrow = th.querySelector('.sort__arrow');
    if (arrow) arrow.textContent = on ? (view.f.dir === 'asc' ? '↑' : '↓') : '';
  }
}

/* ── Render ──────────────────────────────────────────────────────── */

function render(): void {
  hideTip();
  const rows = filterRows(dash.rows, view.f);
  tableRows = sortRows(rows, view.f.sort, view.f.dir);
  must('result-line').textContent =
    rows.length !== dash.rows.length
      ? `${fmtInt(rows.length)} of ${fmtInt(dash.rows.length)} stations`
      : `${fmtInt(dash.rows.length)} stations`;
  must('table-count').textContent = `${fmtInt(rows.length)} ${rows.length === 1 ? 'station' : 'stations'}`;
  renderFilterBar();
  renderKpis();
  renderCountries();
  renderWhy();
  renderNowPlaying();
  renderLogo();
  renderTable();
}

function renderMeta(): void {
  const m = dash.metrics;
  const parts = [
    `${fmtInt(dash.counts.published)} stations in ${fmtInt(dash.counts.countries)} countries, ${fmtInt(dash.counts.curated)} curated`,
    `checked ${fmtDateTime(dash.runs.stream ?? dash.generatedAt)}`,
  ];
  if (m?.availability != null) parts.push(`${fmtPct(m.availability)} of last week’s listening reached a working stream`);
  must('dash-meta').textContent = `${parts.join(' · ')}.`;
}

function wireStaticControls(): void {
  const on = (id: string, fn: () => void): void => must(id).addEventListener('click', fn);
  on('trend-bad', () => {
    view.trend = 'bad';
    renderTrend();
  });
  on('trend-share', () => {
    view.trend = 'share';
    renderTrend();
  });
  on('cc-size', () => {
    view.ccMode = 'size';
    view.ccLimit = CC_STEP;
    renderCountries();
  });
  on('cc-failing', () => {
    view.ccMode = 'failing';
    view.ccLimit = CC_STEP;
    renderCountries();
  });
  on('cc-more', () => {
    view.ccLimit = view.ccLimit < countryRanking().length ? view.ccLimit + CC_STEP * 2 : CC_STEP;
    renderCountries();
  });
  window.addEventListener('scroll', hideTip, { passive: true });
}

async function boot(): Promise<void> {
  const status = must('load-status');
  try {
    dash = await loadDashboard();
  } catch (err) {
    status.textContent = `Couldn’t load today’s checks (${err instanceof Error ? err.message : 'unknown error'}). Try again in a minute.`;
    status.classList.add('is-error');
    return;
  }
  status.hidden = true;
  must('dash').hidden = false;
  renderMeta();
  initFilterBar();
  initTable();
  wireStaticControls();
  renderTrend();
  renderAutomation();
  render();
}

void boot();
