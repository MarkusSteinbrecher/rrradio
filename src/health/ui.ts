/**
 * DOM building blocks for the catalog-health page. Everything is built with
 * createElement / createElementNS — the page's CSP has no 'unsafe-inline',
 * so no innerHTML and no inline style attributes anywhere (positions go
 * through the CSSOM, which the policy allows).
 */

import type { Grade } from './score';

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

/* ── Grade mark ──────────────────────────────────────────────────── */

const GRADE_WORD: Record<Grade, string> = { good: 'good', weak: 'weak', bad: 'bad', skip: 'not checked' };

/** Dot + always-visible label: a grade is never colour alone. */
export function gradeMark(g: Grade, label: string, title?: string): HTMLElement {
  const node = el(
    'span',
    { class: `mark mark--${g}`, title: title ?? label },
    el('i', { class: 'mark__dot', 'aria-hidden': 'true' }),
    el('span', { class: 'mark__label' }, label),
  );
  node.setAttribute('aria-label', `${GRADE_WORD[g]}: ${label}`);
  return node;
}

/* ── Stacked bar (good / weak / bad share) ───────────────────────── */

export interface BarPart {
  grade: 'good' | 'weak' | 'bad';
  value: number;
  label: string;
}

/** One stacked bar with a 2px surface gap between fills. The caller
 *  renders the text legend, so the split never depends on the colours. */
export function stackedBar(parts: BarPart[]): HTMLElement {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  const bar = el('div', { class: 'bar', role: 'img' });
  const words: string[] = [];
  for (const p of parts) {
    if (p.value <= 0) continue;
    const seg = el('i', { class: `bar__seg bar__seg--${p.grade}` });
    // CSSOM, not a style attribute — allowed under the page's CSP.
    seg.style.flexGrow = String(p.value / total);
    bar.append(seg);
    words.push(`${fmtInt(p.value)} ${p.label}`);
  }
  bar.setAttribute('aria-label', words.join(', '));
  return bar;
}

/* ── Trend chart ─────────────────────────────────────────────────── */

export interface TrendPoint {
  day: string;
  value: number;
}

const VW = 600;
const VH = 160;

function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * mag >= v) return m * mag;
  return 10 * mag;
}

/**
 * Single-series line from a zero baseline with recessive gridlines and a
 * crosshair + readout on hover (default: the latest point). The line and
 * grid are SVG stretched to the box; the dot, crosshair and labels are
 * HTML positioned in percent, so nothing distorts at any width.
 */
export function trendChart(points: TrendPoint[], format: (v: number) => string, unit: string): HTMLElement {
  const root = el('div', { class: 'trend' });
  if (points.length < 2) {
    root.append(el('p', { class: 'trend__empty' }, 'Not enough history yet.'));
    return root;
  }
  const top = niceCeil(Math.max(...points.map((p) => p.value)));
  const n = points.length;
  const xPct = (i: number): number => (i / (n - 1)) * 100;
  const yPct = (v: number): number => 100 - (v / top) * 100;

  const plot = el('div', { class: 'trend__plot' });
  const svg = svgEl('svg', { viewBox: `0 0 ${VW} ${VH}`, preserveAspectRatio: 'none', class: 'trend__svg', 'aria-hidden': 'true' });
  const axis = el('div', { class: 'trend__axis', 'aria-hidden': 'true' });
  for (const f of [0, 0.5, 1]) {
    const y = (VH * (1 - f)).toFixed(1);
    svg.append(svgEl('line', { x1: '0', x2: String(VW), y1: y, y2: y, class: f === 0 ? 'trend__base' : 'trend__grid', 'vector-effect': 'non-scaling-stroke' }));
    const tick = el('span', { class: 'trend__tick' }, format(top * f));
    tick.style.top = `${(1 - f) * 100}%`;
    axis.append(tick);
  }
  const d = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${((xPct(i) / 100) * VW).toFixed(1)} ${((yPct(p.value) / 100) * VH).toFixed(1)}`)
    .join(' ');
  svg.append(svgEl('path', { d, class: 'trend__line', 'vector-effect': 'non-scaling-stroke' }));

  const cursor = el('i', { class: 'trend__cursor', 'aria-hidden': 'true' });
  const dot = el('i', { class: 'trend__dot', 'aria-hidden': 'true' });
  const readout = el('p', { class: 'trend__readout', 'aria-live': 'polite' });
  plot.append(svg, cursor, dot);

  const show = (i: number): void => {
    const p = points[i];
    cursor.style.left = `${xPct(i)}%`;
    dot.style.left = `${xPct(i)}%`;
    dot.style.top = `${yPct(p.value)}%`;
    readout.replaceChildren(el('strong', {}, format(p.value)), ` ${unit} · ${fmtDay(p.day)}`);
  };
  const last = n - 1;
  plot.addEventListener('pointermove', (e) => {
    const box = plot.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
    show(Math.round(f * last));
  });
  plot.addEventListener('pointerleave', () => show(last));
  show(last);

  const xAxis = el(
    'div',
    { class: 'trend__x', 'aria-hidden': 'true' },
    el('span', {}, fmtDay(points[0].day)),
    el('span', {}, fmtDay(points[last].day)),
  );
  root.setAttribute('role', 'img');
  root.setAttribute(
    'aria-label',
    `${unit}: ${format(points[0].value)} on ${fmtDay(points[0].day)}, ${format(points[last].value)} on ${fmtDay(points[last].day)}`,
  );
  root.append(readout, el('div', { class: 'trend__frame' }, axis, plot), xAxis);
  return root;
}
