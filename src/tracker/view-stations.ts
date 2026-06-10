/**
 * Stations — dashboard donut over every station we know about, plus ONE
 * table whose columns never change with the donut slice. Base columns
 * (Station / Source / CC / Status / Stream) render identically for
 * catalog rows and upstream candidates; the segmented control swaps the
 * right-hand column set (health / logo / metadata) in every slice.
 * Candidate rows fill in what is known about them (probe verdict → Strm
 * pill, URL scheme → TLS pill) and show "—" for checks that only run
 * against the catalog. Every filter lives in the route params so any
 * view is shareable / bookmarkable.
 */

import { countryName } from '../country';
import type { Station } from '../types';
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
import type { Candidate, Facet, FacetEntry, StationRow } from './data';
import { navigate, stationHref, stationsHref } from './router';
import { searchMatcher } from './search';
import { badge, donut, el, emptyState, fmtInt, loading, logoThumb, verdictPill } from './ui';

const PAGE_SIZE = 100;
const COLUMN_SETS = ['health', 'logo', 'meta'] as const;
type ColumnSet = (typeof COLUMN_SETS)[number];

/** Candidate pools — donut segments other than "in catalog", plus 'all'
 *  (the entire universe across every source). */
const POOLS = ['all', 'available', 'duplicate', 'broken', 'unprobed'] as const;
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
  if (f.set !== 'health') params.set = f.set;
  return stationsHref(params);
}

