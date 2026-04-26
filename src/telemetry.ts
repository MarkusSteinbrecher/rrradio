/**
 * Thin wrapper around GoatCounter's window.goatcounter.count API.
 *
 * The actual <script> is loaded conditionally from index.html (only on
 * non-localhost hosts), so window.goatcounter is undefined in dev.
 * Calls to track() then optional-chain to a no-op. No flag plumbing
 * needed.
 *
 * Conventions
 * - Use slash-prefixed paths for "navigation-like" events
 *   (`tab/browse`, `tab/playing`).
 * - Use `<verb>: <subject>` for actions on a station
 *   (`play: Bayern 1`, `favorite: FM4`).
 * - Use bare verbs for app-wide actions (`add-custom-station`, `search`).
 * - All calls pass `event: true` so they show up under "Events", not as
 *   pageviews. (Auto pageview-on-load remains the only pageview.)
 */

interface GoatCounter {
  count?: (vars: { path?: string; title?: string; event?: boolean }) => void;
}
declare global {
  interface Window {
    goatcounter?: GoatCounter;
  }
}

export function track(path: string, title?: string): void {
  try {
    window.goatcounter?.count?.({ path, title, event: true });
  } catch {
    /* analytics never breaks the app */
  }
}
