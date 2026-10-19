/**
 * Catalog-health page boot. Reads top to bottom: the headline (stations
 * that play), how failing streams trend, what the catalog fixed on its
 * own, the extras on top of playing, what needs attention, then a station
 * lookup. Everything above the lookup is
 * catalog-wide and never changes with its filters; the lookup's filters
 * are URL params, so any view is a shareable link.
 *
 * Data source, in order: the live copy on the health-data branch (fresh
 * every morning without a site deploy), then the same-origin copy deploy.yml
 * overlays into dist/ (in dev: public/catalog-health.json, gitignored).
 */

import {
  DEFAULT_FILTERS,
  NP_LABEL,
  filterRows,
  filtersFromParams,
  filtersToParams,
  isDefaultFilters,
  logoDetailLabel,
  parseDashboard,
  sortRows,
  streamDetailLabel,
  type Dashboard,
  type FacetLevel,
  type Filters,
  type HealthRow,
  type SortKey,
  type View,
} from './model';
import {
  DIMENSIONS,
  DIMENSION_HINT,
  DIMENSION_LABEL,
  EXTRAS,
  GRADE_LABEL,
  goodShare,
  grade,
  needsAttention,
  summarise,
  worstIssue,
  type Dimension,
  type Extra,
} from './score';
import { bootstrapTheme, wireThemeToggle } from './theme';
import { countryName, el, fmtDay, fmtInt, fmtPct, gradeMark, relDay, stackedBar, trendChart } from './ui';

const DAY_MS = 86_400_000;
const STALE_DAYS = 8;

const BASE = import.meta.env.BASE_URL;
const LIVE_URL = 'https://raw.githubusercontent.com/MarkusSteinbrecher/rrradio/health-data/dashboard.json';
const LOCAL_URL = `${BASE}catalog-health.json`;
const PAGE = 25;
const ATTENTION_ROWS = 6;

function must(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`catalog-health: shell markup missing #${id}`);
  return node;
}

bootstrapTheme();
wireThemeToggle(must('theme-toggle') as HTMLButtonElement);

const statusRoot = must('load-status');

/* ── Data ────────────────────────────────────────────────────────── */

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

/* ── Hero: does it play? ────────────────────────────────────────── */

function renderHero(dash: Dashboard): void {
  const stream = summarise(dash.rows).stream;
  const curated = summarise(dash.rows.filter((r) => r.tier === 'curated')).stream;
  must('hero-value').textContent = fmtPct(goodShare(stream));
  const lastRun = dash.runs.stream ?? dash.generatedAt;
  must('hero-lede').textContent =
    `${fmtInt(stream.good)} of ${fmtInt(stream.checked)} stations answered with audio at their last check ` +
    `(${fmtInt(dash.counts.countries)} countries, checked ${relDay(lastRun)}).`;

  const facts: [string, string][] = [
    ['Failing right now', fmtInt(stream.bad)],
    ['Curated stations playing', `${fmtInt(curated.good)} of ${fmtInt(curated.checked)}`],
    ['Listening that reached a working stream, last 7 days', fmtPct(dash.metrics?.availability ?? null)],
  ];
  must('hero-facts').replaceChildren(
    ...facts.map(([label, value]) => el('div', { class: 'fact' }, el('dt', { class: 'fact__label' }, label), el('dd', { class: 'fact__value' }, value))),
  );
  must('hero').hidden = false;
}

/* ── Fixed automatically (catalog-actions loop) ──────────────────── */

function renderAutomation(dash: Dashboard): void {
  const days = dash.automation;
  if (days.length === 0) return;
  const sum = (k: 'retired' | 'recovered' | 'urlSwapped' | 'logoCleared' | 'logoUpgraded' | 'review'): number =>
    days.reduce((n, d) => n + (d[k] ?? 0), 0);
  const totals: [string, number, string][] = [
    ['Retired', sum('retired'), 'Dead streams taken out of the catalog'],
    ['Back on air', sum('recovered'), 'Retired stations that played again'],
    ['Stream replaced', sum('urlSwapped'), 'Dead URL swapped for a working one'],
    ['Dead logo removed', sum('logoCleared'), 'The app shows a placeholder instead'],
    ['Logo moved to https', sum('logoUpgraded'), 'Same image, now allowed by the app'],
    ['Sent to review', sum('review'), 'Curated stations wait for a human'],
  ];
  must('automation-totals').replaceChildren(
    ...totals.map(([label, n, hint]) =>
      el(
        'div',
        { class: 'total' },
        el('dt', { class: 'total__label' }, label),
        el('dd', { class: 'total__value' }, fmtInt(n)),
        el('dd', { class: 'total__hint' }, hint),
      ),
    ),
  );
  const held = days.filter((d) => d.held).length;
  const last = days[days.length - 1];
  must('automation-note').textContent =
    `Last ${days.length} runs, ${fmtDay(days[0].day)} to ${fmtDay(last.day)}. ` +
    (held > 0 ? `On ${held} ${held === 1 ? 'day' : 'days'} the safety brake held every change (too many failures at once).` : 'Runs daily an hour after the check.');
  must('automation').hidden = false;
}

