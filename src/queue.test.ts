import { describe, expect, it } from 'vitest';
import { isListQueue, resolveQueue, stepQueue, type QueueDeps } from './queue';
import type { Station } from './types';

const st = (id: string): Station => ({ id, name: id.toUpperCase(), streamUrl: `https://x/${id}` });
const A = st('a');
const B = st('b');
const C = st('c');
const F1 = st('f1');
const F2 = st('f2');

function deps(lists: Record<string, Station[]> = {}, favorites: Station[] = [F1, F2]): QueueDeps {
  return { listStations: (id) => lists[id], favorites: () => favorites };
}

const ids = (s: Station[]): string[] => s.map((x) => x.id);

describe('resolveQueue', () => {
  it('uses the open station list (live from storage)', () => {
    expect(ids(resolveQueue({ kind: 'list', listId: 'l1' }, deps({ l1: [A, B, C] })))).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('uses favorites for a favorites source', () => {
    expect(ids(resolveQueue({ kind: 'favorites' }, deps()))).toEqual(['f1', 'f2']);
  });

  it('uses the snapshotted browse/search results', () => {
    expect(ids(resolveQueue({ kind: 'results', stations: [C, A] }, deps()))).toEqual(['c', 'a']);
  });

  it('uses the snapshotted recents order', () => {
    expect(ids(resolveQueue({ kind: 'recents', stations: [B, A] }, deps()))).toEqual(['b', 'a']);
  });

  it('falls back to favorites with no source', () => {
    expect(ids(resolveQueue(null, deps()))).toEqual(['f1', 'f2']);
  });

  it('falls back to favorites when the list was deleted or emptied', () => {
    expect(ids(resolveQueue({ kind: 'list', listId: 'gone' }, deps()))).toEqual(['f1', 'f2']);
    expect(ids(resolveQueue({ kind: 'list', listId: 'l1' }, deps({ l1: [] })))).toEqual([
      'f1',
      'f2',
    ]);
  });

  it('falls back to favorites when the results snapshot is empty', () => {
    expect(ids(resolveQueue({ kind: 'results', stations: [] }, deps()))).toEqual(['f1', 'f2']);
  });

  it('de-duplicates by id, first occurrence wins', () => {
    expect(ids(resolveQueue({ kind: 'results', stations: [A, B, A, C, B] }, deps()))).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('is empty when there is no source and no favorites', () => {
    expect(resolveQueue(null, deps({}, []))).toEqual([]);
  });
});

describe('stepQueue', () => {
  const q = [A, B, C];

  it('steps forward and backward', () => {
    expect(stepQueue(q, 'a', 1)?.id).toBe('b');
    expect(stepQueue(q, 'b', -1)?.id).toBe('a');
  });

  it('wraps circularly at both ends', () => {
    expect(stepQueue(q, 'c', 1)?.id).toBe('a');
    expect(stepQueue(q, 'a', -1)?.id).toBe('c');
  });

  it('jumps to the first (next) / last (previous) entry when current is not queued', () => {
    expect(stepQueue(q, 'zzz', 1)?.id).toBe('a');
    expect(stepQueue(q, 'zzz', -1)?.id).toBe('c');
    expect(stepQueue(q, '', 1)?.id).toBe('a');
  });

  it('stays put on a single-station queue that holds the current station', () => {
    expect(stepQueue([A], 'a', 1)).toBeUndefined();
    expect(stepQueue([A], 'b', 1)?.id).toBe('a');
  });

  it('returns undefined for an empty queue', () => {
    expect(stepQueue([], 'a', 1)).toBeUndefined();
  });
});

describe('isListQueue', () => {
  it('matches only the same list', () => {
    expect(isListQueue({ kind: 'list', listId: 'l1' }, 'l1')).toBe(true);
    expect(isListQueue({ kind: 'list', listId: 'l2' }, 'l1')).toBe(false);
    expect(isListQueue({ kind: 'favorites' }, 'l1')).toBe(false);
    expect(isListQueue(null, 'l1')).toBe(false);
  });
});
