import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Station } from './types';

/** In-memory localStorage stub — happy-dom 20 doesn't expose
 *  `localStorage` as a global by default, and we don't want tests
 *  coupled to the env's storage implementation anyway. Match the
 *  Storage interface's surface that storage.ts uses (getItem,
 *  setItem). The `failNext` hatch lets individual tests force a
 *  throw on the next call. */
class MemoryStorage {
  private map = new Map<string, string>();
  failNextGet = false;
  failNextSet = false;
  getItem(k: string): string | null {
    if (this.failNextGet) {
      this.failNextGet = false;
      throw new Error('access denied');
    }
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    if (this.failNextSet) {
      this.failNextSet = false;
      throw new Error('quota exceeded');
    }
    this.map.set(k, v);
  }
  removeItem(k: string): void { this.map.delete(k); }
  clear(): void { this.map.clear(); }
  key(i: number): string | null { return [...this.map.keys()][i] ?? null; }
  get length(): number { return this.map.size; }
}

const mem = new MemoryStorage();
vi.stubGlobal('localStorage', mem);

// Lazy-import storage.ts AFTER the global is stubbed, so the module's
// internal localStorage reference resolves to our memory stub.
const {
  getCustom,
  getFavorites,
  getRecents,
  isCustom,
  isFavorite,
  pushRecent,
  reorderFavorites,
  toggleFavorite,
} = await import('./storage');

const A: Station = {
  id: 'a',
  name: 'Station A',
  streamUrl: 'https://example.com/a',
};
const B: Station = {
  id: 'b',
  name: 'Station B',
  streamUrl: 'https://example.com/b',
};
const C: Station = {
  id: 'c',
  name: 'Station C',
  streamUrl: 'https://example.com/c',
};

beforeEach(() => {
  mem.clear();
  mem.failNextGet = false;
  mem.failNextSet = false;
});

describe('favorites', () => {
  it('starts empty', () => {
    expect(getFavorites()).toEqual([]);
    expect(isFavorite('a')).toBe(false);
  });

  it('toggleFavorite adds and returns true', () => {
    expect(toggleFavorite(A)).toBe(true);
    expect(getFavorites()).toEqual([A]);
    expect(isFavorite('a')).toBe(true);
  });

  it('toggleFavorite a second time removes and returns false', () => {
    toggleFavorite(A);
    expect(toggleFavorite(A)).toBe(false);
    expect(getFavorites()).toEqual([]);
    expect(isFavorite('a')).toBe(false);
  });

  it('preserves insertion order with newest first (unshift)', () => {
    toggleFavorite(A);
    toggleFavorite(B);
    toggleFavorite(C);
    expect(getFavorites().map((s) => s.id)).toEqual(['c', 'b', 'a']);
  });

  it('reorderFavorites respects the supplied id order', () => {
    toggleFavorite(A);
    toggleFavorite(B);
    toggleFavorite(C);
    reorderFavorites(['a', 'c', 'b']);
    expect(getFavorites().map((s) => s.id)).toEqual(['a', 'c', 'b']);
  });

  it('reorderFavorites silently drops unknown ids', () => {
    toggleFavorite(A);
    toggleFavorite(B);
    reorderFavorites(['ghost', 'a', 'b']);
    expect(getFavorites().map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('reorderFavorites appends ids the caller missed (concurrent toggle safety)', () => {
    toggleFavorite(A);
    toggleFavorite(B);
    toggleFavorite(C);
    // Storage holds [c, b, a] (newest first). Caller passed only 'a'.
    // The missed ids are appended in their stored order, so 'c' before 'b'.
    reorderFavorites(['a']);
    expect(getFavorites().map((s) => s.id)).toEqual(['a', 'c', 'b']);
  });
});

describe('recents', () => {
  it('starts empty', () => {
    expect(getRecents()).toEqual([]);
  });

  it('pushRecent prepends', () => {
    pushRecent(A);
    pushRecent(B);
    expect(getRecents().map((s) => s.id)).toEqual(['b', 'a']);
  });

  it('moves a re-played station back to the front (no duplicates)', () => {
    pushRecent(A);
    pushRecent(B);
    pushRecent(A);
    expect(getRecents().map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('caps at 12 entries', () => {
    for (let i = 0; i < 20; i++) {
      pushRecent({ id: `s${i}`, name: `S${i}`, streamUrl: 'https://x' });
    }
    expect(getRecents()).toHaveLength(12);
    expect(getRecents()[0].id).toBe('s19');
    expect(getRecents()[11].id).toBe('s8');
  });
});

describe('custom-station predicates', () => {
  it('getCustom returns [] when nothing is stored', () => {
    expect(getCustom()).toEqual([]);
  });

  it('isCustom returns false for unknown ids', () => {
    expect(isCustom('nope')).toBe(false);
  });
});

describe('localStorage failure modes', () => {
  it('returns [] when getItem throws (privacy mode / disabled)', () => {
    mem.failNextGet = true;
    expect(getFavorites()).toEqual([]);
  });

  it('swallows quota errors on setItem (toggleFavorite still resolves)', () => {
    mem.failNextSet = true;
    expect(() => toggleFavorite(A)).not.toThrow();
  });

  it('returns [] when stored JSON is malformed', () => {
    mem.setItem('rrradio.favorites.v2', '{not valid json');
    expect(getFavorites()).toEqual([]);
  });

  it('filters out non-Station rows from a tampered list', () => {
    const tampered = [A, null, 'not an object', { name: 'no id' }, B];
    mem.setItem('rrradio.favorites.v2', JSON.stringify(tampered));
    expect(getFavorites().map((s) => s.id)).toEqual(['a', 'b']);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
