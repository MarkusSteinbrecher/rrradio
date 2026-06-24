// Canonical genre taxonomy data + matcher. Plain JS (.mjs) so it is the
// SINGLE source of truth shared by the runtime app (via genre-taxonomy.ts)
// and the build-time discovery summary (tools/build-discovery.mjs). Keeping
// one copy means the precomputed genre counts in discovery.json can never
// drift from the counts the running app would compute over the full catalog.
//
// See genre-taxonomy.ts for the doc comments on `match` / `rbTag` semantics
// and genre-taxonomy.data.d.mts for the TypeScript types.

export const GENRES = [
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
  { id: 'soul',         label: 'Soul/R&B',     match: ['soul', 'rnb', 'rhythm and blues', /\bfunk[a-z]*\b/i],                                                                                                                                                                rbTag: 'soul' },
  { id: 'metal',        label: 'Metal',        match: ['metal'],                                                                                                                                                                                                             rbTag: 'metal' },
];

/** Does the station's tag list match this genre? String entries in
 *  `genre.match` are case-insensitive substring checks; RegExp entries are
 *  tested against the lowercased tag as-is. Empty/missing tag list → no
 *  match. */
export function stationMatchesGenre(station, genre) {
  const tags = station.tags;
  if (!tags || tags.length === 0) return false;
  for (const t of tags) {
    const tl = String(t).toLowerCase();
    for (const m of genre.match) {
      if (typeof m === 'string') {
        if (tl.includes(m)) return true;
      } else if (m.test(tl)) {
        return true;
      }
    }
  }
  return false;
}
