/**
 * Health tab for the station tracker — the primary view over the unified
 * per-station health record at public/station-health.json
 * (spec: docs/station-health.md).
 *
 * Self-contained: owns its DOM refs, loads the record lazily on first
 * activation, and takes the catalog (for names/countries) via
 * setHealthCatalog() whenever the host page finishes loading it.
 */

import { countryName } from './country';
import type { Station } from './types';

const BASE = import.meta.env.BASE_URL;
const PAGE_SIZE = 200;

type Verdict = 'ok' | 'warn' | 'bad' | 'na';

interface FacetEntry {
  v: Verdict;
  since: string;
  d?: string;
}

interface RunMeta {
  lastRun: string;
  tool: string;
  scope: string;
  checked: number;
  tally: Record<Verdict, number>;
}

interface HealthRecord {
  version: number;
  runs: Record<string, RunMeta>;
  stations: Record<string, Record<string, FacetEntry>>;
}

/** Column order — matches tools/lib/health-record.mjs FACETS. */
const FACETS = [
  'stream',
  'https',
  'icy',
  'metadata',
  'fetcher',
  'program',
  'logo',
  'homepage',
  'drift',
  'duplicate',
] as const;
type Facet = (typeof FACETS)[number];

const FACET_LABEL: Record<Facet, string> = {
  stream: 'Stream',
  https: 'HTTPS',
  icy: 'ICY',
  metadata: 'Meta API',
  fetcher: 'Fetcher',
  program: 'Program',
  logo: 'Logo',
  homepage: 'Homepage',
  drift: 'RB drift',
  duplicate: 'Duplicates',
};

const GLYPH: Record<Verdict, string> = { ok: '✓', warn: '~', bad: '✗', na: '·' };

interface HealthRow {
  id: string;
  name: string;
  broadcaster: string;
  country: string;
  status: string;
  facets: Record<string, FacetEntry | undefined>;
  badCount: number;
  warnCount: number;
  /** Most recent verdict transition across facets (yyyy-mm-dd). */
  lastChange: string;
}

interface HealthState {
  record: HealthRecord | null;
  loadError: string | null;
  rows: HealthRow[];
  filtered: HealthRow[];
  page: number;
  loaded: boolean;
}

const state: HealthState = {
  record: null,
  loadError: null,
  rows: [],
  filtered: [],
  page: 0,
  loaded: false,
};

let catalogById = new Map<string, Station>();

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`station-tracker-health: missing #${id}`);
  return el as T;
}

const refs = {
  freshness: byId('health-freshness'),
  cards: byId('health-cards'),
  query: byId<HTMLInputElement>('health-filter-query'),
  country: byId<HTMLSelectElement>('health-filter-country'),
  facet: byId<HTMLSelectElement>('health-filter-facet'),
  verdict: byId<HTMLSelectElement>('health-filter-verdict'),
  sort: byId<HTMLSelectElement>('health-sort'),
  summary: byId('health-summary'),
  pagePrev: byId<HTMLButtonElement>('health-page-prev'),
  pageNext: byId<HTMLButtonElement>('health-page-next'),
  pageLabel: byId('health-page-label'),
  rows: byId<HTMLTableSectionElement>('health-rows'),
};

// ─── data loading ────────────────────────────────────────────────────

