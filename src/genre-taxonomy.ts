/**
 * Canonical genre taxonomy for the catalog browse filter.
 *
 * Radio Browser's per-station `tags` are free-form (volunteer-tagged,
 * multi-language, ~6,000 distinct strings across our 15k catalog).
 * The previous 8-option dropdown matched those raw tags by substring,
 * which left 97% of stations un-bucketable through the chip set.
 *
 * This module collapses the long tail to ~22 chips a user can reason
 * about, and gives each chip:
 *
 *   · `match[]`  — list of tag forms that should be treated as this
 *                  genre (case-insensitive, substring match per term).
 *                  Used for the local-catalog filter.
 *   · `rbTag`    — the single string we send to Radio Browser's
 *                  `tag` query parameter when the user picks this
 *                  chip on the long-tail RB browse view. RB's tag
 *                  search is itself a substring match server-side, so
 *                  we send the most-common form.
 *
 * Order in `GENRES` is the order chips/options render in the UI. It
 * roughly mirrors station-count popularity in the catalog so the most
 * common genres come first.
 */

// The canonical GENRES data + stationMatchesGenre matcher live in the plain
// JS sibling so the build-time discovery summary (tools/build-discovery.mjs)
// shares the exact same logic — no drift between precomputed counts and the
// counts the running app derives. See genre-taxonomy.data.d.mts for the
// `match` / `rbTag` semantics (string = case-insensitive substring; RegExp =
// for the rare term whose substring would catch a non-music word, e.g.
// `/\bfunk[a-z]*\b/` keeps "funk"/"funky" but excludes German "rundfunk").
import { GENRES, stationMatchesGenre } from './genre-taxonomy.data.mjs';
import type { Genre } from './genre-taxonomy.data.mjs';

export { GENRES, stationMatchesGenre };
export type { Genre };

const BY_ID = new Map(GENRES.map((g) => [g.id, g]));

export function findGenre(id: string | null | undefined): Genre | undefined {
  if (!id || id === 'all') return undefined;
  return BY_ID.get(id);
}
