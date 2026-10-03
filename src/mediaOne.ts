import { titleCase } from './format';
import type { ParsedTitle } from './icyMetadata';

/** Media One Group (One FM, Radio Lac, LFM, Rouge, Yes FM and the shared
 *  webradio pool) publishes now-playing JSON per stream at
 *  www.mediaone-digital.ch/cache/<slug>.json (CORS `*`). Slugs are names
 *  for the flagships (`onefm`, `radiolac`, `lfm`) and numbers for the rest
 *  (`4` = Rouge, `2104` = Yes FM, `24NN` = webradioNNNN). Pure helpers so
 *  the parse is unit-testable without loading src/builtins.ts. */

export const MEDIA_ONE_CACHE = 'https://www.mediaone-digital.ch/cache/';

interface MediaOneTrack {
  interpret?: string;
  title?: string;
  imageURL?: string;
  imageFullURL?: string;
}

export interface MediaOneResponse {
  live?: MediaOneTrack[];
  played?: MediaOneTrack[];
}

/** metadataUrl holds the slug (or, defensively, a full URL). */
export function mediaOneUrl(metadataUrl: string | undefined): string | null {
  const v = metadataUrl?.trim();
  if (!v) return null;
  if (/^https:\/\//i.test(v)) return v;
  if (!/^[a-z0-9_-]+$/i.test(v)) return null;
  return `${MEDIA_ONE_CACHE}${v}.json`;
}

/** live[0] is the current track. Text arrives ALL CAPS, so title-case it.
 *  The platform serves `tracks/nocover.png` when it has no art — drop that
 *  so the cover-art chain can look further. */
export function parseMediaOne(data: MediaOneResponse): ParsedTitle | null {
  const cur = data.live?.[0];
  const track = cur?.title?.trim();
  if (!cur || !track) return null;
  const artist = cur.interpret?.trim() || undefined;
  const cover = (cur.imageFullURL || cur.imageURL)?.trim();
  const usableCover = cover && /^https:\/\//i.test(cover) && !/\/nocover\.[a-z]+$/i.test(cover);
  return {
    artist: artist ? titleCase(artist) : undefined,
    track: titleCase(track),
    raw: artist ? `${artist} - ${track}` : track,
    coverUrl: usableCover ? cover : undefined,
  };
}
