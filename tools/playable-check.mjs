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
 *
 * http:// records get up to two https rescue attempts per level —
 * same-port scheme swap (browser mixed-content auto-upgrade) and the
 * default-port-443 variant (reverse-proxy TLS; catalog adopts the
 * verified URL). Upgrades recurse through redirect hops to depth 2.
 * Responses undici's strict parser rejects (bare-LF status lines)
 * fall back to a lenient raw-socket header fetch before the probe
 * gives up — browsers play those streams.
 */

import { setTimeout as delay } from 'node:timers/promises';
import net from 'node:net';
import tls from 'node:tls';

const ORIGIN = 'https://rrradio.org';
const TIMEOUT_MS = 10_000;
// How many https-upgrade levels a single probe may recurse through.
// Depth 2 models real browser behavior: mixed-content auto-upgrade
// applies per request, so an upgraded URL whose redirect lands back
// on http:// gets upgraded again (radiojar's tokened 302 chain).
const MAX_UPGRADE_DEPTH = 2;

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

function httpsVariants(rawUrl) {
  // Candidate https equivalents of an http URL, browser-like first:
  //   1. scheme swap keeping the port — what mixed-content auto-upgrade
  //      does (a working variant here plays with zero catalog changes)
  //   2. same host on default port 443 — the common reverse-proxy setup
  //      (Icecast on :8000, TLS terminated on 443; streamtheworld's
  //      :3690 → 443 is a whole CDN family). Not browser behavior, but
  //      the catalog can adopt the verified https URL outright.
  // Returns [] if input isn't a parseable http URL.
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'http:') return [];
    u.protocol = 'https:';
    const variants = [{ url: u.toString(), via: 'browser auto-upgrade' }];
    if (u.port && u.port !== '443') {
      const v = new URL(u);
      v.port = '';
      variants.push({ url: v.toString(), via: 'https variant on default port' });
    }
    return variants;
  } catch { return []; }
}

// Connection-level failures are a property of host:port, not path.
// Batch sweeps hit hosts with hundreds of records (abm21.com.au:8000
// carries 192 RB stations) — without a memo each one re-burns the
// ~20s connect timeout per https variant, serially within a host
// group. Path-level outcomes (4xx, wrong content-type) stay
// per-station and are NOT cached. Used for https-variant attempts and
// direct-http aliveness checks; primary probes of https records stay
// uncached (analyze-rb's per-host circuit breaker owns those).
const CONNECTION_FAILURES = new Set([
  'broken-tls', 'broken-dns', 'broken-refused', 'broken-timeout', 'broken-network',
]);
const deadOrigins = new Map(); // 'scheme://host:port' → verdict that killed it

// Try each https variant of `httpUrl`; first playable one wins. The
// reported finalUrl is the variant ENTRY url, not the inner probe's
// redirect destination — entry points are durable, redirect targets
// often carry per-session tokens (radiojar's rj-tok).
async function tryHttpsVariants(httpUrl, depth, context) {
  if (depth >= MAX_UPGRADE_DEPTH) return null;
  for (const { url: variant, via } of httpsVariants(httpUrl)) {
    const origin = new URL(variant).origin;
    if (deadOrigins.has(origin)) continue;
    const probe = await probeStream(variant, { _upgradeDepth: depth + 1 });
    if (probe.verdict === 'ok' || probe.verdict === 'ok-hls') {
      return {
        ...probe,
        reason: `${probe.reason} (${via} ${context})`,
        finalUrl: variant,
        upgradedFrom: httpUrl,
      };
    }
    if (CONNECTION_FAILURES.has(probe.verdict)) {
      deadOrigins.set(origin, probe.verdict);
    }
  }
  return null;
}

