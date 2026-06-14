/**
 * Inline SVG icon registry. Pulled out of `src/main.ts` to keep the
 * main module focused on render + state — the icon strings are static
 * data with no behavior. Audit #77 (split large modules).
 *
 * All exports are HTML strings. Callers either inject them via a
 * single `innerHTML` write on a wrapper element (where the icon is
 * the only child) or via the row helpers that build the DOM around
 * them. Strings are always trusted SVG constants — never user data.
 */

/** Compact factory for the most common stroke-style 24×24 icons.
 *  Pass `fill: true` to switch to a filled glyph. */
export function svg(
  d: string,
  opts: { fill?: boolean; viewBox?: string } = {},
): string {
  const vb = opts.viewBox ?? '0 0 24 24';
  if (opts.fill) {
    return `<svg viewBox="${vb}" fill="currentColor" aria-hidden="true">${d}</svg>`;
  }
  return `<svg viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}

export const ICON_HEART_FILL = `<svg class="heart--fill" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/></svg>`;
export const ICON_HEART_LINE_CLASSED = `<svg class="heart--line" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/></svg>`;
export const ICON_FAV = svg('<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>');
export const ICON_RECENT = svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>');
export const ICON_EMPTY = svg('<path d="M3 7v10a4 4 0 0 0 4 4h10a4 4 0 0 0 4-4V7"/><path d="M3 7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4"/><path d="M3 7h18"/>');
/** Two short horizontal bars — the conventional drag-handle "grip"
 *  affordance. Smaller dot patterns (six dots) read as decorative at
 *  16px; two bars stay readable at row size. */
export const ICON_GRIP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M5 9h14"/><path d="M5 15h14"/></svg>';

/** Capability star — used by the row builder to render up to three
 *  stars next to a station's tags (★ stream-only, ★★ + track info,
 *  ★★★ + program/schedule). */
export const STAR_SVG =
  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 3.5 2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 17.2l-5.4 2.8 1.2-6L3.3 9.8l6.1-.7L12 3.5z"/></svg>';

// ── Named-lists icons (gh #520) ──────────────────────────────────────
/** Plain list glyph — Lists nav + section label. */
export const ICON_LIST = svg(
  '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
);
/** List + plus — the per-row "add to list" affordance. */
export const ICON_LIST_ADD = svg(
  '<path d="M4 6h11"/><path d="M4 12h8"/><path d="M4 18h8"/><path d="M16 16h6"/><path d="M19 13v6"/>',
);
export const ICON_TRASH = svg(
  '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>',
);
export const ICON_PENCIL = svg(
  '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
);
export const ICON_BACK = svg('<path d="m15 18-6-6 6-6"/>');
export const ICON_CHEVRON_RIGHT = svg('<path d="m9 18 6-6-6-6"/>');
export const ICON_CHECK = svg('<path d="M20 6 9 17l-5-5"/>');
