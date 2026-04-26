#!/usr/bin/env node
/**
 * Usage: node tools/probe-station.mjs <stream-url> [<metadata-url>]
 *        npm run probe -- <stream-url> [<metadata-url>]
 *
 * Probes a stream URL the way the rrradio app would from the browser:
 *   - CORS preflight for `Icy-MetaData`  (must be 2xx for the metadata
 *     fetch to succeed in a real browser)
 *   - GET with `Icy-MetaData: 1` to read the ICY headers and the first
 *     StreamTitle metadata block
 *   - Optional: HEAD a metadata-API URL to confirm CORS + content-type
 *
 * Emits a JSON blob suitable for pasting into data/stations.yaml notes.
 */

const ORIGIN = 'https://markussteinbrecher.github.io';
const TIMEOUT_MS = 10_000;
const MAX_METADATA_BYTES = 255 * 16;

const streamUrl = process.argv[2];
const metaUrl = process.argv[3];

if (!streamUrl) {
  console.error('usage: probe-station.mjs <stream-url> [<metadata-url>]');
  process.exit(1);
}

function timed(promise) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  return [promise(ctrl.signal), () => clearTimeout(timer)];
}

async function preflight(url) {
  const [p, done] = timed((signal) =>
    fetch(url, {
      method: 'OPTIONS',
      signal,
      headers: {
        Origin: ORIGIN,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'icy-metadata',
      },
    }),
  );
  try {
    const res = await p;
    return {
      status: res.status,
      allowOrigin: res.headers.get('access-control-allow-origin'),
      allowHeaders: res.headers.get('access-control-allow-headers'),
      allowMethods: res.headers.get('access-control-allow-methods'),
    };
  } catch (err) {
    return { status: 'failed', error: String(err) };
  } finally {
    done();
  }
}

async function readIcy(url) {
  const [p, done] = timed((signal) =>
    fetch(url, {
      signal,
      headers: { Origin: ORIGIN, 'Icy-MetaData': '1' },
    }),
  );
  try {
    const res = await p;
    const headers = {
      contentType: res.headers.get('content-type'),
      icyName: res.headers.get('icy-name'),
      icyBitrate: res.headers.get('icy-br'),
      icyGenre: res.headers.get('icy-genre'),
      icyMetaint: res.headers.get('icy-metaint'),
      icyExposed: res.headers.get('access-control-expose-headers'),
    };
    if (!res.ok || !res.body) {
      try { await res.body?.cancel(); } catch {}
      return { status: res.status, headers, streamTitle: null };
    }
    const metaint = headers.icyMetaint ? parseInt(headers.icyMetaint, 10) : 0;
    let streamTitle = null;
    if (metaint > 0) {
      const reader = res.body.getReader();
      let buf = new Uint8Array(0);
      const need = metaint + 1 + MAX_METADATA_BYTES;
      try {
        while (buf.length < need) {
          const { value, done: rdDone } = await reader.read();
          if (rdDone) break;
          if (!value) continue;
          const merged = new Uint8Array(buf.length + value.length);
          merged.set(buf); merged.set(value, buf.length); buf = merged;
          if (buf.length > metaint) {
            const len = buf[metaint] * 16;
            if (len === 0) { streamTitle = ''; break; }
            if (buf.length >= metaint + 1 + len) {
              const text = new TextDecoder('utf-8').decode(
                buf.subarray(metaint + 1, metaint + 1 + len),
              );
              const m = text.match(/StreamTitle='([^']*)'/);
              streamTitle = m ? m[1] : '';
              break;
            }
          }
        }
      } finally {
        try { await reader.cancel(); } catch {}
      }
    } else {
      // Brute-force scan for stations whose icy-metaint is hidden by CORS
      const reader = res.body.getReader();
      let buf = new Uint8Array(0);
      const PREFIX = Uint8Array.from([
        0x53, 0x74, 0x72, 0x65, 0x61, 0x6d, 0x54, 0x69, 0x74, 0x6c, 0x65, 0x3d, 0x27,
      ]);
      try {
        while (buf.length < 64 * 1024) {
          const { value, done: rdDone } = await reader.read();
          if (rdDone) break;
          if (!value) continue;
          const merged = new Uint8Array(buf.length + value.length);
          merged.set(buf); merged.set(value, buf.length); buf = merged;
          let idx = -1;
          outer: for (let i = 0; i <= buf.length - PREFIX.length; i++) {
            for (let j = 0; j < PREFIX.length; j++) if (buf[i + j] !== PREFIX[j]) continue outer;
            idx = i; break;
          }
          if (idx >= 0) {
            const start = idx + PREFIX.length;
            const end = buf.indexOf(0x27, start);
            if (end > 0) {
              streamTitle = new TextDecoder('utf-8').decode(buf.subarray(start, end));
              break;
            }
          }
        }
      } finally {
        try { await reader.cancel(); } catch {}
      }
    }
    return { status: res.status, headers, streamTitle };
  } catch (err) {
    return { status: 'failed', error: String(err) };
  } finally {
    done();
  }
}

async function probeMetadata(url) {
  const [p, done] = timed((signal) => fetch(url, { signal, headers: { Origin: ORIGIN } }));
  try {
    const res = await p;
    return {
      status: res.status,
      contentType: res.headers.get('content-type'),
      allowOrigin: res.headers.get('access-control-allow-origin'),
      bytes: res.headers.get('content-length'),
    };
  } catch (err) {
    return { status: 'failed', error: String(err) };
  } finally {
    done();
  }
}

const result = {
  streamUrl,
  preflight: await preflight(streamUrl),
  icy: await readIcy(streamUrl),
};
if (metaUrl) result.metadata = { url: metaUrl, ...(await probeMetadata(metaUrl)) };

// Verdict heuristic
const pf = result.preflight;
const icy = result.icy;
const verdict = [];
if (pf.status === 'failed') verdict.push('preflight unreachable');
else if (typeof pf.status === 'number' && pf.status >= 400) verdict.push('preflight blocked');
else verdict.push('preflight OK');
if (icy.headers?.icyMetaint) verdict.push('ICY metadata advertised');
if (icy.streamTitle) verdict.push(`current title: "${icy.streamTitle}"`);
else if (icy.streamTitle === '') verdict.push('ICY emitted empty StreamTitle');
result.verdict = verdict.join(' · ');

console.log(JSON.stringify(result, null, 2));
