/**
 * iTunes Search-based track lookup. Used for two things:
 *
 *   1. Cover-art fallback when the station's own metadata feed doesn't
 *      provide a cover URL (most stations other than Grrif).
 *   2. Track-existence verification — `resultCount > 0` tells us the
 *      ICY-supplied title plausibly resolves to a real song, so the
 *      now-playing pane only renders Spotify/Apple Music/YT Music
 *      search links when iTunes confirms there's something to find.
 *      News/talk channels typically emit show names ("BR24 Aktuell")
 *      and station IDs that iTunes won't match — those should NOT
 *      surface music-service links.
 *
 * - No auth, no API key
 * - CORS-permissive
 * - Free; ~20 req/min/IP soft limit (we poll every 30s, so plenty)
 *
 * The endpoint returns a 100×100 thumbnail; we rewrite it to 600×600 for
 * a sharper render in Now Playing.
 */

interface ITunesTrack {
  artistName: string;
  trackName: string;
  artworkUrl100?: string;
}

/** Outcome of an iTunes search. `hit` reflects `resultCount > 0`;
 *  `cover` is set only when the best match also carries artwork. */
export interface ITunesResult {
  hit: boolean;
  cover?: string;
}

const CACHE_LIMIT = 64;
// Map iteration order is insertion-order, so we get FIFO eviction for free.
const cache = new Map<string, ITunesResult>();

function cacheKey(artist: string | undefined, track: string): string {
  return `${(artist ?? '').toLowerCase().trim()}|${track.toLowerCase().trim()}`;
}

function rememberCache(key: string, value: ITunesResult): void {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, value);
}

function highRes(url: string): string {
  // /image/thumb/.../<W>x<H>bb.jpg → swap to 600x600
  return url.replace(/\/\d+x\d+bb\.(jpg|jpeg|png)/i, '/600x600bb.$1');
}

function pickBest(
  results: ITunesTrack[],
  artist: string | undefined,
  track: string,
): ITunesTrack | undefined {
  if (results.length === 0) return undefined;
  const a = (artist ?? '').toLowerCase().trim();
  const t = track.toLowerCase().trim();
  const exact = results.find((r) => {
    const ra = r.artistName.toLowerCase();
    const rt = r.trackName.toLowerCase();
    return rt.includes(t) && (a === '' || ra.includes(a) || a.includes(ra));
  });
  return exact ?? results[0];
}

/** Run an iTunes Search and cache the outcome. Returns `{hit: false}`
 *  on transport errors *without* caching so the next poll can retry
 *  (aborts and network blips don't poison the cache). */
export async function searchITunes(
  artist: string | undefined,
  track: string,
  signal: AbortSignal,
): Promise<ITunesResult> {
  const cleaned = track.trim();
  if (cleaned.length < 3) return { hit: false }; // not enough to search on
  if (cleaned === '—' || cleaned === '-') return { hit: false };

  const key = cacheKey(artist, cleaned);
  const cached = cache.get(key);
  if (cached) return cached;

  const term = `${artist ?? ''} ${cleaned}`.trim().slice(0, 100);
  const url =
    'https://itunes.apple.com/search?' +
    new URLSearchParams({ term, entity: 'song', limit: '5', media: 'music' }).toString();

  try {
    const res = await fetch(url, { signal, cache: 'no-store' });
    if (!res.ok) {
      // Treat a failed response as a miss for the duration of the cache
      // — better than the alternative of repeatedly re-hitting a flaky
      // endpoint, and a real song will resurface on a later track.
      const result: ITunesResult = { hit: false };
      rememberCache(key, result);
      return result;
    }
    const data = (await res.json()) as { resultCount: number; results: ITunesTrack[] };
    const hit = (data.resultCount ?? 0) > 0;
    const best = hit ? pickBest(data.results ?? [], artist, cleaned) : undefined;
    const lo = best?.artworkUrl100;
    const result: ITunesResult = { hit };
    if (lo) result.cover = highRes(lo);
    rememberCache(key, result);
    return result;
  } catch {
    // Don't cache transient/aborted errors — let next poll retry
    return { hit: false };
  }
}

/** Cover-art-only wrapper. Returns the high-res artwork URL on hit
 *  (assuming the iTunes record carries one), `undefined` otherwise. */
export async function lookupCover(
  artist: string | undefined,
  track: string,
  signal: AbortSignal,
): Promise<string | undefined> {
  return (await searchITunes(artist, track, signal)).cover;
}

/** Existence-check wrapper. Returns whether iTunes has at least one
 *  result for the given artist+track query. Drives the visibility of
 *  Spotify/Apple Music/YT Music links in the now-playing pane. */
export async function verifyTrack(
  artist: string | undefined,
  track: string,
  signal: AbortSignal,
): Promise<boolean> {
  return (await searchITunes(artist, track, signal)).hit;
}
