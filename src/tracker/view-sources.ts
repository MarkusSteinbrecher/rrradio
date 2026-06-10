/**
 * Sources — the upstream inventory: every candidate we know about from
 * Radio Browser (~55k) and the manual source list, with playability verdicts
 * and dedupe dispositions. Answers "what's out there that we haven't
 * imported, and why not?".
 *
 * Data: public/sources.json (summary) + public/sources/<id>.json (detail) +
 * public/sources/<id>-candidates.json (full per-station list), all produced
 * by tools/build-sources.mjs.
 */

import { countryName } from '../country';
import { stationHref } from './router';
import { searchMatcher } from './search';
import { badge, el, emptyState, fmtInt, loading, sectionHeader, statCard } from './ui';

const BASE = import.meta.env.BASE_URL;
const PAGE_SIZE = 100;

interface SourceSummary {
  id: string;
  name: string;
  abbr?: string;
  kind?: string;
  homepage?: string;
  description?: string;
  candidateCount?: number;
  importedCount?: number;
  availableCount?: number;
}

interface SourcesIndex {
  generatedAt?: string;
  catalogTotal?: number;
  sources?: SourceSummary[];
  crossSourceDuplicates?: { streamUrl?: string; sources?: string[]; entries?: { sourceId?: string; name?: string }[] }[];
}

interface Candidate {
  stationuuid?: string;
  name?: string;
  country?: string;
  votes?: number;
  clickcount?: number;
  verdict?: string | null;
  disposition?: string;
  duplicateOf?: string | null;
  duplicateOfName?: string | null;
  duplicateVia?: string | null;
  matchedCatalogId?: string | null;
  streamHost?: string;
  streamUrl?: string;
  homepage?: string;
}

interface SourceDetail {
  generatedAt?: string;
  counts?: { candidateTotal?: number; imported?: number; available?: number };
  verdictTotals?: Record<string, number>;
  importedWithoutCountryAnalysis?: { catalogId?: string; name?: string; country?: string }[];
  families?: { total?: number; totalMembers?: number; list?: { key?: string; name?: string; members?: number }[] };
}

type Disposition = '' | 'imported' | 'available' | 'duplicate' | 'broken' | 'unprobed';

