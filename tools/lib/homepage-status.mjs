/**
 * Pure classification of a homepage liveness probe into an actionable class.
 *
 * Split out from `tools/check-homepages.mjs` so the decision logic — the part
 * worth getting right — is unit-tested without touching the network.
 *
 * Classes:
 *   ok            final response 2xx (after following redirects)
 *   dead          4xx that means "this page is gone / wrong" — 404, 410, 400,
 *                 and other 4xx. THIS is the actionable signal: a dead homepage
 *                 silently disables logo scraping (see #469/#470).
 *   blocked       401 / 403 / 429 — auth-walled, geo-gated, or rate-limited.
 *                 The page may well be fine for a real browser; not actionable
 *                 on its own, so `--strict` does not fail on it.
 *   server-error  5xx after retries — upstream is broken, but transiently maybe.
 *   error         network-level failure (DNS, TLS, timeout, refused).
 *   redirect      3xx surfaced to the caller (only when redirects aren't
 *                 followed; the tool follows them, so this is mostly for tests).
 */

export const CLASS = Object.freeze({
  OK: 'ok',
  DEAD: 'dead',
  BLOCKED: 'blocked',
  SERVER_ERROR: 'server-error',
  ERROR: 'error',
  REDIRECT: 'redirect',
});

// Classes `--strict` treats as a gate failure. Only genuinely-dead pages —
// not rate-limited, auth-walled, or transiently 5xx ones — block a strict run.
export const STRICT_FAIL = Object.freeze(new Set([CLASS.DEAD]));

/**
 * Map an HTTP status code to a class.
 * @param {number} status final status code (after redirects)
 * @returns {string} one of CLASS.*
 */
export function classifyStatus(status) {
  if (!Number.isFinite(status) || status <= 0) return CLASS.ERROR;
  if (status >= 200 && status < 300) return CLASS.OK;
  if (status >= 300 && status < 400) return CLASS.REDIRECT;
  if (status === 401 || status === 403 || status === 429) return CLASS.BLOCKED;
  if (status >= 400 && status < 500) return CLASS.DEAD;
  if (status >= 500) return CLASS.SERVER_ERROR;
  return CLASS.ERROR;
}

/**
 * Normalise a thrown fetch error into a short, stable reason token so report
 * rows are groupable (`timeout`, `dns`, `tls`, `refused`, `aborted`, `network`).
 * @param {unknown} err
 * @returns {string}
 */
export function classifyError(err) {
  const msg = String(err?.message ?? err ?? '').toLowerCase();
  const cause = String(err?.cause?.code ?? err?.cause?.message ?? '').toLowerCase();
  const hay = `${msg} ${cause}`;
  if (hay.includes('timeout') || hay.includes('timed out') || err?.name === 'TimeoutError') return 'timeout';
  if (hay.includes('abort')) return 'timeout';
  if (hay.includes('enotfound') || hay.includes('eai_again') || hay.includes('getaddrinfo') || hay.includes('dns')) return 'dns';
  if (hay.includes('certificate') || hay.includes('tls') || hay.includes('ssl') || hay.includes('cert')) return 'tls';
  if (hay.includes('econnrefused') || hay.includes('refused')) return 'refused';
  if (hay.includes('econnreset') || hay.includes('reset')) return 'reset';
  return 'network';
}

/**
 * Whether a class/status pair is worth retrying — transient failures only.
 * @param {string} klass one of CLASS.*
 * @param {number} [status]
 * @returns {boolean}
 */
export function isRetryable(klass, status) {
  if (klass === CLASS.SERVER_ERROR) return true;
  if (klass === CLASS.ERROR) return true; // timeout / reset / transient DNS
  if (klass === CLASS.BLOCKED && status === 429) return true; // rate-limited
  return false;
}

/**
 * Record verdict for one homepage result — shared by the record mirror in
 * check-homepages (local sweeps) and the observation rows the daily loop
 * writes, so both writers produce byte-identical details.
 *
 *   ok → ok · blocked (401/403/429) / redirect → warn · dead / server-error /
 *   network error → bad
 *
 * @param {{status: number, class: string, reason?: string}} result
 * @returns {{v: 'ok'|'warn'|'bad', d?: string}}
 */
export function homepageVerdict(result) {
  const v = VERDICT_BY_CLASS[result.class] ?? 'bad';
  if (result.class === CLASS.OK) return { v };
  if (result.class === CLASS.ERROR) return { v, d: result.reason ?? 'network' };
  return { v, d: `HTTP ${result.status}` };
}

const VERDICT_BY_CLASS = Object.freeze({
  [CLASS.OK]: 'ok',
  [CLASS.BLOCKED]: 'warn',
  [CLASS.REDIRECT]: 'warn',
  [CLASS.DEAD]: 'bad',
  [CLASS.SERVER_ERROR]: 'bad',
  [CLASS.ERROR]: 'bad',
});

