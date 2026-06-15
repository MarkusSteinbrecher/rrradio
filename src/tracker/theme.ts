/**
 * Tracker console theme: light/dark parity with the main rrradio app.
 *
 * Mirrors src/theme.ts but kept self-contained — the console ships under
 * a stricter CSP and is deployed standalone, so it avoids importing app
 * modules. It shares the app's localStorage key, so a user's explicit
 * choice carries across rrradio.org and the console.
 *
 * The no-explicit-choice case is handled purely in CSS via
 * prefers-color-scheme (see tracker.css), so there is no render-blocking
 * inline script — which the console's `script-src 'self'` CSP forbids
 * anyway. The only flash risk is the app's: when an explicit choice
 * differs from the OS preference, the module-deferred boot may repaint
 * once. The html.theme-switching guard kills transitions during that
 * swap so it reads as a single repaint.
 */

const THEME_KEY = 'rrradio.theme';

export type Theme = 'light' | 'dark';

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // private mode / storage disabled
  }
}
function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode / storage disabled — choice just won't persist */
  }
}
function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** The user's explicit choice, or null if they haven't picked one (then
 *  the OS preference wins via {@link effectiveTheme}). */
export function readStoredTheme(): Theme | null {
  const v = safeGet(THEME_KEY);
  return v === 'light' || v === 'dark' ? v : null;
}

/** The theme actually in effect — stored choice if any, else the OS
 *  preference via prefers-color-scheme. */
export function effectiveTheme(): Theme {
  const stored = readStoredTheme();
  if (stored) return stored;
  return window.matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark';
}

/** Apply a theme (or clear the explicit choice with `null`) and sync the
 *  iOS status-bar `<meta name="theme-color">` tint to match the app. */
export function applyTheme(theme: Theme | null): void {
  const root = document.documentElement;
  root.classList.add('theme-switching');
  if (theme === null) {
    root.removeAttribute('data-theme');
    safeRemove(THEME_KEY);
  } else {
    root.setAttribute('data-theme', theme);
    safeSet(THEME_KEY, theme);
  }
  requestAnimationFrame(() => {
    requestAnimationFrame(() => root.classList.remove('theme-switching'));
  });
  const meta = document.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]',
  );
  if (meta) {
    meta.content = effectiveTheme() === 'light' ? '#f8f8f6' : '#1e1d19';
  }
}

/** Flip light↔dark and persist the explicit choice. */
export function toggleTheme(): Theme {
  const next: Theme = effectiveTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  return next;
}

/** Apply the persisted theme before the first view renders. Idempotent. */
export function bootstrapTheme(): void {
  applyTheme(readStoredTheme());
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(tag: string, attrs: Record<string, string>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

/** Sun (light in effect) / moon (dark in effect) glyph — built in the DOM
 *  rather than innerHTML to stay clear of the CSP. */
function themeIcon(theme: Theme): SVGElement {
  const root = svg('svg', {
    viewBox: '0 0 24 24',
    width: '16',
    height: '16',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  });
  if (theme === 'dark') {
    root.append(
      svg('path', { d: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z' }),
    );
  } else {
    root.append(svg('circle', { cx: '12', cy: '12', r: '4' }));
    const rays = [
      [12, 2, 12, 4],
      [12, 20, 12, 22],
      [4.93, 4.93, 6.34, 6.34],
      [17.66, 17.66, 19.07, 19.07],
      [2, 12, 4, 12],
      [20, 12, 22, 12],
      [4.93, 19.07, 6.34, 17.66],
      [17.66, 6.34, 19.07, 4.93],
    ];
    for (const [x1, y1, x2, y2] of rays) {
      root.append(
        svg('line', {
          x1: String(x1),
          y1: String(y1),
          x2: String(x2),
          y2: String(y2),
        }),
      );
    }
  }
  return root;
}

/** Wire a topbar toggle button: render the current-theme glyph, flip on
 *  click, and follow the OS when the user hasn't chosen explicitly. */
export function wireThemeToggle(btn: HTMLElement): void {
  const render = (): void => {
    const t = effectiveTheme();
    btn.replaceChildren(themeIcon(t));
    const label = t === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
    btn.setAttribute('aria-label', label);
    btn.setAttribute('title', label);
  };
  render();
  btn.addEventListener('click', () => {
    toggleTheme();
    render();
  });
  window
    .matchMedia('(prefers-color-scheme: light)')
    .addEventListener('change', () => {
      if (readStoredTheme() === null) {
        applyTheme(null);
        render();
      }
    });
}
