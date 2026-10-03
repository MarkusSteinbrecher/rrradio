import { describe, expect, it } from 'vitest';
import {
  CH_MEDIA_HASH,
  bnjUrl,
  chMediaUrl,
  energyUrl,
  parseBnj,
  parseChMedia,
  parseEnergy,
} from './chFetchers';

describe('chMediaUrl', () => {
  it('defaults the streamName to <skin>.main on the homepage origin', () => {
    expect(chMediaUrl('radio24', 'https://www.radio24.ch/')).toBe(
      `https://www.radio24.ch/api/pub/gql/radio24/AudioLiveData/${CH_MEDIA_HASH}?ttl=10&variables=${encodeURIComponent('{"streamName":"radio24.main"}')}`,
    );
  });

  it('takes a #streamName override and upgrades an http homepage', () => {
    const url = chMediaUrl('virginrock#virgin.rock', 'http://www.virginradio.ch/');
    expect(url).toContain('https://www.virginradio.ch/api/pub/gql/virginrock/AudioLiveData/');
    expect(url).toContain(encodeURIComponent('{"streamName":"virgin.rock"}'));
  });

  it('falls back to www.<skin>.ch and rejects junk', () => {
    expect(chMediaUrl('argovia', undefined)).toMatch(/^https:\/\/www\.argovia\.ch\/api\/pub\/gql\/argovia\//);
    expect(chMediaUrl('', 'https://x.ch')).toBeNull();
    expect(chMediaUrl('../x', 'https://x.ch')).toBeNull();
  });
});

describe('parseChMedia', () => {
  // Trimmed from a live AudioLiveData capture (Radio 24, 2026-10-03).
  const sample = {
    data: {
      audioPlayer: {
        stream: {
          live: {
            title: 'ON MY SOUL',
            interpret: 'BRUNO MARS',
            image: { imageUrl: 'https://static.az-cdn.ch/__ip/abc/def/n-mobile2x-1x1' },
          },
        },
        shows: { current: { title: 'Countdown', moderator: { name: 'Peter Stutz' } } },
      },
    },
  };

  it('maps track, cover and current show', () => {
    expect(parseChMedia(sample)).toEqual({
      artist: 'Bruno Mars',
      track: 'On My Soul',
      raw: 'BRUNO MARS - ON MY SOUL',
      coverUrl: 'https://static.az-cdn.ch/__ip/abc/def/n-mobile2x-1x1',
      program: { name: 'Countdown', subtitle: 'Peter Stutz' },
    });
  });

  it('returns program-only between songs, null when empty', () => {
    const r = parseChMedia({ data: { audioPlayer: { stream: null, shows: { current: { title: 'Weekend' } } } } });
    expect(r).toEqual({ track: undefined, raw: '', program: { name: 'Weekend', subtitle: undefined } });
    expect(parseChMedia({})).toBeNull();
  });
});

describe('BNJ', () => {
  it('builds the blob URL from the station code', () => {
    expect(bnjUrl('rtn')).toBe('https://bnj.blob.core.windows.net/mobile/ws/Live/LiveRTN.json');
    expect(bnjUrl('https://evil')).toBeNull();
  });

  it('parses a live capture (empty Cover dropped)', () => {
    expect(
      parseBnj({ Title: 'la lune', Artist: 'CHRISTOPHE MAE', Cover: '', Programm: 'La musique que vous aimez' }),
    ).toEqual({
      artist: 'Christophe Mae',
      track: 'La Lune',
      raw: 'CHRISTOPHE MAE - la lune',
      coverUrl: undefined,
      program: { name: 'La musique que vous aimez' },
    });
    expect(parseBnj({ Title: ' ' })).toBeNull();
  });
});

describe('Energy', () => {
  it('builds the playouts URL from the channel slug', () => {
    expect(energyUrl('bern')).toBe('https://energy.ch/api/channels/bern/playouts');
    expect(energyUrl('a/b')).toBeNull();
  });

  const list = [
    {
      playFrom: '2026-10-03T13:28:23+0200',
      imageUrl: 'https://storage.energy.ch/broadcast/covers/songs/31483_1601279079.jpg',
      title: 'The Business',
      artist: 'Tiesto',
    },
    { playFrom: '2026-10-03T13:25:33+0200', title: 'Older', artist: 'X' },
  ];
  const at = (iso: string): number => Date.parse(iso);

  it('takes the newest playout while it is fresh', () => {
    expect(parseEnergy(list, at('2026-10-03T11:31:00Z'))).toEqual({
      artist: 'Tiesto',
      track: 'The Business',
      raw: 'Tiesto - The Business',
      coverUrl: 'https://storage.energy.ch/broadcast/covers/songs/31483_1601279079.jpg',
    });
  });

  it('treats a stale head entry (talk / ads) as no track', () => {
    expect(parseEnergy(list, at('2026-10-03T11:45:00Z'))).toBeNull();
    expect(parseEnergy({ error: 'x' })).toBeNull();
    expect(parseEnergy([])).toBeNull();
  });
});