export async function probeStream(rawUrl, opts = {}) {
  const depth = opts._upgradeDepth ?? 0;
  if (!rawUrl) return { verdict: 'broken-url', reason: 'empty url' };

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { verdict: 'broken-url', reason: `cannot parse: ${rawUrl}` };
  }

  if (url.protocol === 'http:' && !opts._directHttp) {
    // Browsers auto-upgrade mixed-content audio. Try the https
    // equivalents — if one serves audio we report ok with provenance
    // so curators can see which upgrade made it playable.
    const upgraded = await tryHttpsVariants(rawUrl, depth, 'from http://');
    if (upgraded) return upgraded;

    // No https equivalent. "Alive but mixed-content-blocked" and
    // "actually dead" are different curation outcomes (http-only vs
    // broken in the tracker), so probe the http URL itself.
    const knownDead = deadOrigins.get(url.origin);
    const direct = knownDead
      ? { verdict: knownDead, reason: `host unreachable earlier in this run (memoized ${knownDead})`, finalUrl: url.toString() }
      : await probeStream(rawUrl, { _upgradeDepth: depth, _directHttp: true });
    if (!knownDead && CONNECTION_FAILURES.has(direct.verdict)) {
      deadOrigins.set(url.origin, direct.verdict);
    }
    const alive = direct.verdict === 'ok' || direct.verdict === 'ok-hls' || direct.verdict === 'needs-playlist';
    if (!alive) return direct; // dead http stream — report the real failure
    if ((direct.finalUrl || '').startsWith('https://')) {
      // The http record redirects to a working https stream — the
      // catalog can adopt that target outright.
      return {
        ...direct,
        reason: `${direct.reason} (http record redirects to https)`,
        upgradedFrom: rawUrl,
      };
    }
    return {
      verdict: 'broken-mixed',
      reason: `alive on plain http (${direct.contentType || direct.verdict}) but no https equivalent — mixed-content blocked on the https app origin`,
      finalUrl: url.toString(),
      httpAlive: true,
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
    const classified = classifyNetworkError(lastErr, url.toString());
    if (classified.verdict === 'probe-inconclusive') {
      // undici rejected the response (e.g. a bare-LF status line —
      // regiocast/streamabc send "HTTP/1.1 200 OK\n"). Browsers play
      // these fine, so retry with a lenient raw-socket client before
      // giving up on a verdict.
      const lenient = await lenientProbe(url.toString(), { allowHttp: opts._directHttp === true }).catch(() => null);
      if (lenient) return lenient;
    }
    return classified;
  }

  const finalUrl = res.url || url.toString();
  if (!res.ok) {
    return classifyHttpError(res.status, finalUrl);
  }

  if (finalUrl.startsWith('http://') && !opts._directHttp) {
    // Same mixed-content auto-upgrade flow as above, but applied to
    // the redirect destination. Browsers upgrade every request in a
    // media load, redirect hops included — so when the upgraded hop
    // plays, THIS request's https url is the durable entry point
    // (the hop url often carries per-session tokens).
    const upgraded = await tryHttpsVariants(finalUrl, depth, 'after redirect to http://');
    if (upgraded) {
      return { ...upgraded, finalUrl: url.toString() };
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

// ─── Lenient raw-socket fallback ─────────────────────────────────
// Some streaming servers send responses that violate HTTP/1.1 in ways
// browsers forgive but undici's parser rejects — the big family is a
// bare-LF status line ("HTTP/1.1 200 OK\n" with CRLF on every other
// header; regiocast/streamabc do this). When fetch() dies with an
// HTTPParserError we re-fetch over a raw TLS/TCP socket, parse the
// header block leniently, and classify with the same rules as the
// main path. Only the headers are read; the socket is destroyed
// before meaningful body download.

function rawHeaderFetch(targetUrl, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(targetUrl);
    const secure = u.protocol === 'https:';
    const port = Number(u.port) || (secure ? 443 : 80);
    const connect = secure
      ? () => tls.connect(port, u.hostname, { servername: u.hostname })
      : () => net.connect(port, u.hostname);
    const socket = connect();
    const headerLines = Object.entries(BROWSER_HEADERS)
      .map(([k, v]) => `${k}: ${v}`).join('\r\n');
    let buf = Buffer.alloc(0);
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      fn(value);
    };
    const timer = setTimeout(() => finish(reject, new Error('lenient probe timeout')), timeoutMs);
    socket.on('error', (err) => finish(reject, err));
    socket.on(secure ? 'secureConnect' : 'connect', () => {
      socket.write(
        `GET ${u.pathname}${u.search} HTTP/1.1\r\nHost: ${u.host}\r\n${headerLines}\r\nConnection: close\r\n\r\n`,
      );
    });
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const text = buf.toString('latin1');
      const end = text.search(/\r?\n\r?\n/);
      if (end === -1) {
        if (buf.length > 64 * 1024) finish(reject, new Error('no header terminator in 64KB'));
        return;
      }
      const head = text.slice(0, end);
      const [statusLine, ...rest] = head.split(/\r?\n/);
      // Lenient status line: HTTP/1.x, HTTP/2-ish, or Shoutcast's "ICY 200 OK".
      const m = statusLine.match(/^(?:HTTP\/\d(?:\.\d)?|ICY)\s+(\d{3})/i);
      if (!m) return finish(reject, new Error(`unparseable status line: ${statusLine.slice(0, 60)}`));
      const headers = {};
      for (const line of rest) {
        const idx = line.indexOf(':');
        if (idx > 0) headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
      }
      finish(resolve, { status: Number(m[1]), headers });
    });
    socket.on('end', () => finish(reject, new Error('connection ended before headers')));
  });
}

export async function lenientProbe(startUrl, { allowHttp = false } = {}) {
  let current = startUrl;
  for (let hop = 0; hop < 5; hop++) {
    const { status, headers } = await rawHeaderFetch(current, TIMEOUT_MS);
    if (status >= 300 && status < 400 && headers.location) {
      current = new URL(headers.location, current).toString();
      // Outside direct-http aliveness checks an http hop means the
      // strict path's mixed-content verdict stands.
      if (current.startsWith('http://') && !allowHttp) return null;
      continue;
    }
    if (!(status >= 200 && status < 300)) return classifyHttpError(status, current);
    const ct = headers['content-type'] || '';
    const icyMetaint = headers['icy-metaint'] || null;
    const note = ' (lenient HTTP parse — server violates HTTP/1.1, browsers play it)';
    if (HLS_EXT.test(new URL(current).pathname) || /mpegurl/i.test(ct)) {
      return { verdict: 'ok-hls', reason: 'HLS stream — plays via hls.js / native Safari' + note, finalUrl: current, contentType: ct };
    }
    if (PLAYLIST_EXT.test(new URL(current).pathname)) {
      return { verdict: 'needs-playlist', reason: 'resolved to a playlist file' + note, finalUrl: current, contentType: ct };
    }
    if (!isAudioContentType(ct)) {
      return { verdict: 'broken-format', reason: `content-type ${ct || '<missing>'} not audio-like` + note, finalUrl: current, contentType: ct };
    }
    return { verdict: 'ok', reason: ct + note, finalUrl: current, contentType: ct, icyMetaint };
  }
  return null; // redirect loop — keep the strict verdict
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
