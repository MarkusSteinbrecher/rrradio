import { describe, expect, it } from 'vitest';
import {
  candidateUrlAllowed,
  dhashHex,
  dropPlatformDefaults,
  extractLogoCandidates,
  fillTargets,
  hamming,
  isAggregatorHomepage,
  manifestIcons,
  rejectDimensions,
  siteOf,
} from './logo-fill.mjs';

const PAGE = `<!doctype html><html><head>
<base href="/site/">
<link rel="icon" href="/favicon.ico">
<link rel="icon" type="image/png" sizes="192x192" href="icon-192.png">
<link rel="apple-touch-icon" sizes="120x120" href="touch-120.png">
<link rel='apple-touch-icon' sizes='180x180' href='https://cdn.example.net/touch-180.png?v=1&amp;x=2'>
<link rel="manifest" href="/manifest.webmanifest">
<meta property="og:image" content="https://radio.example/hero.jpg">
<meta name="og:image" content="http://radio.example/insecure.jpg">
<link rel="apple-touch-icon" href="https://scontent.fbcdn.net/avatar.png">
<script type="application/ld+json">{"@graph":[{"@type":"Organization","logo":{"url":"/brand/logo.png"}}]}</script>
</head><body></body></html>`;

describe('extractLogoCandidates', () => {
  const { candidates, manifestUrl } = extractLogoCandidates(PAGE, 'https://radio.example/home');

  it('orders by trust, largest declared size first within a kind', () => {
    expect(candidates.map((c) => [c.kind, c.url])).toEqual([
      ['apple-touch-icon', 'https://cdn.example.net/touch-180.png?v=1&x=2'],
      ['apple-touch-icon', 'https://radio.example/site/touch-120.png'],
      ['icon', 'https://radio.example/site/icon-192.png'],
      ['jsonld-logo', 'https://radio.example/brand/logo.png'],
      ['og:image', 'https://radio.example/hero.jpg'],
    ]);
  });

  it('drops http images, UGC hosts and the unsized favicon.ico', () => {
    const urls = candidates.map((c) => c.url);
    expect(urls).not.toContain('http://radio.example/insecure.jpg');
    expect(urls.some((u) => u.includes('fbcdn'))).toBe(false);
    expect(urls.some((u) => u.endsWith('favicon.ico'))).toBe(false);
  });

  it('reports the manifest, resolved against the page', () => {
    expect(manifestUrl).toBe('https://radio.example/manifest.webmanifest');
  });

  it('survives an empty or broken page', () => {
    expect(extractLogoCandidates('', 'https://x.example/')).toEqual({ candidates: [], manifestUrl: null });
    expect(extractLogoCandidates('<script type="application/ld+json">{oops</script>', 'https://x.example/').candidates).toEqual([]);
  });
});

describe('manifestIcons', () => {
  it('keeps icons of at least 120px, skips monochrome and small ones', () => {
    const icons = manifestIcons(
      { icons: [{ src: 'a-48.png', sizes: '48x48' }, { src: '/b-512.png', sizes: '192x192 512x512' }, { src: 'mono.png', sizes: '512x512', purpose: 'monochrome' }] },
      'https://radio.example/app/manifest.json',
    );
    expect(icons).toEqual([{ url: 'https://radio.example/b-512.png', kind: 'manifest-icon', declared: 512 }]);
    expect(manifestIcons(null, 'https://x.example/')).toEqual([]);
  });
});

describe('guards', () => {
  it('rejects by size and — for photo-prone kinds — by shape', () => {
    expect(rejectDimensions('apple-touch-icon', 180, 180, 'png')).toBeNull();
    expect(rejectDimensions('apple-touch-icon', 57, 57, 'png')).toBe('too-small');
    expect(rejectDimensions('apple-touch-icon', 600, 200, 'png')).toBeNull(); // a wide wordmark is a display problem, not a wrong logo
    expect(rejectDimensions('og:image', 1200, 630, 'jpeg')).toBe('not-square');
    expect(rejectDimensions('og:image', 150, 150, 'png')).toBe('too-small');
    expect(rejectDimensions('og:image', 512, 512, 'png')).toBeNull();
    expect(rejectDimensions('icon', 0, 0, 'svg')).toBeNull();
    expect(rejectDimensions('icon', 0, 0, 'png')).toBe('undecodable');
  });

  it('knows aggregator homepages and allowed image hosts', () => {
    expect(isAggregatorHomepage('https://www.facebook.com/someradio')).toBe(true);
    expect(isAggregatorHomepage('https://laut.fm/stoneprog')).toBe(true);
    expect(isAggregatorHomepage('not a url')).toBe(true);
    expect(isAggregatorHomepage('https://www.kusc.org/')).toBe(false);
    expect(candidateUrlAllowed('https://i0.wp.com/radio.example/logo.png')).toBe(true);
    expect(candidateUrlAllowed('http://radio.example/logo.png')).toBe(false);
    expect(candidateUrlAllowed('https://static.wixstatic.com/media/x.png')).toBe(false);
    expect(siteOf('https://www2.Radio.example/a')).toBe('radio.example');
  });
});

