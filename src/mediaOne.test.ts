import { describe, expect, it } from 'vitest';
import { mediaOneUrl, parseMediaOne } from './mediaOne';

const COVERS = 'https://www.mediaone-digital.ch/tracks/';

describe('mediaOneUrl', () => {
  it('builds the cache URL from a named or numeric slug', () => {
    expect(mediaOneUrl('onefm')).toBe('https://www.mediaone-digital.ch/cache/onefm.json');
    expect(mediaOneUrl(' 2402 ')).toBe('https://www.mediaone-digital.ch/cache/2402.json');
  });

  it('passes a full https URL through and rejects junk', () => {
    expect(mediaOneUrl('https://example.ch/x.json')).toBe('https://example.ch/x.json');
    expect(mediaOneUrl(undefined)).toBeNull();
    expect(mediaOneUrl('')).toBeNull();
    expect(mediaOneUrl('../evil')).toBeNull();
  });
});

describe('parseMediaOne', () => {
  // Trimmed from a live capture of cache/2402.json (One FM Rock Oldies).
  const sample = {
    live: [
      {
        title: "SWEET CHILD O' MINE",
        interpret: "GUNS N' ROSES",
        playtime: '2026-10-03T13:14Z',
        imageURL: `${COVERS}covers/guns_n__roses_sweet_child_o__mine.jpg`,
        imageFullURL: `${COVERS}covers/guns_n__roses_sweet_child_o__mine.jpg`,
      },
    ],
    played: [{ title: 'BORN TO BE WILD', interpret: 'STEPPENWOLF' }],
  };

  it('reads live[0], title-cases the ALL CAPS text and keeps the cover', () => {
    const r = parseMediaOne(sample);
    expect(r?.track).toBe("Sweet Child O' Mine");
    expect(r?.artist).toBe("Guns N' Roses");
    expect(r?.raw).toBe("GUNS N' ROSES - SWEET CHILD O' MINE");
    expect(r?.coverUrl).toBe(`${COVERS}covers/guns_n__roses_sweet_child_o__mine.jpg`);
  });

  it('drops the nocover.png placeholder', () => {
    const r = parseMediaOne({
      live: [{ title: 'INSTANT CRUSH', interpret: 'DAFT PUNK', imageFullURL: `${COVERS}nocover.png` }],
    });
    expect(r?.track).toBe('Instant Crush');
    expect(r?.coverUrl).toBeUndefined();
  });

  it('returns null without a current title', () => {
    expect(parseMediaOne({})).toBeNull();
    expect(parseMediaOne({ live: [] })).toBeNull();
    expect(parseMediaOne({ live: [{ interpret: 'X', title: '  ' }] })).toBeNull();
  });

  it('handles a title without an artist', () => {
    const r = parseMediaOne({ live: [{ title: 'JINGLE' }] });
    expect(r).toEqual({ artist: undefined, track: 'Jingle', raw: 'JINGLE', coverUrl: undefined });
  });
});
