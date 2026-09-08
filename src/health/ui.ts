/**
 * DOM building blocks for the catalog-health page. Everything is built with
 * createElement / createElementNS — the page's CSP has no 'unsafe-inline',
 * so no innerHTML and no inline style attributes anywhere.
 */

import type { Verdict } from './model';

type Child = Node | string | null | undefined;

/** el('div', { class: 'x' }, ...children) */
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

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string> = {}): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

/* ── Formatting ──────────────────────────────────────────────────── */

export function fmtInt(n: number): string {
  return n.toLocaleString('en-US');
}

export function fmtPct(x: number | null | undefined, digits = 1): string {
  if (x == null || Number.isNaN(x)) return '—';
  return `${(x * 100).toFixed(digits)}%`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "8 Sep" for a YYYY-MM-DD or ISO string; '' for empty input. */
export function fmtDay(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "8 Sep 2026, 05:12 UTC" */
export function fmtDateTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hh}:${mm} UTC`;
}

/** "today" / "yesterday" / "3 days ago", by UTC calendar day. */
export function relDay(iso: string, now: Date = new Date()): string {
  if (!iso) return 'never';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dayOf = (x: Date): number => Math.floor(x.getTime() / 86_400_000);
  const days = dayOf(now) - dayOf(d);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

let displayNames: Intl.DisplayNames | null | undefined;

/** "Germany" for DE — via Intl so the page carries no country table. */
export function countryName(cc: string): string {
  if (!cc) return 'Unknown';
  if (displayNames === undefined) {
    try {
      displayNames = new Intl.DisplayNames(['en'], { type: 'region' });
    } catch {
      displayNames = null;
    }
  }
  try {
    return displayNames?.of(cc) ?? cc;
  } catch {
    return cc;
  }
}

/* ── Verdict cell ────────────────────────────────────────────────── */

const VERDICT_WORD: Record<Verdict, string> = { ok: 'ok', warn: 'warning', bad: 'failing', na: 'not applicable', '': 'not checked' };

/** Colored dot + always-visible label; verdict is never color alone.
 *  `title` carries the long form for hover / screen readers. */
export function verdictCell(v: Verdict, label: string, title?: string, extra?: string): HTMLElement {
  const cls = v === '' ? 'v v-none' : `v v-${v}`;
  const node = el(
    'span',
    { class: cls, title: title ?? `${VERDICT_WORD[v]} — ${label}` },
    el('i', { class: 'v__dot', 'aria-hidden': 'true' }),
    el('span', { class: 'v__label' }, label),
    extra ? el('span', { class: 'v__extra' }, extra) : null,
  );
  node.setAttribute('aria-label', `${VERDICT_WORD[v]}: ${label}${extra ? `, ${extra}` : ''}`);
  return node;
}

/* ── Proportion bar (ok / warn / bad share) ──────────────────────── */

export interface BarPart {
  key: 'ok' | 'warn' | 'bad' | 'na';
  value: number;
  label: string;
}

/** A single stacked bar with a 2px surface gap between fills plus a text
 *  legend underneath, so the split is readable without the colors. */
export function proportionBar(parts: BarPart[]): HTMLElement {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  const bar = el('div', { class: 'bar', role: 'img' });
  const legend = el('div', { class: 'bar__legend' });
  const words: string[] = [];
  for (const p of parts) {
    if (p.value <= 0) continue;
    const seg = el('i', { class: `bar__seg bar__seg--${p.key}` });
    // flex-grow carries the proportion — no inline style attribute needed.
    seg.style.flexGrow = String(p.value / total);
    bar.append(seg);
    legend.append(
      el('span', { class: `bar__key bar__key--${p.key}` }, el('i', { class: 'v__dot', 'aria-hidden': 'true' }), `${fmtInt(p.value)} ${p.label}`),
    );
    words.push(`${fmtInt(p.value)} ${p.label}`);
  }
  bar.setAttribute('aria-label', words.join(', '));
  return el('div', { class: 'bar-wrap' }, bar, legend);
}

/* ── Sparkline ───────────────────────────────────────────────────── */

export interface SparkOptions {
  /** Y-axis floor/ceiling; default = data min/max with a little headroom. */
  min?: number;
  max?: number;
  format: (v: number) => string;
}

export interface Sparkline {
  root: HTMLElement;
  readout: HTMLElement;
}

const W = 160;
const H = 40;
const PAD = 4;

/**
 * Single-series line with a filled area, last-point marker and a hover
 * layer: transparent hit columns wider than the marks; hovering one moves
 * the crosshair and writes "day · value" into the readout (default: the
 * latest point). One series → no legend; the tile title names it.
 */
export function sparkline(points: { day: string; value: number | null }[], opts: SparkOptions): Sparkline {
  const readout = el('span', { class: 'spark__readout' });
  const root = el('div', { class: 'spark' });
  const valid = points.filter((p): p is { day: string; value: number } => p.value != null);
  if (valid.length === 0) {
    readout.textContent = 'no history yet';
    root.append(el('div', { class: 'spark__empty' }), readout);
    return { root, readout };
  }
  const values = valid.map((p) => p.value);
  const lo = opts.min ?? Math.min(...values);
  const hi = opts.max ?? Math.max(...values);
  const span = hi - lo || 1;
  const n = points.length;
  const x = (i: number): number => (n === 1 ? W / 2 : PAD + (i * (W - 2 * PAD)) / (n - 1));
  const y = (v: number): number => H - PAD - ((v - lo) / span) * (H - 2 * PAD);

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'spark__svg', 'aria-hidden': 'true', preserveAspectRatio: 'none' });
  const coords: { i: number; px: number; py: number; p: { day: string; value: number } }[] = [];
  points.forEach((p, i) => {
    if (p.value == null) return;
    coords.push({ i, px: x(i), py: y(p.value), p: { day: p.day, value: p.value } });
  });
  const lineD = coords.map((c, k) => `${k === 0 ? 'M' : 'L'}${c.px.toFixed(1)} ${c.py.toFixed(1)}`).join(' ');
  const first = coords[0];
  const last = coords[coords.length - 1];
  const areaD = `${lineD} L${last.px.toFixed(1)} ${H - PAD} L${first.px.toFixed(1)} ${H - PAD} Z`;
  svg.append(svgEl('path', { d: areaD, class: 'spark__area' }));
  svg.append(svgEl('path', { d: lineD, class: 'spark__line', 'vector-effect': 'non-scaling-stroke' }));
  const cursor = svgEl('line', { class: 'spark__cursor', x1: String(last.px), x2: String(last.px), y1: '0', y2: String(H), 'vector-effect': 'non-scaling-stroke' });
  svg.append(cursor);
  const marker = svgEl('circle', { class: 'spark__marker', cx: String(last.px), cy: String(last.py), r: '3.5' });
  svg.append(marker);

  const show = (c: (typeof coords)[number]): void => {
    cursor.setAttribute('x1', String(c.px));
    cursor.setAttribute('x2', String(c.px));
    marker.setAttribute('cx', String(c.px));
    marker.setAttribute('cy', String(c.py));
    readout.textContent = `${fmtDay(c.p.day)} · ${opts.format(c.p.value)}`;
  };
  // Hit columns: each owns the half-gap to its neighbours.
  coords.forEach((c, k) => {
    const left = k === 0 ? 0 : (coords[k - 1].px + c.px) / 2;
    const right = k === coords.length - 1 ? W : (c.px + coords[k + 1].px) / 2;
    const hit = svgEl('rect', { x: String(left), y: '0', width: String(right - left), height: String(H), class: 'spark__hit' });
    hit.addEventListener('mouseenter', () => show(c));
    svg.append(hit);
  });
  svg.addEventListener('mouseleave', () => show(last));
  show(last);

  root.append(svg, readout);
  return { root, readout };
}
