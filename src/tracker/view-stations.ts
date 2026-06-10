/**
 * Stations — the one table over the whole published catalog. Health pills
 * always visible; a segmented control swaps the right-hand column set
 * between health, logo provenance, and metadata wiring. Every filter lives
 * in the route params so any view is shareable / bookmarkable.
 */

import { countryName } from '../country';
import { FACETS, FACET_LABEL, FACET_SHORT, loadRows } from './data';
import type { Facet, FacetEntry, StationRow } from './data';
import { navigate, stationHref, stationsHref } from './router';
import { el, fmtInt, loading, logoThumb, verdictPill } from './ui';

const PAGE_SIZE = 100;
const COLUMN_SETS = ['health', 'logo', 'meta'] as const;
type ColumnSet = (typeof COLUMN_SETS)[number];

interface Filters {
  q: string;
  cc: string;
  status: string;
  facet: Facet | '';
  v: string;
  set: ColumnSet;
  sort: string;
  page: number;
}

function readFilters(params: URLSearchParams): Filters {
  const set = params.get('set') as ColumnSet;
  return {
    q: params.get('q') ?? '',
    cc: params.get('cc') ?? '',
    status: params.get('status') ?? '',
    facet: (params.get('facet') as Facet) ?? '',
    v: params.get('v') ?? '',
    set: COLUMN_SETS.includes(set) ? set : 'health',
    sort: params.get('sort') ?? 'worst',
    page: Math.max(0, Number(params.get('page') ?? 0) || 0),
  };
}

function writeFilters(f: Filters): void {
  const params: Record<string, string> = {};
  if (f.q) params.q = f.q;
  if (f.cc) params.cc = f.cc;
  if (f.status) params.status = f.status;
  if (f.facet) params.facet = f.facet;
  if (f.v) params.v = f.v;
  if (f.set !== 'health') params.set = f.set;
  if (f.sort !== 'worst') params.sort = f.sort;
  if (f.page > 0) params.page = String(f.page);
  navigate(stationsHref(params));
}

function matchesVerdict(entry: FacetEntry | undefined, v: string): boolean {
  if (!entry) return false;
  if (v === 'problem') return entry.v === 'bad' || entry.v === 'warn';
  return entry.v === v;
}

function applyFilters(rows: StationRow[], f: Filters): StationRow[] {
  let out = rows;
  if (f.cc) out = out.filter((r) => (r.station.country ?? '').toUpperCase() === f.cc);
  if (f.status) out = out.filter((r) => r.station.status === f.status);
  if (f.q) {
    const q = f.q.toLowerCase();
    out = out.filter(
      (r) =>
        r.station.id.toLowerCase().includes(q) ||
        r.station.name.toLowerCase().includes(q) ||
        (r.station.broadcaster ?? '').toLowerCase().includes(q),
    );
  }
  if (f.v) {
    out = f.facet
      ? out.filter((r) => matchesVerdict(r.facets[f.facet], f.v))
      : out.filter((r) => FACETS.some((facet) => matchesVerdict(r.facets[facet], f.v)));
  } else if (f.facet) {
    out = out.filter((r) => r.facets[f.facet]);
  }

  out = [...out];
  if (f.sort === 'recent') {
    out.sort((a, b) => b.lastChange.localeCompare(a.lastChange) || a.station.id.localeCompare(b.station.id));
  } else if (f.sort === 'id') {
    out.sort((a, b) => a.station.id.localeCompare(b.station.id));
  } else if (f.sort === 'name') {
    out.sort((a, b) => a.station.name.localeCompare(b.station.name));
  } else {
    out.sort(
      (a, b) =>
        b.badCount - a.badCount ||
        b.warnCount - a.warnCount ||
        b.lastChange.localeCompare(a.lastChange) ||
        a.station.id.localeCompare(b.station.id),
    );
  }
  return out;
}

// ── column sets ──────────────────────────────────────────────────────

