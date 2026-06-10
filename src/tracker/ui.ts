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

/** Compact verdict pill for table cells; tooltip carries detail + since. */
export function verdictPill(entry: FacetEntry | undefined): HTMLElement {
  if (!entry) {
    return el('span', { class: 'pill v-none', title: 'not checked yet' }, '—');
  }
  return el(
    'span',
    {
      class: `pill v-${entry.v}`,
      title: `${entry.v}${entry.d ? ` — ${entry.d}` : ''} (since ${entry.since})`,
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

export function emptyState(text: string): HTMLElement {
  return el('div', { class: 'empty-state' }, text);
}

export function loading(text = 'Loading…'): HTMLElement {
  return el('div', { class: 'loading' }, text);
}
