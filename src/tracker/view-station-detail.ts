/**
 * Station detail — everything the console knows about one station, ready to
 * act on. Deep-linkable: #/station/<id>.
 */

import { countryName } from '../country';
import {
  FACETS,
  FACET_LABEL,
  loadDriftById,
  loadDuplicateGroupsById,
  loadRowById,
} from './data';
import type { StationRow } from './data';
import { stationHref, stationsHref } from './router';
import { copyButton, cspSafeFavicon, el, emptyState, externalLink, loading, sectionHeader, verdictBadge } from './ui';

export async function renderStationDetail(root: HTMLElement, id: string): Promise<void> {
  root.replaceChildren(loading());
  const [rowById, driftById, dupsById] = await Promise.all([
    loadRowById(),
    loadDriftById(),
    loadDuplicateGroupsById(),
  ]);
  const row = rowById.get(id);
  if (!row) {
    root.replaceChildren(
      el('a', { class: 'back-link', href: '#/stations' }, '← stations'),
      emptyState(`No station "${id}" in the published catalog.`),
    );
    return;
  }
  const s = row.station;

  const frag = document.createDocumentFragment();
  frag.append(el('a', { class: 'back-link', href: '#/stations' }, '← stations'));

  // ── Header ─────────────────────────────────────────────────────
  const head = el('div', { class: 'detail-head' });
  head.append(logoPreview(s.favicon));
  const sub = el('div', { class: 'detail-sub' });
  sub.append(
    el('code', {}, s.id),
    el('span', { class: 'badge badge-muted' }, s.status ?? '?'),
    el('span', {}, s.country ? `${s.country.toUpperCase()} · ${countryName(s.country.toUpperCase())}` : '—'),
  );
  if (row.source) {
    sub.append(
      el(
        'a',
        { class: 'badge badge-muted', href: stationsHref({ source: row.source }), title: 'catalog source (data/sources.yaml)' },
        `src: ${row.source}`,
      ),
    );
  }
  if (s.broadcaster) sub.append(el('span', {}, `broadcaster: ${s.broadcaster}`));
  if (s.tags?.length) sub.append(el('span', {}, s.tags.slice(0, 6).join(' · ')));
  head.append(el('div', {}, el('h2', {}, s.name), sub));
  frag.append(head);

  // ── Actions ────────────────────────────────────────────────────
  const actions = el('div', { class: 'action-row' });
  actions.append(
    copyButton('copy id', () => s.id),
    copyButton('copy probe cmd', () => `npm run health -- --only ${s.id}`),
    externalLink('stream', s.streamUrl),
  );
  if (s.homepage) actions.append(externalLink('homepage', s.homepage));
  const driftEntry = driftById.get(id);
  if (driftEntry?.stationuuid) {
    actions.append(
      externalLink('RB record', `https://de1.api.radio-browser.info/json/stations/byuuid?uuids=${driftEntry.stationuuid}`),
    );
  }
  frag.append(actions);

  // ── Panels ─────────────────────────────────────────────────────
  const grid = el('div', { class: 'panel-grid' });
  grid.append(healthPanel(row));
  grid.append(streamPanel(row));
  grid.append(logoPanel(row));
  grid.append(rbPanel(row, driftEntry));
  const dupPanel = duplicatesPanel(id, dupsById.get(id) ?? []);
  if (dupPanel) grid.append(dupPanel);
  frag.append(sectionHeader('Details'), grid);

  root.replaceChildren(frag);
}

function logoPreview(favicon: string | undefined): HTMLElement {
  const url = cspSafeFavicon(favicon);
  if (!url) return el('span', { class: 'logo-preview thumb-fallback' }, favicon ? 'http' : '·');
  const img = el('img', { class: 'logo-preview', src: url, alt: '' });
  img.addEventListener('error', () => img.replaceWith(el('span', { class: 'logo-preview thumb-fallback' }, '?')));
  return img;
}

function healthPanel(row: StationRow): HTMLElement {
  const list = el('div', { class: 'facet-list' });
  for (const facet of FACETS) {
    const entry = row.facets[facet];
    const r = el('div', { class: 'facet-row' });
    r.append(el('span', { class: 'facet-name' }, FACET_LABEL[facet]));
    if (!entry) {
      r.append(el('span', { class: 'badge badge-muted' }, 'unchecked'));
    } else {
      r.append(verdictBadge(entry.v));
      if (entry.d) r.append(el('span', { class: 'facet-detail' }, entry.d));
      r.append(el('span', { class: 'facet-since' }, `since ${entry.since}`));
    }
    list.append(r);
  }
  return el('section', { class: 'panel' }, el('h3', { class: 'panel-title' }, 'Health facets'), list);
}

