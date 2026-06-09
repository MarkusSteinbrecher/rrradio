import { describe, expect, it } from 'vitest';
import {
  ADAPTERS,
  POLICY,
  faviconState,
  getAdapter,
  indexSrgChannelList,
  parseSrgMetadataUrl,
  policyIncludes,
  srgAdapter,
  srgChannelListUrl,
} from './broadcaster-logos.mjs';

describe('parseSrgMetadataUrl', () => {
  it('extracts net + hex channel id (SRF/RTS/RTR style)', () => {
    expect(
      parseSrgMetadataUrl(
        'https://il.srf.ch/integrationlayer/2.0/srf/songList/radio/byChannel/69e8ac16-4327-4af4-b873-fd5cd6e895a7.json',
      ),
    ).toEqual({ net: 'srf', channelId: '69e8ac16-4327-4af4-b873-fd5cd6e895a7' });
    expect(
      parseSrgMetadataUrl(
        'https://il.srf.ch/integrationlayer/2.0/rts/songList/radio/byChannel/a9e7621504c6959e35c3ecbe7f6bed0446cdf8da.json',
      ),
    ).toEqual({ net: 'rts', channelId: 'a9e7621504c6959e35c3ecbe7f6bed0446cdf8da' });
  });

  it('extracts net + slug channel id (RSI style)', () => {
    expect(
      parseSrgMetadataUrl('https://il.srf.ch/integrationlayer/2.0/rsi/songList/radio/byChannel/rete-uno.json'),
    ).toEqual({ net: 'rsi', channelId: 'rete-uno' });
  });

  it('rejects non-SRG and malformed urls', () => {
    expect(parseSrgMetadataUrl('https://api.radiofrance.fr/livemeta/live/1/inter_player')).toBeNull();
    expect(parseSrgMetadataUrl('https://il.srf.ch/integrationlayer/2.0/xx/songList/radio/byChannel/a.json')).toBeNull();
    expect(parseSrgMetadataUrl('https://il.srf.ch/integrationlayer/2.0/srf/songList/radio/byChannel/.json')).toBeNull();
    expect(parseSrgMetadataUrl('')).toBeNull();
    expect(parseSrgMetadataUrl(null)).toBeNull();
    expect(parseSrgMetadataUrl(42)).toBeNull();
  });
});

describe('srgChannelListUrl', () => {
  it('builds the per-net channelList endpoint', () => {
    expect(srgChannelListUrl('rsi')).toBe('https://il.srf.ch/integrationlayer/2.0/rsi/channelList/radio.json');
  });
});

describe('indexSrgChannelList', () => {
  const doc = {
    channelList: [
      { id: 'rete-uno', title: 'Rete Uno', imageUrl: 'https://il.rsi.ch/.../rete-uno.png', imageTitle: 'Rete Uno Logo', timeTableUrl: '' },
      { id: 'rete-due', title: 'Rete Due', imageUrl: '  https://il.rsi.ch/.../rete-due.png  ' },
      { id: 'podcast', title: 'RSI Podcast', imageUrl: '' }, // no usable art → dropped
      { id: 'broken', title: 'No image field' }, // missing imageUrl → dropped
    ],
  };

  it('keys real channel art by id and trims the url', () => {
    const idx = indexSrgChannelList(doc);
    expect(idx.size).toBe(2);
    expect(idx.get('rete-uno').imageUrl).toBe('https://il.rsi.ch/.../rete-uno.png');
    expect(idx.get('rete-due').imageUrl).toBe('https://il.rsi.ch/.../rete-due.png');
    expect(idx.get('rete-uno').timeTableUrl).toBe('');
  });

  it('drops channels without usable image urls', () => {
    const idx = indexSrgChannelList(doc);
    expect(idx.has('podcast')).toBe(false);
    expect(idx.has('broken')).toBe(false);
  });

  it('tolerates missing / non-array documents', () => {
    expect(indexSrgChannelList(null).size).toBe(0);
    expect(indexSrgChannelList({}).size).toBe(0);
    expect(indexSrgChannelList({ channelList: 'nope' }).size).toBe(0);
  });
});