/**
 * Failure class for a bad homepage verdict (observation `c`). Only a page
 * that is unambiguously gone is hard; 5xx and network trouble are soft.
 * @param {{v: string, d?: string}} verdict
 * @returns {'hard'|'soft'|null}
 */
export function homepageFailureClass(verdict) {
  if (verdict.v !== 'bad') return null;
  return /^HTTP 4\d\d$/.test(verdict.d ?? '') || verdict.d === 'dns' || verdict.d === 'refused' ? 'hard' : 'soft';
}

/**
 * Observation row for the homepage facet. One per station, even when
 * several stations share the probed URL.
 * @param {{station: {id: string}, result: {status: number, class: string, reason?: string, ms?: number},
 *          at: string}} input
 */
export function toHomepageObservation({ station, result, at }) {
  const verdict = homepageVerdict(result);
  return {
    id: station.id,
    at,
    v: 'gha',
    f: 'homepage',
    o: verdict.v,
    c: homepageFailureClass(verdict),
    s: result.status > 0 ? result.status : null,
    ct: null,
    ms: typeof result.ms === 'number' ? result.ms : null,
    d: verdict.d ?? null,
    r: false,
  };
}

/**
 * Probe one homepage politely: a HEAD first (no body), and only when that
 * is not a clean 2xx a GET — many servers answer HEAD with 403/405/501 or
 * drop it, so a non-2xx HEAD is never a verdict on its own. The GET keeps
 * the original semantics: redirects followed, transient failures (5xx,
 * network, 429) retried with backoff.
 *
 * I/O is injected so the decision path is testable without the network.
 *
 * @param {string} url
 * @param {{fetch: typeof fetch, timeout: number, retries?: number,
 *          headers?: Record<string, string>, sleep?: (ms: number) => Promise<void>,
 *          now?: () => number}} io
 * @returns {Promise<{status: number, class: string, reason?: string, finalUrl?: string,
 *                    method: 'HEAD'|'GET', ms: number}>}
 */
export async function probeHomepage(url, io) {
  const { timeout, retries = 2, headers = {} } = io;
  const sleep = io.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = io.now ?? Date.now;
  const t0 = now();

  async function attempt(method) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    try {
      const res = await io.fetch(url, { method, redirect: 'follow', signal: ctl.signal, headers });
      try { await res.body?.cancel(); } catch { /* already consumed */ }
      return { res };
    } catch (err) {
      return { err };
    } finally {
      clearTimeout(timer);
    }
  }

  function done(method, res) {
    const row = { status: res.status, class: classifyStatus(res.status), method, ms: now() - t0 };
    if (res.redirected && res.url && res.url !== url) row.finalUrl = res.url;
    return row;
  }

  const head = await attempt('HEAD');
  if (head.res && classifyStatus(head.res.status) === CLASS.OK) return done('HEAD', head.res);

  for (let i = 0; ; i += 1) {
    const { res, err } = await attempt('GET');
    if (res) {
      const klass = classifyStatus(res.status);
      if (isRetryable(klass, res.status) && i < retries) {
        await sleep(300 * (i + 1) + Math.floor(Math.random() * 200));
        continue;
      }
      return done('GET', res);
    }
    if (i < retries) {
      await sleep(300 * (i + 1) + Math.floor(Math.random() * 200));
      continue;
    }
    return { status: 0, class: CLASS.ERROR, reason: classifyError(err), method: 'GET', ms: now() - t0 };
  }
}

/** Lower-cased host of a URL, or the URL itself when it does not parse. */
export function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return url;
  }
}

/**
 * Bounded worker pool that never has two requests in flight to the same
 * host — brand families share a homepage host, and hammering one server
 * with `concurrency` parallel GETs is exactly what a polite checker avoids.
 * With a `deadline` (epoch ms) no new item starts after it; items not
 * started are reported back so the caller can leave them unobserved.
 *
 * @template T
 * @param {T[]} items
 * @param {(item: T) => string} keyOf host key
 * @param {(item: T) => Promise<void>} worker
 * @param {{concurrency: number, deadline?: number|null, now?: () => number}} opts
 * @returns {Promise<{started: number, skipped: T[]}>}
 */
export async function runPolitePool(items, keyOf, worker, opts) {
  const now = opts.now ?? Date.now;
  const queue = [...items];
  const busy = new Set();
  let started = 0;
  /** @type {(() => void)[]} */
  let waiters = [];
  const wake = () => {
    const w = waiters;
    waiters = [];
    for (const fn of w) fn();
  };

  async function lane() {
    for (;;) {
      if (opts.deadline != null && now() >= opts.deadline) return;
      const idx = queue.findIndex((item) => !busy.has(keyOf(item)));
      if (idx < 0) {
        if (!queue.length) return;
        await new Promise((r) => waiters.push(r)); // every free item's host is busy
        continue;
      }
      const [item] = queue.splice(idx, 1);
      const key = keyOf(item);
      busy.add(key);
      started += 1;
      try {
        await worker(item);
      } finally {
        busy.delete(key);
        wake();
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency, items.length)) }, lane));
  return { started, skipped: queue };
}
