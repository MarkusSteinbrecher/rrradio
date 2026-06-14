import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Station } from './types';

/** In-memory localStorage stub — same approach as storage.test.ts.
 *  happy-dom doesn't expose localStorage as a global by default, and we
 *  don't want the tests coupled to the env's storage implementation. */
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
  get length(): number {
    return this.map.size;
  }
}

const mem = new MemoryStorage();
vi.stubGlobal('localStorage', mem);

const {
  addToList,
  createList,
  deleteList,
  getList,
  getLists,
  listContains,
  removeFromList,
  renameList,
  reorderListStations,
  setLists,
  toggleInList,
} = await import('./lists');

const A: Station = { id: 'a', name: 'Station A', streamUrl: 'https://example.com/a' };
const B: Station = { id: 'b', name: 'Station B', streamUrl: 'https://example.com/b' };
const C: Station = { id: 'c', name: 'Station C', streamUrl: 'https://example.com/c' };

beforeEach(() => {
  mem.clear();
});

describe('createList', () => {
  it('starts empty', () => {
    expect(getLists()).toEqual([]);
  });

  it('creates a named, empty list and prepends it', () => {
    const first = createList('Roadtrip', 100);
    const second = createList('Focus', 200);
    expect(first.name).toBe('Roadtrip');
    expect(first.stations).toEqual([]);
    expect(first.createdAt).toBe(100);
    // newest first
    expect(getLists().map((l) => l.name)).toEqual(['Focus', 'Roadtrip']);
    expect(getList(second.id)?.name).toBe('Focus');
  });

  it('trims the name and falls back to "Untitled list" when blank', () => {
    expect(createList('  Morning  ').name).toBe('Morning');
    expect(createList('   ').name).toBe('Untitled list');
  });

  it('gives each list a distinct id', () => {
    const a = createList('A');
    const b = createList('B');
    expect(a.id).not.toBe(b.id);
  });
});

describe('renameList', () => {
  it('renames an existing list', () => {
    const l = createList('Old');
    renameList(l.id, '  New  ');
    expect(getList(l.id)?.name).toBe('New');
  });

  it('ignores a blank rename (keeps the old name)', () => {
    const l = createList('Keep');
    renameList(l.id, '   ');
    expect(getList(l.id)?.name).toBe('Keep');
  });

  it('no-ops on an unknown id', () => {
    createList('Untouched');
    renameList('nope', 'X');
    expect(getLists().map((l) => l.name)).toEqual(['Untouched']);
  });
});

describe('deleteList', () => {
  it('removes only the named list', () => {
    const a = createList('A');
    const b = createList('B');
    deleteList(a.id);
    expect(getLists().map((l) => l.id)).toEqual([b.id]);
  });
});

describe('membership', () => {
  it('addToList adds without duplicates and returns added-state', () => {
    const l = createList('L');
    expect(addToList(l.id, A)).toBe(true);
    expect(addToList(l.id, A)).toBe(false); // already there
    expect(addToList(l.id, B)).toBe(true);
    expect(getList(l.id)?.stations.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('addToList appends (preserves insertion order)', () => {
    const l = createList('L');
    addToList(l.id, A);
    addToList(l.id, B);
    addToList(l.id, C);
    expect(getList(l.id)?.stations.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('removeFromList drops a station', () => {
    const l = createList('L');
    addToList(l.id, A);
    addToList(l.id, B);
    removeFromList(l.id, 'a');
    expect(getList(l.id)?.stations.map((s) => s.id)).toEqual(['b']);
  });

  it('toggleInList flips membership and returns the new state', () => {
    const l = createList('L');
    expect(toggleInList(l.id, A)).toBe(true);
    expect(listContains(l.id, 'a')).toBe(true);
    expect(toggleInList(l.id, A)).toBe(false);
    expect(listContains(l.id, 'a')).toBe(false);
  });

  it('addToList returns false for an unknown list', () => {
    expect(addToList('nope', A)).toBe(false);
  });
});

describe('reorderListStations', () => {
  it('reorders to the given id order', () => {
    const l = createList('L');
    addToList(l.id, A);
    addToList(l.id, B);
    addToList(l.id, C);
    reorderListStations(l.id, ['c', 'a', 'b']);
    expect(getList(l.id)?.stations.map((s) => s.id)).toEqual(['c', 'a', 'b']);
  });

  it('appends stations missing from the new order (no data loss)', () => {
    const l = createList('L');
    addToList(l.id, A);
    addToList(l.id, B);
    addToList(l.id, C);
    reorderListStations(l.id, ['b']);
    expect(getList(l.id)?.stations.map((s) => s.id)).toEqual(['b', 'a', 'c']);
  });
});

describe('persistence + resilience', () => {
  it('survives a round-trip through storage', () => {
    const l = createList('Persisted', 7);
    addToList(l.id, A);
    const again = getLists();
    expect(again).toEqual([
      { id: l.id, name: 'Persisted', stations: [A], createdAt: 7 },
    ]);
  });

  it('returns [] when storage holds garbage', () => {
    mem.setItem('rrradio.lists.v1', 'not json');
    expect(getLists()).toEqual([]);
  });

  it('drops malformed entries and non-station members on read', () => {
    setLists([
      // valid
      { id: 'ok', name: 'OK', stations: [A], createdAt: 1 },
      // missing name → dropped
      { id: 'bad' } as never,
    ]);
    // also stuff a bogus member into a valid list
    mem.setItem(
      'rrradio.lists.v1',
      JSON.stringify([
        { id: 'm', name: 'Mixed', stations: [A, { id: 5 }, { nope: true }], createdAt: 2 },
      ]),
    );
    const lists = getLists();
    expect(lists).toHaveLength(1);
    expect(lists[0].stations.map((s) => s.id)).toEqual(['a']);
  });
});