async function loadRecord(): Promise<void> {
  try {
    const res = await fetch(`${BASE}station-health.json`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = (await res.json()) as HealthRecord;
    if (parsed.version !== 1 || typeof parsed.stations !== 'object') {
      throw new Error('unrecognised record shape');
    }
    state.record = parsed;
  } catch (err) {
    state.loadError = `station-health.json unavailable — run \`npm run health-import\` or \`npm run health\` (${String(err)})`;
  }
}

function buildRows(): void {
  const record = state.record;
  if (!record) return;
  const rows: HealthRow[] = [];
  for (const [id, facets] of Object.entries(record.stations)) {
    const station = catalogById.get(id);
    let badCount = 0;
    let warnCount = 0;
    let lastChange = '';
    for (const facet of FACETS) {
      const f = facets[facet];
      if (!f) continue;
      if (f.v === 'bad') badCount += 1;
      else if (f.v === 'warn') warnCount += 1;
      if (f.since > lastChange) lastChange = f.since;
    }
    rows.push({
      id,
      name: station?.name ?? id,
      broadcaster: station?.broadcaster ?? '',
      country: (station?.country ?? '').toUpperCase(),
      status: station?.status ?? '',
      facets,
      badCount,
      warnCount,
      lastChange,
    });
  }
  state.rows = rows;
}

// ─── filtering + sorting ─────────────────────────────────────────────

function applyHealthFilters(): void {
  const q = refs.query.value.trim().toLowerCase();
  const cc = refs.country.value;
  const facet = refs.facet.value as Facet | '';
  const verdict = refs.verdict.value;

  let rows = state.rows;
  if (cc) rows = rows.filter((r) => r.country === cc);
  if (q) {
    rows = rows.filter(
      (r) =>
        r.id.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        r.broadcaster.toLowerCase().includes(q),
    );
  }
  if (verdict) {
    const matches = (f: FacetEntry | undefined): boolean => {
      if (!f) return false;
      if (verdict === 'problem') return f.v === 'bad' || f.v === 'warn';
      return f.v === verdict;
    };
    rows = facet
      ? rows.filter((r) => matches(r.facets[facet]))
      : rows.filter((r) => FACETS.some((f) => matches(r.facets[f])));
  } else if (facet) {
    rows = rows.filter((r) => r.facets[facet]);
  }

  const sort = refs.sort.value;
  rows = [...rows];
  if (sort === 'recent') {
    rows.sort((a, b) => b.lastChange.localeCompare(a.lastChange) || a.id.localeCompare(b.id));
  } else if (sort === 'id') {
    rows.sort((a, b) => a.id.localeCompare(b.id));
  } else {
    rows.sort(
      (a, b) =>
        b.badCount - a.badCount ||
        b.warnCount - a.warnCount ||
        b.lastChange.localeCompare(a.lastChange) ||
        a.id.localeCompare(b.id),
    );
  }

  state.filtered = rows;
  state.page = 0;
  renderTable();
}

// ─── rendering ───────────────────────────────────────────────────────

function ageDays(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function freshnessClass(days: number): string {
  if (days < 8) return 'is-fresh';
  if (days < 30) return 'is-stale';
  return 'is-dead';
}

function renderFreshness(): void {
  const record = state.record;
  if (!record) return;
  const chips: HTMLElement[] = [];
  for (const facet of FACETS) {
    const run = record.runs[facet];
    const chip = document.createElement('span');
    if (!run) {
      chip.className = 'health-chip is-dead';
      chip.title = `${FACET_LABEL[facet]}: never checked`;
      chip.textContent = `${FACET_LABEL[facet]} · never`;
    } else {
      const days = ageDays(run.lastRun);
      chip.className = `health-chip ${freshnessClass(days)}`;
      const scope = run.scope === 'full' ? '' : ` · ${run.scope}`;
      chip.title = `${run.tool} · ${run.checked.toLocaleString()} station(s) · ${new Date(run.lastRun).toLocaleString()}${scope}`;
      const full = run.scope === 'full' || run.scope === 'rolling'; // rolling = ADR 002 daily shards, weekly coverage
      chip.textContent = `${FACET_LABEL[facet]} · ${days === 0 ? 'today' : `${days}d`}${full ? '' : ' (partial)'}`;
    }
    chips.push(chip);
  }
  refs.freshness.replaceChildren(...chips);
}

function renderCards(): void {
  const record = state.record;
  if (!record) return;
  const cards: HTMLElement[] = [];
  for (const facet of FACETS) {
    const run = record.runs[facet];
    if (!run) continue;
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'health-card';
    const problems = (run.tally.bad ?? 0) + (run.tally.warn ?? 0);
    card.classList.toggle('has-bad', (run.tally.bad ?? 0) > 0);
    const label = document.createElement('span');
    label.className = 'health-card__label';
    label.textContent = FACET_LABEL[facet];
    const counts = document.createElement('span');
    counts.className = 'health-card__counts';
    counts.textContent = `${(run.tally.bad ?? 0).toLocaleString()} bad · ${(run.tally.warn ?? 0).toLocaleString()} warn`;
    card.append(label, counts);
    card.title = `${problems.toLocaleString()} problem(s) of ${run.checked.toLocaleString()} checked — click to filter`;
    card.addEventListener('click', () => {
      refs.facet.value = facet;
      refs.verdict.value = 'problem';
      applyHealthFilters();
    });
    cards.push(card);
  }
  refs.cards.replaceChildren(...cards);
}

function facetCell(entry: FacetEntry | undefined): HTMLTableCellElement {
  const td = document.createElement('td');
  td.className = 'health-cell';
  const pill = document.createElement('span');
  if (!entry) {
    pill.className = 'health-pill is-unchecked';
    pill.textContent = '—';
    pill.title = 'not checked yet';
  } else {
    pill.className = `health-pill is-${entry.v}`;
    pill.textContent = GLYPH[entry.v];
    pill.title = `${entry.v}${entry.d ? ` — ${entry.d}` : ''} (since ${entry.since})`;
  }
  td.append(pill);
  return td;
}

function renderTable(): void {
  const pages = Math.max(1, Math.ceil(state.filtered.length / PAGE_SIZE));
  if (state.page >= pages) state.page = pages - 1;
  const start = state.page * PAGE_SIZE;
  const slice = state.filtered.slice(start, start + PAGE_SIZE);

  const frag = document.createDocumentFragment();
  for (const row of slice) {
    const tr = document.createElement('tr');

    const name = document.createElement('td');
    name.className = 'health-name';
    const title = document.createElement('span');
    title.className = 'health-name__title';
    title.textContent = row.name;
    const sub = document.createElement('span');
    sub.className = 'health-name__id';
    sub.textContent = row.broadcaster ? `${row.id} · ${row.broadcaster}` : row.id;
    name.append(title, sub);
    tr.append(name);

    const cc = document.createElement('td');
    cc.textContent = row.country || '—';
    if (row.country) cc.title = countryName(row.country);
    tr.append(cc);

    const status = document.createElement('td');
    status.textContent = row.status || '—';
    tr.append(status);

    for (const facet of FACETS) tr.append(facetCell(row.facets[facet]));
    frag.append(tr);
  }
  refs.rows.replaceChildren(frag);

  refs.summary.textContent = state.loadError
    ? state.loadError
    : `${state.filtered.length.toLocaleString()} of ${state.rows.length.toLocaleString()} station(s)`;
  refs.pageLabel.textContent = `Page ${state.page + 1} / ${pages}`;
  refs.pagePrev.disabled = state.page === 0;
  refs.pageNext.disabled = state.page >= pages - 1;
}

function syncCountryOptions(): void {
  const counts = new Map<string, number>();
  for (const row of state.rows) {
    if (row.country) counts.set(row.country, (counts.get(row.country) ?? 0) + 1);
  }
  const selected = refs.country.value;
  const options = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  refs.country.replaceChildren(
    new Option('All', ''),
    ...options.map(([cc, n]) => new Option(`${cc} — ${countryName(cc)} (${n.toLocaleString()})`, cc)),
  );
  refs.country.value = selected;
}

function syncFacetOptions(): void {
  const selected = refs.facet.value;
  refs.facet.replaceChildren(
    new Option('Any facet', ''),
    ...FACETS.map((f) => new Option(FACET_LABEL[f], f)),
  );
  refs.facet.value = selected;
}

// ─── public API ──────────────────────────────────────────────────────

/** Bind events once at boot. Cheap; does not fetch anything. */
export function initHealthTab(): void {
  syncFacetOptions();
  let debounce: number | null = null;
  refs.query.addEventListener('input', () => {
    if (debounce !== null) window.clearTimeout(debounce);
    debounce = window.setTimeout(() => applyHealthFilters(), 150);
  });
  for (const el of [refs.country, refs.facet, refs.verdict, refs.sort]) {
    el.addEventListener('change', () => applyHealthFilters());
  }
  refs.pagePrev.addEventListener('click', () => {
    state.page = Math.max(0, state.page - 1);
    renderTable();
  });
  refs.pageNext.addEventListener('click', () => {
    state.page += 1;
    renderTable();
  });
}

/** Lazy-load the record on first activation, then render. */
export async function activateHealthTab(): Promise<void> {
  if (state.loaded) return;
  state.loaded = true;
  await loadRecord();
  if (state.loadError) {
    refs.freshness.replaceChildren();
    refs.summary.textContent = state.loadError;
    return;
  }
  buildRows();
  renderFreshness();
  renderCards();
  syncCountryOptions();
  applyHealthFilters();
}

/** Called by the host page once the catalog has loaded — fills in names,
 *  countries and statuses, and re-renders if the tab is already live. */
export function setHealthCatalog(stations: Station[]): void {
  catalogById = new Map(stations.map((s) => [s.id, s]));
  if (state.record) {
    buildRows();
    syncCountryOptions();
    applyHealthFilters();
  }
}
