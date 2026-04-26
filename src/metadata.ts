import { fetchIcyOnce, parseStreamTitle, type ParsedTitle } from './icyMetadata';
import type { Station } from './types';

/**
 * A unit of work that returns the current track for a station.
 *
 * - Resolves to a ParsedTitle when a track is known
 * - Resolves to `null` when the source is reachable but has no current title
 *   (e.g., between songs, ad break) — caller keeps polling
 * - Throws when the source is unreachable / unsupported — caller stops polling
 */
export type MetadataFetcher = (
  station: Station,
  signal: AbortSignal,
) => Promise<ParsedTitle | null>;

/** Default ICY-over-fetch fetcher. Works for any Icecast/Shoutcast stream
 *  that allows CORS — many do, including Infomaniak's AIS9. */
export const icyFetcher: MetadataFetcher = async (station, signal) => {
  const raw = await fetchIcyOnce(station.streamUrl, signal);
  if (raw === null) throw new Error('icy unavailable');
  return parseStreamTitle(raw);
};

export class MetadataPoller {
  private timer: number | undefined;
  private controller: AbortController | undefined;
  private currentKey: string | undefined;
  private generation = 0;
  private listener: (parsed: ParsedTitle | null) => void;

  constructor(listener: (parsed: ParsedTitle | null) => void) {
    this.listener = listener;
  }

  /** Start polling under a unique key (e.g., station id). Re-calls with the
   *  same key are no-ops; different keys swap fetchers cleanly. */
  start(station: Station, fetcher: MetadataFetcher, intervalMs = 30_000): void {
    const key = station.id;
    if (this.currentKey === key) return;
    this.stop();
    this.currentKey = key;
    const myGen = ++this.generation;
    const tick = async (): Promise<void> => {
      if (myGen !== this.generation) return;
      this.controller?.abort();
      this.controller = new AbortController();
      try {
        const result = await fetcher(station, this.controller.signal);
        if (myGen !== this.generation) return;
        this.listener(result);
      } catch {
        if (myGen !== this.generation) return;
        // Source unreachable / unsupported — give up on this key.
        this.stop();
      }
    };
    void tick();
    this.timer = window.setInterval(() => void tick(), intervalMs);
  }

  stop(): void {
    this.generation++;
    this.currentKey = undefined;
    if (this.timer !== undefined) {
      window.clearInterval(this.timer);
      this.timer = undefined;
    }
    if (this.controller) {
      try { this.controller.abort(); } catch { /* ignore */ }
      this.controller = undefined;
    }
  }
}
