/** Shared DOM building blocks for the tracker console. */

import type { FacetEntry, Verdict } from './data';

type Child = Node | string | null | undefined;

/** Element factory: el('div', { class: 'x', title: 'y' }, ...children). */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children) {
    if (c == null) continue;
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export function fmtInt(n: number): string {
  return n.toLocaleString('en-US');
}

export function ageDays(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

export function freshnessClass(days: number): 'is-fresh' | 'is-stale' | 'is-dead' {
  if (days < 8) return 'is-fresh';
  if (days < 30) return 'is-stale';
  return 'is-dead';
}

export function ageLabel(iso: string): string {
  const days = ageDays(iso);
  return days <= 0 ? 'today' : `${days}d ago`;
}

const GLYPH: Record<Verdict, string> = { ok: '✓', warn: '~', bad: '✗', na: '·' };
const VERDICT_WORD: Record<Verdict, string> = { ok: 'ok', warn: 'warn', bad: 'bad', na: 'n/a — check does not apply' };

/** Compact verdict pill for table cells; tooltip carries facet, verdict,
 *  detail, and the date the verdict last changed. */
export function verdictPill(entry: FacetEntry | undefined, facetLabel?: string): HTMLElement {
  const prefix = facetLabel ? `${facetLabel}: ` : '';
  if (!entry) {
    return el('span', { class: 'pill v-none', title: `${prefix}not checked yet` }, '—');
  }
  return el(
    'span',
    {
      class: `pill v-${entry.v}`,
      title: `${prefix}${VERDICT_WORD[entry.v]}${entry.d ? ` — ${entry.d}` : ''}${entry.since ? ` (since ${entry.since})` : ''}`,
    },
    GLYPH[entry.v],
  );
}

export function badge(text: string, kind: 'primary' | 'success' | 'warning' | 'error' | 'info' | 'muted'): HTMLElement {
  return el('span', { class: `badge badge-${kind}` }, text);
}

export function verdictBadge(v: Verdict): HTMLElement {
  const kind = v === 'ok' ? 'success' : v === 'warn' ? 'warning' : v === 'bad' ? 'error' : 'muted';
  return badge(v, kind);
}

export function sectionHeader(title: string, hint?: string): HTMLElement {
  return el('h2', { class: 'section-header' }, title, hint ? el('span', { class: 'hint' }, hint) : null);
}

export interface StatCardOpts {
  value: string;
  label: string;
  sub?: string;
  tone?: 'bad' | 'warn' | 'ok' | 'accent';
  href?: string;
  title?: string;
}

export function statCard(opts: StatCardOpts): HTMLElement {
  const tag = opts.href ? 'a' : 'div';
  const card = el(tag as 'div', { class: `stat-card${opts.tone ? ` tone-${opts.tone}` : ''}${opts.href ? ' is-link' : ''}` });
  if (opts.href) card.setAttribute('href', opts.href);
  if (opts.title) card.title = opts.title;
  card.append(
    el('span', { class: 'value' }, opts.value),
    el('span', { class: 'label' }, opts.label),
  );
  if (opts.sub) card.append(el('span', { class: 'sub' }, opts.sub));
  return card;
}

/** True when a favicon URL may load under this page's CSP (no http://). */
export function cspSafeFavicon(favicon: string | undefined): string | null {
  const url = favicon?.trim();
  return url && /^(https:\/\/|stations\/|favicons\/)/.test(url) ? url : null;
}

/** Station logo thumbnail with graceful fallback (CSP blocks http:// images). */
export function logoThumb(favicon: string | undefined): HTMLElement {
  const url = cspSafeFavicon(favicon);
  if (!url) {
    return el('span', { class: 'thumb-fallback' }, favicon ? 'http' : '·');
  }
  const img = el('img', { class: 'thumb', src: url, alt: '', loading: 'lazy' });
  img.addEventListener('error', () => {
    img.replaceWith(el('span', { class: 'thumb-fallback' }, '?'));
  });
  return img;
}

/** Button that copies text and confirms inline. */
export function copyButton(label: string, text: () => string): HTMLElement {
  const btn = el('button', { class: 'btn', type: 'button' }, label);
  btn.addEventListener('click', () => {
    void navigator.clipboard.writeText(text()).then(() => {
      btn.classList.add('copied');
      const prev = btn.textContent;
      btn.textContent = 'copied';
      window.setTimeout(() => {
        btn.classList.remove('copied');
        btn.textContent = prev;
      }, 1200);
    });
  });
  return btn;
}

export function externalLink(label: string, href: string): HTMLElement {
  return el('a', { class: 'btn', href, target: '_blank', rel: 'noopener noreferrer' }, label, ' ↗');
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag: string, attrs: Record<string, string> = {}): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

export interface DonutSegment {
  label: string;
  count: number;
  /** Suffix for the CSS classes donut-seg-<key> / swatch-<key>. */
  key: string;
  href?: string;
  /** Highlight this segment as the current selection. */
  active?: boolean;
}

export interface DonutOpts {
  /** Make the legend's total row a link (e.g. "show everything"). */
  totalHref?: string;
  totalActive?: boolean;
}

/** Donut chart + legend. Segments are SVG strokes (crisp at any size,
 *  CSP-safe — presentation attributes, no inline style). The center shows
 *  the first segment's share of the total. Segments with an href are
 *  clickable (SVG <a>), as are their legend rows. */
export function donut(label: string, segments: DonutSegment[], opts: DonutOpts = {}): HTMLElement {
  const total = segments.reduce((sum, s) => sum + s.count, 0);

  const svg = svgEl('svg', { viewBox: '0 0 64 64', role: 'img', class: 'donut' });
  const title = svgEl('title');
  title.textContent = `${label} (${fmtInt(total)})`;
  svg.append(title);

  // Background ring + segments share the same geometry. pathLength=100
  // lets the percentage drive stroke-dasharray directly.
  const ring = { cx: '32', cy: '32', r: '26', fill: 'none', 'stroke-width': '10', pathLength: '100' };
  svg.append(svgEl('circle', { ...ring, class: 'donut-bg' }));
  let offset = 0;
  for (const seg of segments) {
    const pct = total > 0 ? (seg.count / total) * 100 : 0;
    if (pct <= 0) continue;
    const arc = svgEl('circle', {
      ...ring,
      class: `donut-seg donut-seg-${seg.key}${seg.active ? ' is-active' : ''}`,
      'stroke-dasharray': `${pct} ${100 - pct}`,
      'stroke-dashoffset': String(-offset),
      transform: 'rotate(-90 32 32)',
    });
    const segTitle = svgEl('title');
    segTitle.textContent = `${seg.label}: ${fmtInt(seg.count)} (${pct.toFixed(1)}%)${seg.href ? ' — click to show below' : ''}`;
    arc.append(segTitle);
    if (seg.href) {
      const link = svgEl('a', { href: seg.href, class: 'donut-arc-link' });
      link.append(arc);
      svg.append(link);
    } else {
      svg.append(arc);
    }
    offset += pct;
  }
  const primaryPct = total > 0 && segments[0] ? Math.round((segments[0].count / total) * 100) : 0;
  const center = svgEl('text', {
    x: '32',
    y: '32',
    'text-anchor': 'middle',
    'dominant-baseline': 'central',
    class: 'donut-center',
  });
  center.textContent = total > 0 ? `${primaryPct}%` : '–';
  svg.append(center);

  const legend = el('ul', { class: 'donut-legend' });
  for (const seg of segments) {
    const pct = total > 0 ? ((seg.count / total) * 100).toFixed(1) : '0.0';
    const name = seg.href ? el('a', { href: seg.href }, seg.label) : el('span', {}, seg.label);
    legend.append(
      el(
        'li',
        { class: seg.active ? 'is-active' : '' },
        el('span', { class: `swatch swatch-${seg.key}` }),
        name,
        el('span', { class: 'count' }, `${fmtInt(seg.count)} · ${pct}%`),
      ),
    );
  }
  legend.append(
    el(
      'li',
      { class: `total${opts.totalActive ? ' is-active' : ''}` },
      el('span', { class: 'swatch' }),
      opts.totalHref
        ? el('a', { href: opts.totalHref, title: 'show every station across all sources' }, 'total — show all')
        : el('span', {}, 'total'),
      el('span', { class: 'count' }, fmtInt(total)),
    ),
  );

  return el('div', { class: 'donut-panel' }, svg, legend);
}

export function emptyState(text: string): HTMLElement {
  return el('div', { class: 'empty-state' }, text);
}

export function loading(text = 'Loading…'): HTMLElement {
  return el('div', { class: 'loading' }, text);
}
