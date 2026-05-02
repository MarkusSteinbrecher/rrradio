/**
 * Light/dark theme persistence + DOM application.
 *
 * Pulled out of `src/main.ts` (audit #77 — split large modules). Three
 * concerns in one place:
 *   1. localStorage round-trip via the safe `getString`/`setString`
 *      wrappers (so privacy mode / disabled-storage doesn't crash).
 *   2. `<html data-theme="...">` attribute that the CSS palette reads.
 *   3. `<meta name="theme-color">` sync so iOS Safari's status bar
 *      tints match the in-page palette.
 *
 * Behavior is contract-preserving — every callsite in main.ts kept
 * its previous semantics.
 */

import { getString, removeKey, setString } from './storage';

const THEME_KEY = 'rrradio.theme';

export type Theme = 'light' | 'dark';

/** Returns the user's explicit choice, or null if they haven't picked
 *  one (in which case the OS preference wins via {@link effectiveTheme}). */
export function readStoredTheme(): Theme | null {
  const v = getString(THEME_KEY);
  return v === 'light' || v === 'dark' ? v : null;
}

/** The theme actually in effect — stored choice if any, otherwise the
 *  OS-level preference via prefers-color-scheme. */
export function effectiveTheme(): Theme {
  const stored = readStoredTheme();
  if (stored) return stored;
  return window.matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark';
}

/** Apply a theme (or clear the explicit choice with `null`) and sync
 *  the iOS status-bar `<meta name="theme-color">` tint. */
export function applyTheme(theme: Theme | null): void {
  if (theme === null) {
    document.documentElement.removeAttribute('data-theme');
    removeKey(THEME_KEY);
  } else {
    document.documentElement.setAttribute('data-theme', theme);
    setString(THEME_KEY, theme);
  }
  const meta = document.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]',
  );
  if (meta) {
    meta.content = effectiveTheme() === 'light' ? '#fafaf8' : '#0a0a0a';
  }
}

/** Flip light↔dark and persist. The caller usually wants to track the
 *  result in telemetry — see the matching block in main.ts. */
export function toggleTheme(): Theme {
  const next: Theme = effectiveTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  return next;
}

/** Wire the once-per-session bootstrap: apply persisted theme before
 *  first paint so the palette is correct, and re-sync the theme-color
 *  meta when the OS preference changes (only when the user hasn't
 *  picked an explicit theme themselves). Idempotent. */
export function bootstrapTheme(): void {
  applyTheme(readStoredTheme());
  window
    .matchMedia('(prefers-color-scheme: light)')
    .addEventListener('change', () => {
      if (readStoredTheme() === null) applyTheme(null);
    });
}