/** The dashboard donut — every station we know about, by disposition. */
function dashboardDonut(f: Filters, dispositions: Map<string, number>): HTMLElement | null {
  if (!dispositions.size) return null;
  const segs: { key: string; label: string; pool: Pool }[] = [
    { key: 'imported', label: 'in catalog', pool: '' },
    { key: 'available', label: 'available — plays over https, not imported', pool: 'available' },
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
    { totalHref: poolHref(f, 'all'), totalActive: f.pool === 'all' },
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
    const matches = searchMatcher(f.q);
    out = out.filter((r) => matches(r.station.id, r.station.name, r.station.broadcaster));
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

// ── unified row model ────────────────────────────────────────────────
// Catalog stations and upstream candidates render through the same
// columns; this is the common shape both map into.

interface URow {
  name: string;
  sub: string;
  /** Catalog id when the row is (or matches) a catalog station — row click target. */
  catalogId?: string;
  sourceId?: string;
  cc?: string;
  /** Curation status (catalog rows only). */
  status?: string;
  /** Disposition (candidate rows only). */
  dispo?: string;
  streamUrl?: string;
  /** Upstream record URL when streamUrl is the probe-verified upgrade. */
  recordUrl?: string;
  favicon?: string;
  homepage?: string;
  /** Catalog-only extras for the logo / metadata column sets. */
  station?: Station;
  srow?: StationRow;
  probeVerdict?: string | null;
}

function fromStation(r: StationRow): URow {
  const s = r.station;
  return {
    name: s.name,
    sub: s.broadcaster ? `${s.id} · ${s.broadcaster}` : s.id,
    catalogId: s.id,
    sourceId: r.source,
    cc: s.country,
    status: s.status,
    streamUrl: s.streamUrl,
    favicon: s.favicon,
    homepage: s.homepage,
    station: s,
    srow: r,
  };
}

function fromCandidate(c: Candidate): URow {
  const sub: string[] = [];
  if (c.streamHost) sub.push(c.streamHost);
  if (c.votes) sub.push(`${fmtInt(c.votes)} votes`);
  if (c.disposition === 'duplicate') {
    sub.push(`dup of ${c.duplicateOfName ?? c.duplicateOf ?? c.matchedCatalogId ?? '?'}`);
  }
  // Prefer the probe-verified playable URL (e.g. the https upgrade of an
  // http record) — it's the URL an import would use and the one worth
  // click-testing.
  const upgraded = !!c.playableUrl && c.playableUrl !== c.streamUrl;
  return {
    name: c.name || '?',
    sub: sub.join(' · '),
    catalogId: c.matchedCatalogId ?? undefined,
    sourceId: c.sourceId,
    cc: c.country,
    dispo: c.disposition,
    streamUrl: (c.playableUrl ?? c.streamUrl) ?? undefined,
    recordUrl: upgraded ? (c.streamUrl ?? undefined) : undefined,
    favicon: c.favicon ?? undefined,
    homepage: c.homepage ?? undefined,
    probeVerdict: c.verdict,
  };
}

/** Synthetic facet entries for candidate rows: the playability probe
 *  maps onto the Strm column, the URL scheme onto TLS. The other checks
 *  only run against catalog stations and stay "—". */
function candidateFacet(u: URow, facet: Facet): FacetEntry | undefined {
  if (facet === 'stream' && u.probeVerdict) {
    const v = u.probeVerdict;
    if (v === 'ok' || v === 'ok-hls') return { v: 'ok', since: '', d: `probe: ${v}` };
    if (v === 'needs-playlist' || v === 'redirect-downgrade' || v === 'probe-inconclusive') {
      return { v: 'warn', since: '', d: `probe: ${v}` };
    }
    return { v: 'bad', since: '', d: `probe: ${v}` };
  }
  if (facet === 'https' && u.streamUrl) {
    if (u.streamUrl.startsWith('https:')) {
      return {
        v: 'ok',
        since: '',
        d: u.recordUrl ? `record is http — https verified by probe (${u.recordUrl})` : 'https stream',
      };
    }
    return { v: 'bad', since: '', d: 'http-only stream — unpublishable on the web (mixed content)' };
  }
  return undefined;
}

const DISPO_BADGE: Record<string, 'primary' | 'success' | 'info' | 'error' | 'muted'> = {
  imported: 'primary',
  available: 'success',
  duplicate: 'info',
  broken: 'error',
  unprobed: 'muted',
};

// ── columns (identical in every slice) ───────────────────────────────

function headerCells(set: ColumnSet): HTMLElement[] {
  const cells = [
    el('th', {}, ''),
    el('th', {}, 'Station'),
    el('th', { title: 'Where this row comes from (data/sources.yaml)' }, 'Source'),
    el('th', { title: 'Country code' }, 'CC'),
    el(
      'th',
      {
        title:
          'Catalog rows: curation status (working / icy-only / stream-only). Candidate rows: disposition (imported / available / duplicate / broken / unprobed). See legend.',
      },
      'Status',
    ),
    el('th', { title: 'Direct stream URL' }, 'Stream'),
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
    cells.push(el('th', {}, 'Codec'), el('th', {}, 'Fetcher'), el('th', {}, 'Metadata URL'), el('th', {}, 'Homepage'));
  }
  return cells;
}

function bodyCells(u: URow, set: ColumnSet): HTMLElement[] {
  const cells = [
    el('td', {}, logoThumb(u.favicon)),
    el(
      'td',
      { class: 'cell-station' },
      el('span', { class: 'title' }, u.name),
      el('span', { class: 'sub' }, u.sub),
    ),
    el('td', {}, u.sourceId ?? '—'),
    el('td', { title: u.cc ? countryName(u.cc.toUpperCase()) : '' }, (u.cc ?? '—').toUpperCase()),
    u.status
      ? el('td', { title: STATUS_DESC[u.status] ?? '' }, u.status)
      : el('td', {}, badge(u.dispo ?? '?', DISPO_BADGE[u.dispo ?? ''] ?? 'muted')),
    el(
      'td',
      {
        class: 'cell-url',
        title: u.recordUrl ? `probe-verified https URL — upstream record: ${u.recordUrl}` : (u.streamUrl ?? ''),
      },
      u.streamUrl ? el('a', { href: u.streamUrl, target: '_blank', rel: 'noopener noreferrer' }, u.streamUrl) : '—',
    ),
  ];
  if (set === 'health') {
    for (const facet of FACETS) {
      const entry = u.srow ? u.srow.facets[facet] : candidateFacet(u, facet);
      const td = el('td', { class: 'center' });
      td.append(verdictPill(entry, FACET_LABEL[facet]));
      cells.push(td);
    }
  } else if (set === 'logo') {
    const logo = u.srow?.logo;
    const facet = u.srow?.facets.logo;
    const size =
      logo?.probeWidth && logo?.probeHeight ? `${logo.probeWidth}×${logo.probeHeight}` : logo?.probeError ? 'probe failed' : '';
    cells.push(
      el('td', { class: 'cell-url', title: u.favicon ?? '' }, u.favicon ?? '—'),
      el('td', {}, logo?.tier ?? facet?.d ?? (facet?.v === 'ok' ? 'ok' : '—')),
      el('td', {}, logo?.faviconSource ?? '—'),
      el('td', {}, logo?.faviconLicense ?? '—'),
      el('td', {}, size || '—'),
      el('td', {}, logo?.action ?? '—'),
    );
  } else {
    cells.push(
      el('td', {}, u.station?.codec ?? '—'),
      el('td', {}, u.station?.metadata ?? '—'),
      el('td', { class: 'cell-url', title: u.station?.metadataUrl ?? '' }, u.station?.metadataUrl ?? '—'),
      el(
        'td',
        { class: 'cell-url', title: u.homepage ?? '' },
        u.homepage ? el('a', { href: u.homepage, target: '_blank', rel: 'noopener noreferrer' }, u.homepage) : '—',
      ),
    );
  }
  return cells;
}

/** Collapsible legend: cell glyphs, statuses/dispositions, health columns. */
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
        .join(' · ') +
        ' — candidate rows show their disposition instead: imported / available / duplicate / broken / unprobed',
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
  const search = searchInput(f, 'id, name, broadcaster…');

  const ccCounts = new Map<string, number>();
  for (const r of rows) {
    const cc = (r.station.country ?? '').toUpperCase();
    if (cc) ccCounts.set(cc, (ccCounts.get(cc) ?? 0) + 1);
  }
  const ccSelect = countrySelect(ccCounts, f.cc);

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
    el('label', { class: 'filter' }, 'Columns', columnSegmented(f)),
  );

  const filtered = applyFilters(rows, f);
  const panel = tablePanel(
    filtered.map(fromStation),
    f,
    `${fmtInt(filtered.length)} of ${fmtInt(rows.length)} station(s)`,
  );

  root.replaceChildren(...(dash ? [dash] : []), filterBar, legend(), panel);
  refocusSearch(search, f);
}

