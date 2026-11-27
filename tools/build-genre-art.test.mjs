import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import {
  buildGenreArtPayload,
  imageHost,
  licensedPhotos,
  loadGenreArt,
  photoFileName,
  rotationIndex,
  serializePayload,
} from './build-genre-art.mjs';

const cover = (n, extra = {}) => ({
  artist: `Artist ${n}`,
  album: `Album ${n}`,
  image: `https://is1-ssl.mzstatic.com/image/thumb/Music/${n}/600x600bb.jpg`,
  ...extra,
});
const photo = (name) => ({ image: `https://rrradio.org/genre-art/${name}` });
const doc = (genres, extra = {}) => ({ schemaVersion: 1, rotateEveryDays: 7, genres, ...extra });
const square = { width: 480, height: 480 };

describe('rotationIndex', () => {
  const monday = Date.UTC(2026, 10, 23) / 1000; // Monday 2026-11-23 00:00 UTC

  it('changes on Monday 00:00 UTC with a 7-day period', () => {
    const before = rotationIndex(monday - 1, 7, 3);
    const after = rotationIndex(monday, 7, 3);
    expect(after).toBe((before + 1) % 3);
    expect(rotationIndex(monday + 6 * 86400 + 86399, 7, 3)).toBe(after);
    expect(rotationIndex(monday + 7 * 86400, 7, 3)).toBe((after + 1) % 3);
  });

  it('matches the formula in the contract', () => {
    const t = 1795000000;
    expect(rotationIndex(t, 7, 3)).toBe(Math.floor((t - 4 * 86400) / (7 * 86400)) % 3);
  });

  it('is 0 for a single set, clamps days to 1 and never goes negative', () => {
    expect(rotationIndex(monday, 7, 1)).toBe(0);
    expect(rotationIndex(monday, 0, 2)).toBe(rotationIndex(monday, 1, 2));
    expect(rotationIndex(-1, 7, 3)).toBe(2);
  });
});

describe('imageHost / photoFileName', () => {
  it('accepts only https on rrradio.org or *.mzstatic.com', () => {
    expect(imageHost('https://rrradio.org/genre-art/news-1.jpg')).toBe('site');
    expect(imageHost('https://is1-ssl.mzstatic.com/a/600x600bb.jpg')).toBe('apple');
    expect(imageHost('http://rrradio.org/genre-art/news-1.jpg')).toBeNull();
    expect(imageHost('https://evilmzstatic.com/a.jpg')).toBeNull();
    expect(imageHost('https://mzstatic.com.evil.org/a.jpg')).toBeNull();
    expect(imageHost('https://www.rrradio.org/genre-art/news-1.jpg')).toBeNull();
    expect(imageHost('not a url')).toBeNull();
  });

  it('reads the photo file name from a hosted photo URL', () => {
    expect(photoFileName('https://rrradio.org/genre-art/news-12.jpg')).toBe('news-12.jpg');
    expect(photoFileName('https://rrradio.org/genre-art/news-1.png')).toBeNull();
    expect(photoFileName('https://rrradio.org/other/news-1.jpg')).toBeNull();
    expect(photoFileName('https://rrradio.org/genre-art/news-1.jpg?v=2')).toBeNull();
  });
});

describe('licensedPhotos', () => {
  it('reads file → licence from the table', () => {
    const md = '| File | Licence |\n|---|---|\n| `news-1.jpg` | CC0 | x |\n| `talk-2.jpg` | Public domain | y |\n';
    expect([...licensedPhotos(md)]).toEqual([
      ['news-1.jpg', 'CC0'],
      ['talk-2.jpg', 'Public domain'],
    ]);
  });
});

