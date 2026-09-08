/**
 * Catalog-health page boot: load the dashboard artifact, render the metric
 * tiles once, then keep the filter bar, result line and table in sync with
 * the URL (every filter is a search param, so any view is a link).
 *
 * Data source, in order: the live copy on the health-data branch (fresh
 * every morning without a site deploy), then the same-origin copy deploy.yml
 * overlays into dist/ (in dev: public/catalog-health.json, gitignored).
 */

import {
  DEFAULT_FILTERS,
  NP_LABEL,
  STATUS_LABEL,
  countBy,
  filterRows,
  filtersFromParams,
  filtersToParams,
  hasProblem,
  isDefaultFilters,
  logoDetailLabel,
  parseDashboard,
  sortRows,
  streamDetailLabel,
  tally,
  type Dashboard,
  type Filters,
  type HealthRow,
  type SortKey,
} from './model';
import { bootstrapTheme, wireThemeToggle } from './theme';
import { countryName, el, fmtDateTime, fmtDay, fmtInt, fmtPct, proportionBar, relDay, sparkline, verdictCell } from './ui';

const BASE = import.meta.env.BASE_URL;
const LIVE_URL = 'https://raw.githubusercontent.com/MarkusSteinbrecher/rrradio/health-data/dashboard.json';
const LOCAL_URL = `${BASE}catalog-health.json`;
const PAGE = 100;

function must(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`catalog-health: shell markup missing #${id}`);
  return node;
}

bootstrapTheme();
wireThemeToggle(must('theme-toggle') as HTMLButtonElement);

const tilesRoot = must('tiles');
const filtersRoot = must('filters');
const resultLine = must('result-line');
const tbody = must('table-body');
const moreRoot = must('more');
const ledeMeta = must('lede-meta');
const statusRoot = must('load-status');

/* ── Data ────────────────────────────────────────────────────────── */

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

async function loadDashboard(): Promise<Dashboard> {
  let raw: unknown;
  try {
    raw = await fetchJson(LIVE_URL);
  } catch {
    raw = await fetchJson(LOCAL_URL);
  }
  return parseDashboard(raw as Parameters<typeof parseDashboard>[0]);
}

/* ── Tiles (whole catalog — the filters below never change these) ── */

function tile(label: string, value: string, sub: Node | string, extra?: Node): HTMLElement {
  return el(
    'article',
    { class: 'tile' },
    el('h2', { class: 'tile__label' }, label),
    el('p', { class: 'tile__value' }, value),
    extra ?? null,
    el('p', { class: 'tile__sub' }, sub),
  );
}

function renderTiles(d: Dashboard): void {
  const stream = tally(d.rows, 'stream');
  const observed = stream.ok + stream.warn + stream.bad;
  const logo = tally(d.rows, 'logo');
  const logoChecked = logo.ok + logo.warn + logo.bad;
  const m = d.metrics;
  const pct = (v: number | null | undefined): string => fmtPct(v, 1);

  const availability = sparkline(
    d.history.map((h) => ({ day: h.day, value: h.availability })),
    { min: 0.8, max: 1, format: (v) => pct(v) },
  );
  const coverage = sparkline(
    d.history.map((h) => ({ day: h.day, value: h.freshness })),
    { min: 0, max: 1, format: (v) => pct(v) },
  );
  const failing = sparkline(
    d.history.map((h) => ({ day: h.day, value: h.bad })),
    { min: 0, format: (v) => `${fmtInt(v)} failing` },
  );

  tilesRoot.replaceChildren(
    tile(
      'Stations published',
      fmtInt(d.counts.published),
      `${fmtInt(d.counts.curated)} curated · ${fmtInt(d.counts.longTail)} long tail · ${fmtInt(d.counts.countries)} countries`,
    ),
    tile(
      'Streams playing',
      observed ? pct(stream.ok / observed) : '—',
      'share of probed streams answering with audio',
      proportionBar([
        { key: 'ok', value: stream.ok, label: 'playing' },
        { key: 'warn', value: stream.warn, label: 'odd reply' },
        { key: 'bad', value: stream.bad, label: 'failing' },
      ]),
    ),
    tile(
      'Availability',
      pct(m?.availability),
      'of listening in the last 7 days hit a working stream (play-weighted)',
      availability.root,
    ),
    tile(
      'Failing now',
      fmtInt(stream.bad),
      `${fmtInt(m?.stream?.hard ?? 0)} hard failures · ${fmtInt(m?.stream?.soft ?? 0)} soft · ${fmtInt(stream.unobserved)} not probed yet`,
      failing.root,
    ),
    tile(
      'Probe coverage',
      pct(m?.freshness),
      'of the catalog probed within the last 7 days',
      coverage.root,
    ),
    tile(
      'Logos',
      logoChecked ? pct(logo.ok / logoChecked) : '—',
      'share of stations with a good, licensed logo',
      proportionBar([
        { key: 'ok', value: logo.ok, label: 'good' },
        { key: 'warn', value: logo.warn, label: 'weak' },
        { key: 'bad', value: logo.bad, label: 'missing' },
      ]),
    ),
  );

  const probed = d.runs.stream ?? d.generatedAt;
  ledeMeta.replaceChildren(
    'Last probe ',
    el('time', { datetime: probed, title: fmtDateTime(probed) }, relDay(probed)),
    '.',
  );
}

