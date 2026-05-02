import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string): string | null { return this.map.get(k) ?? null; }
  setItem(k: string, v: string): void { this.map.set(k, v); }
  removeItem(k: string): void { this.map.delete(k); }
  clear(): void { this.map.clear(); }
  key(i: number): string | null { return [...this.map.keys()][i] ?? null; }
  get length(): number { return this.map.size; }
}

const mem = new MemoryStorage();
vi.stubGlobal('localStorage', mem);

// Stub matchMedia — happy-dom 20 doesn't expose it. Default to the
// dark preference; individual tests override via mockMatchMedia.
let prefersLight = false;
type MMListener = (ev: MediaQueryListEvent) => void;
const listeners: MMListener[] = [];
function mockMatchMedia(query: string): MediaQueryList {
  const matches = query.includes('light') ? prefersLight : !prefersLight;
  return {
    matches,
    media: query,
    onchange: null,
    addEventListener: (_: 'change', cb: MMListener) => listeners.push(cb),
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
  } as unknown as MediaQueryList;
}
vi.stubGlobal('matchMedia', mockMatchMedia);
window.matchMedia = mockMatchMedia;

const theme = await import('./theme');

beforeEach(() => {
  mem.clear();
  listeners.length = 0;
  prefersLight = false;
  document.documentElement.removeAttribute('data-theme');
  // Reset / inject the theme-color meta so applyTheme has a target.
  document.head.innerHTML = '<meta name="theme-color" content="" />';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('readStoredTheme', () => {
  it('returns null when nothing is stored', () => {
    expect(theme.readStoredTheme()).toBe(null);
  });

  it('reads "light" or "dark"', () => {
    mem.setItem('rrradio.theme', 'light');
    expect(theme.readStoredTheme()).toBe('light');
    mem.setItem('rrradio.theme', 'dark');
    expect(theme.readStoredTheme()).toBe('dark');
  });

  it('rejects unknown values', () => {
    mem.setItem('rrradio.theme', 'rainbow');
    expect(theme.readStoredTheme()).toBe(null);
  });
});

describe('effectiveTheme', () => {
  it('uses the stored choice when set', () => {
    mem.setItem('rrradio.theme', 'light');
    expect(theme.effectiveTheme()).toBe('light');
  });

  it('falls back to OS dark preference when nothing is stored', () => {
    prefersLight = false;
    expect(theme.effectiveTheme()).toBe('dark');
  });

  it('falls back to OS light preference when nothing is stored', () => {
    prefersLight = true;
    expect(theme.effectiveTheme()).toBe('light');
  });
});

describe('applyTheme', () => {
  it('writes data-theme on <html>', () => {
    theme.applyTheme('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('persists the choice to storage', () => {
    theme.applyTheme('dark');
    expect(mem.getItem('rrradio.theme')).toBe('dark');
  });

  it('null clears the data-theme attribute and storage entry', () => {
    mem.setItem('rrradio.theme', 'dark');
    document.documentElement.setAttribute('data-theme', 'dark');
    theme.applyTheme(null);
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(mem.getItem('rrradio.theme')).toBe(null);
  });

  it('syncs the theme-color meta tag', () => {
    theme.applyTheme('light');
    expect(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content)
      .toBe('#fafaf8');
    theme.applyTheme('dark');
    expect(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content)
      .toBe('#0a0a0a');
  });
});

describe('toggleTheme', () => {
  it('flips dark → light', () => {
    mem.setItem('rrradio.theme', 'dark');
    expect(theme.toggleTheme()).toBe('light');
    expect(mem.getItem('rrradio.theme')).toBe('light');
  });

  it('flips light → dark', () => {
    mem.setItem('rrradio.theme', 'light');
    expect(theme.toggleTheme()).toBe('dark');
  });
});

describe('bootstrapTheme', () => {
  it('applies the persisted theme', () => {
    mem.setItem('rrradio.theme', 'light');
    theme.bootstrapTheme();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('subscribes to OS preference changes (re-syncs only when no explicit choice)', () => {
    theme.bootstrapTheme();
    expect(listeners.length).toBeGreaterThan(0);
    // Simulate an OS-level change. With nothing stored, applyTheme(null)
    // is the expected effect — clears any data-theme attribute (nothing
    // was set, so still no attribute) and resyncs the meta.
    listeners[0]({ matches: true, media: '(prefers-color-scheme: light)' } as MediaQueryListEvent);
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});