function headerCells(set: ColumnSet): HTMLElement[] {
  const cells = [el('th', {}, ''), el('th', {}, 'Station'), el('th', {}, 'CC'), el('th', {}, 'Status')];
  if (set === 'health') {
    for (const facet of FACETS) cells.push(el('th', { title: FACET_LABEL[facet] }, FACET_SHORT[facet]));
  } else if (set === 'logo') {
    cells.push(
      el('th', {}, 'Logo'),
      el('th', {}, 'Tier'),
      el('th', {}, 'Provenance'),
      el('th', {}, 'License'),
      el('th', {}, 'Size'),
      el('th', {}, 'Action'),
    );
  } else {
    cells.push(
      el('th', {}, 'Stream URL'),
      el('th', {}, 'Codec'),
      el('th', {}, 'Fetcher'),
      el('th', {}, 'Metadata URL'),
      el('th', {}, 'Homepage'),
    );
  }
  return cells;
}

function bodyCells(row: StationRow, set: ColumnSet): HTMLElement[] {
  const s = row.station;
  const cells = [
    el('td', {}, logoThumb(s.favicon)),
    el(
      'td',
      { class: 'cell-station' },
      el('span', { class: 'title' }, s.name),
      el('span', { class: 'sub' }, s.broadcaster ? `${s.id} · ${s.broadcaster}` : s.id),
    ),
    el('td', { title: s.country ? countryName(s.country.toUpperCase()) : '' }, (s.country ?? '—').toUpperCase()),
    el('td', {}, s.status ?? '—'),
  ];
  if (set === 'health') {
    for (const facet of FACETS) {
      const td = el('td', { class: 'center' });
      td.append(verdictPill(row.facets[facet]));
      cells.push(td);
    }
  } else if (set === 'logo') {
    const logo = row.logo;
    const facet = row.facets.logo;
    const size =
      logo?.probeWidth && logo?.probeHeight ? `${logo.probeWidth}×${logo.probeHeight}` : logo?.probeError ? 'probe failed' : '';
    cells.push(
      el('td', { class: 'cell-url', title: s.favicon ?? '' }, s.favicon ?? '—'),
      el('td', {}, logo?.tier ?? facet?.d ?? (facet?.v === 'ok' ? 'ok' : '—')),
      el('td', {}, logo?.faviconSource ?? '—'),
      el('td', {}, logo?.faviconLicense ?? '—'),
      el('td', {}, size || '—'),
      el('td', {}, logo?.action ?? '—'),
    );
  } else {
    cells.push(
      el('td', { class: 'cell-url', title: s.streamUrl }, s.streamUrl),
      el('td', {}, s.codec ?? '—'),
      el('td', {}, s.metadata ?? '—'),
      el('td', { class: 'cell-url', title: s.metadataUrl ?? '' }, s.metadataUrl ?? '—'),
      el('td', { class: 'cell-url', title: s.homepage ?? '' }, s.homepage ?? '—'),
    );
  }
  return cells;
}

// ── view ─────────────────────────────────────────────────────────────

