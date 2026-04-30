/**
 * Lyrics lookup for the currently-playing track.
 *
 * Two free, no-auth, CORS-permissive sources tried in order:
 *
 *   1. LRCLIB (https://lrclib.net) — community-uploaded, returns both
 *      `plainLyrics` and `syncedLyrics` (LRC format with timestamps).
 *      Has the best coverage for mainstream pop/rock and is the only
 *      public source with synced lyrics.
 *   2. Lyrics.ovh (https://api.lyrics.ovh) — plain text only, used as
 *      fallback when LRCLIB doesn't have the track.
 *
 * Coverage caveats:
 *   - Both APIs skew anglophone pop/rock; non-English tracks miss more.
 *   - Instrumentals and station IDs trivially miss; we cache the null
 *     result so we don't refetch.
 *   - Live radio doesn't tell us the song's start position relative to
 *     the wall clock, so synced timestamps are returned but a UI that
 *     wants to highlight "current line" would need to estimate the
 *     elapsed-since-track-started locally.
 */

export interface SyncedLine {
  /** Milliseconds from the start of the track. */
  ts: number;
  text: string;
}

export interface LyricsResult {
  plain?: string;
  synced?: SyncedLine[];
}

const LRCLIB_URL = 'https://lrclib.net/api/get';
const LYRICS_OVH_URL = 'https://api.lyrics.ovh/v1';

/** Cache by lowercased "<artist>::<track>". `null` is a real cache value
 *  meaning "we asked, neither source had it" — don't refetch. */
const cache = new Map<string, LyricsResult | null>();

function cacheKey(artist: string, track: string): string {
  return `${artist.toLowerCase().trim()}::${track.toLowerCase().trim()}`;
}

/** Parse LRCLIB's syncedLyrics field (LRC format: `[mm:ss.xx] text`).
 *  A line can carry multiple timestamps before its text — we expand
 *  each into its own entry. Lines without timestamps are skipped. */
function parseLrc(lrc: string): SyncedLine[] {
  const out: SyncedLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    const stamps: number[] = [];
    let rest = line;
    while (true) {
      const m = rest.match(/^\[(\d+):(\d+)(?:\.(\d+))?\]/);
      if (!m) break;
      const min = Number(m[1]);
      const sec = Number(m[2]);
      const frac = m[3] ?? '0';
      const ms = Number(frac.padEnd(3, '0').slice(0, 3));
      stamps.push((min * 60 + sec) * 1000 + ms);
      rest = rest.slice(m[0].length);
    }
    if (stamps.length === 0) continue;
    const text = rest.trim();
    for (const ts of stamps) out.push({ ts, text });
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

/** LRCLIB. Returns null if the response says the track is instrumental
 *  or carries no lyrics text at all. Throws AbortError; other errors
 *  resolve to undefined so the caller can fall through. */
async function tryLrclib(
  artist: string,
  track: string,
  signal?: AbortSignal,
): Promise<LyricsResult | null | undefined> {
  const url = `${LRCLIB_URL}?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(track)}`;
  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    return undefined;
  }
  if (!res.ok) return undefined;
  let data: { plainLyrics?: string; syncedLyrics?: string; instrumental?: boolean };
  try {
    data = (await res.json()) as typeof data;
  } catch {
    return undefined;
  }
  if (data.instrumental) return null;
  const result: LyricsResult = {};
  if (data.plainLyrics) result.plain = data.plainLyrics.trim();
  if (data.syncedLyrics) {
    const synced = parseLrc(data.syncedLyrics);
    if (synced.length > 0) result.synced = synced;
  }
  return result.plain || result.synced ? result : undefined;
}

/** Lyrics.ovh fallback. Plain text only. */
async function tryLyricsOvh(
  artist: string,
  track: string,
  signal?: AbortSignal,
): Promise<LyricsResult | undefined> {
  const url = `${LYRICS_OVH_URL}/${encodeURIComponent(artist)}/${encodeURIComponent(track)}`;
  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    return undefined;
  }
  if (!res.ok) return undefined;
  let data: { lyrics?: string };
  try {
    data = (await res.json()) as { lyrics?: string };
  } catch {
    return undefined;
  }
  const plain = data.lyrics?.trim();
  return plain ? { plain } : undefined;
}

/** Look up lyrics for an artist + track. Cached in-memory so changing
 *  tabs / re-rendering doesn't refire the request. Returns:
 *   - LyricsResult when at least one source had something
 *   - null when both sources came back empty (cached as a miss)
 *  Throws AbortError when the signal aborts mid-flight; never throws
 *  for normal "not found" responses. */
export async function lookupLyrics(
  artist: string,
  track: string,
  signal?: AbortSignal,
): Promise<LyricsResult | null> {
  const key = cacheKey(artist, track);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const lrclib = await tryLrclib(artist, track, signal);
  if (lrclib) {
    cache.set(key, lrclib);
    return lrclib;
  }
  if (lrclib === null) {
    // LRCLIB explicitly said "instrumental" — no point asking Lyrics.ovh.
    cache.set(key, null);
    return null;
  }

  const ovh = await tryLyricsOvh(artist, track, signal);
  const result = ovh ?? null;
  cache.set(key, result);
  return result;
}