/* ── Extras: now playing, logo, homepage ─────────────────────────── */

/** When each extra was last checked. Now playing folds stream titles and
 *  the metadata probe, so it is as old as the older of the two. */
function lastChecked(dash: Dashboard, dim: Extra): string {
  const r = dash.runs;
  if (dim === 'np') return [r.icy, r.metadata].filter(Boolean).sort()[0] ?? '';
  return (dim === 'logo' ? r.logo : r.homepage) ?? '';
}

function renderExtras(dash: Dashboard, onPick: (dim: Dimension, level: FacetLevel) => void): void {
  const dims = summarise(dash.rows);
  const now = Date.now();
  const items = EXTRAS.map((dim) => {
    const s = dims[dim];
    const labels = GRADE_LABEL[dim];
    const pick = (level: 'weak' | 'bad', n: number): HTMLElement => {
      const btn = el(
        'button',
        { type: 'button', class: 'key', 'data-grade': level },
        el('i', { class: 'mark__dot', 'aria-hidden': 'true' }),
        `${fmtInt(n)} ${labels[level].toLowerCase()}`,
      );
      btn.title = `List the ${fmtInt(n)} stations: ${labels[level].toLowerCase()}`;
      if (n === 0) btn.disabled = true;
      btn.addEventListener('click', () => onPick(dim, level));
      return btn;
    };
    const checked = lastChecked(dash, dim);
    const age = checked ? (now - new Date(checked).getTime()) / DAY_MS : Infinity;
    const stale = age > STALE_DAYS;
    const when = el(
      'p',
      { class: stale ? 'dim__when dim__when--stale' : 'dim__when' },
      checked ? `Checked ${stale ? fmtDay(checked) : relDay(checked)}` : 'Not checked yet',
      stale ? ' · not on the daily check yet' : '',
    );
    return el(
      'li',
      { class: 'dim' },
      el('div', { class: 'dim__name' }, el('h3', { class: 'dim__title' }, DIMENSION_LABEL[dim]), el('p', { class: 'dim__hint' }, DIMENSION_HINT[dim]), when),
      el('p', { class: 'dim__score' }, fmtPct(goodShare(s), 0)),
      el(
        'div',
        { class: 'dim__bar' },
        stackedBar([
          { grade: 'good', value: s.good, label: labels.good.toLowerCase() },
          { grade: 'weak', value: s.weak, label: labels.weak.toLowerCase() },
          { grade: 'bad', value: s.bad, label: labels.bad.toLowerCase() },
        ]),
        el(
          'p',
          { class: 'dim__keys' },
          el('span', { class: 'key', 'data-grade': 'good' }, el('i', { class: 'mark__dot', 'aria-hidden': 'true' }), `${fmtInt(s.good)} ${labels.good.toLowerCase()}`),
          pick('weak', s.weak),
          pick('bad', s.bad),
        ),
      ),
    );
  });
  must('dims').replaceChildren(...items);
  must('extras').hidden = false;
}

/* ── Trend: failing streams per day ──────────────────────────────── */

function renderTrend(dash: Dashboard): void {
  // Start once the probe covered the whole catalog: before that the count
  // climbs only because more stations were being checked.
  const firstFull = dash.history.findIndex((h) => (h.freshness ?? 0) >= 0.95);
  const points = dash.history
    .slice(Math.max(0, firstFull))
    .filter((h): h is typeof h & { bad: number } => typeof h.bad === 'number')
    .map((h) => ({ day: h.day, value: h.bad }));
  if (points.length < 2) return;
  const now = points[points.length - 1];
  const peak = points.reduce((a, b) => (b.value > a.value ? b : a));
  must('trend-note').textContent =
    peak.value > now.value
      ? `Failing at each morning’s check: down from ${fmtInt(peak.value)} on ${fmtDay(peak.day)} to ${fmtInt(now.value)} on ${fmtDay(now.day)}, as dead streams leave the catalog and recovered ones return.`
      : `Failing at each morning’s check: ${fmtInt(now.value)} on ${fmtDay(now.day)}.`;
  must('trend-chart').replaceChildren(trendChart(points, fmtInt, 'failing'));
  must('trend').hidden = false;
}

/* ── Needs attention ─────────────────────────────────────────────── */