describe('faviconState', () => {
  it('flags a station with no favicon as missing', () => {
    expect(faviconState({})).toBe('missing');
    expect(faviconState({ favicon: '   ' })).toBe('missing');
    expect(faviconState({ favicon: 7 })).toBe('missing');
  });

  it('flags weak sources and site-default paths as generic', () => {
    expect(faviconState({ favicon: 'https://x/a.png', faviconSource: 'radio-browser' })).toBe('generic');
    expect(faviconState({ favicon: 'https://x/a.png', faviconSource: 'catalog-family-brand' })).toBe('generic');
    expect(faviconState({ favicon: 'https://x/a.png' })).toBe('generic'); // no source
    expect(faviconState({ favicon: 'https://example.com/favicon.ico', faviconSource: 'broadcaster-site' })).toBe('generic');
    expect(faviconState({ favicon: 'https://example.com/apple-touch-icon-180.png', faviconSource: 'wiki' })).toBe('generic');
  });

  it('treats deliberate per-station logos as good', () => {
    expect(faviconState({ favicon: 'https://upload.wikimedia.org/.../Logo_SRF_1.svg.png', faviconSource: 'wiki' })).toBe('good');
    expect(faviconState({ favicon: 'https://img.rts.ch/articles/2020/image/4kb71i.image', faviconSource: 'broadcaster-api' })).toBe('good');
    expect(faviconState({ favicon: 'stations/builtin-rtr.png', faviconSource: 'broadcaster-site' })).toBe('good');
  });
});

describe('policyIncludes', () => {
  it('MISSING writes only missing', () => {
    expect(policyIncludes(POLICY.MISSING, 'missing')).toBe(true);
    expect(policyIncludes(POLICY.MISSING, 'generic')).toBe(false);
    expect(policyIncludes(POLICY.MISSING, 'good')).toBe(false);
  });

  it('GENERIC writes missing + generic', () => {
    expect(policyIncludes(POLICY.GENERIC, 'missing')).toBe(true);
    expect(policyIncludes(POLICY.GENERIC, 'generic')).toBe(true);
    expect(policyIncludes(POLICY.GENERIC, 'good')).toBe(false);
  });

  it('ALL writes everything', () => {
    for (const s of ['missing', 'generic', 'good']) expect(policyIncludes(POLICY.ALL, s)).toBe(true);
  });
});

describe('srgAdapter', () => {
  const srf1 = {
    id: 'builtin-srf-1',
    metadataUrl: 'https://il.srf.ch/integrationlayer/2.0/srf/songList/radio/byChannel/abc.json',
  };
  const reteUno = {
    id: 'builtin-rsi-rete-uno',
    metadataUrl: 'https://il.srf.ch/integrationlayer/2.0/rsi/songList/radio/byChannel/rete-uno.json',
  };
  const notSrg = { id: 'x', metadataUrl: 'https://api.radiofrance.fr/livemeta/live/1/inter_player' };

  it('is registered and discoverable by name', () => {
    expect(ADAPTERS).toContain(srgAdapter);
    expect(getAdapter('SRG')).toBe(srgAdapter);
    expect(getAdapter('nope')).toBeNull();
  });

  it('match() identifies SRG stations only', () => {
    expect(srgAdapter.match(srf1)).toEqual({ net: 'srf', channelId: 'abc' });
    expect(srgAdapter.match(notSrg)).toBeNull();
  });

  it('sources() returns one channelList per present net, deduped + sorted', () => {
    const srf2 = { id: 'b', metadataUrl: 'https://il.srf.ch/integrationlayer/2.0/srf/songList/radio/byChannel/def.json' };
    const sources = srgAdapter.sources([srf1, srf2, reteUno, notSrg]);
    expect(sources).toEqual([
      { net: 'rsi', url: srgChannelListUrl('rsi') },
      { net: 'srf', url: srgChannelListUrl('srf') },
    ]);
  });

  it('resolve() joins channel id → image url into an apply-logos entry', () => {
    const indexByNet = new Map([
      ['srf', new Map([['abc', { channelId: 'abc', imageUrl: 'https://download-media.srf.ch/x', title: 'Radio SRF 1' }]])],
    ]);
    expect(srgAdapter.resolve(srf1, indexByNet)).toEqual({
      id: 'builtin-srf-1',
      url: 'https://download-media.srf.ch/x',
      source: 'broadcaster-api',
      sourceType: 'cdn',
      license: 'broadcaster',
      sourceUrl: srgChannelListUrl('srf'),
    });
  });

  it('resolve() returns null when the channel id is absent or station is not SRG', () => {
    expect(srgAdapter.resolve(srf1, new Map([['srf', new Map()]]))).toBeNull();
    expect(srgAdapter.resolve(notSrg, new Map())).toBeNull();
  });
});
