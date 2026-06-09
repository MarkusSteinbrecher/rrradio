import { describe, expect, it } from 'vitest';
import {
  langsForCountry,
  looksLikeRadio,
  titleMatchesStation,
  urlLooksLikeLogo,
  isCommons,
  scoreFileHit,
  FILE_HIT_MIN_SCORE,
  commonsFileName,
  normalizeLicense,
  enWikiFileName,
  propagationTier,
  sharesBrandToken,
} from './nonfree-migration.mjs';

describe('langsForCountry', () => {
  it('puts the native language before en', () => {
    expect(langsForCountry('DK')).toEqual(['da', 'en']);
    expect(langsForCountry('DE')).toEqual(['de', 'en']);
  });
  it('handles the spelled-out country keys used in the catalog', () => {
    expect(langsForCountry('Lithuania')).toEqual(['lt', 'en']);
    expect(langsForCountry('Estonia')).toEqual(['et', 'en']);
  });
  it('falls back to en-only for unmapped countries', () => {
    expect(langsForCountry('GB')).toEqual(['en']);
    expect(langsForCountry('US')).toEqual(['en']);
    expect(langsForCountry(undefined)).toEqual(['en']);
  });
});

describe('looksLikeRadio', () => {
  it('matches a plain "radio" word', () => {
    expect(looksLikeRadio({ extract: 'DR P3 is a Danish radio channel.' })).toBe(true);
  });
  it('matches native compound words (#472 regression: radiokanal / DABradio)', () => {
    // Danish da.wikipedia extracts that broke the first cut of the tool:
    expect(looksLikeRadio({ extract: "DR P1 er DR's første radiokanal." })).toBe(true);
    expect(looksLikeRadio({ extract: "DR P6 Beat er en af DR's fem landsdækkende DABradio-kanaler." })).toBe(true);
    expect(looksLikeRadio({ extract: 'Ein deutscher Radiosender aus Berlin.' })).toBe(true);
  });
  it('rejects text with no broadcasting signal', () => {
    expect(looksLikeRadio({ extract: 'Gold is a chemical element with the symbol Au.' })).toBe(false);
    expect(looksLikeRadio({})).toBe(false);
  });
});

describe('titleMatchesStation', () => {
  it('matches exact and contained names, ignoring parentheticals', () => {
    expect(titleMatchesStation('DR P1', 'DR P1')).toBe(true);
    expect(titleMatchesStation('DR P4', 'DR P4 København')).toBe(true); // article is the parent
    expect(titleMatchesStation('Kiss (UK radio station)', 'Kiss FM')).toBe(true); // "Kiss" ⊂ "Kiss FM"
    expect(titleMatchesStation('RTN (Switzerland)', 'RTN')).toBe(true);
  });
  it('rejects unrelated titles', () => {
    expect(titleMatchesStation('Gold (chemistry)', 'DR P1')).toBe(false);
    expect(titleMatchesStation('Copenhagen', 'DR P1')).toBe(false);
  });
});

describe('urlLooksLikeLogo', () => {
  it('accepts filenames carrying "logo"', () => {
    expect(urlLooksLikeLogo('https://upload.wikimedia.org/wikipedia/commons/3/3d/DR_P1_2017_logo.png')).toBe(true);
    expect(urlLooksLikeLogo('https://x/330px-DR_P6_Beat_2017_logo.png')).toBe(true);
  });
  it('rejects non-logo images', () => {
    expect(urlLooksLikeLogo('https://x/Copenhagen_skyline.jpg')).toBe(false);
  });
});

describe('isCommons', () => {
  it('distinguishes free Commons from non-free en uploads', () => {
    expect(isCommons('https://upload.wikimedia.org/wikipedia/commons/3/3d/DR_P1_2017_logo.png')).toBe(true);
    expect(isCommons('https://upload.wikimedia.org/wikipedia/en/d/d7/DR_P1_logo_2020.svg.png')).toBe(false);
  });
});