describe('buildGenreArtPayload', () => {
  it('builds the contract shape, artist and album before image', () => {
    const { payload, errors } = buildGenreArtPayload(doc({ jazz: [[cover(1), cover(2), cover(3)]] }));
    expect(errors).toEqual([]);
    expect(payload.schemaVersion).toBe(1);
    expect(payload.rotateEveryDays).toBe(7);
    expect(Object.keys(payload.genres.jazz[0][0])).toEqual(['artist', 'album', 'image']);
    expect(serializePayload(payload).endsWith('}\n')).toBe(true);
  });

  it('defaults rotateEveryDays to 7 and rejects values under 1', () => {
    const genres = { jazz: [[cover(1), cover(2), cover(3)]] };
    expect(buildGenreArtPayload({ schemaVersion: 1, genres }).payload.rotateEveryDays).toBe(7);
    expect(buildGenreArtPayload(doc(genres, { rotateEveryDays: 0 })).errors[0]).toMatch(/rotateEveryDays/);
    expect(buildGenreArtPayload(doc(genres, { rotateEveryDays: 1.5 })).errors[0]).toMatch(/rotateEveryDays/);
  });

  it('rejects another schemaVersion, unknown keys and unknown genres', () => {
    const genres = { jazz: [[cover(1), cover(2), cover(3)]] };
    expect(buildGenreArtPayload(doc(genres, { schemaVersion: 2 })).errors[0]).toMatch(/schemaVersion/);
    expect(buildGenreArtPayload(doc(genres, { extra: 1 })).errors[0]).toMatch(/unknown top-level key/);
    expect(buildGenreArtPayload(doc({ polka: [[cover(1), cover(2), cover(3)]] })).errors[0]).toMatch(/not a catalog genre/);
    expect(buildGenreArtPayload(doc({ jazz: [[cover(1, { year: 1959 }), cover(2), cover(3)]] })).errors[0]).toMatch(/unknown key "year"/);
  });

  it('requires sets of exactly three', () => {
    expect(buildGenreArtPayload(doc({ jazz: [] })).errors[0]).toMatch(/non-empty list of sets/);
    expect(buildGenreArtPayload(doc({ jazz: [[cover(1), cover(2)]] })).errors[0]).toMatch(/exactly 3/);
    expect(buildGenreArtPayload(doc({ jazz: [[cover(1), cover(2), cover(3), cover(4)]] })).errors[0]).toMatch(/exactly 3/);
  });

  it('rejects a missing image, http and other hosts', () => {
    const bad = (image) => buildGenreArtPayload(doc({ jazz: [[cover(1, { image }), cover(2), cover(3)]] })).errors[0];
    expect(bad(undefined)).toMatch(/image is required/);
    expect(bad('http://is1-ssl.mzstatic.com/a.jpg')).toMatch(/must be https/);
    expect(bad('https://example.com/a.jpg')).toMatch(/must be https/);
  });

  it('rejects an image or an album used twice across music genres', () => {
    const sameImage = buildGenreArtPayload(
      doc({ jazz: [[cover(1), cover(2), cover(3)]], rock: [[cover(4), cover(5), cover(6, { image: cover(1).image })]] }),
    );
    expect(sameImage.errors.join('\n')).toMatch(/image already used at jazz set 1 entry 1/);
    const sameAlbum = buildGenreArtPayload(
      doc({ jazz: [[cover(1), cover(2), cover(3)], [cover(4), cover(5), cover(6, { artist: 'artist 1', album: 'ALBUM 1' })]] }),
    );
    expect(sameAlbum.errors.join('\n')).toMatch(/album already used at jazz set 1 entry 1/);
  });

  it('keeps album covers off rrradio.org and photos out of music genres', () => {
    const hosted = buildGenreArtPayload(doc({ jazz: [[photo('news-1.jpg'), cover(2), cover(3)]] }));
    expect(hosted.errors.join('\n')).toMatch(/do not host copies/);
    const covers = buildGenreArtPayload(doc({ news: [[cover(1), cover(2), cover(3)]] }));
    expect(covers.errors.join('\n')).toMatch(/spoken-word genres use photos/);
    expect(buildGenreArtPayload(doc({ jazz: [[{ image: cover(1).image }, cover(2), cover(3)]] })).errors[0]).toMatch(
      /needs artist and album/,
    );
  });

  it('checks a photo against its file and its licence row', () => {
    const genres = { news: [[photo('news-1.jpg'), photo('news-2.jpg'), photo('news-3.jpg')]] };
    const photos = new Map([
      ['news-1.jpg', square],
      ['news-2.jpg', { width: 640, height: 480 }],
    ]);
    const licences = new Map([
      ['news-1.jpg', 'CC0'],
      ['news-2.jpg', 'CC BY-SA 4.0'],
    ]);
    const text = buildGenreArtPayload(doc(genres), { photos, licences }).errors.join('\n');
    expect(text).toMatch(/news-2\.jpg is 640×480/);
    expect(text).toMatch(/news-2\.jpg is listed as "CC BY-SA 4\.0"/);
    expect(text).toMatch(/news-3\.jpg does not exist/);
    expect(text).toMatch(/news-3\.jpg has no row/);
    expect(text).not.toMatch(/news-1/);
  });

  it('wants a photo named for its genre, and a licence row for every file on disk', () => {
    const wrong = buildGenreArtPayload(doc({ news: [[photo('talk-1.jpg'), photo('news-2.jpg'), photo('news-3.jpg')]] }));
    expect(wrong.errors.join('\n')).toMatch(/talk-1\.jpg is not a news photo/);
    const orphan = buildGenreArtPayload(doc({}), { photos: new Map([['talk-9.jpg', square]]), licences: new Map() });
    expect(orphan.errors).toEqual(['public/genre-art/talk-9.jpg has no row in public/genre-art/SOURCES.md']);
  });
});

describe('data/genre-art.yaml', () => {
  it('passes every rule', () => {
    const { payload, errors } = loadGenreArt(join(import.meta.dirname, '..'));
    expect(errors).toEqual([]);
    expect(Object.keys(payload.genres).length).toBeGreaterThan(0);
  });
});
