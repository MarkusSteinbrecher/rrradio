/**
 * Stations — dashboard donut over every station we know about, plus the
 * one table. With no pool selected the table is the published catalog
 * (health pills, segmented column sets). Clicking a donut segment swaps
 * the table to that candidate pool (available / duplicate / broken /
 * unprobed — stations that exist upstream but are NOT in the catalog).
 * Every filter lives in the route params so any view is shareable.
 */

import { countryName } from '../country';
import {
  FACETS,
  FACET_DESC,
  FACET_LABEL,
  FACET_SHORT,
  STATUS_DESC,
  loadAllCandidates,
  loadDispositionTotals,
  loadRows,
} from './data';
import type { Facet, FacetEntry, StationRow } from './data';
import { navigate, stationHref, stationsHref } from './router';
import { badge, donut, el, emptyState, fmtInt, loading, logoThumb, verdictPill } from './ui';

const PAGE_SIZE = 100;
const COLUMN_SETS = ['health', 'logo', 'meta'] as const;
type ColumnSet = (typeof COLUMN_SETS)[number];

/** Candidate pools — donut segments other than "in catalog". */
const POOLS = ['available', 'duplicate', 'broken', 'unprobed'] as const;
type Pool = '' | (typeof POOLS)[number];

interface Filters {
  pool: Pool;
  q: string;
  cc: string;
  status: string;
  source: string;
  facet: Facet | '';
  v: string;
  set: ColumnSet;
  sort: string;
  page: number;
}

function readFilters(params: URLSearchParams): Filters {
  const set = params.get('set') as ColumnSet;
  const pool = params.get('pool') as Pool;
  const hasPool = POOLS.includes(pool as (typeof POOLS)[number]);
  return {
    pool: hasPool ? pool : '',
    q: params.get('q') ?? '',
    cc: params.get('cc') ?? '',
    status: params.get('status') ?? '',
    source: params.get('source') ?? '',
    facet: (params.get('facet') as Facet) ?? '',
    v: params.get('v') ?? '',
    set: COLUMN_SETS.includes(set) ? set : 'health',
    sort: params.get('sort') ?? (hasPool ? 'votes' : 'worst'),
    page: Math.max(0, Number(params.get('page') ?? 0) || 0),
  };
}

function writeFilters(f: Filters): void {
  const params: Record<string, string> = {};
  if (f.pool) params.pool = f.pool;
  if (f.q) params.q = f.q;
  if (f.cc) params.cc = f.cc;
  if (f.status) params.status = f.status;
  if (f.source) params.source = f.source;
  if (f.facet) params.facet = f.facet;
  if (f.v) params.v = f.v;
  if (f.set !== 'health') params.set = f.set;
  if (f.sort !== (f.pool ? 'votes' : 'worst')) params.sort = f.sort;
  if (f.page > 0) params.page = String(f.page);
  navigate(stationsHref(params));
}

/** Href that switches the pool while keeping the cross-mode filters. */
function poolHref(f: Filters, pool: Pool): string {
  const params: Record<string, string> = {};
  if (pool) params.pool = pool;
  if (f.q) params.q = f.q;
  if (f.cc) params.cc = f.cc;
  return stationsHref(params);
}