const cache = new Map<string, unknown>();
async function getJson<T>(path: string): Promise<T> {
  if (cache.has(path)) return cache.get(path) as T;
  const res = await fetch(`${BASE}${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  const data = (await res.json()) as T;
  cache.set(path, data);
  return data;
}

function isPlayable(verdict: string | null | undefined): boolean {
  return verdict === 'ok' || verdict === 'ok-hls' || verdict === 'needs-playlist';
}

const DISPOSITIONS = new Set(['imported', 'available', 'duplicate', 'broken', 'unprobed']);

function dispositionOf(c: Candidate): Exclude<Disposition, ''> {
  // build-sources stamps the authoritative disposition (it also demotes
  // surplus same-stream rows to duplicate); fall back to the local
  // derivation for artifacts built before the stamp existed.
  if (c.disposition && DISPOSITIONS.has(c.disposition)) return c.disposition as Exclude<Disposition, ''>;
  if (c.matchedCatalogId) return 'imported';
  if (c.duplicateOf) return 'duplicate';
  if (!c.verdict) return 'unprobed';
  if (isPlayable(c.verdict)) return 'available';
  return 'broken';
}

function verdictBadgeFor(verdict: string | null | undefined): HTMLElement {
  if (!verdict) return badge('unprobed', 'muted');
  if (verdict === 'ok' || verdict === 'ok-hls') return badge(verdict, 'success');
  if (verdict === 'needs-playlist' || verdict === 'redirect-downgrade' || verdict === 'probe-inconclusive') {
    return badge(verdict, 'warning');
  }
  return badge(verdict, 'error');
}

interface SourcesState {
  sourceId: string;
  q: string;
  cc: string;
  disposition: Disposition;
  sort: string;
  page: number;
}

const state: SourcesState = { sourceId: 'radio-browser', q: '', cc: '', disposition: 'available', sort: 'votes', page: 0 };

export async function renderSources(root: HTMLElement): Promise<void> {
  root.replaceChildren(loading());
  const index = await getJson<SourcesIndex>('sources.json');
  const sources = index.sources ?? [];
  if (!sources.length) {
    root.replaceChildren(emptyState('No sources.json — run `npm run build-sources`.'));
    return;
  }
  if (!sources.some((s) => s.id === state.sourceId)) state.sourceId = sources[0].id;

  const frag = document.createDocumentFragment();

  // ── Source summary cards ───────────────────────────────────────
  frag.append(sectionHeader('Upstream sources', `catalog holds ${fmtInt(index.catalogTotal ?? 0)} published stations`));
  const grid = el('div', { class: 'stats-grid' });
  for (const s of sources) {
    grid.append(
      statCard({
        value: fmtInt(s.candidateCount ?? 0),
        label: `${s.name} candidates`,
        sub: `${fmtInt(s.importedCount ?? 0)} imported · ${fmtInt(s.availableCount ?? 0)} available`,
        tone: s.id === state.sourceId ? 'accent' : undefined,
        title: s.description ?? '',
      }),
    );
  }
  frag.append(grid);

  // ── Per-source detail + candidates ─────────────────────────────
  const detailHost = el('div', {});
  frag.append(detailHost);
  root.replaceChildren(frag);

  await renderSourceSection(detailHost, sources);

  // ── Cross-source duplicates ────────────────────────────────────
  const xdupes = index.crossSourceDuplicates ?? [];
  if (xdupes.length) {
    const list = el('ul', { class: 'plain-list' });
    for (const d of xdupes.slice(0, 50)) {
      list.append(
        el(
          'li',
          {},
          el('code', {}, d.streamUrl ?? '?'),
          el('span', { class: 'facet-detail' }, (d.entries ?? []).map((e) => `${e.sourceId}: ${e.name}`).join(' · ')),
        ),
      );
    }
    root.append(sectionHeader('Cross-source duplicates', 'one stream URL imported from multiple sources'), list);
  }

  root.append(explainer());
}

async function renderSourceSection(host: HTMLElement, sources: SourceSummary[]): Promise<void> {
  host.replaceChildren(loading('Loading candidates…'));
  const [detail, candidatesRaw] = await Promise.all([
    getJson<SourceDetail>(`sources/${state.sourceId}.json`),
    getJson<Candidate[] | { candidates?: Candidate[] }>(`sources/${state.sourceId}-candidates.json`),
  ]);
  const candidates = Array.isArray(candidatesRaw) ? candidatesRaw : (candidatesRaw.candidates ?? []);

  const wrap = el('div', { class: 'stack' });

  // Verdict tally chips for the active source.
  const tallies = el('div', { class: 'chip-row' });
  const totals = detail.verdictTotals ?? {};
  for (const [verdict, count] of Object.entries(totals).sort((a, b) => b[1] - a[1])) {
    const cls = isPlayable(verdict) ? 'is-fresh' : verdict.startsWith('broken') ? 'is-dead' : 'is-stale';
    tallies.append(el('span', { class: `chip ${cls}` }, `${verdict} · ${fmtInt(count)}`));
  }
  wrap.append(sectionHeader('Probe verdicts', `source: ${state.sourceId}`), tallies);

  // Filters
  const sourceSelect = el('select', {});
  for (const s of sources) sourceSelect.append(new Option(s.name, s.id));
  sourceSelect.value = state.sourceId;
  sourceSelect.addEventListener('change', () => {
    state.sourceId = sourceSelect.value;
    state.page = 0;
    void renderSourceSection(host, sources);
  });

  const search = el('input', { type: 'search', placeholder: 'name, uuid, host, catalog id…', value: state.q });
  let debounce: number | null = null;
  search.addEventListener('input', () => {
    if (debounce !== null) window.clearTimeout(debounce);
    debounce = window.setTimeout(() => {
      state.q = search.value.trim().toLowerCase();
      state.page = 0;
      renderTable();
    }, 250);
  });

  const ccSelect = el('select', {});
  ccSelect.append(new Option('All', ''));
  const ccCounts = new Map<string, number>();
  for (const c of candidates) {
    const cc = (c.country ?? '').toUpperCase();
    if (cc) ccCounts.set(cc, (ccCounts.get(cc) ?? 0) + 1);
  }
  for (const [cc, n] of [...ccCounts.entries()].sort((a, b) => b[1] - a[1])) {
    ccSelect.append(new Option(`${cc} — ${countryName(cc)} (${fmtInt(n)})`, cc));
  }
  ccSelect.value = state.cc;
  ccSelect.addEventListener('change', () => {
    state.cc = ccSelect.value;
    state.page = 0;
    renderTable();
  });

  const dispSelect = el('select', {});
  for (const [label, value] of [
    ['All candidates', ''],
    ['Available (playable, not imported)', 'available'],
    ['Imported', 'imported'],
    ['Duplicates', 'duplicate'],
    ['Broken', 'broken'],
    ['Unprobed', 'unprobed'],
  ]) {
    dispSelect.append(new Option(label, value));
  }
  dispSelect.value = state.disposition;
  dispSelect.addEventListener('change', () => {
    state.disposition = dispSelect.value as Disposition;
    state.page = 0;
    renderTable();
  });

  const sortSelect = el('select', {});
  for (const [label, value] of [
    ['Votes ↓', 'votes'],
    ['Clicks ↓', 'clicks'],
    ['Name', 'name'],
    ['Country', 'country'],
  ]) {
    sortSelect.append(new Option(label, value));
  }
  sortSelect.value = state.sort;
  sortSelect.addEventListener('change', () => {
    state.sort = sortSelect.value;
    state.page = 0;
    renderTable();
  });

  wrap.append(
    el(
      'div',
      { class: 'filter-bar' },
      el('label', { class: 'filter' }, 'Source', sourceSelect),
      el('label', { class: 'filter grow' }, 'Search', search),
      el('label', { class: 'filter' }, 'Country', ccSelect),
      el('label', { class: 'filter' }, 'Disposition', dispSelect),
      el('label', { class: 'filter' }, 'Sort', sortSelect),
    ),
  );

  // Table
  const tablePanel = el('section', { class: 'table-panel' });
  wrap.append(tablePanel);

  function renderTable(): void {
    let rows = candidates;
    if (state.cc) rows = rows.filter((c) => (c.country ?? '').toUpperCase() === state.cc);
    if (state.disposition) rows = rows.filter((c) => dispositionOf(c) === state.disposition);
    if (state.q) {
      const matches = searchMatcher(state.q);
      rows = rows.filter((c) => matches(c.name, c.stationuuid, c.streamHost, c.matchedCatalogId));
    }
    rows = [...rows];
    if (state.sort === 'clicks') rows.sort((a, b) => (b.clickcount ?? 0) - (a.clickcount ?? 0));
    else if (state.sort === 'name') rows.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
    else if (state.sort === 'country') rows.sort((a, b) => (a.country ?? '').localeCompare(b.country ?? '') || (b.votes ?? 0) - (a.votes ?? 0));
    else rows.sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0));

    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    if (state.page >= pages) state.page = pages - 1;
    const slice = rows.slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE);

    const tbody = el('tbody', {});
    for (const c of slice) {
      const dispo = dispositionOf(c);
      const tr = el('tr', {});
      tr.append(
        el(
          'td',
          { class: 'cell-station' },
          el('span', { class: 'title' }, c.name ?? '?'),
          el('span', { class: 'sub' }, c.streamHost ?? ''),
        ),
        el('td', { title: c.country ? countryName(c.country.toUpperCase()) : '' }, (c.country ?? '—').toUpperCase()),
        el('td', { class: 'num' }, fmtInt(c.votes ?? 0)),
        el('td', { class: 'num' }, fmtInt(c.clickcount ?? 0)),
        el('td', {}, verdictBadgeFor(c.verdict)),
        el(
          'td',
          {},
          dispo === 'imported' && c.matchedCatalogId
            ? el('a', { href: stationHref(c.matchedCatalogId) }, c.matchedCatalogId)
            : dispo === 'duplicate'
              ? el(
                  'span',
                  { class: 'facet-detail', title: c.duplicateVia ?? '' },
                  `dup of ${c.duplicateOfName ?? c.duplicateOf ?? c.matchedCatalogId ?? '?'}`,
                )
              : badge(dispo, dispo === 'available' ? 'primary' : 'muted'),
        ),
        el(
          'td',
          {},
          c.streamUrl ? el('a', { href: c.streamUrl, target: '_blank', rel: 'noopener noreferrer' }, 'stream') : null,
          ' ',
          c.homepage ? el('a', { href: c.homepage, target: '_blank', rel: 'noopener noreferrer' }, 'home') : null,
        ),
      );
      tbody.append(tr);
    }

    const prev = el('button', { type: 'button' }, 'Prev');
    const next = el('button', { type: 'button' }, 'Next');
    prev.disabled = state.page === 0;
    next.disabled = state.page >= pages - 1;
    prev.addEventListener('click', () => {
      state.page -= 1;
      renderTable();
    });
    next.addEventListener('click', () => {
      state.page += 1;
      renderTable();
    });

    tablePanel.replaceChildren(
      el(
        'div',
        { class: 'table-toolbar' },
        el('span', {}, `${fmtInt(rows.length)} candidate(s)`),
        el('span', { class: 'spacer' }),
        el('div', { class: 'pager' }, prev, el('span', {}, `${state.page + 1} / ${pages}`), next),
      ),
      el(
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
              el('th', {}, 'Candidate'),
              el('th', {}, 'CC'),
              el('th', {}, 'Votes'),
              el('th', {}, 'Clicks'),
              el('th', {}, 'Probe'),
              el('th', {}, 'Disposition'),
              el('th', {}, 'Links'),
            ),
          ),
          tbody,
        ),
      ),
    );
  }
  renderTable();

  // Orphans + families (collapsed)
  const orphans = detail.importedWithoutCountryAnalysis ?? [];
  if (orphans.length) {
    const list = el('ul', { class: 'plain-list' });
    for (const o of orphans) {
      list.append(
        el(
          'li',
          {},
          o.catalogId ? el('a', { href: stationHref(o.catalogId) }, o.catalogId) : el('span', {}, o.name ?? '?'),
          el('span', { class: 'facet-detail' }, `${o.name ?? ''} (${o.country ?? '?'})`),
        ),
      );
    }
    wrap.append(sectionHeader('Imported without country analysis', 'no rb-analysis verdict backs these imports'), list);
  }

  const families = detail.families;
  if (families?.list?.length) {
    const list = el('ul', { class: 'plain-list' });
    for (const f of families.list.slice(0, 60)) {
      list.append(
        el('li', {}, el('span', {}, f.name ?? f.key ?? '?'), el('span', { class: 'when' }, `${fmtInt(f.members ?? 0)} members`)),
      );
    }
    const details = el('details', {});
    details.append(
      el('summary', { class: 'section-header' }, `Brand families · ${fmtInt(families.total ?? 0)} groups, ${fmtInt(families.totalMembers ?? 0)} members`),
      list,
    );
    wrap.append(details);
  }

  host.replaceChildren(wrap);
}

function explainer(): HTMLElement {
  const details = el('details', {});
  const body = el('div', { class: 'process' });
  body.append(
    el(
      'p',
      {},
      'Dedupe runs in three layers: ',
      el('strong', {}, 'FEED'),
      ' (byte-identical streams collapse to one row), ',
      el('strong', {}, 'FAMILY'),
      ' (regional or sub-brand siblings of one broadcaster group together), ',
      el('strong', {}, 'DISTINCT'),
      ' (everything else stands alone).',
    ),
    el(
      'p',
      {},
      'Identity signals are tried strongest-first: stationuuid → exact stream URL → normalised stream fingerprint → name+host signature → family tag. ',
      'A candidate marked "dup of …" lost to a stronger row under one of these signals; overrides live in data/sources/radio-browser/overrides.yaml.',
    ),
  );
  details.append(el('summary', { class: 'section-header' }, 'How dedupe decides'), body);
  return details;
}
