import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  coverSrc,
  coversForRail,
  currentCovers,
  isAllowedImage,
  parseGenreArt,
  rotationIndex,
  SPOKEN_GENRES,
  type Cover,
} from './genre-art';
import { rotationIndex as buildRotationIndex, SPOKEN_GENRES as BUILD_SPOKEN } from '../tools/build-genre-art.mjs';
import type { Station } from './types';

const cover = (n: number | string): Cover => ({
  artist: `Artist ${n}`,
  album: `Album ${n}`,
  image: `https://is1-ssl.mzstatic.com/image/${n}/600x600bb.jpg`,
});
const set = (prefix: string): Cover[] => [cover(`${prefix}1`), cover(`${prefix}2`), cover(`${prefix}3`)];
const station = (id: string, tags: string[]): Station =>
  ({ id, name: id, streamUrl: `https://example.com/${id}`, tags }) as Station;

describe('isAllowedImage', () => {
  it('accepts only https on rrradio.org or *.mzstatic.com', () => {
    expect(isAllowedImage('https://rrradio.org/genre-art/news-1.jpg')).toBe(true);
    expect(isAllowedImage('https://is1-ssl.mzstatic.com/a.jpg')).toBe(true);
    expect(isAllowedImage('http://rrradio.org/genre-art/news-1.jpg')).toBe(false);
    expect(isAllowedImage('https://evilmzstatic.com/a.jpg')).toBe(false);
    expect(isAllowedImage('https://example.com/a.jpg')).toBe(false);
    expect(isAllowedImage(42)).toBe(false);
  });
});

describe('parseGenreArt', () => {
  it('reads sets and the rotation period', () => {
    const art = parseGenreArt({ schemaVersion: 1, rotateEveryDays: 3, genres: { jazz: [set('a'), set('b')] } });
    expect(art?.rotateEveryDays).toBe(3);
    expect(art?.sets.get('jazz')).toHaveLength(2);
  });

  it('ignores the whole file for another schemaVersion or a non-object', () => {
    expect(parseGenreArt({ schemaVersion: 2, genres: { jazz: [set('a')] } })).toBeNull();
    expect(parseGenreArt('nope')).toBeNull();
    expect(parseGenreArt({ schemaVersion: 1 })).toBeNull();
  });

  it('defaults a missing or invalid rotation period to 7', () => {
    expect(parseGenreArt({ genres: {} })?.rotateEveryDays).toBe(7);
    expect(parseGenreArt({ rotateEveryDays: 0, genres: {} })?.rotateEveryDays).toBe(7);
    expect(parseGenreArt({ rotateEveryDays: 'x', genres: {} })?.rotateEveryDays).toBe(7);
  });

  it('drops bad entries, short sets and genres with no set left; keeps the first three', () => {
    const bad = { image: 'https://example.com/x.jpg' };
    const art = parseGenreArt({
      genres: {
        jazz: [[bad, ...set('a'), cover('extra')], [cover('b1'), bad, cover('b2')], 'junk'],
        rock: [[cover('c1')]],
        folk: 'junk',
      },
    });
    expect(art?.sets.get('jazz')).toEqual([set('a')]);
    expect(art?.sets.has('rock')).toBe(false);
    expect(art?.sets.has('folk')).toBe(false);
  });
});

describe('rotationIndex', () => {
  it('matches the build tool at many moments', () => {
    for (const t of [-1, 0, 345600, 1795391999, 1795392000, 1795996800, 1900000000]) {
      for (const [days, count] of [[7, 3], [1, 2], [0, 3], [7, 1], [30, 5]]) {
        expect(rotationIndex(t, days, count)).toBe(buildRotationIndex(t, days, count));
      }
    }
  });

  it('moves to the next set on Monday 00:00 UTC', () => {
    const monday = Date.UTC(2026, 10, 23) / 1000;
    expect(rotationIndex(monday - 1, 7, 3)).toBe(0);
    expect(rotationIndex(monday, 7, 3)).toBe(1);
  });

  it('names the same spoken-word genres as the build tool', () => {
    expect([...SPOKEN_GENRES].sort()).toEqual([...BUILD_SPOKEN].sort());
  });
});

describe('currentCovers', () => {
  it('picks one set per genre by its own number of sets', () => {
    const art = parseGenreArt({ genres: { jazz: [set('a'), set('b'), set('c')], rock: [set('r')] } });
    const now = new Date(Date.UTC(2026, 10, 23));
    const current = currentCovers(art, now);
    expect(current.get('jazz')).toEqual(set('b'));
    expect(current.get('rock')).toEqual(set('r'));
    expect(currentCovers(null).size).toBe(0);
  });
});

describe('coverSrc', () => {
  it('loads a hosted photo from this origin and leaves album covers alone', () => {
    expect(coverSrc('https://rrradio.org/genre-art/news-1.jpg', '/')).toBe('/genre-art/news-1.jpg');
    expect(coverSrc('https://rrradio.org/genre-art/news-1.jpg', '/sub/')).toBe('/sub/genre-art/news-1.jpg');
    expect(coverSrc(cover(1).image, '/')).toBe(cover(1).image);
  });
});

describe('coversForRail', () => {
  const current = new Map<string, Cover[]>([
    ['jazz', set('jazz')],
    ['rock', set('rock')],
    ['soul', set('soul')],
    ['electronic', set('electronic')],
    ['indie', set('indie')],
    ['folk', set('folk')],
    ['hiphop', set('hiphop')],
    ['reggae', set('reggae')],
    ['pop', set('pop')],
    ['ambient', set('ambient')],
    ['news', [{ image: 'https://rrradio.org/genre-art/news-1.jpg' }, { image: 'https://rrradio.org/genre-art/news-2.jpg' }, { image: 'https://rrradio.org/genre-art/news-3.jpg' }]],
  ]);

  it('gives every station three covers, starting in its own genre', () => {
    const rows = coversForRail([station('a', ['jazz'])], current);
    const row = rows.get('a') ?? [];
    expect(row).toHaveLength(3);
    expect(row.every((c) => c.image.includes('/jazz'))).toBe(true);
  });

  it('shows no album twice on a rail while the pool lasts', () => {
    const stations = [station('a', ['jazz']), station('b', ['jazz']), station('c', ['rock']), station('d', ['eclectic'])];
    const rows = coversForRail(stations, current);
    const images = stations.flatMap((s) => (rows.get(s.id) ?? []).map((c) => c.image));
    expect(images).toHaveLength(12);
    expect(new Set(images).size).toBe(12);
  });

  it('never uses a photo, is stable per station, and is empty without pictures', () => {
    const rows = coversForRail([station('n', ['news'])], current);
    expect((rows.get('n') ?? []).every((c) => c.image.includes('mzstatic'))).toBe(true);
    expect(coversForRail([station('n', ['news'])], current)).toEqual(rows);
    expect(coversForRail([station('a', ['jazz'])], new Map()).size).toBe(0);
  });
});

describe('public/genre-art.json', () => {
  it('is fully usable by this client', () => {
    const raw = JSON.parse(readFileSync(join(import.meta.dirname, '../public/genre-art.json'), 'utf8')) as {
      genres: Record<string, unknown[]>;
    };
    const art = parseGenreArt(raw);
    for (const [id, sets] of Object.entries(raw.genres)) expect(art?.sets.get(id)).toHaveLength(sets.length);
  });
});