/** The dashboard donut — every station we know about, by disposition. */
function dashboardDonut(f: Filters, dispositions: Map<string, number>): HTMLElement | null {
  if (!dispositions.size) return null;
  const segs: { key: string; label: string; pool: Pool }[] = [
    { key: 'imported', label: 'in catalog', pool: '' },
    { key: 'available', label: 'available — playable, not imported', pool: 'available' },
    { key: 'duplicate', label: 'duplicate — excluded, same stream/brand', pool: 'duplicate' },
    { key: 'broken', label: 'broken — stream failed probe', pool: 'broken' },
    { key: 'unprobed', label: 'unprobed — not analyzed yet', pool: 'unprobed' },
  ];
  return donut(
    'All known stations',
    segs.map((s) => ({
      key: s.key,
      label: s.label,
      count: dispositions.get(s.key) ?? 0,
      href: poolHref(f, s.pool),
      active: f.pool === s.pool,
    })),
  );
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
  if (f.source) out = out.filter((r) => r.source === f.source);
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
  const cells = [
    el('th', {}, ''),
    el('th', {}, 'Station'),
    el('th', { title: 'Country code' }, 'CC'),
    el('th', { title: 'Curation status — working / icy-only / stream-only (see legend)' }, 'Status'),
  ];
  if (set === 'health') {
    for (const facet of FACETS) {
      cells.push(el('th', { title: `${FACET_LABEL[facet]} — ${FACET_DESC[facet]}` }, FACET_SHORT[facet]));
    }
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
    el('td', { title: s.status ? (STATUS_DESC[s.status] ?? '') : '' }, s.status ?? '—'),
  ];
  if (set === 'health') {
    for (const facet of FACETS) {
      const td = el('td', { class: 'center' });
      td.append(verdictPill(row.facets[facet], FACET_LABEL[facet]));
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

/** Collapsible legend: cell glyphs, curation statuses, health columns. */
function legend(): HTMLElement {
  const details = el('details', { class: 'legend' });
  details.append(el('summary', { class: 'section-header' }, 'Legend — what the columns and icons mean'));

  const body = el('div', { class: 'legend-body' });
  body.append(
    el(
      'div',
      { class: 'chip-row' },
      el('span', { class: 'chip is-fresh' }, '✓ ok'),
      el('span', { class: 'chip is-stale' }, '~ warn'),
      el('span', { class: 'chip is-dead' }, '✗ bad'),
      el('span', { class: 'chip' }, '· n/a — check does not apply'),
      el('span', { class: 'chip' }, '— not checked yet'),
      el('span', { class: 'chip' }, 'hover any cell for detail + the date the verdict last changed'),
    ),
  );

  const dl = el('dl', { class: 'legend-grid' });
  dl.append(
    el('dt', {}, 'Status'),
    el(
      'dd',
      {},
      Object.entries(STATUS_DESC)
        .map(([k, v]) => `${k} = ${v}`)
        .join(' · '),
    ),
  );
  for (const facet of FACETS) {
    const term =
      FACET_SHORT[facet] === FACET_LABEL[facet] ? FACET_SHORT[facet] : `${FACET_SHORT[facet]} — ${FACET_LABEL[facet]}`;
    dl.append(el('dt', {}, term), el('dd', {}, FACET_DESC[facet]));
  }
  body.append(dl);
  details.append(body);
  return details;
}

// ── view ─────────────────────────────────────────────────────────────

export async function renderStations(root: HTMLElement, params: URLSearchParams): Promise<void> {
  root.replaceChildren(loading());
  const f = readFilters(params);
  const dash = dashboardDonut(f, await loadDispositionTotals());

  if (f.pool) {
    await renderCandidatePool(root, f, dash);
    return;
  }

  const rows = await loadRows();

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

  const sourceCounts = new Map<string, number>();
  for (const r of rows) {
    if (r.source) sourceCounts.set(r.source, (sourceCounts.get(r.source) ?? 0) + 1);
  }
  const sourceSelect = el('select', {});
  sourceSelect.append(new Option('All', ''));
  for (const [source, n] of [...sourceCounts.entries()].sort((a, b) => b[1] - a[1])) {
    sourceSelect.append(new Option(`${source} (${fmtInt(n)})`, source));
  }
  sourceSelect.value = f.source;

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
  onSelect(sourceSelect, (v) => (f.source = v));
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
    el('label', { class: 'filter' }, 'Source', sourceSelect),
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

  root.replaceChildren(...(dash ? [dash] : []), filterBar, legend(), panel);
  if (document.activeElement === document.body && f.q) {
    search.focus();
    search.setSelectionRange(search.value.length, search.value.length);
  }
}

// ── candidate pools (stations NOT in the catalog) ────────────────────

function probeBadge(verdict: string | null | undefined): HTMLElement {
  if (!verdict) return badge('unprobed', 'muted');
  if (verdict === 'ok' || verdict === 'ok-hls') return badge(verdict, 'success');
  if (verdict === 'needs-playlist' || verdict === 'redirect-downgrade' || verdict === 'probe-inconclusive') {
    return badge(verdict, 'warning');
  }
  return badge(verdict, 'error');
}

async function renderCandidatePool(root: HTMLElement, f: Filters, dash: HTMLElement | null): Promise<void> {
  root.replaceChildren(...(dash ? [dash] : []), loading('Loading candidates…'));
  const pool = (await loadAllCandidates()).filter((c) => c.disposition === f.pool);

  // Filter bar — same write-back-to-route pattern as the catalog table.
  const search = el('input', { type: 'search', placeholder: 'name, host, uuid…', value: f.q });
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
  for (const c of pool) {
    const cc = (c.country ?? '').toUpperCase();
    if (cc) ccCounts.set(cc, (ccCounts.get(cc) ?? 0) + 1);
  }
  const ccSelect = el('select', {});
  ccSelect.append(new Option('All', ''));
  for (const [cc, n] of [...ccCounts.entries()].sort((a, b) => b[1] - a[1])) {
    ccSelect.append(new Option(`${cc} — ${countryName(cc)} (${fmtInt(n)})`, cc));
  }
  ccSelect.value = f.cc;

  const sortSelect = el('select', {});
  for (const [label, value] of [
    ['Votes ↓', 'votes'],
    ['Clicks ↓', 'clicks'],
    ['Name', 'name'],
    ['Country', 'country'],
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
  onSelect(sortSelect, (v) => (f.sort = v));

  const filterBar = el(
    'div',
    { class: 'filter-bar' },
    el('label', { class: 'filter grow' }, 'Search', search),
    el('label', { class: 'filter' }, 'Country', ccSelect),
    el('label', { class: 'filter' }, 'Sort', sortSelect),
  );

  // Table
  let filtered = pool;
  if (f.cc) filtered = filtered.filter((c) => (c.country ?? '').toUpperCase() === f.cc);
  if (f.q) {
    const q = f.q.toLowerCase();
    filtered = filtered.filter(
      (c) =>
        (c.name ?? '').toLowerCase().includes(q) ||
        (c.streamHost ?? '').toLowerCase().includes(q) ||
        (c.stationuuid ?? '').toLowerCase().includes(q),
    );
  }
  filtered = [...filtered];
  if (f.sort === 'clicks') filtered.sort((a, b) => (b.clickcount ?? 0) - (a.clickcount ?? 0));
  else if (f.sort === 'name') filtered.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  else if (f.sort === 'country') {
    filtered.sort((a, b) => (a.country ?? '').localeCompare(b.country ?? '') || (b.votes ?? 0) - (a.votes ?? 0));
  } else filtered.sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0));

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if (f.page >= pages) f.page = pages - 1;
  const slice = filtered.slice(f.page * PAGE_SIZE, (f.page + 1) * PAGE_SIZE);

  const tbody = el('tbody', {});
  for (const c of slice) {
    const sub: string[] = [];
    if (c.streamHost) sub.push(c.streamHost);
    if (f.pool === 'duplicate') sub.push(`dup of ${c.duplicateOfName ?? c.duplicateOf ?? c.matchedCatalogId ?? '?'}`);
    tbody.append(
      el(
        'tr',
        {},
        el('td', {}, logoThumb(c.favicon ?? undefined)),
        el(
          'td',
          { class: 'cell-station' },
          el('span', { class: 'title' }, c.name ?? '?'),
          el('span', { class: 'sub' }, sub.join(' · ')),
        ),
        el('td', {}, c.sourceId),
        el('td', { title: c.country ? countryName(c.country.toUpperCase()) : '' }, (c.country ?? '—').toUpperCase()),
        el('td', { class: 'num' }, fmtInt(c.votes ?? 0)),
        el('td', { class: 'num' }, fmtInt(c.clickcount ?? 0)),
        el('td', {}, probeBadge(c.verdict)),
        el(
          'td',
          {},
          c.streamUrl ? el('a', { href: c.streamUrl, target: '_blank', rel: 'noopener noreferrer' }, 'stream') : null,
          ' ',
          c.homepage ? el('a', { href: c.homepage, target: '_blank', rel: 'noopener noreferrer' }, 'home') : null,
          ' ',
          c.matchedCatalogId ? el('a', { href: stationHref(c.matchedCatalogId) }, 'catalog') : null,
        ),
      ),
    );
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

  const panel = el(
    'section',
    { class: 'table-panel' },
    el(
      'div',
      { class: 'table-toolbar' },
      el('span', {}, `${fmtInt(filtered.length)} of ${fmtInt(pool.length)} ${f.pool} candidate(s) — not in the catalog`),
      el('span', { class: 'spacer' }),
      el('div', { class: 'pager' }, prev, el('span', {}, `${f.page + 1} / ${pages}`), next),
    ),
    filtered.length
      ? el(
          'div',
          { class: 'table-wrap' },
          el(
            'table',
            { class: 'data' },
            el(
              'thead',
              {},
              el(
                'tr',
                {},
                el('th', {}, ''),
                el('th', {}, 'Candidate'),
                el('th', { title: 'Which upstream source this candidate comes from (data/sources.yaml)' }, 'Source'),
                el('th', { title: 'Country code' }, 'CC'),
                el('th', { title: 'Radio Browser community votes' }, 'Votes'),
                el('th', { title: 'Radio Browser click count' }, 'Clicks'),
                el('th', { title: 'Stream playability probe verdict (rb-analysis)' }, 'Probe'),
                el('th', {}, 'Links'),
              ),
            ),
            tbody,
          ),
        )
      : emptyState(`No ${f.pool} candidates match.`),
  );

  root.replaceChildren(...(dash ? [dash] : []), filterBar, panel);
  if (document.activeElement === document.body && f.q) {
    search.focus();
    search.setSelectionRange(search.value.length, search.value.length);
  }
}