describe('dhash', () => {
  const ramp = (flip) => Uint8Array.from({ length: 72 }, (_, i) => (flip ? 8 - (i % 9) : i % 9) * 20);
  it('is stable, 64 bits, and far apart for opposite pictures', () => {
    expect(dhashHex(ramp(false))).toBe('0000000000000000');
    expect(dhashHex(ramp(true))).toBe('ffffffffffffffff');
    expect(hamming('0000000000000000', 'ffffffffffffffff')).toBe(64);
    expect(hamming('00ff', '01ff')).toBe(1);
    expect(hamming('00', '0000')).toBe(Infinity);
    expect(() => dhashHex(new Uint8Array(10))).toThrow();
  });
});

describe('dropPlatformDefaults', () => {
  const find = (id, site, hash) => ({ id, site, hash });
  it('drops a picture shared by three unrelated sites and remembers it', () => {
    const finds = [
      find('a', 'one.example', 'aaaaaaaaaaaaaaaa'),
      find('b', 'two.example', 'aaaaaaaaaaaaaaab'), // one bit off: same picture
      find('c', 'three.example', 'aaaaaaaaaaaaaaaa'),
      find('d', 'four.example', '0123456789abcdef'),
    ];
    const { kept, dropped, generic } = dropPlatformDefaults(finds);
    expect(kept.map((f) => f.id)).toEqual(['d']);
    expect(dropped.map((f) => f.id)).toEqual(['a', 'b', 'c']);
    expect(generic).toEqual(['aaaaaaaaaaaaaaaa']);
  });

  it('keeps a family mark: many sub-channels, one site', () => {
    const finds = ['x', 'y', 'z', 'w'].map((id) => find(id, 'rpr1.de', 'bbbbbbbbbbbbbbbb'));
    expect(dropPlatformDefaults(finds).kept).toHaveLength(4);
  });

  it('drops a single find that matches a hash learned on an earlier day', () => {
    const { kept, generic } = dropPlatformDefaults([find('a', 'one.example', 'aaaaaaaaaaaaaaa8')], ['aaaaaaaaaaaaaaaa']);
    expect(kept).toEqual([]);
    expect(generic).toEqual(['aaaaaaaaaaaaaaaa']);
  });
});

describe('fillTargets', () => {
  const published = [
    { id: 'tail-a', homepage: 'https://a.example/' },
    { id: 'tail-b', homepage: 'https://b.example/' },
    { id: 'has-logo', homepage: 'https://c.example/' },
    { id: 'agg', homepage: 'https://www.facebook.com/x' },
    { id: 'dead-home', homepage: 'https://d.example/' },
    { id: 'tried', homepage: 'https://e.example/' },
    { id: 'tried-long-ago', homepage: 'https://f.example/' },
    { id: 'hot', homepage: 'https://g.example/' },
    { id: 'curated', homepage: 'https://h.example/' },
    { id: 'no-home' },
    { id: 'just-filled', homepage: 'https://i.example/', favicon: 'https://i.example/logo.png' },
  ];
  const latestLogoDetail = new Map(published.map((s) => [s.id, s.id === 'has-logo' ? 'good' : 'missing']));
  const base = {
    published,
    latestLogoDetail,
    homepageVerdict: { 'dead-home': 'bad' },
    tiers: { curated: 'curated' },
    plays: { hot: 12 },
    attempts: { tried: { day: '2026-11-10' }, 'tried-long-ago': { day: '2026-09-01' } },
    day: '2026-11-23',
    max: 50,
  };

  it('selects logo-less stations with a live homepage of their own, most played first', () => {
    const ids = fillTargets(base).map((t) => t.id);
    expect(ids.slice(0, 2)).toEqual(['hot', 'curated']);
    expect([...ids].sort()).toEqual(['curated', 'hot', 'tail-a', 'tail-b', 'tried-long-ago']);
  });

  it('respects the budget', () => {
    expect(fillTargets({ ...base, max: 1 }).map((t) => t.id)).toEqual(['hot']);
    expect(fillTargets({ ...base, max: 0 })).toEqual([]);
  });
});