function issueText(row: HealthRow, dim: Dimension): string {
  if (dim === 'stream') {
    const days = row.streakDays > 0 ? `${row.streakDays} ${row.streakDays === 1 ? 'day' : 'days'} · ` : '';
    return `${days}${streamDetailLabel(row)}`;
  }
  if (dim === 'logo') return logoDetailLabel(row);
  if (dim === 'np') return NP_LABEL[row.np];
  return GRADE_LABEL.home[grade(row, 'home') === 'bad' ? 'bad' : 'weak'];
}

function issueRow(row: HealthRow, dim: Dimension, onOpen: (row: HealthRow) => void): HTMLElement {
  const g = grade(row, dim);
  const open = el('button', { type: 'button', class: 'issue__name' }, row.name);
  open.title = `Look up ${row.name}`;
  open.addEventListener('click', () => onOpen(row));
  return el(
    'li',
    { class: 'issue' },
    open,
    el('span', { class: 'issue__cc' }, row.cc || '—'),
    gradeMark(g === 'bad' ? 'bad' : 'weak', `${DIMENSION_LABEL[dim]}: ${issueText(row, dim)}`),
  );
}

function showAllButton(label: string, onClick: () => void): HTMLElement {
  const btn = el('button', { type: 'button', 'data-variant': 'ghost', 'data-size': 'sm', class: 'issues__all' }, label);
  btn.addEventListener('click', onClick);
  return el('li', { class: 'issues__more' }, btn);
}

function renderAttention(dash: Dashboard, onOpen: (row: HealthRow) => void, onShow: (f: Partial<Filters>) => void): void {
  const curated = sortRows(
    dash.rows.filter((r) => r.tier === 'curated' && needsAttention(r)),
    'problems',
  );
  must('attention-curated-title').textContent = `Curated stations · ${fmtInt(curated.length)}`;
  const curatedList = must('attention-curated');
  if (curated.length === 0) {
    curatedList.replaceChildren(el('li', { class: 'issues__empty' }, 'Every curated station is in good shape.'));
  } else {
    curatedList.replaceChildren(
      ...curated.slice(0, ATTENTION_ROWS).map((r) => {
        const w = worstIssue(r);
        return issueRow(r, w ? w.dim : 'stream', onOpen);
      }),
      ...(curated.length > ATTENTION_ROWS
        ? [showAllButton(`Show all ${fmtInt(curated.length)}`, () => onShow({ view: 'attention', sort: 'curated' }))]
        : []),
    );
  }

  const failing = dash.rows
    .filter((r) => r.stream === 'bad')
    .sort((a, b) => b.streakDays - a.streakDays || a.name.localeCompare(b.name));
  const failingList = must('attention-failing');
  if (failing.length === 0) {
    failingList.replaceChildren(el('li', { class: 'issues__empty' }, 'No stream is failing today.'));
  } else {
    failingList.replaceChildren(
      ...failing.slice(0, ATTENTION_ROWS).map((r) => issueRow(r, 'stream', onOpen)),
      showAllButton(`Show all ${fmtInt(failing.length)}`, () => onShow({ facet: 'stream', level: 'bad', sort: 'problems' })),
    );
  }
  must('attention').hidden = false;
}

/* ── Station lookup ──────────────────────────────────────────────── */

const VIEW_LABEL: Record<View, string> = { all: 'All', curated: 'Curated', attention: 'Needs attention' };
const SORT_LABEL: Record<SortKey, string> = { curated: 'Curated first', problems: 'Problems first', name: 'Name' };

function dimCell(row: HealthRow, dim: Dimension): HTMLElement {
  const g = grade(row, dim);
  const label = g === 'skip' ? 'Not checked' : GRADE_LABEL[dim][g];
  let title = label;
  if (dim === 'stream') title = streamDetailLabel(row) + (row.streakDays > 0 ? ` · failing ${row.streakDays} days` : '');
  else if (dim === 'logo') title = logoDetailLabel(row);
  else if (dim === 'np') title = NP_LABEL[row.np];
  return el('td', { class: 'col-dim', 'data-label': DIMENSION_LABEL[dim] }, gradeMark(g, label, title));
}

function stationRow(row: HealthRow): HTMLElement {
  const meta = [row.id, row.cc ? countryName(row.cc) : '', row.tier === 'curated' ? 'Curated' : ''].filter(Boolean).join(' · ');
  return el(
    'tr',
    {},
    el(
      'td',
      { class: 'col-station' },
      el('a', { class: 'station__name', href: `${BASE}station/${encodeURIComponent(row.id)}/` }, row.name),
      el('span', { class: 'station__meta' }, meta),
    ),
    ...DIMENSIONS.map((d) => dimCell(row, d)),
  );
}

