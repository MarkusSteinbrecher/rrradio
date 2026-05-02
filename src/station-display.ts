/**
 * Pure display helpers for a Station — initials block fallback when
 * no favicon loads, deterministic favicon class for color tinting.
 * Extracted from `src/main.ts` (audit #77).
 */

/** Up-to-2-letter initials from the station name; falls back to "··". */
export function stationInitials(name: string): string {
  const parts = name
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const letters = parts.slice(0, 2).map((w) => w[0]).join('').toUpperCase().slice(0, 2);
  return letters || '··';
}

/** Deterministic CSS class for the favicon block. Hashes the id to
 *  pick one of four broadcaster-tinted classes so identical ids get
 *  the same color across renders. Empty / unknown id → "fav". */
export function faviconClass(id: string): string {
  if (!id) return 'fav';
  const sum = id.charCodeAt(0) + id.charCodeAt(id.length - 1);
  return ['fav', 'fav fav-bbc', 'fav fav-soma', 'fav fav-fip'][sum % 4];
}
