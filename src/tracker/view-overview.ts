/** Overview — is the catalog healthy, and is our knowledge fresh? */

import { FACETS, FACET_LABEL, facetTally, loadHealth, loadRows, loadSourcesIndex } from './data';
import type { SourceSummary, StationRow } from './data';
import { stationHref, stationsHref } from './router';
import { ageDays, ageLabel, el, emptyState, fmtInt, freshnessClass, loading, sectionHeader, statCard } from './ui';

export async function renderOverview(root: HTMLElement): Promise<void> {
  root.replaceChildren(loading());
  const [rows, health, sourcesIndex] = await Promise.all([loadRows(), loadHealth(), loadSourcesIndex()]);

  const frag = document.createDocumentFragment();

  // ── Catalog shape ──────────────────────────────────────────────
  const byStatus = new Map<string, number>();
  const countries = new Set<string>();
  for (const r of rows) {
    byStatus.set(r.station.status ?? '?', (byStatus.get(r.station.status ?? '?') ?? 0) + 1);
    if (r.station.country) countries.add(r.station.country);
  }
  frag.append(sectionHeader('Catalog', 'published stations by curation status'));
  const catalogGrid = el('div', { class: 'stats-grid' });
  catalogGrid.append(
    statCard({ value: fmtInt(rows.length), label: 'stations', tone: 'accent', href: stationsHref({}) }),
    statCard({
      value: fmtInt(byStatus.get('working') ?? 0),
      label: 'working',
      sub: 'stream + metadata + cover',
      href: stationsHref({ status: 'working' }),
    }),
    statCard({
      value: fmtInt(byStatus.get('icy-only') ?? 0),
      label: 'icy-only',
      sub: 'ICY title, no fetcher',
      href: stationsHref({ status: 'icy-only' }),
    }),
    statCard({
      value: fmtInt(byStatus.get('stream-only') ?? 0),
      label: 'stream-only',
      sub: 'plays, no metadata source',
      href: stationsHref({ status: 'stream-only' }),
    }),
    statCard({ value: fmtInt(countries.size), label: 'countries' }),
  );
  frag.append(catalogGrid);

  // ── Provenance ─────────────────────────────────────────────────
  // (The all-known-stations donut lives on the Stations page — the
  // dashboard sits directly above the list it filters.)
  // Published stations per source (data/sources.yaml registry). Registry
  // sources with zero published stations still get a card so empty
  // pipelines (e.g. user suggestions) stay visible.
  const bySource = new Map<string, number>();
  for (const r of rows) {
    if (r.source) bySource.set(r.source, (bySource.get(r.source) ?? 0) + 1);
  }
  const registry: SourceSummary[] = sourcesIndex?.sources ?? [];
  if (bySource.size || registry.length) {
    frag.append(sectionHeader('Provenance', 'published stations by source — see the Sources view for the upstream inventory'));
    const provGrid = el('div', { class: 'stats-grid' });
    const knownIds = new Set(registry.map((s) => s.id));
    const cards: { id: string; summary?: SourceSummary }[] = [
      ...registry.map((s) => ({ id: s.id, summary: s })),
      ...[...bySource.keys()].filter((id) => !knownIds.has(id)).map((id) => ({ id })),
    ];
    for (const { id, summary } of cards) {
      const published = bySource.get(id) ?? 0;
      const sub = summary?.candidateCount
        ? `of ${fmtInt(summary.candidateCount)} candidates · ${fmtInt(summary.availableCount ?? 0)} available`
        : summary?.kind === 'user-suggestion'
          ? 'no open suggestions'
          : '';
      provGrid.append(
        statCard({
          value: fmtInt(published),
          label: summary?.name ?? id,
          sub,
          href: published > 0 ? stationsHref({ source: id }) : '#/sources',
          title: summary?.description ?? '',
        }),
      );
    }
    frag.append(provGrid);
  }

  if (!health) {
    frag.append(
      sectionHeader('Health'),
      emptyState('No station-health.json — run `npm run health-import` once, then `npm run health`.'),
    );
    root.replaceChildren(frag);
    return;
  }

  // ── Check freshness ────────────────────────────────────────────
  frag.append(sectionHeader('Check freshness', 'when each facet was last verified — fresh <8d · stale <30d'));
  const chipRow = el('div', { class: 'chip-row' });
  for (const facet of FACETS) {
    const run = health.runs[facet];
    if (!run) {
      chipRow.append(
        el('span', { class: 'chip is-dead', title: `${FACET_LABEL[facet]}: never checked` }, `${FACET_LABEL[facet]} · never`),
      );
      continue;
    }
    const days = ageDays(run.lastRun);
    // 'rolling' is the derive-health scope (ADR 002): every station is
    // observed within the week, so it is full coverage, not a partial pass.
    const partial = run.scope === 'full' || run.scope === 'rolling' ? '' : ' (partial)';
    chipRow.append(
      el(
        'span',
        {
          class: `chip ${freshnessClass(days)}`,
          title: `${run.tool} · ${fmtInt(run.checked)} station(s) · ${new Date(run.lastRun).toLocaleString()} · scope ${run.scope}`,
        },
        `${FACET_LABEL[facet]} · ${days <= 0 ? 'today' : `${days}d`}${partial}`,
      ),
    );
  }
  frag.append(chipRow);

  // ── Problems by facet ──────────────────────────────────────────
  // Counts come from the per-station rows (facetTally), NOT
  // health.runs[facet].tally: a partial run (e.g. a --cc repair) leaves the
  // runs header covering only its own scope, which understates the true
  // catalog-wide totals. Freshness above still reads the runs header.
  frag.append(sectionHeader('Problems by facet', 'click a card for the filtered station list'));
  const tallies = facetTally(rows);
  const problemGrid = el('div', { class: 'stats-grid' });
  for (const facet of FACETS) {
    const t = tallies[facet];
    const covered = t.ok + t.warn + t.bad + t.na;
    if (!covered) continue;
    problemGrid.append(
      statCard({
        value: fmtInt(t.bad),
        label: `${FACET_LABEL[facet]} bad`,
        sub: `${fmtInt(t.warn)} warn · ${fmtInt(covered)} checked`,
        tone: t.bad > 0 ? 'bad' : 'ok',
        href: stationsHref({ facet, v: t.bad > 0 ? 'bad' : 'warn' }),
      }),
    );
  }
  frag.append(problemGrid);

  // ── Recent transitions ─────────────────────────────────────────
  const cutoff = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
  const recent = rows
    .filter((r) => r.lastChange >= cutoff && (r.badCount > 0 || r.warnCount > 0))
    .sort((a, b) => b.lastChange.localeCompare(a.lastChange) || b.badCount - a.badCount)
    .slice(0, 15);
  frag.append(sectionHeader('Changed in the last 14 days', 'verdict transitions with open problems'));
  frag.append(recent.length ? transitionList(recent) : emptyState('No problem transitions in the window.'));

  // ── Worst offenders ────────────────────────────────────────────
  const worst = [...rows].sort((a, b) => b.badCount - a.badCount || b.warnCount - a.warnCount).slice(0, 15);
  if ((worst[0]?.badCount ?? 0) > 0) {
    frag.append(sectionHeader('Worst offenders', 'most failing facets'));
    frag.append(transitionList(worst.filter((r) => r.badCount > 0)));
  }

  root.replaceChildren(frag);
}

function transitionList(rows: StationRow[]): HTMLElement {
  const list = el('ul', { class: 'plain-list' });
  for (const r of rows) {
    const badFacets = FACETS.filter((f) => r.facets[f]?.v === 'bad');
    const warnFacets = FACETS.filter((f) => r.facets[f]?.v === 'warn');
    const li = el('li', {});
    li.append(
      el('a', { href: stationHref(r.station.id) }, r.station.name),
      el('span', { class: 'badge badge-muted' }, r.station.country ?? '—'),
    );
    for (const f of badFacets.slice(0, 3)) {
      li.append(el('span', { class: 'badge badge-error', title: r.facets[f]?.d ?? '' }, FACET_LABEL[f]));
    }
    if (badFacets.length === 0) {
      for (const f of warnFacets.slice(0, 3)) {
        li.append(el('span', { class: 'badge badge-warning', title: r.facets[f]?.d ?? '' }, FACET_LABEL[f]));
      }
    }
    li.append(el('span', { class: 'when' }, r.lastChange ? ageLabel(r.lastChange) : ''));
    list.append(li);
  }
  if (!list.childElementCount) return emptyState('Nothing here.');
  return list;
}
