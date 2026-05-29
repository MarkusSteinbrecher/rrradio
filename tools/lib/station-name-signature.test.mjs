import { describe, expect, it } from 'vitest';
import { nameSignature, nameTokens } from './station-name-signature.mjs';

describe('nameSignature', () => {
  it('collapses BR24 delivery variants to one station signature', () => {
    expect(nameSignature('BR24')).toBe('br24');
    expect(nameSignature('BR24live')).toBe('br24');
    expect(nameSignature('BR24 (HLS 96)')).toBe('br24');
    expect(nameSignature('BR24 (HLS 192)')).toBe('br24');
  });

  it('does not strip live from the 1LIVE brand', () => {
    expect(nameSignature('1LIVE')).toBe('1live');
    expect(nameSignature('1LIVE -- (https)')).toBe('1live');
  });

  it('still merges genuine bitrate/CDN variants', () => {
    const a = nameSignature('BBC Radio 2');
    expect(nameSignature('BBC Radio 2 (128k)')).toBe(a);
    expect(nameSignature('bbc 2')).toBe(a);
  });

  // Regression: stripping non-ASCII used to collapse every channel of a
  // Latin-branded non-Latin broadcaster onto the brand token, over-merging
  // them in the dedupe DB.
  it('keeps non-Latin channels of one brand distinct', () => {
    expect(nameSignature('BRTV北京文艺广播')).not.toBe(nameSignature('BRTV北京新闻广播'));
    expect(nameSignature('BTV影视伴音')).not.toBe(nameSignature('BTV财经伴音'));
    expect(nameSignature('Unistar - Свежие Хиты')).not.toBe(nameSignature('Unistar - Мой рок-н-ролл'));
  });

  it('splits a Latin brand prefix from the localized name', () => {
    expect(nameTokens('BRTV北京新闻广播')).toEqual(['brtv', '北京新闻广播']);
  });

  it('gives pure non-Latin names a real (non-empty) signature', () => {
    expect(nameSignature('純邦楽')).toBe('純邦楽');
    expect(nameSignature('純邦楽')).not.toBe(nameSignature('純演歌'));
  });
});