describe('scoreFileHit', () => {
  it('scores an exact logo file above the accept threshold when a radio word is present', () => {
    // The File: fallback (mirroring wiki-logos) needs a radio token in the
    // name or the file title; here "Radio" is in the station name.
    expect(scoreFileHit('File:Jazz Radio Logo.png', 'Jazz Radio')).toBeGreaterThanOrEqual(FILE_HIT_MIN_SCORE);
  });
  it('rejects non-image, off-subject, and radio-less hits', () => {
    expect(scoreFileHit('File:Some report.pdf', 'Jazz Radio')).toBe(-1); // not an image
    expect(scoreFileHit('File:Jazz Radio photo.png', 'Beat')).toBe(-1); // name not contained
    expect(scoreFileHit('File:DR P6 Beat 2017 logo.png', 'DR P6 BEAT')).toBe(-1); // no radio word anywhere
  });
  it('prefers the exact brand over a sub-brand (#478: NRJ over NRJ Junior)', () => {
    const main = scoreFileHit('File:Logo NRJ 2016 radio.png', 'NRJ');
    const junior = scoreFileHit('File:Logo NRJJunior radio 2014.png', 'NRJ');
    expect(main).toBeGreaterThan(junior);
  });
  it('lets a logo-less exact-brand + radio file clear the threshold (NRJ Radio.png)', () => {
    expect(scoreFileHit('File:NRJ Radio.png', 'NRJ')).toBeGreaterThanOrEqual(FILE_HIT_MIN_SCORE);
  });
});

describe('enWikiFileName', () => {
  it('extracts the shared file from non-free en uploads (thumb + direct)', () => {
    expect(enWikiFileName('https://upload.wikimedia.org/wikipedia/en/thumb/d/d7/DR_P1_logo_2020.svg/330px-DR_P1_logo_2020.svg.png')).toBe('DR_P1_logo_2020.svg');
    expect(enWikiFileName('https://upload.wikimedia.org/wikipedia/en/8/8a/Nash_FM_Orange_Logo.jpeg')).toBe('Nash_FM_Orange_Logo.jpeg');
  });
  it('returns null for Commons (free) URLs', () => {
    expect(enWikiFileName('https://upload.wikimedia.org/wikipedia/commons/3/3d/DR_P1_2017_logo.png')).toBe(null);
  });
});

describe('propagationTier', () => {
  it('is same-country only when both countries match', () => {
    expect(propagationTier('US', 'US')).toBe('same-country');
    expect(propagationTier('us', 'US')).toBe('same-country');
    expect(propagationTier('SE', 'BG')).toBe('cross-country'); // NRJ across countries
    expect(propagationTier('CA', 'ES')).toBe('cross-country'); // unrelated Kiss stations
  });
  it('treats a missing country as cross-country (conservative)', () => {
    expect(propagationTier('US', '')).toBe('cross-country');
    expect(propagationTier(undefined, 'US')).toBe('cross-country');
  });
});

describe('sharesBrandToken', () => {
  it('matches real brand siblings, ignoring generic tokens', () => {
    expect(sharesBrandToken('NRJ Sweden', 'Energy NRJ')).toBe(true);
    expect(sharesBrandToken('KCRW 88.9 FM', 'KCRW Eclectic 24')).toBe(true);
    expect(sharesBrandToken('Mirchi Top 20', 'Mirchi Love')).toBe(true);
  });
  it('does not match on generic words alone', () => {
    expect(sharesBrandToken('Jazz Radio', 'Smooth Radio')).toBe(false); // only "radio" shared
    expect(sharesBrandToken('Magic 99.5', 'Gold FM')).toBe(false);
  });
});

describe('commonsFileName', () => {
  it('extracts the File name from thumb and direct Commons URLs', () => {
    expect(commonsFileName('https://upload.wikimedia.org/wikipedia/commons/thumb/3/3d/DR_P1_2017_logo.png/330px-DR_P1_2017_logo.png')).toBe('DR_P1_2017_logo.png');
    expect(commonsFileName('https://upload.wikimedia.org/wikipedia/commons/3/3d/DR_P1_2017_logo.png')).toBe('DR_P1_2017_logo.png');
  });
  it('returns null for non-Commons URLs', () => {
    expect(commonsFileName('https://upload.wikimedia.org/wikipedia/en/d/d7/DR_P1_logo_2020.svg.png')).toBe(null);
  });
});

describe('normalizeLicense', () => {
  it('maps public domain and CC0', () => {
    expect(normalizeLicense({ License: { value: 'pd' }, LicenseShortName: { value: 'Public domain' } })).toBe('public-domain');
    expect(normalizeLicense({ LicenseShortName: { value: 'CC0' } })).toBe('cc0');
  });
  it('slugifies a CC short name', () => {
    expect(normalizeLicense({ LicenseShortName: { value: 'CC BY-SA 4.0' } })).toBe('cc-by-sa-4.0');
  });
  it('returns null when no licence info is present', () => {
    expect(normalizeLicense(undefined)).toBe(null);
    expect(normalizeLicense({})).toBe(null);
  });
});
