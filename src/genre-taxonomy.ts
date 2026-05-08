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

export interface Genre {
  /** Stable id used in URLs, telemetry, and the <select> value. */
  id: string;
  /** Display label for the chip / dropdown option. */
  label: string;
  /** Tag forms that count as this genre. Case-insensitive. Substring
   *  match — "rock" also matches "classic rock", "punk rock", … */
  match: string[];
  /** Tag string sent to Radio Browser when this chip is active on the
   *  long-tail browse view. */
  rbTag: string;
}

export const GENRES: Genre[] = [
  { id: 'pop',          label: 'Pop',          match: ['pop'],                                                                                                                                                                                                              rbTag: 'pop' },
  { id: 'rock',         label: 'Rock',         match: ['rock'],                                                                                                                                                                                                             rbTag: 'rock' },
  { id: 'oldies',       label: 'Oldies',       match: ['oldies', 'classic hits', '60s', '70s', '80s', '90s', 'schlager'],                                                                                                                                                    rbTag: 'oldies' },
  { id: 'latin',        label: 'Latin',        match: ['latino', 'latin', 'banda', 'grupera', 'salsa', 'mariachi', 'bachata', 'merengue', 'cumbia', 'reggaeton', 'spanish', 'mexican', 'brazilian', 'sertanejo', 'español', 'tejano', 'norteño', 'romantica', 'noticias'],   rbTag: 'latino' },
  { id: 'news',         label: 'News',         match: ['news', 'noticias'],                                                                                                                                                                                                  rbTag: 'news' },
  { id: 'talk',         label: 'Talk',         match: ['talk'],                                                                                                                                                                                                              rbTag: 'talk' },
  { id: 'public',       label: 'Public',       match: ['public radio', 'community radio', 'public', 'community'],                                                                                                                                                            rbTag: 'public radio' },
  { id: 'dance',        label: 'Dance',        match: ['dance', 'edm', 'club'],                                                                                                                                                                                              rbTag: 'dance' },
  { id: 'electronic',   label: 'Electronic',   match: ['electronic', 'electronica', 'techno', 'trance', 'electro'],                                                                                                                                                          rbTag: 'electronic' },
  { id: 'house',        label: 'House',        match: ['house'],                                                                                                                                                                                                             rbTag: 'house' },
  { id: 'christian',    label: 'Christian',    match: ['christian', 'gospel', 'religious', 'worship'],                                                                                                                                                                       rbTag: 'christian' },
  { id: 'indie',        label: 'Indie/alt',    match: ['indie', 'alternative', 'alt'],                                                                                                                                                                                       rbTag: 'alternative' },
  { id: 'jazz',         label: 'Jazz',         match: ['jazz'],                                                                                                                                                                                                              rbTag: 'jazz' },
  { id: 'classical',    label: 'Classical',    match: ['classical', 'orchestral'],                                                                                                                                                                                           rbTag: 'classical' },
  { id: 'ambient',      label: 'Chill',        match: ['ambient', 'chillout', 'chill', 'lounge', 'easy listening', 'downtempo', 'meditation', 'relax'],                                                                                                                      rbTag: 'ambient' },
  { id: 'country',      label: 'Country',      match: ['country'],                                                                                                                                                                                                           rbTag: 'country' },
  { id: 'hiphop',       label: 'Hip hop',      match: ['hip hop', 'hip-hop', 'hiphop', 'rap', 'r&b'],                                                                                                                                                                        rbTag: 'hip hop' },
  { id: 'sports',       label: 'Sports',       match: ['sports', 'sport'],                                                                                                                                                                                                   rbTag: 'sports' },
  { id: 'folk',         label: 'Folk',         match: ['folk'],                                                                                                                                                                                                              rbTag: 'folk' },
  { id: 'reggae',       label: 'Reggae',       match: ['reggae', 'ska', 'dancehall'],                                                                                                                                                                                        rbTag: 'reggae' },
  { id: 'soul',         label: 'Soul/R&B',     match: ['soul', 'rnb', 'rhythm and blues', 'funk'],                                                                                                                                                                           rbTag: 'soul' },
  { id: 'metal',        label: 'Metal',        match: ['metal'],                                                                                                                                                                                                             rbTag: 'metal' },
];

const BY_ID = new Map(GENRES.map((g) => [g.id, g]));

export function findGenre(id: string | null | undefined): Genre | undefined {
  if (!id || id === 'all') return undefined;
  return BY_ID.get(id);
}

/** Does the station's tag list match this genre? Case-insensitive
 *  substring against any of the genre's `match` terms. Empty/missing
 *  tag list → no match. */
export function stationMatchesGenre(
  station: { tags?: string[] | null },
  genre: Genre,
): boolean {
  const tags = station.tags;
  if (!tags || tags.length === 0) return false;
  for (const t of tags) {
    const tl = String(t).toLowerCase();
    for (const m of genre.match) {
      if (tl.includes(m)) return true;
    }
  }
  return false;
}
