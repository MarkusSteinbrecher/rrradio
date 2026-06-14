import { describe, it, expect } from 'vitest';
import { broadcasterBase, sameSite, hostAllowed, aspectOk, scoreCandidate, rankCandidates } from './logo-candidates.mjs';

describe('host rules', () => {
  it('derives the broadcaster base, dropping www / wwwN', () => {
    expect(broadcasterBase('http://wdr2.de/')).toBe('wdr2.de');
    expect(broadcasterBase('https://www1.wdr.de/index.html')).toBe('wdr.de');
    expect(broadcasterBase('not a url')).toBe('');
  });

  it('matches subdomains of the broadcaster base', () => {
    expect(sameSite('www1.wdr.de', 'wdr.de')).toBe(true);
    expect(sameSite('wdr.de', 'wdr.de')).toBe(true);
    expect(sameSite('evil.com', 'wdr.de')).toBe(false);
  });

  it('allows wikimedia and the broadcaster domain, rejects http and UGC hosts', () => {
    expect(hostAllowed('https://upload.wikimedia.org/x/WDR.svg', 'wdr.de')).toBe(true);
    expect(hostAllowed('https://www.swr.de/assets/icon-512.png', 'swr.de')).toBe(true);
    expect(hostAllowed('http://www.swr.de/icon.png', 'swr.de')).toBe(false); // not https
    expect(hostAllowed('https://i.ibb.co/abc/soft-rock.jpg', 'example.de')).toBe(false); // UGC deny-list
    expect(hostAllowed('https://random.example.com/logo.png', 'wdr.de')).toBe(false); // unrelated host
  });
});

describe('aspect + scoring', () => {
  it('treats vectors and unknown sizes as acceptable, penalizes wide rasters', () => {
    expect(aspectOk(1000, 333, 'svg')).toBe(true);
    expect(aspectOk(null, null, 'png')).toBe(true);
    expect(aspectOk(512, 512, 'png')).toBe(true);
    expect(aspectOk(960, 200, 'png')).toBe(false);
  });

  it('ranks a square broadcaster PNG icon above a tiny favicon, and tanks placeholders', () => {
    const ctx = { stationName: 'SWR1', broadcasterHost: 'swr.de' };
    const icon = scoreCandidate({ kind: 'manifest-icon', url: 'https://www.swr.de/assets/swr1/icon-512.png', width: 512, height: 512, inHeader: false }, ctx);
    const tiny = scoreCandidate({ kind: 'link-icon', url: 'https://www.swr.de/favicon.ico', width: 16, height: 16 }, ctx);
    const dummy = scoreCandidate({ kind: 'og:image', url: 'https://www.swr.de/dummy-logo.jpg', width: 600, height: 600 }, ctx);
    expect(icon).toBeGreaterThan(tiny);
    expect(dummy).toBeLessThan(icon);
  });
});

describe('rankCandidates', () => {
  it('filters disallowed hosts, dedupes, and returns a bounded sorted shortlist', () => {
    const raw = [
      { kind: 'og:image', url: 'https://i.ibb.co/x/soft-rock.jpg', width: 600, height: 600 }, // UGC → dropped
      { kind: 'manifest-icon', url: 'https://www.byte.fm/icon-512.png', width: 512, height: 512 },
      { kind: 'manifest-icon', url: 'https://www.byte.fm/icon-512.png', width: 512, height: 512 }, // dup → dropped
      { kind: 'link-icon', url: 'https://www.byte.fm/favicon.ico', width: 16, height: 16 },
    ];
    const ranked = rankCandidates(raw, { stationName: 'ByteFM', broadcasterHost: 'byte.fm', limit: 8 });
    expect(ranked).toHaveLength(2);
    expect(ranked[0].url).toBe('https://www.byte.fm/icon-512.png');
    expect(ranked.every((c) => !c.url.includes('ibb.co'))).toBe(true);
  });
});
