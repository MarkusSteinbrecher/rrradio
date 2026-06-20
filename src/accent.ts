/**
 * Custom accent colour — ported from the iOS Settings → COLOR section.
 *
 * iOS lets the listener override the brand accent independently for the
 * light and dark appearances (a green default in light, yellow in dark).
 * This mirrors that: a hex stored per appearance, applied as a
 * `--accent` / `--live-on` override on `<html>`. An inline CSSOM property
 * beats the stylesheet's `[data-theme]` palette rule, so the override
 * wins without touching the base tokens. Absent = "Standard" = the
 * built-in token.
 *
 * The override re-resolves on every theme application via the
 * {@link onThemeApplied} hook (see theme.ts), so flipping light↔dark —
 * or the OS doing it while on "System" — always paints the accent that
 * belongs to the appearance now in effect.
 */

import { getString, removeKey, setString } from './storage';
import { effectiveTheme, onThemeApplied, type Theme } from './theme';

const ACCENT_KEYS: Record<Theme, string> = {
  light: 'rrradio.accent.light',
  dark: 'rrradio.accent.dark',
};

/** Built-in brand accent per appearance — mirrors the CSS `--accent`
 *  tokens in style.css (green on light, pure yellow on dark). Used as the
 *  picker's starting value when no custom colour is set. */
export const DEFAULT_ACCENT: Record<Theme, string> = {
  light: '#00a040',
  dark: '#ffff00',
};

/** `#rrggbb` only — `<input type="color">` always emits this form. */
const HEX = /^#[0-9a-f]{6}$/i;

/** The user's custom accent for an appearance, or null if "Standard". */
export function readAccent(theme: Theme): string | null {
  const v = getString(ACCENT_KEYS[theme]);
  return v && HEX.test(v) ? v.toLowerCase() : null;
}

/** The hex to show in the picker for an appearance — custom if set,
 *  otherwise the built-in default so a fresh "Custom" pick starts there. */
export function accentValue(theme: Theme): string {
  return readAccent(theme) ?? DEFAULT_ACCENT[theme];
}

/** Persist (or clear, with `null`) the custom accent for an appearance and
 *  re-paint. Invalid hex is treated as a clear. */
export function setAccent(theme: Theme, hex: string | null): void {
  if (hex && HEX.test(hex)) setString(ACCENT_KEYS[theme], hex.toLowerCase());
  else removeKey(ACCENT_KEYS[theme]);
  applyAccent();
}

/** Push the current appearance's accent onto `<html>` (or clear the
 *  override so the base token shows through). */
export function applyAccent(): void {
  const root = document.documentElement;
  const custom = readAccent(effectiveTheme());
  if (custom) {
    root.style.setProperty('--accent', custom);
    root.style.setProperty('--live-on', custom);
  } else {
    root.style.removeProperty('--accent');
    root.style.removeProperty('--live-on');
  }
}

/** Apply the stored accent at boot and keep it in sync with theme flips.
 *  Call once, after {@link bootstrapTheme}. Idempotent. */
export function bootstrapAccent(): void {
  onThemeApplied(applyAccent);
  applyAccent();
}
