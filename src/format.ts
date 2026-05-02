/**
 * Pure formatting / normalization helpers used across the app.
 *
 * Extracted from main.ts + builtins.ts so they can be unit-tested
 * without dragging in DOM globals or the fetcher registry. Anything
 * here must stay side-effect-free and stable across browser + Node
 * test environments.
 */

/** Title-case a free-form string while preserving in-word casing
 *  the broadcaster supplied. Uppercases the first letter of every
 *  whitespace- or hyphen-delimited segment. Used to soften
 *  ALL-CAPS broadcaster metadata into something readable. */
export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|[\s'’\-/])([a-zà-ÿ])/g, (_, p: string, c: string) => p + c.toUpperCase());
}

/** Strip leading non-JSON noise (comments, BOM) so JSON.parse can swallow
 *  responses like BR's radioplayer.json which starts with `//@formatter:off`. */
export function parseLooseJSON(text: string): unknown {
  const idx = text.search(/[\[{]/);
  return JSON.parse(idx > 0 ? text.slice(idx) : text);
}

/** Strip non-alphanumeric chars (incl. German umlauts/ß) for whitespace-
 *  insensitive search matching. So "WDR 5" and "WDR5" both reduce to
 *  "wdr5" and a query of either form finds the other. Used as a
 *  fallback alongside the literal-substring check. */
export function normalizeForSearch(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9äöüß]+/g, '');
}

/** Format a per-row share of total. Rounds to whole percent; non-zero
 *  values below 0.5% (which would round to 0) print as "<1%" so a
 *  long-tail row never reads as a misleading "0%". Empty string when
 *  total is zero/missing. */
export function fmtSharePct(count: number, total: number): string {
  if (!total) return '';
  const pct = (count / total) * 100;
  if (pct > 0 && pct < 0.5) return '<1%';
  return Math.round(pct) + '%';
}
