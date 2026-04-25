/**
 * ICY metadata reader for Icecast / Shoutcast streams.
 *
 * Browsers don't expose ICY metadata from the <audio> element, but we
 * can open a parallel `fetch()` with `Icy-MetaData: 1`, walk past one
 * audio interval, and pluck the `StreamTitle='...'` out of the
 * metadata block. Then we abort.
 *
 * Works only if the stream returns CORS headers permitting our origin
 * (Access-Control-Allow-Origin). Many modern Icecast deployments do;
 * Shoutcast v1 generally doesn't. We try once per station and silently
 * give up if the server refuses.
 */

export interface ParsedTitle {
  artist?: string;
  track: string;
  raw: string;
}

const MAX_METADATA_BYTES = 255 * 16; // ICY length byte × 16

/** Result of one fetch attempt:
 *  - `string` (possibly empty): server speaks ICY, here's the latest title
 *  - `null`: server doesn't expose ICY metadata at all (give up polling)
 */
async function fetchOnce(streamUrl: string, signal: AbortSignal): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch(streamUrl, {
      headers: { 'Icy-MetaData': '1' },
      signal,
      // No-store: don't pollute browser cache with stream bytes
      cache: 'no-store',
    });
  } catch {
    return null;
  }
  const metaintHeader = res.headers.get('icy-metaint');
  const metaint = metaintHeader ? parseInt(metaintHeader, 10) : 0;
  if (!res.ok || !metaint || !res.body) {
    try { await res.body?.cancel(); } catch { /* ignore */ }
    return null;
  }

  const reader = res.body.getReader();
  const totalNeeded = metaint + 1 + MAX_METADATA_BYTES;
  let buffer = new Uint8Array(0);

  try {
    while (buffer.length < totalNeeded) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      const merged = new Uint8Array(buffer.length + value.length);
      merged.set(buffer);
      merged.set(value, buffer.length);
      buffer = merged;

      if (buffer.length > metaint) {
        const lengthByte = buffer[metaint];
        const metaLen = lengthByte * 16;
        if (metaLen === 0) {
          // No metadata in this block — server is alive but has nothing new
          return '';
        }
        if (buffer.length >= metaint + 1 + metaLen) {
          const metaBytes = buffer.subarray(metaint + 1, metaint + 1 + metaLen);
          // Try UTF-8 first; fall back to latin1 if it produces too many U+FFFD
          const utf8 = new TextDecoder('utf-8').decode(metaBytes);
          const text = /�/.test(utf8)
            ? new TextDecoder('iso-8859-1').decode(metaBytes)
            : utf8;
          const m = text.match(/StreamTitle='([^']*)'/);
          return m ? m[1].trim() : '';
        }
      }
    }
  } finally {
    try { await reader.cancel(); } catch { /* ignore */ }
  }
  return '';
}

export function parseStreamTitle(raw: string): ParsedTitle | null {
  const t = raw.trim();
  if (!t) return null;
  const idx = t.indexOf(' - ');
  if (idx > 0 && idx < t.length - 3) {
    return { artist: t.slice(0, idx).trim(), track: t.slice(idx + 3).trim(), raw: t };
  }
  return { track: t, raw: t };
}

export class IcyMetadataPoller {
  private timer: number | undefined;
  private controller: AbortController | undefined;
  private currentUrl: string | undefined;
  private generation = 0;
  private listener: (title: ParsedTitle | null) => void;

  constructor(listener: (title: ParsedTitle | null) => void) {
    this.listener = listener;
  }

  start(streamUrl: string, intervalMs = 30_000): void {
    if (this.currentUrl === streamUrl) return;
    this.stop();
    this.currentUrl = streamUrl;
    const myGen = ++this.generation;
    const tick = async (): Promise<void> => {
      if (myGen !== this.generation) return;
      this.controller?.abort();
      this.controller = new AbortController();
      const result = await fetchOnce(streamUrl, this.controller.signal);
      if (myGen !== this.generation) return;
      if (result === null) {
        // Server doesn't speak ICY-over-fetch — abandon this URL
        this.stop();
        return;
      }
      this.listener(parseStreamTitle(result));
    };
    void tick();
    this.timer = window.setInterval(() => void tick(), intervalMs);
  }

  stop(): void {
    this.generation++;
    this.currentUrl = undefined;
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
