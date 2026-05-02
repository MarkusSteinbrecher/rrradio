/**
 * Build-time config that ships to the browser.
 *
 * Single typed surface for the rrradio-stats Worker base URL. The
 * Worker hosts the GoatCounter proxy (admin + public stats) and the
 * broadcaster CORS proxies (Antenne, BR, HR, Radio Bremen, Radio Swiss,
 * BBC, SR). Both `src/main.ts` and `src/builtins.ts` need this URL
 * and used to hardcode it independently — audit #66 flagged the
 * drift risk.
 *
 * Override via `VITE_STATS_WORKER_BASE` in `.env.local` for a
 * locally-running `wrangler dev` (typically `http://localhost:8787`).
 * Production reads the literal default, so a fresh `vite build` with
 * no env file ships the same URL the dashboard expects.
 */

const DEFAULT_STATS_WORKER_BASE = 'https://rrradio-stats.markussteinbrecher.workers.dev';

/** Base URL of the rrradio-stats Cloudflare Worker (no trailing slash). */
export const STATS_WORKER_BASE: string =
  import.meta.env.VITE_STATS_WORKER_BASE?.replace(/\/$/, '') ?? DEFAULT_STATS_WORKER_BASE;

/** Public proxy endpoint for broadcaster APIs that lack CORS. The
 *  Worker enforces a regex allowlist; see worker/src/index.ts. */
export const STATS_PROXY = `${STATS_WORKER_BASE}/api/public/proxy`;

/** BBC-specific proxy base (Origin-gated by upstream). Append
 *  `/schedule/<service>` or `/play/<service>`. */
export const STATS_BBC_PROXY = `${STATS_WORKER_BASE}/api/public/bbc`;
