import { describe, expect, it } from 'vitest';
import { GENRES, findGenre, stationMatchesGenre } from './genre-taxonomy';

const byId = new Map(GENRES.map((g) => [g.id, g]));

describe('GENRES', () => {
  it('has unique ids and non-empty labels/rbTag/match', () => {
    const ids = new Set<string>();
    for (const g of GENRES) {
      expect(g.id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(ids.has(g.id)).toBe(false);
      ids.add(g.id);
      expect(g.label.length).toBeGreaterThan(0);
      expect(g.rbTag.length).toBeGreaterThan(0);
      expect(g.match.length).toBeGreaterThan(0);
      for (const m of g.match) expect(m).toBe(m.toLowerCase());
    }
  });
});

describe('findGenre', () => {
  it('returns undefined for "all" / null / unknown', () => {
    expect(findGenre('all')).toBeUndefined();
    expect(findGenre(null)).toBeUndefined();
    expect(findGenre(undefined)).toBeUndefined();
    expect(findGenre('not-a-genre')).toBeUndefined();
  });
  it('returns the canonical record for a known id', () => {
    expect(findGenre('rock')?.label).toBe('Rock');
    expect(findGenre('hiphop')?.rbTag).toBe('hip hop');
  });
});

describe('stationMatchesGenre', () => {
  const rock = byId.get('rock')!;
  const hiphop = byId.get('hiphop')!;
  const oldies = byId.get('oldies')!;
  const latin = byId.get('latin')!;
  const ambient = byId.get('ambient')!;

  it('matches simple cases', () => {
    expect(stationMatchesGenre({ tags: ['rock'] }, rock)).toBe(true);
    expect(stationMatchesGenre({ tags: ['pop', 'hits'] }, rock)).toBe(false);
  });

  it('matches via substring (classic rock → rock)', () => {
    expect(stationMatchesGenre({ tags: ['classic rock'] }, rock)).toBe(true);
    expect(stationMatchesGenre({ tags: ['punk rock'] }, rock)).toBe(true);
    expect(stationMatchesGenre({ tags: ['alternative rock'] }, rock)).toBe(true);
  });

  it('matches synonyms via the match[] list', () => {
    // "hip hop" tag, "hip-hop" tag, "rap" tag — all map to the hiphop chip
    expect(stationMatchesGenre({ tags: ['hip hop'] }, hiphop)).toBe(true);
    expect(stationMatchesGenre({ tags: ['hip-hop'] }, hiphop)).toBe(true);
    expect(stationMatchesGenre({ tags: ['hiphop'] }, hiphop)).toBe(true);
    expect(stationMatchesGenre({ tags: ['rap'] }, hiphop)).toBe(true);
  });

  it('decade tags fold into oldies', () => {
    expect(stationMatchesGenre({ tags: ['80s'] }, oldies)).toBe(true);
    expect(stationMatchesGenre({ tags: ['oldies'] }, oldies)).toBe(true);
    expect(stationMatchesGenre({ tags: ['classic hits'] }, oldies)).toBe(true);
    expect(stationMatchesGenre({ tags: ['schlager'] }, oldies)).toBe(true);
  });

  it('latin family folds together', () => {
    expect(stationMatchesGenre({ tags: ['banda'] }, latin)).toBe(true);
    expect(stationMatchesGenre({ tags: ['grupera'] }, latin)).toBe(true);
    expect(stationMatchesGenre({ tags: ['reggaeton'] }, latin)).toBe(true);
    expect(stationMatchesGenre({ tags: ['mexican'] }, latin)).toBe(true);
    // Bare "noticias" (Spanish for "news") is also tagged latin since
    // RB uses it almost exclusively for Latin American stations.
    expect(stationMatchesGenre({ tags: ['noticias'] }, latin)).toBe(true);
  });

  it('matches case-insensitively', () => {
    expect(stationMatchesGenre({ tags: ['ROCK'] }, rock)).toBe(true);
    expect(stationMatchesGenre({ tags: ['Classic Rock'] }, rock)).toBe(true);
  });

  it('returns false for empty/missing tags', () => {
    expect(stationMatchesGenre({}, rock)).toBe(false);
    expect(stationMatchesGenre({ tags: [] }, rock)).toBe(false);
    expect(stationMatchesGenre({ tags: null }, rock)).toBe(false);
  });

  it('chillout and lounge fold into ambient', () => {
    expect(stationMatchesGenre({ tags: ['chillout'] }, ambient)).toBe(true);
    expect(stationMatchesGenre({ tags: ['lounge'] }, ambient)).toBe(true);
    expect(stationMatchesGenre({ tags: ['easy listening'] }, ambient)).toBe(true);
  });
});
