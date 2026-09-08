/**
 * Edge second opinion client (ADR 002 phase 2 — "Edge second opinion").
 *
 * The daily probe sees the internet from one GitHub Actions ASN. Before a
 * *soft* failure streak (timeouts, 403s, 5xx — what geo-blocks and flaky
 * hosts look like from one place) turns into an unpublish, the policy asks
 * the stats Worker to look from Cloudflare's network:
 *
 *   GET <base>/api/admin/probe?url=<encoded>   Authorization: Bearer <token>
 *   → { url, s, ct, o, c, d, ms }              (worker/src/probe.ts)
 *
 * Every failure of the *question* (no token, non-2xx, timeout, bad JSON)
 * is `null` — "no opinion" — never a thrown error: the policy maps that to
 * `skipped: no-edge-opinion` and the run goes on. The Worker itself never
 * answers a failed *probe* with an error; that is a `bad` verdict.
 */

import { normaliseObservation } from './observations.mjs';

export const DEFAULT_BASE = 'https://stats.rrradio.org';
export const DEFAULT_TIMEOUT_MS = 12000;

/**
 * @typedef {{url: string, s: number|null, ct: string|null, o: 'ok'|'warn'|'bad',
 *            c: 'hard'|'soft'|null, d: string, ms: number}} EdgeAnswer
 */

/**
 * Ask the edge about one URL.
 * @param {string} url
 * @param {{base?: string, token?: string, timeoutMs?: number, fetchImpl?: typeof fetch}} [opts]
 * @returns {Promise<EdgeAnswer|null>}
 */
export async function edgeProbe(url, { base = DEFAULT_BASE, token, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch } = {}) {
  if (!token) return null;
  const endpoint = `${base.replace(/\/+$/, '')}/api/admin/probe?url=${encodeURIComponent(url)}`;
  try {
    const res = await fetchImpl(endpoint, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const body = await res.json();
    return pickAnswer(body, url);
  } catch {
    return null;
  }
}

/** Keep only the contract keys; reject anything that is not a verdict. */
function pickAnswer(body, url) {
  if (!body || typeof body !== 'object' || !['ok', 'warn', 'bad'].includes(body.o)) return null;
  return {
    url: typeof body.url === 'string' ? body.url : url,
    s: typeof body.s === 'number' ? body.s : null,
    ct: typeof body.ct === 'string' && body.ct ? body.ct.toLowerCase() : null,
    o: body.o,
    c: body.o === 'bad' && (body.c === 'hard' || body.c === 'soft') ? body.c : body.o === 'bad' ? 'soft' : null,
    d: typeof body.d === 'string' ? body.d : '',
    ms: typeof body.ms === 'number' ? body.ms : 0,
  };
}

/**
 * Ask about many URLs with a small worker pool. URLs past `max` are not
 * asked at all (they are absent from the map, which the policy reads as
 * "no opinion"); duplicates are asked once.
 *
 * @param {string[]} urls
 * @param {Parameters<typeof edgeProbe>[1]} [opts]
 * @param {{concurrency?: number, max?: number}} [limits]
 * @returns {Promise<Map<string, EdgeAnswer|null>>}
 */
export async function edgeProbeMany(urls, opts = {}, { concurrency = 4, max = 300 } = {}) {
  const queue = [...new Set(urls.filter((u) => typeof u === 'string' && u))].slice(0, Math.max(0, max));
  /** @type {Map<string, EdgeAnswer|null>} */
  const out = new Map();
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= queue.length) return;
      out.set(queue[i], await edgeProbe(queue[i], opts));
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * An edge answer as an observation row, so the second opinion becomes
 * history in the same log as the runner's rows.
 * @param {string} id station id
 * @param {EdgeAnswer} answer
 * @param {string} at ISO timestamp
 */
export function toEdgeObservation(id, answer, at) {
  return normaliseObservation({
    id,
    at,
    v: 'edge',
    f: 'stream',
    o: answer.o,
    c: answer.c,
    s: answer.s,
    ct: answer.ct,
    ms: answer.ms,
    d: answer.d,
    icy: 'na',
    r: false,
  });
}
