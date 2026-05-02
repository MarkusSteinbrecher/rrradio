/**
 * Privacy-preserving runtime error reporting (audit #76).
 *
 * Captures `window.onerror`, unhandled promise rejections, catalog
 * load failures, and Worker fetch failures, and emits them as
 * GoatCounter events under the `error/*` namespace. No new third-
 * party endpoint, no new tracker — same privacy posture as the rest
 * of the app's telemetry.
 *
 * What we capture:
 *   - Build version (`__BUILD_VERSION__` injected by Vite at build
 *     time — short git SHA + ISO date).
 *   - Route (current path, e.g. `/` or `/station/grrif/`).
 *   - Error class (`Error.name` — e.g. `TypeError`, `AbortError`).
 *   - Truncated message (cap MAX_MESSAGE_CHARS, no PII).
 *   - Optional station id when relevant.
 *
 * What we deliberately do NOT capture:
 *   - Stack trace (can leak file paths from the user's machine if a
 *     local override / extension is in play; not worth the privacy hit
 *     when class + message already differentiate regressions).
 *   - User agent / IP / locale / timezone — already filtered by
 *     GoatCounter, but we don't add any of our own here either.
 *   - Free-form caller strings — every event goes through `errorEvent`
 *     so the path shape is uniform.
 *
 * GoatCounter event shape:
 *   path:  `error/<category>` — `runtime`, `promise`, `catalog`, `worker`, `stream`
 *   title: `<errorClass>: <truncated message> · <build> · <route>[ · station=<id>]`
 */

import { track } from './telemetry';

const MAX_MESSAGE_CHARS = 120;

/** Build version stamp injected by Vite (`define` in vite.config.ts).
 *  Falls back to "dev" when the constant isn't defined (e.g. tests). */
declare const __BUILD_VERSION__: string;
const BUILD: string =
  typeof __BUILD_VERSION__ !== 'undefined' ? __BUILD_VERSION__ : 'dev';

export type ErrorCategory =
  | 'runtime'   // window.onerror — synchronous JS exceptions
  | 'promise'   // unhandled promise rejection
  | 'catalog'   // failure loading public/stations.json
  | 'worker'    // failure calling the rrradio-stats Worker
  | 'stream';   // a station's audio stream errored (existing path)

/** Strip URLs / file paths / long whitespace runs from a message,
 *  then cap at MAX_MESSAGE_CHARS. The goal is a human-readable
 *  category, not a full reproducible trace. */
export function truncateErrorMessage(raw: unknown): string {
  if (raw == null) return '';
  let s = typeof raw === 'string' ? raw : String(raw);
  // Collapse whitespace.
  s = s.replace(/\s+/g, ' ').trim();
  // Strip absolute URLs (http(s) / file / blob) — they can carry
  // local paths or IDs the broadcaster's response embedded.
  s = s.replace(/\b(?:https?|file|blob):[^\s)]+/gi, '<url>');
  if (s.length > MAX_MESSAGE_CHARS) {
    s = s.slice(0, MAX_MESSAGE_CHARS - 1) + '…';
  }
  return s;
}

/** Pull the human-readable name off an unknown thrown value. */
export function errorClass(err: unknown): string {
  if (err instanceof Error && err.name) return err.name;
  if (err && typeof err === 'object' && 'name' in err) {
    const n = (err as { name?: unknown }).name;
    if (typeof n === 'string') return n;
  }
  return 'Error';
}

interface ReportContext {
  /** Per-event additional context — e.g. station id, worker route. */
  detail?: string;
  /** Override the route (useful if the error happens during navigation). */
  route?: string;
}

/** Single source of truth for emitting an error event. Keeps the
 *  path / title shape uniform across every category. */
export function errorEvent(
  category: ErrorCategory,
  err: unknown,
  ctx: ReportContext = {},
): void {
  const path = `error/${category}`;
  const cls = errorClass(err);
  const msg =
    err instanceof Error
      ? truncateErrorMessage(err.message)
      : truncateErrorMessage(err);
  const route = ctx.route ?? currentRoute();
  const parts = [`${cls}: ${msg}`, BUILD, route];
  if (ctx.detail) parts.push(ctx.detail);
  track(path, parts.join(' · '));
}

/** Best-effort current route — falls back to '/' if the host environment
 *  doesn't expose `location` (e.g. happy-dom test bootstrap). */
function currentRoute(): string {
  try {
    return window.location?.pathname || '/';
  } catch {
    return '/';
  }
}

let installed = false;
let errorHandler: ((event: ErrorEvent) => void) | null = null;
let rejectionHandler: ((event: PromiseRejectionEvent) => void) | null = null;

/** Install global handlers once. Idempotent — calling twice is a no-op. */
export function installGlobalErrorHandlers(): void {
  if (installed) return;
  installed = true;

  errorHandler = (event: ErrorEvent) => {
    // ErrorEvent.error can be null when the error originated from a
    // cross-origin script — fall back to event.message.
    const err = event.error ?? event.message ?? 'unknown';
    errorEvent('runtime', err);
  };
  window.addEventListener('error', errorHandler);

  rejectionHandler = (event: PromiseRejectionEvent) => {
    errorEvent('promise', event.reason ?? 'unknown');
  };
  window.addEventListener('unhandledrejection', rejectionHandler);
}

// Convenience helpers for the named categories — keep the call sites
// concise and prevent typos in `category` string literals.

export function reportCatalogError(err: unknown): void {
  errorEvent('catalog', err);
}

export function reportWorkerError(
  err: unknown,
  workerRoute: string,
  status?: number,
): void {
  const detail =
    status !== undefined ? `${workerRoute}@${status}` : workerRoute;
  errorEvent('worker', err, { detail });
}

export function reportStreamError(err: unknown, stationId: string): void {
  errorEvent('stream', err, { detail: `station=${stationId}` });
}

/** Reset the install-once latch and detach handlers — tests only. */
export function _resetForTests(): void {
  if (errorHandler) window.removeEventListener('error', errorHandler);
  if (rejectionHandler) window.removeEventListener('unhandledrejection', rejectionHandler);
  errorHandler = null;
  rejectionHandler = null;
  installed = false;
}