// ── candidate pools (upstream rows; 'all' = the whole universe) ──────

async function renderCandidatePool(root: HTMLElement, f: Filters, dash: HTMLElement | null): Promise<void> {
  root.replaceChildren(...(dash ? [dash] : []), loading('Loading candidates…'));
  const all = await loadAllCandidates();
  const pool = f.pool === 'all' ? all : all.filter((c) => c.disposition === f.pool);

  const search = searchInput(f, 'name, host, uuid…');

  const ccCounts = new Map<string, number>();
  for (const c of pool) {
    const cc = (c.country ?? '').toUpperCase();
    if (cc) ccCounts.set(cc, (ccCounts.get(cc) ?? 0) + 1);
  }
  const ccSelect = countrySelect(ccCounts, f.cc);

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
    el('label', { class: 'filter' }, 'Columns', columnSegmented(f)),
  );

  let filtered = pool;
  if (f.cc) filtered = filtered.filter((c) => (c.country ?? '').toUpperCase() === f.cc);
  if (f.q) {
    const matches = searchMatcher(f.q);
    filtered = filtered.filter((c) => matches(c.name, c.streamHost, c.stationuuid));
  }
  filtered = [...filtered];
  if (f.sort === 'clicks') filtered.sort((a, b) => (b.clickcount ?? 0) - (a.clickcount ?? 0));
  else if (f.sort === 'name') filtered.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  else if (f.sort === 'country') {
    filtered.sort((a, b) => (a.country ?? '').localeCompare(b.country ?? '') || (b.votes ?? 0) - (a.votes ?? 0));
  } else filtered.sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0));

  const label =
    f.pool === 'all'
      ? `${fmtInt(filtered.length)} of ${fmtInt(pool.length)} known station(s) across all sources`
      : `${fmtInt(filtered.length)} of ${fmtInt(pool.length)} ${f.pool} candidate(s) — not in the catalog`;
  const panel = tablePanel(filtered.map(fromCandidate), f, label);

  root.replaceChildren(...(dash ? [dash] : []), filterBar, legend(), panel);
  refocusSearch(search, f);
}

