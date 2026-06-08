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
