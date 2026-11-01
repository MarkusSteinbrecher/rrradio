/**
 * Interactive chart pieces for the catalog-health dashboard: ranked
 * horizontal bars (plain or split playing / odd / failing), a daily column
 * chart and a shared hover tooltip. Built with createElement and sized
 * through the CSSOM — the page's CSP allows no inline style attributes.
 *
 * Colour language (health.css): healthy is neutral grey, odd is amber,
 * failing is crimson, and the current pick is the accent red. Every bar
 * carries its number as text, so nothing depends on colour alone.
 */

import type { Split } from './aggregate';
import { el, fmtInt } from './ui';

/* ── Tooltip ─────────────────────────────────────────────────────── */

let tipNode: HTMLElement | null = null;

function tip(): HTMLElement {
  if (!tipNode) {
    tipNode = el('div', { class: 'tip', role: 'tooltip', hidden: '' });
    document.body.append(tipNode);
  }
  return tipNode;
}

/** Show the tooltip next to the pointer, flipped to stay on screen. */
export function showTip(x: number, y: number, lines: (string | Node)[]): void {
  const node = tip();
  node.replaceChildren(...lines.map((l, i) => el('p', { class: i === 0 ? 'tip__head' : 'tip__line' }, l)));
  node.hidden = false;
  const box = node.getBoundingClientRect();
  const pad = 12;
  const left = x + pad + box.width > window.innerWidth ? x - pad - box.width : x + pad;
  const top = y + pad + box.height > window.innerHeight ? y - pad - box.height : y + pad;
  node.style.left = `${Math.max(4, left)}px`;
  node.style.top = `${Math.max(4, top)}px`;
}

export function hideTip(): void {
  if (tipNode) tipNode.hidden = true;
}

function hover(target: HTMLElement, lines: () => (string | Node)[]): void {
  target.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    showTip(e.clientX, e.clientY, lines());
  });
  target.addEventListener('pointerleave', hideTip);
}

/** A swatch + text, for tooltips and legends: identity is never colour alone. */
export function keyed(grade: 'good' | 'weak' | 'bad' | 'plain', text: string): HTMLElement {
  return el('span', { class: 'keyed' }, el('i', { class: `swatch swatch--${grade}`, 'aria-hidden': 'true' }), text);
}

/* ── Ranked horizontal bars ──────────────────────────────────────── */

export interface HBarItem {
  key: string;
  label: string;
  /** Bar length. For split bars, the row total (unchecked included). */
  value: number;
  split?: Split;
  /** Text after the number, e.g. "97% playing". */
  note?: string;
}

export interface HBarOptions {
  selected: string | null;
  onSelect: (key: string) => void;
  /** What one unit is, for tooltips and screen readers ("stations"). */
  unit: string;
  splitLabels?: Record<keyof Split, string>;
  empty?: string;
}

export function hbarChart(items: HBarItem[], opts: HBarOptions): HTMLElement {
  if (items.length === 0) return el('p', { class: 'chart-empty' }, opts.empty ?? 'Nothing matches the filters.');
  const max = Math.max(...items.map((i) => i.value), 1);
  const list = el('ul', { class: `hbars${opts.selected ? ' has-pick' : ''}` });
  for (const item of items) {
    const picked = item.key === opts.selected;
    const track = el('span', { class: 'hbar__track', 'aria-hidden': 'true' });
    const lane = el('span', { class: 'hbar__lane' });
    lane.style.width = `${(item.value / max) * 100}%`;
    if (item.split) {
      for (const g of ['good', 'weak', 'bad'] as const) {
        const v = item.split[g];
        if (v <= 0) continue;
        const seg = el('i', { class: `hbar__seg hbar__seg--${g}` });
        seg.style.flexGrow = String(v);
        lane.append(seg);
      }
      // Unchecked rows keep their length but get no fill.
      const rest = item.value - item.split.good - item.split.weak - item.split.bad;
      if (rest > 0) {
        const seg = el('i', { class: 'hbar__seg hbar__seg--rest' });
        seg.style.flexGrow = String(rest);
        lane.append(seg);
      }
    } else {
      lane.append(el('i', { class: 'hbar__seg hbar__seg--plain' }));
    }
    track.append(lane);

    const button = el(
      'button',
      { type: 'button', class: 'hbar', 'aria-pressed': String(picked) },
      el('span', { class: 'hbar__label' }, item.label),
      track,
      el('span', { class: 'hbar__value sd-num' }, fmtInt(item.value), item.note ? el('span', { class: 'hbar__note' }, item.note) : null),
    );
    const words = [`${item.label}: ${fmtInt(item.value)} ${opts.unit}`];
    if (item.split && opts.splitLabels) {
      for (const g of ['good', 'weak', 'bad'] as const) words.push(`${fmtInt(item.split[g])} ${opts.splitLabels[g]}`);
    }
    button.setAttribute('aria-label', `${words.join(', ')}. ${picked ? 'Selected; press to clear.' : 'Press to filter.'}`);
    button.addEventListener('click', () => {
      hideTip();
      opts.onSelect(item.key);
    });
    hover(button, () => {
      const lines: (string | Node)[] = [`${item.label} · ${fmtInt(item.value)} ${opts.unit}`];
      if (item.split && opts.splitLabels) {
        for (const g of ['good', 'weak', 'bad'] as const) {
          if (item.split[g] > 0) lines.push(keyed(g, `${fmtInt(item.split[g])} ${opts.splitLabels[g]}`));
        }
      }
      lines.push(picked ? 'Click to clear' : 'Click to filter');
      return lines;
    });
    list.append(el('li', {}, button));
  }
  return list;
}

/* ── Daily columns ───────────────────────────────────────────────── */

export interface ColumnPoint {
  day: string;
  label: string;
  value: number;
  /** Tooltip lines under the headline. */
  detail: (string | Node)[];
  /** Drawn as a short dashed stub: e.g. a day the safety brake held every change. */
  flagged?: boolean;
}

export function columnChart(points: ColumnPoint[], unit: string): HTMLElement {
  if (points.length === 0) return el('p', { class: 'chart-empty' }, 'No runs yet.');
  const max = Math.max(...points.map((p) => p.value), 1);
  const plot = el('div', { class: 'cols', role: 'img' });
  for (const p of points) {
    const col = el('span', { class: `col${p.flagged ? ' col--flagged' : ''}` });
    const bar = el('i', { class: 'col__bar' });
    if (!p.flagged) bar.style.height = `${(p.value / max) * 100}%`;
    col.append(bar);
    hover(col, () => [`${p.label} · ${fmtInt(p.value)} ${unit}`, ...p.detail]);
    plot.append(col);
  }
  const total = points.reduce((s, p) => s + p.value, 0);
  plot.setAttribute('aria-label', `${fmtInt(total)} ${unit} over ${points.length} days, at most ${fmtInt(max)} on one day.`);
  return el(
    'div',
    { class: 'colchart' },
    el('div', { class: 'colchart__frame' }, el('span', { class: 'colchart__max sd-num', 'aria-hidden': 'true' }, fmtInt(max)), plot),
    el(
      'div',
      { class: 'colchart__x', 'aria-hidden': 'true' },
      el('span', {}, points[0].label),
      el('span', {}, points[points.length - 1].label),
    ),
  );
}
