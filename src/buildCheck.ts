/**
 * Stale-build reload (#666). There is no service worker, so a tab or
 * home-screen web app that stays open for weeks keeps running the JS it
 * first loaded — error-watch kept seeing fixes "not landing" because the
 * reports came from builds months old. Each deploy publishes
 * `version.json` (see vite.config.ts); when the page comes back into view
 * we compare it with our own stamp and reload onto the new build, but
 * never while audio is playing or loading.
 */

/** Don't re-ask the server more often than this. */
export const CHECK_INTERVAL_MS = 30 * 60_000;

export interface BuildCheckDeps {
  current: string;
  /** Resolves to the deployed version, or null when unknown. */
  fetchVersion: () => Promise<string | null>;
  /** True while audio is playing or loading — reload would cut it off. */
  isBusy: () => boolean;
  reload: () => void;
  now?: () => number;
}

/** Returns `check`: asks the server (throttled) whether a newer build
 *  is live and reloads onto it when the player is idle. Callers invoke
 *  it only at moments a reload is unobtrusive — the page becoming
 *  visible or hidden, or playback stopping while the page is hidden. */
export function createBuildChecker(deps: BuildCheckDeps): () => Promise<void> {
  const now = deps.now ?? Date.now;
  let lastCheck = -Infinity;
  let pending = false;

  return async () => {
    if (deps.current === 'dev') return;
    if (!pending && now() - lastCheck >= CHECK_INTERVAL_MS) {
      lastCheck = now();
      const live = await deps.fetchVersion();
      if (live && live !== deps.current) pending = true;
    }
    if (pending && !deps.isBusy()) deps.reload();
  };
}

/** Fetch `version.json`; any failure reads as "unknown". */
export async function fetchDeployedVersion(base: string): Promise<string | null> {
  try {
    const res = await fetch(`${base}version.json`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: unknown };
    return typeof data.version === 'string' ? data.version : null;
  } catch {
    return null;
  }
}
