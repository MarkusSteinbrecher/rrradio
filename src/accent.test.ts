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

// happy-dom 20 doesn't expose matchMedia; default to the dark preference
// (matches theme.test.ts). effectiveTheme() reads the stored theme first,
// so tests pin the appearance via the `rrradio.theme` key.
function mockMatchMedia(query: string): MediaQueryList {
  return {
    matches: query.includes('light') ? false : true,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
  } as unknown as MediaQueryList;
}
vi.stubGlobal('matchMedia', mockMatchMedia);
window.matchMedia = mockMatchMedia;

const accent = await import('./accent');
const theme = await import('./theme');

const root = document.documentElement;

beforeEach(() => {
  mem.clear();
  root.style.removeProperty('--accent');
  root.style.removeProperty('--live-on');
  root.removeAttribute('data-theme');
  document.head.innerHTML = '<meta name="theme-color" content="" />';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('readAccent', () => {
  it('returns null when nothing is stored', () => {
    expect(accent.readAccent('dark')).toBe(null);
    expect(accent.readAccent('light')).toBe(null);
  });

  it('reads and lowercases a valid hex', () => {
    mem.setItem('rrradio.accent.dark', '#FF8800');
    expect(accent.readAccent('dark')).toBe('#ff8800');
  });

  it('rejects malformed values', () => {
    mem.setItem('rrradio.accent.light', 'red');
    expect(accent.readAccent('light')).toBe(null);
    mem.setItem('rrradio.accent.light', '#fff');
    expect(accent.readAccent('light')).toBe(null);
  });

  it('keeps light and dark independent', () => {
    mem.setItem('rrradio.accent.light', '#112233');
    expect(accent.readAccent('light')).toBe('#112233');
    expect(accent.readAccent('dark')).toBe(null);
  });
});

describe('accentValue', () => {
  it('falls back to the built-in default when unset', () => {
    expect(accent.accentValue('dark')).toBe(accent.DEFAULT_ACCENT.dark);
    expect(accent.accentValue('light')).toBe(accent.DEFAULT_ACCENT.light);
  });

  it('returns the custom value when set', () => {
    mem.setItem('rrradio.accent.dark', '#abcdef');
    expect(accent.accentValue('dark')).toBe('#abcdef');
  });
});

describe('DEFAULT_ACCENT', () => {
  it('mirrors the brand tokens (green light, yellow dark)', () => {
    expect(accent.DEFAULT_ACCENT.light).toBe('#00a040');
    expect(accent.DEFAULT_ACCENT.dark).toBe('#ffff00');
  });
});

describe('setAccent', () => {
  it('persists a valid hex and paints the override (current appearance)', () => {
    mem.setItem('rrradio.theme', 'dark');
    accent.setAccent('dark', '#123456');
    expect(mem.getItem('rrradio.accent.dark')).toBe('#123456');
    expect(root.style.getPropertyValue('--accent')).toBe('#123456');
    expect(root.style.getPropertyValue('--live-on')).toBe('#123456');
  });

  it('null clears the stored value and the override', () => {
    mem.setItem('rrradio.theme', 'dark');
    accent.setAccent('dark', '#123456');
    accent.setAccent('dark', null);
    expect(mem.getItem('rrradio.accent.dark')).toBe(null);
    expect(root.style.getPropertyValue('--accent')).toBe('');
  });

  it('treats an invalid hex as a clear', () => {
    mem.setItem('rrradio.theme', 'dark');
    accent.setAccent('dark', '#123456');
    accent.setAccent('dark', 'nope');
    expect(mem.getItem('rrradio.accent.dark')).toBe(null);
  });

  it('writing the non-active appearance does not paint the active one', () => {
    mem.setItem('rrradio.theme', 'dark');
    accent.setAccent('light', '#abcdef');
    // dark is active and has no custom → no override on the root
    expect(root.style.getPropertyValue('--accent')).toBe('');
  });
});

describe('applyAccent', () => {
  it('paints the override for the effective appearance', () => {
    mem.setItem('rrradio.theme', 'light');
    mem.setItem('rrradio.accent.light', '#0a0b0c');
    accent.applyAccent();
    expect(root.style.getPropertyValue('--accent')).toBe('#0a0b0c');
  });

  it('removes the override when the effective appearance is Standard', () => {
    mem.setItem('rrradio.theme', 'light');
    root.style.setProperty('--accent', '#999999');
    accent.applyAccent();
    expect(root.style.getPropertyValue('--accent')).toBe('');
  });
});

describe('bootstrapAccent + theme hook', () => {
  it('re-resolves the accent when the appearance flips', () => {
    mem.setItem('rrradio.accent.dark', '#222222');
    mem.setItem('rrradio.theme', 'dark');
    accent.bootstrapAccent();
    expect(root.style.getPropertyValue('--accent')).toBe('#222222');
    // Switch to light, which has no custom accent → override clears via the
    // onThemeApplied hook registered by bootstrapAccent.
    theme.applyTheme('light');
    expect(root.style.getPropertyValue('--accent')).toBe('');
    // Back to dark → the dark custom accent repaints.
    theme.applyTheme('dark');
    expect(root.style.getPropertyValue('--accent')).toBe('#222222');
  });
});
