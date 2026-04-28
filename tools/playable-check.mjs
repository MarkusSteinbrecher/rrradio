#!/usr/bin/env node
/**
 * Playability check — given a stream URL, returns a verdict on
 * whether the stream is likely to play in our app (modern browsers
 * + hls.js for HLS, no .pls/.m3u parsing).
 *
 * Library + CLI in one file. Other tools import probeStream() to
 * batch-probe RB datasets.
 *
 *   node tools/playable-check.mjs <url>
 *
 * Verdicts (most-blocking first):
 *   broken-url        URL parse failed
 *   broken-mixed      stream is http:// (mixed-content blocks on https origin)
 *   broken-network    fetch failed / non-2xx after redirects
 *   broken-format     content-type isn't audio + URL isn't HLS
 *   needs-playlist    response is .pls / .m3u / .asx / .xspf — we don't parse
 *   redirect-downgrade ends on http:// after starting https://
 *   ok-hls            .m3u8 endpoint, plays via hls.js or native Safari
 *   ok                direct stream, content-type matches audio
 *
 * Each verdict carries a string `reason` for humans to read.
 */

import { setTimeout as delay } from 'node:timers/promises';

const ORIGIN = 'https://rrradio.org';
const TIMEOUT_MS = 10_000;
const USER_AGENT = 'rrradio-playable-check/1.0';

const PLAYLIST_EXT = /\.(pls|m3u|asx|xspf)(\?|$)/i;
const HLS_EXT = /\.m3u8(\?|$)/i;
const AUDIO_TYPES = [
  'audio/',
  'application/ogg',
  'application/octet-stream', // many Icecast servers serve raw audio with this
  'application/vnd.apple.mpegurl',
  'audio/mpegurl',
];

function isAudioContentType(ct) {
  if (!ct) return false;
  const lower = ct.toLowerCase();
  return AUDIO_TYPES.some((t) => lower.includes(t)) || lower.includes('mpegurl');
}

export async function probeStream(rawUrl) {
  if (!rawUrl) return { verdict: 'broken-url', reason: 'empty url' };

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { verdict: 'broken-url', reason: `cannot parse: ${rawUrl}` };
  }

  if (url.protocol === 'http:') {
    return {
      verdict: 'broken-mixed',
      reason: 'http:// stream blocks on rrradio.org (https origin)',
      finalUrl: url.toString(),
    };
  }

  if (PLAYLIST_EXT.test(url.pathname)) {
    return {
      verdict: 'needs-playlist',
      reason: `URL extension ${url.pathname.match(PLAYLIST_EXT)?.[1]} — we don't parse playlist files`,
      finalUrl: url.toString(),
    };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        Origin: ORIGIN,
        'Icy-MetaData': '1',
      },
      signal: ctrl.signal,
    });
    // We only need the headers — drop the body.
    try {
      await res.body?.cancel();
    } catch {
      /* ignored */
    }
  } catch (err) {
    return {
      verdict: 'broken-network',
      reason: String(err).slice(0, 120),
      finalUrl: url.toString(),
    };
  } finally {
    clearTimeout(timer);
  }

  const finalUrl = res.url || url.toString();
  if (!res.ok) {
    return {
      verdict: 'broken-network',
      reason: `HTTP ${res.status}`,
      finalUrl,
      status: res.status,
    };
  }

  if (finalUrl.startsWith('http://')) {
    return {
      verdict: 'redirect-downgrade',
      reason: 'redirect chain ends on http:// — mixed-content block',
      finalUrl,
    };
  }

  const ct = res.headers.get('content-type') || '';
  const isHls = HLS_EXT.test(new URL(finalUrl).pathname) || /mpegurl/i.test(ct);

  if (isHls) {
    return {
      verdict: 'ok-hls',
      reason: 'HLS stream — plays via hls.js / native Safari',
      finalUrl,
      contentType: ct,
    };
  }

  if (PLAYLIST_EXT.test(new URL(finalUrl).pathname)) {
    return {
      verdict: 'needs-playlist',
      reason: 'redirect resolved to a playlist file',
      finalUrl,
      contentType: ct,
    };
  }

  if (!isAudioContentType(ct)) {
    return {
      verdict: 'broken-format',
      reason: `content-type ${ct || '<missing>'} not audio-like`,
      finalUrl,
      contentType: ct,
    };
  }

  return {
    verdict: 'ok',
    reason: ct,
    finalUrl,
    contentType: ct,
  };
}

export async function probeBatch(urls, { concurrency = 5, onResult } = {}) {
  const results = new Array(urls.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, urls.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= urls.length) return;
      results[i] = await probeStream(urls[i]);
      if (onResult) onResult(i, results[i]);
      // tiny stagger so we don't burst
      await delay(20);
    }
  });
  await Promise.all(workers);
  return results;
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.argv[2];
  if (!url) {
    console.error('usage: node tools/playable-check.mjs <url>');
    process.exit(1);
  }
  const r = await probeStream(url);
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.verdict.startsWith('broken') ? 2 : 0);
}
