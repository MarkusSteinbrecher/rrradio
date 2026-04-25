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

const MAX_METADATA_BYTES = 255 * 16;       // ICY length byte × 16
const SCAN_LIMIT_BYTES = 96 * 1024;        // hard cap for brute-force scan
// "StreamTitle='" — the literal byte sequence we look for in fallback mode
const STREAM_TITLE_PREFIX = Uint8Array.from(
  [0x53, 0x74, 0x72, 0x65, 0x61, 0x6d, 0x54, 0x69, 0x74, 0x6c, 0x65, 0x3d, 0x27],
);

function indexOf(buf: Uint8Array, needle: Uint8Array, from = 0): number {
  outer: for (let i = from; i <= buf.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (buf[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function decodeMaybeUtf8(bytes: Uint8Array): string {
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  return /�/.test(utf8) ? new TextDecoder('iso-8859-1').decode(bytes) : utf8;
}

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
      cache: 'no-store',
    });
  } catch {
    return null;
  }
  if (!res.ok || !res.body) {
    try { await res.body?.cancel(); } catch { /* ignore */ }
    return null;
  }

  // Most CORS-allowed Icecast servers DON'T set `Access-Control-Expose-Headers:
  // icy-metaint`, so JS sees that header as null even though the server is
  // sending it. Fall back to scanning the byte stream for the literal
  // `StreamTitle='...'` pattern, which is unambiguous against binary audio.
  const metaintHeader = res.headers.get('icy-metaint');
  const metaint = metaintHeader ? parseInt(metaintHeader, 10) : 0;
  return metaint > 0
    ? await readPrecise(res.body, metaint, signal)
    : await readBruteForce(res.body);
}

async function readPrecise(
  body: ReadableStream<Uint8Array>,
  metaint: number,
  signal: AbortSignal,
): Promise<string> {
  const reader = body.getReader();
  const totalNeeded = metaint + 1 + MAX_METADATA_BYTES;
  let buffer = new Uint8Array(0);
  try {
    while (buffer.length < totalNeeded) {
      if (signal.aborted) return '';
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      const merged = new Uint8Array(buffer.length + value.length);
      merged.set(buffer);
      merged.set(value, buffer.length);
      buffer = merged;

      if (buffer.length > metaint) {
        const metaLen = buffer[metaint] * 16;
        if (metaLen === 0) return '';
        if (buffer.length >= metaint + 1 + metaLen) {
          const text = decodeMaybeUtf8(buffer.subarray(metaint + 1, metaint + 1 + metaLen));
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

async function readBruteForce(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader();
  let buffer = new Uint8Array(0);
  let scannedTo = 0;
  try {
    while (buffer.length < SCAN_LIMIT_BYTES) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      const merged = new Uint8Array(buffer.length + value.length);
      merged.set(buffer);
      merged.set(value, buffer.length);
      buffer = merged;

      // Slide back a bit so we can catch a pattern that straddles a chunk
      const start = Math.max(0, scannedTo - STREAM_TITLE_PREFIX.length);
      const idx = indexOf(buffer, STREAM_TITLE_PREFIX, start);
      scannedTo = buffer.length;
      if (idx >= 0) {
        const valueStart = idx + STREAM_TITLE_PREFIX.length;
        const closeQuote = buffer.indexOf(0x27, valueStart);
        if (closeQuote > 0) {
          return decodeMaybeUtf8(buffer.subarray(valueStart, closeQuote)).trim();
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
