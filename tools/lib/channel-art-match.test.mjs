import { describe, expect, it } from 'vitest';
import {
  labelFromFilename,
  extractLabeledImages,
  commonPrefixTokens,
  matchChannelArt,
} from './channel-art-match.mjs';

describe('labelFromFilename', () => {
  it('strips dimensions, hash, and extension', () => {
    expect(labelFromFilename('https://x/a/Gong 96.3_Top 50_600x600.68a866af.png')).toBe('Gong 96.3 Top 50');
  });
  it('handles a hash-only filename', () => {
    expect(labelFromFilename('https://x/CHILL.d52e3685.webp')).toBe('CHILL');
  });
  it('decodes percent-encoding', () => {
    expect(labelFromFilename('https://x/Gong%2096.3_90er%20Hits_600x600.5cedabca.png')).toBe('Gong 96.3 90er Hits');
  });
});

describe('extractLabeledImages', () => {
  it('reads src + alt and resolves relative URLs', () => {
    const html = `
      <img src="/img/Gong 96.3_Top 50_600x600.aa11bb22.png" alt="Top 50">
      <img data-src="/img/Gong 96.3_Chill_600x600.cc33dd44.png">
    `;
    const out = extractLabeledImages(html, 'https://www.radiogong.de/');
    expect(out).toHaveLength(2);
    expect(out[0].url).toBe('https://www.radiogong.de/img/Gong%2096.3_Top%2050_600x600.aa11bb22.png');
    expect(out[0].label).toBe('Top 50'); // alt wins
    expect(out[1].label).toBe('Gong 96.3 Chill'); // falls back to filename
  });
});

describe('commonPrefixTokens', () => {
  it('finds the shared brand prefix', () => {
    expect(commonPrefixTokens([
      ['gong', '3', 'top', '50'],
      ['gong', '3', '2000er', 'hits'],
      ['gong', '3', 'chill'],
    ])).toEqual(['gong', '3']);
  });
});

// The real Radio Gong 96.3 case: filenames carry the channel name, station
// names restate the brand and add quirks ("Weihnachtshits" vs "Weihnachts
// Hits", a "-om" suffix). All six must match their own art, none mis-assigned.
describe('matchChannelArt — Radio Gong 96.3', () => {
  const members = [
    { id: 'top-50', shortName: 'Top 50', name: 'Radio Gong 96.3 - Top 50 Gong Top 50' },
    { id: '2000er', shortName: '2000er Hits', name: 'Radio Gong 96.3 - 2000er Hits Gong 2000er Hits' },
    { id: '80er', shortName: '80er Hits', name: 'Radio Gong 96.3 - 80er Hits Gong 80er Hits' },
    { id: '90er', shortName: '90er Hits', name: 'Radio Gong 96.3 - 90er Hits Gong 90er Hits' },
    { id: 'chill', shortName: 'Chill -om', name: 'Radio Gong 96.3 - Chill -om' },
    { id: 'weihnacht', shortName: 'Weihnachtshits -om', name: 'Radio Gong 96.3 - Weihnachtshits -om' },
  ];
  const candidates = [
    { url: 'https://g/Gong 96.3_Top 50_600x600.1.png', label: 'Gong 96.3 Top 50' },
    { url: 'https://g/Gong 96.3_2000er Hits_600x600.2.png', label: 'Gong 96.3 2000er Hits' },
    { url: 'https://g/Gong 96.3_80er Hits_600x600.3.png', label: 'Gong 96.3 80er Hits' },
    { url: 'https://g/Gong 96.3_90er Hits_600x600.4.png', label: 'Gong 96.3 90er Hits' },
    { url: 'https://g/Gong 96.3_Chill_600x600.5.png', label: 'Gong 96.3 Chill' },
    { url: 'https://g/Gong 96.3_Weihnachts Hits_600x600.6.png', label: 'Gong 96.3 Weihnachts Hits' },
    // distractors from the same page that must NOT be assigned to a Gong channel
    { url: 'https://g/Gong 96.3_Rock_600x600.7.png', label: 'Gong 96.3 Rock' },
    { url: 'https://g/089Kult_Logo.8.png', label: '089Kult Logo' },
  ];

  const { matches, unmatched, ambiguous } = matchChannelArt({ members, candidates });

  it('matches all six channels to their own art', () => {
    expect(unmatched).toEqual([]);
    expect(ambiguous).toEqual([]);
    expect(matches).toHaveLength(6);
  });

  it('assigns the correct image per channel', () => {
    const byId = Object.fromEntries(matches.map((m) => [m.id, m.url]));
    expect(byId['top-50']).toContain('Top 50');
    expect(byId['2000er']).toContain('2000er Hits');
    expect(byId['80er']).toContain('80er Hits');
    expect(byId['90er']).toContain('90er Hits');
    expect(byId['chill']).toContain('Chill');
    expect(byId['weihnacht']).toContain('Weihnachts Hits');
  });

  it('never reuses one image for two channels', () => {
    const urls = matches.map((m) => m.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('does not assign the Rock distractor to a chosen channel', () => {
    expect(matches.find((m) => m.url.includes('Rock'))).toBeUndefined();
  });
});