function kvList(pairs: [string, Node | string | null | undefined][]): HTMLElement {
  const dl = el('dl', { class: 'kv' });
  for (const [k, v] of pairs) {
    if (v == null || v === '') continue;
    dl.append(el('dt', {}, k), el('dd', {}, v));
  }
  return dl;
}

function streamPanel(row: StationRow): HTMLElement {
  const s = row.station;
  return el(
    'section',
    { class: 'panel' },
    el('h3', { class: 'panel-title' }, 'Stream & metadata'),
    kvList([
      ['stream', el('code', {}, s.streamUrl)],
      ['codec', s.codec],
      ['bitrate', s.bitrate ? `${s.bitrate} kbps` : null],
      ['fetcher key', s.metadata ?? 'generic (ICY)'],
      ['metadata url', s.metadataUrl ? el('code', {}, s.metadataUrl) : null],
      ['homepage', s.homepage ? el('a', { href: s.homepage, target: '_blank', rel: 'noopener noreferrer' }, s.homepage) : null],
    ]),
  );
}

function logoPanel(row: StationRow): HTMLElement {
  const s = row.station;
  const logo = row.logo;
  const facet = row.facets.logo;
  const size =
    logo?.probeWidth && logo?.probeHeight
      ? `${logo.probeWidth}×${logo.probeHeight}px${logo.probeBytes ? ` · ${Math.round(logo.probeBytes / 1024)} KB` : ''}`
      : null;
  return el(
    'section',
    { class: 'panel' },
    el('h3', { class: 'panel-title' }, 'Logo provenance'),
    kvList([
      ['favicon', s.favicon ? el('code', {}, s.favicon) : 'none'],
      ['state', facet ? `${facet.v}${facet.d ? ` — ${facet.d}` : ''}` : 'unchecked'],
      ['tier', logo?.tier],
      ['source', logo?.faviconSource ?? null],
      [
        'original',
        logo?.faviconSourceUrl
          ? el('a', { href: logo.faviconSourceUrl, target: '_blank', rel: 'noopener noreferrer' }, logo.faviconSourceUrl)
          : null,
      ],
      ['license', logo?.faviconLicense],
      ['measured', size],
      ['probe error', logo?.probeError],
      ['next action', logo?.action],
    ]),
  );
}

function rbPanel(row: StationRow, drift: import('./data').DriftEntry | undefined): HTMLElement {
  const facet = row.facets.drift;
  // The published catalog deliberately omits the RB binding fields
  // (stationuuid / changeuuid / reviewedAt live in data/stations.yaml);
  // what the console knows client-side is the drift facet + the drift
  // report row when this station drifted.
  const pairs: [string, Node | string | null | undefined][] = [
    ['binding', facet?.v === 'na' ? 'not RB-bound' : 'RB-bound (uuid in data/stations.yaml)'],
    ['stationuuid', drift?.stationuuid ? el('code', {}, drift.stationuuid) : null],
    ['drift', facet ? `${facet.v}${facet.d ? ` — ${facet.d}` : ''} (since ${facet.since})` : 'unchecked'],
  ];
  const panel = el('section', { class: 'panel' }, el('h3', { class: 'panel-title' }, 'Radio Browser binding'), kvList(pairs));
  if (drift?.upstream && Object.keys(drift.upstream).length) {
    const dl = el('dl', { class: 'kv' });
    for (const [field, value] of Object.entries(drift.upstream)) {
      dl.append(el('dt', {}, field), el('dd', { class: 'muted' }, String(value)));
    }
    panel.append(el('h3', { class: 'panel-title' }, 'Upstream values (drifted)'), dl);
  }
  return panel;
}

function duplicatesPanel(id: string, groups: import('./data').DuplicateGroup[]): HTMLElement | null {
  if (!groups.length) return null;
  const panel = el('section', { class: 'panel' }, el('h3', { class: 'panel-title' }, 'Duplicate groups'));
  for (const g of groups) {
    const list = el('ul', { class: 'plain-list' });
    for (const e of g.entries) {
      list.append(
        el(
          'li',
          {},
          e.id === id ? el('strong', {}, e.id) : el('a', { href: stationHref(e.id) }, e.id),
          e.name ? el('span', { class: 'facet-detail' }, e.name) : null,
        ),
      );
    }
    panel.append(
      el(
        'div',
        {},
        el('span', { class: `badge ${g.severity === 'blocking' ? 'badge-error' : 'badge-warning'}` }, g.severity),
        ' ',
        el('span', { class: 'facet-detail' }, (g.signalKinds ?? []).join(', ')),
      ),
      list,
    );
  }
  panel.append(
    el('a', { class: 'back-link', href: stationsHref({ facet: 'duplicate', v: 'problem' }) }, 'all duplicate problems →'),
  );
  return panel;
}
