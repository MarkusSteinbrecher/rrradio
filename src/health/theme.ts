/**
 * Light/dark theme for the catalog-health page — parity with the app.
 *
 * Self-contained on purpose: the page ships under a stricter CSP than the
 * app (`script-src 'self'`, no inline boot script) and must not pull app
 * modules along. It shares the app's `rrradio.theme` localStorage key so a
 * listener's explicit choice carries across rrradio.org and this page.
 *
 * With no explicit choice the palette follows prefers-color-scheme purely
 * in CSS (health.css), so the only repaint risk is the app's own: an
 * explicit choice that differs from the OS preference is applied once the
 * module runs. `html.theme-switching` suppresses transitions around that
 * swap so it reads as a single repaint.
 */

const THEME_KEY = 'rrradio.theme';
const DARK_BG = '#1e1d19';
const LIGHT_BG = '#f8f8f6';

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
    /* choice just won't persist */
  }
}

export function readStoredTheme(): Theme | null {
  const v = safeGet(THEME_KEY);
  return v === 'light' || v === 'dark' ? v : null;
}

export function effectiveTheme(): Theme {
  const stored = readStoredTheme();
  if (stored) return stored;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.classList.add('theme-switching');
  root.setAttribute('data-theme', theme);
  safeSet(THEME_KEY, theme);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => root.classList.remove('theme-switching'));
  });
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'light' ? LIGHT_BG : DARK_BG;
}

/** Apply a stored explicit choice at boot (the OS default needs no JS). */
export function bootstrapTheme(): void {
  const stored = readStoredTheme();
  if (stored) applyTheme(stored);
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Sun / moon glyphs built with createElementNS — no innerHTML under CSP. */
function themeIcon(theme: Theme): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  if (theme === 'dark') {
    // Currently dark → offer the sun.
    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('cx', '12');
    c.setAttribute('cy', '12');
    c.setAttribute('r', '4');
    svg.append(c);
    for (const d of ['M12 2v2', 'M12 20v2', 'M2 12h2', 'M20 12h2', 'm4.9 4.9 1.4 1.4', 'm17.7 17.7 1.4 1.4', 'm4.9 19.1 1.4-1.4', 'm17.7 6.3 1.4-1.4']) {
      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', d);
      svg.append(p);
    }
  } else {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z');
    svg.append(p);
  }
  return svg;
}

/** Wire a toggle button: swaps the theme and its own icon/label. */
export function wireThemeToggle(button: HTMLButtonElement): void {
  const render = (): void => {
    const now = effectiveTheme();
    button.replaceChildren(themeIcon(now));
    button.setAttribute('aria-label', now === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    button.title = button.getAttribute('aria-label') ?? '';
  };
  button.addEventListener('click', () => {
    applyTheme(effectiveTheme() === 'dark' ? 'light' : 'dark');
    render();
  });
  // Follow OS flips while no explicit choice is stored.
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (!readStoredTheme()) render();
  });
  render();
}