/* ── Filters ─────────────────────────────────────────────────────── */

interface Controls {
  q: HTMLInputElement;
  cc: HTMLSelectElement;
  tier: HTMLSelectElement;
  status: HTMLSelectElement;
  stream: HTMLSelectElement;
  np: HTMLSelectElement;
  logo: HTMLSelectElement;
  home: HTMLSelectElement;
  sort: HTMLSelectElement;
  problems: HTMLButtonElement;
  reset: HTMLButtonElement;
  toggle: HTMLButtonElement;
}

function select(id: string, label: string, options: [string, string][]): { wrap: HTMLElement; node: HTMLSelectElement } {
  const node = el('select', { id: `f-${id}`, class: 'control control--select' });
  for (const [value, text] of options) node.append(el('option', { value }, text));
  const wrap = el('label', { class: 'field' }, el('span', { class: 'field__label' }, label), node);
  return { wrap, node };
}

function buildControls(d: Dashboard): Controls {
  const countries = [...countBy(d.rows, (r) => r.cc).entries()]
    .filter(([cc]) => cc)
    .map(([cc, n]) => ({ cc, n, name: countryName(cc) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const statuses = [...countBy(d.rows, (r) => r.status).keys()].filter(Boolean).sort();

  const q = el('input', {
    id: 'f-q',
    class: 'control control--search',
    type: 'search',
    placeholder: 'Search station or id',
    autocomplete: 'off',
    spellcheck: 'false',
    'aria-label': 'Search stations',
  });
  const cc = select('cc', 'Country', [['all', 'All countries'], ...countries.map((c): [string, string] => [c.cc, `${c.name} (${fmtInt(c.n)})`])]);
  const tier = select('tier', 'Tier', [['all', 'All tiers'], ['curated', 'Curated'], ['long-tail', 'Long tail']]);
  const status = select('status', 'Status', [['all', 'Any status'], ...statuses.map((s): [string, string] => [s, STATUS_LABEL[s] ?? s])]);
  const stream = select('stream', 'Stream', [['all', 'Any stream'], ['ok', 'Playing'], ['warn', 'Odd reply'], ['bad', 'Failing'], ['unobserved', 'Not probed yet']]);
  const np = select('np', 'Now playing', [['all', 'Any now-playing'], ['api', NP_LABEL.api], ['icy', NP_LABEL.icy], ['silent', NP_LABEL.silent], ['hls', NP_LABEL.hls], ['none', NP_LABEL.none]]);
  const logo = select('logo', 'Logo', [['all', 'Any logo'], ['ok', 'Good'], ['warn', 'Weak'], ['bad', 'Missing']]);
  const home = select('home', 'Homepage', [['all', 'Any homepage'], ['ok', 'Reachable'], ['warn', 'Blocked'], ['bad', 'Dead']]);
  const sort = select('sort', 'Sort', [['name', 'Name'], ['country', 'Country'], ['stream', 'Worst stream first'], ['since', 'Recently changed'], ['checked', 'Recently probed']]);
  const problems = el('button', { type: 'button', class: 'chip', id: 'f-problems', 'aria-pressed': 'false' }, 'Problems only');
  const reset = el('button', { type: 'button', class: 'linkish', id: 'f-reset' }, 'Reset');
  // Narrow screens only (CSS hides it otherwise): folds the select row away
  // so the sticky bar doesn't swallow the viewport.
  const toggle = el('button', { type: 'button', class: 'chip chip--filters', id: 'f-toggle', 'aria-expanded': 'false', 'aria-controls': 'f-selects' }, 'Filters');
  toggle.addEventListener('click', () => {
    const open = filtersRoot.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  filtersRoot.replaceChildren(
    el('div', { class: 'filters__row' }, q, sort.wrap, problems, toggle, reset),
    el('div', { class: 'filters__row filters__row--selects', id: 'f-selects' }, cc.wrap, tier.wrap, status.wrap, stream.wrap, np.wrap, logo.wrap, home.wrap),
  );
  return { q, cc: cc.node, tier: tier.node, status: status.node, stream: stream.node, np: np.node, logo: logo.node, home: home.node, sort: sort.node, problems, reset, toggle };
}

function readControls(c: Controls): Filters {
  return {
    q: c.q.value,
    cc: c.cc.value,
    tier: c.tier.value === 'curated' || c.tier.value === 'long-tail' ? c.tier.value : 'all',
    status: c.status.value,
    stream: c.stream.value as Filters['stream'],
    np: c.np.value as Filters['np'],
    logo: c.logo.value as Filters['logo'],
    home: c.home.value as Filters['home'],
    problems: c.problems.getAttribute('aria-pressed') === 'true',
    sort: c.sort.value as SortKey,
  };
}

function writeControls(c: Controls, f: Filters): void {
  c.q.value = f.q;
  const setSel = (node: HTMLSelectElement, value: string): void => {
    node.value = value;
    if (node.value !== value) node.value = 'all';
  };
  setSel(c.cc, f.cc);
  setSel(c.tier, f.tier);
  setSel(c.status, f.status);
  setSel(c.stream, f.stream);
  setSel(c.np, f.np);
  setSel(c.logo, f.logo);
  setSel(c.home, f.home);
  c.sort.value = f.sort;
  c.problems.setAttribute('aria-pressed', f.problems ? 'true' : 'false');
  c.problems.classList.toggle('is-active', f.problems);
  c.reset.hidden = isDefaultFilters(f);
  const active = [f.cc, f.tier, f.status, f.stream, f.np, f.logo, f.home].filter((v) => v !== 'all').length;
  c.toggle.textContent = active ? `Filters · ${active}` : 'Filters';
  c.toggle.classList.toggle('is-active', active > 0);
}

/* ── Table ───────────────────────────────────────────────────────── */

const NP_SHORT: Record<HealthRow['np'], string> = {
  api: 'Broadcaster API',
  icy: 'Stream titles',
  silent: 'Silent',
  hls: 'HLS',
  none: 'None',
  '': '—',
};

const HOME_WORD: Record<HealthRow['home'], string> = { ok: 'Reachable', warn: 'Blocked', bad: 'Dead', na: 'None', '': '—' };

function streamCell(r: HealthRow): HTMLElement {
  const label = streamDetailLabel(r);
  const streak = r.streakDays > 0 ? `${r.streakDays} d${r.streakClass ? ` · ${r.streakClass}` : ''}` : undefined;
  const since = r.streamSince ? ` since ${fmtDay(r.streamSince)}` : '';
  const title = r.stream === 'ok' ? `Playing (${r.streamDetail})${since}` : `${label}${since}${streak ? `, failing ${r.streakDays} days in a row` : ''}`;
  return verdictCell(r.stream, label, title, streak);
}

function row(r: HealthRow): HTMLTableRowElement {
  const tr = el('tr', { class: hasProblem(r) ? 'row row--problem' : 'row' });
  tr.append(
    el(
      'td',
      { class: 'cell cell--station' },
      el('a', { class: 'station__name', href: `${BASE}station/${encodeURIComponent(r.id)}/` }, r.name),
      el('span', { class: 'station__id' }, r.id),
    ),
    el('td', { class: 'cell cell--country', title: countryName(r.cc) }, r.cc || '—'),
    el(
      'td',
      { class: 'cell cell--tier' },
      r.tier === 'curated'
        ? el('span', { class: 'pill pill--curated', title: `Curated tier · ${STATUS_LABEL[r.status] ?? r.status} · probed daily` }, 'curated')
        : el('span', { class: 'pill pill--tail', title: `Long tail · ${STATUS_LABEL[r.status] ?? r.status} · probed weekly, daily while failing` }, 'long tail'),
    ),
    el('td', { class: 'cell cell--stream' }, streamCell(r)),
    el('td', { class: `cell cell--np np-${r.np || 'none'}`, title: NP_LABEL[r.np] }, NP_SHORT[r.np]),
    el('td', { class: 'cell cell--logo' }, verdictCell(r.logo, logoDetailLabel(r), `Logo: ${logoDetailLabel(r)}`)),
    el('td', { class: 'cell cell--home' }, verdictCell(r.home, HOME_WORD[r.home], `Homepage: ${HOME_WORD[r.home]}`)),
    el('td', { class: 'cell cell--checked', title: r.checked ? `Last probed ${r.checked}` : 'Not probed yet' }, r.checked ? fmtDay(r.checked) : '—'),
  );
  return tr;
}

/* ── Wiring ──────────────────────────────────────────────────────── */

async function boot(): Promise<void> {
  let d: Dashboard;
  try {
    d = await loadDashboard();
  } catch (err) {
    statusRoot.textContent = 'The health data could not be loaded right now. Please try again in a few minutes.';
    statusRoot.classList.add('is-error');
    console.error(err);
    return;
  }
  statusRoot.hidden = true;
  renderTiles(d);
  const controls = buildControls(d);
  let filters = filtersFromParams(new URLSearchParams(location.search));
  let visible = PAGE;
  let current: HealthRow[] = [];

  const renderRows = (): void => {
    const slice = current.slice(0, visible);
    tbody.replaceChildren(...slice.map(row));
    moreRoot.replaceChildren();
    if (current.length === 0) {
      tbody.append(el('tr', {}, el('td', { class: 'cell cell--empty', colspan: '8' }, 'No station matches these filters.')));
      return;
    }
    if (current.length > visible) {
      const remaining = current.length - visible;
      const more = el('button', { type: 'button', class: 'more__btn' }, `Show ${fmtInt(Math.min(PAGE, remaining))} more`);
      more.addEventListener('click', () => {
        visible += PAGE;
        renderRows();
      });
      moreRoot.append(more, el('span', { class: 'more__meta' }, `${fmtInt(slice.length)} of ${fmtInt(current.length)} shown`));
    }
  };

  const renderResults = (): void => {
    current = sortRows(filterRows(d.rows, filters), filters.sort);
    visible = PAGE;
    const t = tally(current, 'stream');
    const observed = t.ok + t.warn + t.bad;
    const logo = tally(current, 'logo');
    const logoChecked = logo.ok + logo.warn + logo.bad;
    const parts: string[] = [`${fmtInt(current.length)} station${current.length === 1 ? '' : 's'}`];
    if (!isDefaultFilters(filters) && d.rows.length) parts.push(`${fmtPct(current.length / d.rows.length, 1)} of the catalog`);
    if (observed) parts.push(`${fmtPct(t.ok / observed, 1)} playing`);
    if (t.bad) parts.push(`${fmtInt(t.bad)} failing`);
    if (logoChecked) parts.push(`${fmtPct(logo.ok / logoChecked, 0)} good logos`);
    resultLine.textContent = parts.join(' · ');
    renderRows();
  };

  const syncUrl = (): void => {
    const qs = filtersToParams(filters).toString();
    history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}`);
  };

  const onChange = (): void => {
    filters = readControls(controls);
    writeControls(controls, filters);
    syncUrl();
    renderResults();
  };

  for (const node of [controls.cc, controls.tier, controls.status, controls.stream, controls.np, controls.logo, controls.home, controls.sort]) {
    node.addEventListener('change', onChange);
  }
  let debounce = 0;
  controls.q.addEventListener('input', () => {
    window.clearTimeout(debounce);
    debounce = window.setTimeout(onChange, 120);
  });
  controls.problems.addEventListener('click', () => {
    const on = controls.problems.getAttribute('aria-pressed') !== 'true';
    controls.problems.setAttribute('aria-pressed', on ? 'true' : 'false');
    onChange();
  });
  controls.reset.addEventListener('click', () => {
    writeControls(controls, { ...DEFAULT_FILTERS });
    onChange();
  });
  window.addEventListener('popstate', () => {
    filters = filtersFromParams(new URLSearchParams(location.search));
    writeControls(controls, filters);
    renderResults();
  });

  writeControls(controls, filters);
  renderResults();
}

void boot();