// ── shared controls + table ──────────────────────────────────────────

function searchInput(f: Filters, placeholder: string): HTMLInputElement {
  const search = el('input', { type: 'search', placeholder, value: f.q });
  let debounce: number | null = null;
  search.addEventListener('input', () => {
    if (debounce !== null) window.clearTimeout(debounce);
    debounce = window.setTimeout(() => {
      f.q = search.value.trim();
      f.page = 0;
      writeFilters(f);
    }, 250);
  });
  return search;
}

function refocusSearch(search: HTMLInputElement, f: Filters): void {
  if (document.activeElement === document.body && f.q) {
    search.focus();
    search.setSelectionRange(search.value.length, search.value.length);
  }
}

function countrySelect(counts: Map<string, number>, value: string): HTMLSelectElement {
  const select = el('select', {});
  select.append(new Option('All', ''));
  for (const [cc, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    select.append(new Option(`${cc} — ${countryName(cc)} (${fmtInt(n)})`, cc));
  }
  select.value = value;
  return select;
}

function columnSegmented(f: Filters): HTMLElement {
  const segmented = el('div', { class: 'segmented', role: 'group', 'aria-label': 'Column set' });
  for (const [label, value] of [['Health', 'health'], ['Logo', 'logo'], ['Metadata', 'meta']] as const) {
    const btn = el('button', { type: 'button', class: value === f.set ? 'active' : '' }, label);
    btn.addEventListener('click', () => {
      f.set = value;
      writeFilters(f);
    });
    segmented.append(btn);
  }
  return segmented;
}

/** Toolbar + pager + the one table, identical for every slice. */
function tablePanel(urows: URow[], f: Filters, countLabel: string): HTMLElement {
  const pages = Math.max(1, Math.ceil(urows.length / PAGE_SIZE));
  if (f.page >= pages) f.page = pages - 1;
  const slice = urows.slice(f.page * PAGE_SIZE, (f.page + 1) * PAGE_SIZE);

  const tbody = el('tbody', {});
  for (const u of slice) {
    const tr = el('tr', { class: u.catalogId ? 'is-clickable' : '' }, ...bodyCells(u, f.set));
    if (u.catalogId) {
      const id = u.catalogId;
      tr.addEventListener('click', (ev) => {
        if ((ev.target as HTMLElement).closest('a')) return;
        navigate(stationHref(id));
      });
    }
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

  return el(
    'section',
    { class: 'table-panel' },
    el(
      'div',
      { class: 'table-toolbar' },
      el('span', {}, countLabel),
      el('span', { class: 'spacer' }),
      el('div', { class: 'pager' }, prev, el('span', {}, `${f.page + 1} / ${pages}`), next),
    ),
    slice.length
      ? el(
          'div',
          { class: 'table-wrap' },
          el('table', { class: 'data' }, el('thead', {}, el('tr', {}, ...headerCells(f.set))), tbody),
        )
      : emptyState('Nothing matches.'),
  );
}
