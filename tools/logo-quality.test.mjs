import { describe, expect, it } from 'vitest';
import {
  classifyLogoUrl,
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
