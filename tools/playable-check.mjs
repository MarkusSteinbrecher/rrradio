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
 *   probe-inconclusive Node's HTTP client could not model browser playback
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

// Send browser-equivalent headers. Many CDN edges (Cloudflare in
// particular) sniff User-Agent / Sec-Fetch-* / Referer and return
// DIFFERENT Location headers to browsers vs. plain HTTP clients —
// e.g. dancewave.online 302s plain curl to http://…:8080 (downgrade)
// but 302s real browsers to https://…:8082 (no downgrade). Probing
// with a stripped-down UA produced false `redirect-downgrade` verdicts.
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': ORIGIN + '/',
  'Origin': ORIGIN,
  'Sec-Fetch-Dest': 'audio',
  'Sec-Fetch-Mode': 'no-cors',
  'Sec-Fetch-Site': 'cross-site',
  'Icy-MetaData': '1',
};

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

// Sort a network-level fetch failure into a more actionable verdict.
// Distinguishes "endpoint is gone" (DNS, refused) from "endpoint is
// slow / flaky" (timeout) so curation can prioritize differently.
function classifyNetworkError(err, finalUrl) {
  // Node's fetch (undici) wraps the real network error in `err.cause`.
  // The outer message is usually a generic "TypeError: fetch failed"
  // so we have to walk both the outer error and the cause to pick up
  // codes / messages that identify the specific failure.
  const outerMsg = String(err || '');
  const causeMsg = String(err?.cause || '');
  const msg = outerMsg + ' ' + causeMsg;
  const name = err?.name || '';
  const code = err?.cause?.code || err?.code || err?.cause?.cause?.code || '';

  let verdict = 'broken-network';
  if (/HTTPParserError|Response does not match the HTTP\/1\.1 protocol|Expected HTTP\/|Missing expected CR|Parse Error/i.test(msg))
    verdict = 'probe-inconclusive';
  else if (name === 'AbortError' || /abort|timeout/i.test(msg)) verdict = 'broken-timeout';
  else if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(msg) || code === 'ENOTFOUND') verdict = 'broken-dns';
  else if (/CERT|SSL|TLS|HANDSHAKE|UNABLE_TO_VERIFY|self.signed|self-signed|altname|expired|HOSTNAME/i.test(msg)
           || /^ERR_TLS|^CERT_|^ERR_SSL|^DEPTH_ZERO|^UNABLE_TO/i.test(code))
    verdict = 'broken-tls';
  else if (/ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ECONNRESET|EPIPE/i.test(msg) ||
           ['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ECONNRESET', 'EPIPE'].includes(code))
    verdict = 'broken-refused';

  // Reason combines outer + cause when distinct so curators see the
  // actionable detail, not just "fetch failed".
  const reason = causeMsg && causeMsg !== outerMsg
    ? `${outerMsg} — ${causeMsg}`.slice(0, 200)
    : outerMsg.slice(0, 200);
  return { verdict, reason, finalUrl };
}

// HTTP status reached but isn't 2xx. 5xx and 4xx behave very differently
// in curation: 5xx often clears up; 4xx (esp. 403/451) usually means
// geo/auth blocking that's not going away.
function classifyHttpError(status, finalUrl) {
  let verdict = 'broken-network';
  if (status >= 500 && status <= 599) verdict = 'broken-5xx';
  else if (status >= 400 && status <= 499) verdict = 'broken-4xx';
  return { verdict, reason: `HTTP ${status}`, finalUrl, status };
}

function upgradeToHttps(rawUrl) {
  // Naive scheme swap — keeps port and path. Browsers' mixed-content
  // auto-upgrade for media is essentially this: try the https variant
  // on the same host, see if it works. Returns null if input isn't
  // a parseable http URL.
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'http:') return null;
    u.protocol = 'https:';
    return u.toString();
  } catch { return null; }
}

export async function probeStream(rawUrl, opts = {}) {
  const noUpgrade = opts._noUpgrade === true; // recursion guard
  if (!rawUrl) return { verdict: 'broken-url', reason: 'empty url' };

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { verdict: 'broken-url', reason: `cannot parse: ${rawUrl}` };
  }

  if (url.protocol === 'http:') {
    // Browsers auto-upgrade mixed-content audio. Try the https
    // equivalent — if it serves audio we report ok with provenance
    // so curators can see the auto-upgrade happened.
    if (!noUpgrade) {
      const upgraded = upgradeToHttps(rawUrl);
      if (upgraded) {
        const probe = await probeStream(upgraded, { _noUpgrade: true });
        if (probe.verdict === 'ok' || probe.verdict === 'ok-hls') {
          return {
            ...probe,
            reason: `${probe.reason} (browser auto-upgrade from http://)`,
            upgradedFrom: rawUrl,
          };
        }
      }
    }
    return {
      verdict: 'broken-mixed',
      reason: 'http:// stream blocks on rrradio.org (https origin); no https equivalent on same host',
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

  // One probe attempt. Returns a verdict object on success or an
  // Error to retry/classify upstream.
  async function attempt(timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        headers: BROWSER_HEADERS,
        signal: ctrl.signal,
      });
      try { await r.body?.cancel(); } catch { /* ignored */ }
      return r;
    } finally {
      clearTimeout(timer);
    }
  }

  // Single retry on aborts/timeouts — those are usually transient
  // (icecast servers occasionally slow-respond when busy). DNS / TLS
  // / refused errors don't retry; they're properties of the endpoint.
  let res;
  let lastErr;
  for (let attemptIdx = 0; attemptIdx < 2; attemptIdx++) {
    try {
      res = await attempt(attemptIdx === 0 ? TIMEOUT_MS : TIMEOUT_MS + 5_000);
      break;
    } catch (err) {
      lastErr = err;
      const msg = String(err);
      const isAbort = /abort/i.test(msg) || err?.name === 'AbortError';
      if (!isAbort) break; // only retry timeouts/aborts
      // Brief pause before retry so a transiently-busy server can recover.
      await delay(250);
    }
  }
  if (!res) {
    return classifyNetworkError(lastErr, url.toString());
  }

  const finalUrl = res.url || url.toString();
  if (!res.ok) {
    return classifyHttpError(res.status, finalUrl);
  }

  if (finalUrl.startsWith('http://')) {
    // Same mixed-content auto-upgrade flow as above, but applied to
    // the redirect destination. Cloudflare-style header-sniffing
    // SHOULD already have served us the https variant given the
    // browser headers we sent, so this branch is a fallback.
    if (!noUpgrade) {
      const upgraded = upgradeToHttps(finalUrl);
      if (upgraded) {
        const probe = await probeStream(upgraded, { _noUpgrade: true });
        if (probe.verdict === 'ok' || probe.verdict === 'ok-hls') {
          return {
            ...probe,
            reason: `${probe.reason} (browser auto-upgrade after redirect to http://)`,
            upgradedFrom: finalUrl,
          };
        }
      }
    }
    return {
      verdict: 'redirect-downgrade',
      reason: 'redirect chain ends on http:// — mixed-content block (no https equivalent on same host)',
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
  process.exit(r.verdict === 'ok' || r.verdict === 'ok-hls' ? 0 : 2);
}