export async function renderStations(root: HTMLElement, params: URLSearchParams): Promise<void> {
  root.replaceChildren(loading());
  const rows = await loadRows();
  const f = readFilters(params);

  // Filter bar — writes back into the route on change.
  const search = el('input', { type: 'search', placeholder: 'id, name, broadcaster…', value: f.q });
  let debounce: number | null = null;
  search.addEventListener('input', () => {
    if (debounce !== null) window.clearTimeout(debounce);
    debounce = window.setTimeout(() => {
      f.q = search.value.trim();
      f.page = 0;
      writeFilters(f);
    }, 250);
  });

  const ccCounts = new Map<string, number>();
  for (const r of rows) {
    const cc = (r.station.country ?? '').toUpperCase();
    if (cc) ccCounts.set(cc, (ccCounts.get(cc) ?? 0) + 1);
  }
  const ccSelect = el('select', {});
  ccSelect.append(new Option('All', ''));
  for (const [cc, n] of [...ccCounts.entries()].sort((a, b) => b[1] - a[1])) {
    ccSelect.append(new Option(`${cc} — ${countryName(cc)} (${fmtInt(n)})`, cc));
  }
  ccSelect.value = f.cc;

  const statusSelect = el('select', {});
  for (const [label, value] of [['All', ''], ['working', 'working'], ['icy-only', 'icy-only'], ['stream-only', 'stream-only']]) {
    statusSelect.append(new Option(label, value));
  }
  statusSelect.value = f.status;

  const facetSelect = el('select', {});
  facetSelect.append(new Option('Any facet', ''));
  for (const facet of FACETS) facetSelect.append(new Option(FACET_LABEL[facet], facet));
  facetSelect.value = f.facet;

  const verdictSelect = el('select', {});
  for (const [label, value] of [
    ['All stations', ''],
    ['Problems (bad or warn)', 'problem'],
    ['bad', 'bad'],
    ['warn', 'warn'],
    ['ok', 'ok'],
    ['n/a', 'na'],
  ]) {
    verdictSelect.append(new Option(label, value));
  }
  verdictSelect.value = f.v;

  const sortSelect = el('select', {});
  for (const [label, value] of [
    ['Worst first', 'worst'],
    ['Recent change', 'recent'],
    ['Catalog id', 'id'],
    ['Name', 'name'],
  ]) {
    sortSelect.append(new Option(label, value));
  }
  sortSelect.value = f.sort;

  const onSelect = (select: HTMLSelectElement, apply: (value: string) => void) => {
    select.addEventListener('change', () => {
      apply(select.value);
      f.page = 0;
      writeFilters(f);
    });
  };
  onSelect(ccSelect, (v) => (f.cc = v));
  onSelect(statusSelect, (v) => (f.status = v));
  onSelect(facetSelect, (v) => (f.facet = v as Facet | ''));
  onSelect(verdictSelect, (v) => (f.v = v));
  onSelect(sortSelect, (v) => (f.sort = v));

  const segmented = el('div', { class: 'segmented', role: 'group', 'aria-label': 'Column set' });
  for (const [label, value] of [['Health', 'health'], ['Logo', 'logo'], ['Metadata', 'meta']] as const) {
    const btn = el('button', { type: 'button', class: value === f.set ? 'active' : '' }, label);
    btn.addEventListener('click', () => {
      f.set = value;
      writeFilters(f);
    });
    segmented.append(btn);
  }

  const filterBar = el(
    'div',
    { class: 'filter-bar' },
    el('label', { class: 'filter grow' }, 'Search', search),
    el('label', { class: 'filter' }, 'Country', ccSelect),
    el('label', { class: 'filter' }, 'Status', statusSelect),
    el('label', { class: 'filter' }, 'Facet', facetSelect),
    el('label', { class: 'filter' }, 'Verdict', verdictSelect),
    el('label', { class: 'filter' }, 'Sort', sortSelect),
    el('label', { class: 'filter' }, 'Columns', segmented),
  );

  // Table
  const filtered = applyFilters(rows, f);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if (f.page >= pages) f.page = pages - 1;
  const slice = filtered.slice(f.page * PAGE_SIZE, (f.page + 1) * PAGE_SIZE);

  const thead = el('thead', {}, el('tr', {}, ...headerCells(f.set)));
  const tbody = el('tbody', {});
  for (const row of slice) {
    const tr = el('tr', { class: 'is-clickable' }, ...bodyCells(row, f.set));
    tr.addEventListener('click', (ev) => {
      if ((ev.target as HTMLElement).closest('a')) return;
      navigate(stationHref(row.station.id));
    });
    tbody.append(tr);
  }

  const prev = el('button', { type: 'button' }, 'Prev');
  const next = el('button', { type: 'button' }, 'Next');
  prev.disabled = f.page === 0;
  next.disabled = f.page >= pages - 1;
  prev.addEventListener('click', () => {
    f.page -= 1;
    writeFilters(f);
  });
  next.addEventListener('click', () => {
    f.page += 1;
    writeFilters(f);
  });

  const toolbar = el(
    'div',
    { class: 'table-toolbar' },
    el('span', {}, `${fmtInt(filtered.length)} of ${fmtInt(rows.length)} station(s)`),
    el('span', { class: 'spacer' }),
    el('div', { class: 'pager' }, prev, el('span', {}, `${f.page + 1} / ${pages}`), next),
  );

  const panel = el(
    'section',
    { class: 'table-panel' },
    toolbar,
    el('div', { class: 'table-wrap' }, el('table', { class: 'data' }, thead, tbody)),
  );

  root.replaceChildren(filterBar, panel);
  if (document.activeElement === document.body && f.q) {
    search.focus();
    search.setSelectionRange(search.value.length, search.value.length);
  }
}
