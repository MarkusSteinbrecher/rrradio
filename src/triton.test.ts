import { describe, expect, it } from 'vitest';
import { TRITON_STALE_MS, parseTriton, tritonMount, tritonUrl } from './triton';

const NOW = 1792222100_000;

function xml(props: Record<string, string>, timestamp = NOW / 1000 - 60): string {
  const body = Object.entries(props)
    .map(([k, v]) => `<property name="${k}"><![CDATA[${v}]]></property>`)
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8"?><nowplaying-info-list>' +
    `<nowplaying-info mountName="X" timestamp="${timestamp}" type="track">${body}</nowplaying-info>` +
    `<nowplaying-info mountName="X" timestamp="${timestamp - 200}" type="track"><property name="cue_title"><![CDATA[Older]]></property></nowplaying-info>` +
    '</nowplaying-info-list>'
  );
}

describe('tritonMount', () => {
  it('reads the mount off livestream-redirect and direct node URLs', () => {
    expect(tritonMount('https://playerservices.streamtheworld.com/api/livestream-redirect/HRT_RADIO1AAC.aac')).toBe(
      'HRT_RADIO1AAC',
    );
    expect(tritonMount('https://playerservices.streamtheworld.com/api/livestream-redirect/CADENASER.mp3')).toBe(
      'CADENASER',
    );
    expect(tritonMount('https://27033.live.streamtheworld.com/KKMGFMAAC.aac?dist=oro_web')).toBe('KKMGFMAAC');
    expect(tritonMount('https://14223.live.streamtheworld.com/NZME_33AAC.m3u8')).toBe('NZME_33AAC');
    expect(tritonMount('https://18153.live.streamtheworld.com:443/RAC105.mp3;stream.mp3')).toBe('RAC105');
  });

  it('drops the Shoutcast _SC suffix but keeps codec suffixes', () => {
    expect(tritonMount('https://playerservices.streamtheworld.com/api/livestream-redirect/CONCIERTO_SC')).toBe(
      'CONCIERTO',
    );
    expect(tritonMount('https://26733.live.streamtheworld.com/PULAAAC_SC')).toBe('PULAAAC');
    expect(tritonMount('https://x.live.streamtheworld.com/NOVA_1069_AAC48.aac')).toBe('NOVA_1069_AAC48');
  });

  it('rejects non-Triton hosts and junk', () => {
    expect(tritonMount('https://streamtheworld.com.evil.example/FOO.aac')).toBeNull();
    expect(tritonMount('https://icecast.example.com/FOO.aac')).toBeNull();
    expect(tritonMount('https://playerservices.streamtheworld.com/')).toBeNull();
    expect(tritonMount('not a url')).toBeNull();
  });
});

describe('tritonUrl', () => {
  it('targets the public now-playing endpoint', () => {
    expect(tritonUrl('KKMGFM')).toBe(
      'https://np.tritondigital.com/public/nowplaying?mountName=KKMGFM&numberToFetch=1&eventType=track',
    );
  });
});

describe('parseTriton', () => {
  it('takes artist + title from the newest cue, with an https cover', () => {
    expect(
      parseTriton(
        xml({
          cue_title: 'Good times',
          track_artist_name: 'INXS',
          track_cover_url: 'https://recursosweb.prisaradio.com/fotos/dest/490002846423.jpg',
        }),
        { now: NOW },
      ),
    ).toEqual({
      artist: 'INXS',
      track: 'Good times',
      raw: 'INXS - Good times',
      coverUrl: 'https://recursosweb.prisaradio.com/fotos/dest/490002846423.jpg',
    });
  });

  it('title-cases ALL-CAPS feeds and leaves mixed case / CJK alone', () => {
    expect(parseTriton(xml({ cue_title: 'RIPTIDE', track_artist_name: 'VANCE JOY' }), { now: NOW })).toMatchObject({
      artist: 'Vance Joy',
      track: 'Riptide',
    });
    expect(parseTriton(xml({ cue_title: '瞬间的瞬间', track_artist_name: '林俊杰' }), { now: NOW })).toMatchObject({
      artist: '林俊杰',
      track: '瞬间的瞬间',
    });
  });

  it('splits "Artist - Title" when there is no artist field', () => {
    expect(parseTriton(xml({ cue_title: 'Oasis - Supersonic' }), { now: NOW })).toMatchObject({
      artist: 'Oasis',
      track: 'Supersonic',
    });
  });

  it('strips playout file extensions and ignores http covers', () => {
    expect(
      parseTriton(
        xml({ cue_title: 'The Way You Look At Me PCM.mp3', track_artist_name: 'Christian Bautista', track_cover_url: 'http://x/y.jpg' }),
        { now: NOW },
      ),
    ).toEqual({
      artist: 'Christian Bautista',
      track: 'The Way You Look At Me PCM',
      raw: 'Christian Bautista - The Way You Look At Me PCM',
      coverUrl: undefined,
    });
  });

  it('returns null for an unknown mount (empty list)', () => {
    expect(parseTriton('<?xml version="1.0" encoding="UTF-8"?><nowplaying-info-list></nowplaying-info-list>')).toBeNull();
  });

  it('returns null for a stale cue', () => {
    const old = (NOW - TRITON_STALE_MS - 60_000) / 1000;
    expect(parseTriton(xml({ cue_title: 'Feels', track_artist_name: 'Calvin Harris' }, old), { now: NOW })).toBeNull();
  });

  it('returns null for station idents and clock-time cues', () => {
    expect(parseTriton(xml({ cue_title: 'HRVATSKI RADIO' }), { now: NOW, stationName: 'Hrvatski Radio' })).toBeNull();
    expect(parseTriton(xml({ cue_title: '10:55' }), { now: NOW })).toBeNull();
    expect(parseTriton(xml({ track_artist_name: 'Someone' }), { now: NOW })).toBeNull();
  });
});
