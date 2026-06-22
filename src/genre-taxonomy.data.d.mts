// Type declarations for the shared genre-taxonomy data module
// (genre-taxonomy.data.mjs). The .mjs is the runtime/build source of truth;
// these types let the strict TS app consume it. genre-taxonomy.ts re-exports
// both, so app code keeps importing from './genre-taxonomy'.

export interface Genre {
  /** Stable id used in URLs, telemetry, and the <select> value. */
  id: string;
  /** Display label for the chip / dropdown option. */
  label: string;
  /** Tag forms that count as this genre: a string (case-insensitive
   *  substring match) or a RegExp (tested against the lowercased tag). */
  match: Array<string | RegExp>;
  /** Tag string sent to Radio Browser when this chip is active. */
  rbTag: string;
}

export const GENRES: Genre[];

export function stationMatchesGenre(
  station: { tags?: string[] | null },
  genre: Genre,
): boolean;
