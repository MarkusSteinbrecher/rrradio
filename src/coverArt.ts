/**
 * iTunes Search-based cover art lookup. Used as a fallback when the
 * station's own metadata feed doesn't provide a cover URL (most stations
 * other than Grrif fall in this bucket).
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

const CACHE_LIMIT = 64;
// Map iteration order is insertion-order, so we get FIFO eviction for free.
// Value `null` means "we tried, no result" — short-circuits future lookups.
const cache = new Map<string, string | null>();

function cacheKey(artist: string | undefined, track: string): string {
  return `${(artist ?? '').toLowerCase().trim()}|${track.toLowerCase().trim()}`;
}

function rememberCache(key: string, value: string | null): void {
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

export async function lookupCover(
  artist: string | undefined,
  track: string,
  signal: AbortSignal,
): Promise<string | undefined> {
  const cleaned = track.trim();
  if (cleaned.length < 3) return undefined; // not enough to search on
  if (cleaned === '—' || cleaned === '-') return undefined;

  const key = cacheKey(artist, cleaned);
  if (cache.has(key)) {
    const cached = cache.get(key);
    return cached ?? undefined;
  }

  const term = `${artist ?? ''} ${cleaned}`.trim().slice(0, 100);
  const url =
    'https://itunes.apple.com/search?' +
    new URLSearchParams({ term, entity: 'song', limit: '5', media: 'music' }).toString();

  try {
    const res = await fetch(url, { signal, cache: 'no-store' });
    if (!res.ok) {
      rememberCache(key, null);
      return undefined;
    }
    const data = (await res.json()) as { resultCount: number; results: ITunesTrack[] };
    const best = pickBest(data.results ?? [], artist, cleaned);
    const lo = best?.artworkUrl100;
    const hi = lo ? highRes(lo) : null;
    rememberCache(key, hi);
    return hi ?? undefined;
  } catch {
    // Don't cache transient/aborted errors — let next poll retry
    return undefined;
  }
}
