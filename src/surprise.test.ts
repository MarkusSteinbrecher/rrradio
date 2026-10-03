import { describe, expect, it } from 'vitest';
import {
  SURPRISE_AVOID_LIMIT,
  parseRecentPicks,
  pickSurprise,
  rememberPick,
} from './surprise';
import type { Station } from './types';

function st(id: string, extra: Partial<Station> = {}): Station {
  return { id, name: id, streamUrl: `https://example.com/${id}`, status: 'stream-only', ...extra };
}

const first = (): number => 0;
const last = (): number => 0.999;

describe('pickSurprise', () => {
  it('prefers working / icy-only / featured stations', () => {
    const list = [st('a', { favicon: 'x' }), st('b', { status: 'working' }), st('c', { status: 'icy-only' })];
    expect(pickSurprise(list, { random: first })?.id).toBe('b');
    expect(pickSurprise(list, { random: last })?.id).toBe('c');
    expect(pickSurprise([st('a'), st('f', { featured: true })], { random: first })?.id).toBe('f');
  });

  it('falls back to logo-carrying stream-only, then the rest', () => {
    expect(pickSurprise([st('a'), st('b', { favicon: 'x' })], { random: first })?.id).toBe('b');
    expect(pickSurprise([st('a')], { random: first })?.id).toBe('a');
  });

  it('never picks excluded (duplicate / broken) stations', () => {
    const list = [st('dup', { status: 'working' }), st('ok')];
    expect(pickSurprise(list, { exclude: new Set(['dup']), random: first })?.id).toBe('ok');
    expect(pickSurprise([st('dup')], { exclude: new Set(['dup']) })).toBeNull();
  });

  it('honours the active filter', () => {
    const list = [st('de', { country: 'DE', status: 'working' }), st('fr', { country: 'FR' })];
    const pick = pickSurprise(list, { matches: (s) => s.country === 'FR', random: first });
    expect(pick?.id).toBe('fr');
    expect(pickSurprise(list, { matches: () => false })).toBeNull();
  });

  it('skips recent picks while an alternative exists, even in a lower tier', () => {
    const list = [st('w', { status: 'working' }), st('s')];
    expect(pickSurprise(list, { avoid: ['w'], random: first })?.id).toBe('s');
  });

  it('repeats a recent pick only when nothing else is left', () => {
    expect(pickSurprise([st('only')], { avoid: ['only'] })?.id).toBe('only');
  });

  it('returns null for an empty catalog', () => {
    expect(pickSurprise([])).toBeNull();
  });

  it('covers the whole pool across the RNG range', () => {
    const list = ['a', 'b', 'c', 'd'].map((id) => st(id, { status: 'working' }));
    const seen = new Set<string>();
    for (let i = 0; i < 4; i++) seen.add(pickSurprise(list, { random: () => i / 4 })!.id);
    expect(seen.size).toBe(4);
  });
});

describe('rememberPick / parseRecentPicks', () => {
  it('keeps the newest first, de-duplicated and capped', () => {
    let recent: string[] = [];
    for (const id of ['a', 'b', 'a', 'c', 'd', 'e', 'f']) recent = rememberPick(recent, id);
    expect(recent[0]).toBe('f');
    expect(recent.length).toBe(SURPRISE_AVOID_LIMIT);
    expect(new Set(recent).size).toBe(recent.length);
  });

  it('parses persisted values defensively', () => {
    expect(parseRecentPicks(null)).toEqual([]);
    expect(parseRecentPicks('nope')).toEqual([]);
    expect(parseRecentPicks('{"a":1}')).toEqual([]);
    expect(parseRecentPicks('["a",2,"b"]')).toEqual(['a', 'b']);
  });
});
