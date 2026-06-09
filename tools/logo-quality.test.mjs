import { describe, expect, it } from 'vitest';
import {
  classifyLogoUrl,
  isNonFreeWikiLogo,
  scoreLogoCandidate,
  shouldReplaceLogo,
} from './logo-quality.mjs';

describe('classifyLogoUrl', () => {
  it('marks local station assets as curated and not upgradable', () => {
    const out = classifyLogoUrl('stations/fm4.png');
    expect(out.state).toBe('ok');
    expect(out.tier).toBe('curated');
    expect(out.upgradeRecommended).toBe(false);
  });

  it('marks missing logos as bad and upgradable', () => {
    const out = classifyLogoUrl(undefined);
    expect(out.state).toBe('bad');
    expect(out.tier).toBe('missing');
    expect(out.upgradeRecommended).toBe(true);
  });

  it('marks http images as mixed-content risks', () => {
    const out = classifyLogoUrl('http://example.com/logo.png');
    expect(out.state).toBe('bad');
    expect(out.tier).toBe('http');
    expect(out.upgradeRecommended).toBe(true);
  });

  it('marks favicon.ico as weak even when it is https', () => {
    const out = classifyLogoUrl('https://example.com/favicon.ico');
    expect(out.state).toBe('warn');
    expect(out.tier).toBe('weak');
    expect(out.upgradeRecommended).toBe(true);
  });

  it('marks logo-like high-resolution paths as good remote images', () => {
    const out = classifyLogoUrl('https://example.com/assets/radio-logo-512x512.png');
    expect(out.state).toBe('ok');
    expect(out.tier).toBe('good-remote');
    expect(out.upgradeRecommended).toBe(false);
  });

  it('marks known platform runtime icons as generic', () => {
    const out = classifyLogoUrl('https://static.xx.fbcdn.net/rsrc.php/yH/r/a0cO3e6g_yJ.webp');
    expect(out.state).toBe('bad');
    expect(out.tier).toBe('generic');
    expect(out.upgradeRecommended).toBe(true);
  });

  it('marks parked-domain social artwork as generic', () => {
    const out = classifyLogoUrl('https://static.hugedomains.com/images/hdv3-img/og_hugedomains.png');
    expect(out.state).toBe('bad');
    expect(out.tier).toBe('generic');
    expect(out.upgradeRecommended).toBe(true);
  });

  it('marks platform pinned tab assets as weak instead of good SVGs', () => {
    const out = classifyLogoUrl('https://www.listnr.com/favicon/safari-pinned-tab.svg');
    expect(out.state).toBe('warn');
    expect(out.tier).toBe('weak');
    expect(out.upgradeRecommended).toBe(true);
  });

  it('flags non-free wikipedia/en uploads as upgrade candidates (#472)', () => {
    const out = classifyLogoUrl(
      'https://upload.wikimedia.org/wikipedia/en/2/2b/LBC_News_station_logo.png?utm_source=en.wikipedia.org',
    );
    expect(out.tier).toBe('non-free-wiki');
    expect(out.upgradeRecommended).toBe(true);
  });

  it('does NOT flag free wikimedia/commons uploads', () => {
    const out = classifyLogoUrl('https://upload.wikimedia.org/wikipedia/commons/2/29/Logo_SRF_1.svg.png');
    expect(out.tier).not.toBe('non-free-wiki');
    expect(out.upgradeRecommended).toBe(false); // logo-like → good-remote
  });
});

describe('isNonFreeWikiLogo', () => {
  it('matches only the non-free wikipedia/en namespace', () => {
    expect(isNonFreeWikiLogo('https://upload.wikimedia.org/wikipedia/en/2/2b/LBC_News_station_logo.png')).toBe(true);
    expect(isNonFreeWikiLogo('https://upload.wikimedia.org/wikipedia/commons/2/29/Logo_SRF_1.svg.png')).toBe(false);
    expect(isNonFreeWikiLogo('https://example.com/wikipedia/en/x.png')).toBe(false); // wrong host
    expect(isNonFreeWikiLogo('https://www.lbc.co.uk/logo.svg')).toBe(false);
    expect(isNonFreeWikiLogo(undefined)).toBe(false);
    expect(isNonFreeWikiLogo('not a url')).toBe(false);
  });
});

describe('scoreLogoCandidate', () => {
  it('prefers structured logo sources over generic favicons', () => {
    const logo = scoreLogoCandidate({
      rel: 'jsonld-logo',
      url: 'https://example.com/logo-512x512.png',
      size: 512,
    });
    const favicon = scoreLogoCandidate({
      rel: 'icon',
      url: 'https://example.com/favicon.ico',
      size: 32,
    });
    expect(logo).toBeGreaterThan(favicon);
  });

  it('treats header logo images as stronger than touch icons', () => {
    const headerLogo = scoreLogoCandidate({
      rel: 'header-logo',
      url: 'https://example.com/wp-content/uploads/station-mark.png',
      size: 250,
    });
    const touchIcon = scoreLogoCandidate({
      rel: 'apple-touch-icon',
      url: 'https://example.com/wp-content/uploads/cropped-station-180x180.png',
      size: 180,
    });
    expect(headerLogo).toBeGreaterThan(touchIcon);
  });
});

describe('shouldReplaceLogo', () => {
  it('does not replace curated local station assets', () => {
    expect(
      shouldReplaceLogo('stations/fm4.png', {
        rel: 'jsonld-logo',
        url: 'https://example.com/logo-512x512.png',
        size: 512,
      }),
    ).toBe(false);
  });

  it('replaces weak imported favicons with strong homepage candidates', () => {
    expect(
      shouldReplaceLogo('https://example.com/favicon.ico', {
        rel: 'jsonld-logo',
        url: 'https://example.com/logo-512x512.png',
        size: 512,
      }),
    ).toBe(true);
  });

  it('keeps already good remote logos unless replaceGood is set', () => {
    const candidate = {
      rel: 'jsonld-logo',
      url: 'https://example.com/new-logo-512x512.png',
      size: 512,
    };
    expect(shouldReplaceLogo('https://example.com/current-logo-512x512.png', candidate)).toBe(false);
    expect(shouldReplaceLogo('https://example.com/current-logo-512x512.png', candidate, { replaceGood: true })).toBe(true);
  });
});