function initLookup(dash: Dashboard): { apply: (f: Partial<Filters>, scroll?: boolean) => void } {
  let filters: Filters = filtersFromParams(new URLSearchParams(location.search));
  let shown = PAGE;

  const search = el('input', {
    id: 'f-q',
    type: 'search',
    placeholder: 'Station name or id',
    'aria-label': 'Search stations',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  const countries = [...new Set(dash.rows.map((r) => r.cc).filter(Boolean))]
    .map((cc) => ({ cc, name: countryName(cc) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const country = el(
    'select',
    { id: 'f-cc', 'aria-label': 'Country' },
    el('option', { value: 'all' }, 'All countries'),
    ...countries.map((c) => el('option', { value: c.cc }, c.name)),
  );
  const sort = el(
    'select',
    { id: 'f-sort', 'aria-label': 'Sort' },
    ...(Object.keys(SORT_LABEL) as SortKey[]).map((k) => el('option', { value: k }, SORT_LABEL[k])),
  );
  const views = (Object.keys(VIEW_LABEL) as View[]).map((v) => {
    const b = el('button', { type: 'button', class: 'seg__btn', id: `f-view-${v}`, 'data-view': v }, VIEW_LABEL[v]);
    b.addEventListener('click', () => apply({ view: v }));
    return b;
  });
  const chip = el('p', { class: 'chip-row' });

  must('filters').replaceChildren(
    el('div', { class: 'filters__search' }, search),
    el('div', { class: 'seg', role: 'group', 'aria-label': 'Show' }, ...views),
    el('div', { class: 'filters__selects' }, country, sort),
    chip,
  );

  const tbody = must('table-body');
  const moreRoot = must('more');
  const resultLine = must('result-line');

  const syncControls = (): void => {
    if (search.value !== filters.q) search.value = filters.q;
    country.value = filters.cc;
    sort.value = filters.sort;
    for (const b of views) b.setAttribute('aria-pressed', String(b.dataset.view === filters.view));
    if (filters.facet) {
      const level = filters.level ? GRADE_LABEL[filters.facet][filters.level].toLowerCase() : 'weak or bad';
      const clear = el('button', { type: 'button', 'data-variant': 'ghost', 'data-size': 'sm' }, 'Clear');
      clear.addEventListener('click', () => apply({ facet: '', level: '' }));
      chip.replaceChildren(el('span', { class: 'chip' }, `${DIMENSION_LABEL[filters.facet]}: ${level}`), clear);
      chip.hidden = false;
    } else {
      chip.replaceChildren();
      chip.hidden = true;
    }
  };

  const render = (): void => {
    const rows = sortRows(filterRows(dash.rows, filters), filters.sort);
    tbody.replaceChildren(...rows.slice(0, shown).map(stationRow));
    if (rows.length === 0) {
      tbody.replaceChildren(el('tr', {}, el('td', { class: 'empty', colspan: '5' }, 'No station matches.')));
    }
    resultLine.textContent =
      rows.length === dash.rows.length
        ? `${fmtInt(rows.length)} stations`
        : `${fmtInt(rows.length)} of ${fmtInt(dash.rows.length)} stations`;
    moreRoot.replaceChildren();
    if (rows.length > shown) {
      const btn = el('button', { type: 'button', 'data-size': 'sm' }, `Show ${fmtInt(Math.min(PAGE, rows.length - shown))} more`);
      btn.addEventListener('click', () => {
        shown += PAGE;
        render();
      });
      moreRoot.append(btn);
    }
  };

  const apply = (patch: Partial<Filters>, scroll = false): void => {
    filters = { ...filters, ...patch };
    if (!filters.facet) filters.level = '';
    shown = PAGE;
    const params = filtersToParams(filters).toString();
    history.replaceState(null, '', isDefaultFilters(filters) ? location.pathname : `${location.pathname}?${params}`);
    syncControls();
    render();
    if (scroll) must('lookup').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  let typing: number | undefined;
  search.addEventListener('input', () => {
    window.clearTimeout(typing);
    typing = window.setTimeout(() => apply({ q: search.value }), 120);
  });
  country.addEventListener('change', () => apply({ cc: country.value }));
  sort.addEventListener('change', () => apply({ sort: sort.value as SortKey }));

  syncControls();
  render();
  must('lookup').hidden = false;
  return { apply };
}

/* ── Boot ────────────────────────────────────────────────────────── */

loadDashboard()
  .then((dash) => {
    statusRoot.hidden = true;
    renderHero(dash);
    const lookup = initLookup(dash);
    renderTrend(dash);
    renderAutomation(dash);
    renderExtras(dash, (facet, level) => lookup.apply({ ...DEFAULT_FILTERS, facet, level }, true));
    renderAttention(
      dash,
      (row) => lookup.apply({ ...DEFAULT_FILTERS, q: row.id }, true),
      (patch) => lookup.apply({ ...DEFAULT_FILTERS, ...patch }, true),
    );
  })
  .catch(() => {
    statusRoot.textContent = 'Today’s checks could not be loaded. Try again in a minute.';
    statusRoot.classList.add('is-error');
  });
