import { describe, it, expect } from 'vitest';
import { detectFamilies, familyBucketKey } from './station-family.mjs';

const S = (name, country, homepage) => ({ name, country, homepage });

function byCore(stations) {
  const out = new Map();
  for (const f of detectFamilies(stations)) out.set(f.core, f.members.map((m) => m.name).sort());
  return out;
}

describe('familyBucketKey', () => {
  it('is country + homepage host, protocol/www/port stripped', () => {
    expect(familyBucketKey(S('X', 'de', 'https://www.br.de/radio/bayern1/index.html'))).toBe('DE|br.de');
    expect(familyBucketKey(S('X', 'de', 'http://br.de:8000/'))).toBe('DE|br.de');
  });
  it('refuses to bucket without a country or homepage', () => {
    expect(familyBucketKey(S('X', '', 'https://br.de'))).toBe('');
    expect(familyBucketKey(S('X', 'DE', ''))).toBe('');
    expect(familyBucketKey(S('X', 'DE', 'not a url'))).toBe('');
  });
  it('refuses known aggregator hosts (would invent families from tenants)', () => {
    expect(familyBucketKey(S('X', 'DE', 'https://laut.fm/some-station'))).toBe('');
    expect(familyBucketKey(S('X', 'US', 'https://zeno.fm/abc'))).toBe('');
  });
});

describe('detectFamilies', () => {
  it('groups regional siblings of one brand into a family', () => {
    const fams = byCore([
      S('Bayern 1', 'DE', 'https://br.de/radio/bayern1'),
      S('Bayern 1 Franken', 'DE', 'https://br.de/radio/bayern1'),
      S('Bayern 1 Schwaben', 'DE', 'https://br.de/radio/bayern1'),
    ]);
    expect(fams.get('1 bayern')).toEqual(['Bayern 1', 'Bayern 1 Franken', 'Bayern 1 Schwaben']);
  });

  it('keeps numbered channels in SEPARATE families (digit guard)', () => {
    // Three Bayern 1 regions + three Bayern 2 regions on one homepage must not
    // collapse onto the shared "bayern" stem.
    const fams = byCore([
      S('Bayern 1 Franken', 'DE', 'https://br.de'),
      S('Bayern 1 Schwaben', 'DE', 'https://br.de'),
      S('Bayern 2 Nord', 'DE', 'https://br.de'),
      S('Bayern 2 Süd', 'DE', 'https://br.de'),
    ]);
    expect(fams.get('1 bayern')).toEqual(['Bayern 1 Franken', 'Bayern 1 Schwaben']);
    expect(fams.get('2 bayern')).toEqual(['Bayern 2 Nord', 'Bayern 2 Süd']);
    expect([...fams.keys()]).not.toContain('bayern');
  });

  it('a lone numbered channel forms no family (no shallow fallback)', () => {
    const fams = byCore([
      S('Bayern 1 Franken', 'DE', 'https://br.de'),
      S('Bayern 1 Schwaben', 'DE', 'https://br.de'),
      S('Bayern 2', 'DE', 'https://br.de'), // only one Bayern 2 → not a family member
    ]);
    expect(fams.get('1 bayern')).toEqual(['Bayern 1 Franken', 'Bayern 1 Schwaben']);
    expect([...fams.keys()]).not.toContain('2 bayern');
    expect([...fams.keys()]).not.toContain('bayern');
  });

  it('groups sub-brand (genre) channels too', () => {
    const fams = byCore([
      S('bigFM Deutschland', 'DE', 'https://bigfm.de'),
      S('bigFM House Beats', 'DE', 'https://bigfm.de'),
      S('bigFM Oldschool Rap', 'DE', 'https://bigfm.de'),
    ]);
    expect(fams.get('bigfm')).toEqual(['bigFM Deutschland', 'bigFM House Beats', 'bigFM Oldschool Rap']);
  });

  it('groups word-numbered siblings (Uno/Due/Tre are not digit-guarded)', () => {
    const fams = byCore([
      S('RSI Rete Uno', 'CH', 'https://rsi.ch'),
      S('RSI Rete Due', 'CH', 'https://rsi.ch'),
      S('RSI Rete Tre', 'CH', 'https://rsi.ch'),
    ]);
    expect(fams.get('rete rsi')).toEqual(['RSI Rete Due', 'RSI Rete Tre', 'RSI Rete Uno']);
  });

  it('does NOT bridge same-brand-word stations on DIFFERENT broadcasters', () => {
    // The "Радио X" / "Radyo X" cross-broadcaster false-family trap: only the
    // homepage host distinguishes them, and it differs.
    const fams = detectFamilies([
      S('Радио Maximum', 'RU', 'https://maximum.ru'),
      S('Радио Крым', 'RU', 'https://crimea-radio.ru'),
      S('Радио Звезда', 'RU', 'https://zvezda.fm'),
    ]);
    expect(fams).toEqual([]);
  });

  it('feed-duplicate siblings join the parent family (no orphaning)', () => {
    // The two "Oberbayern (HLS 96/192)" share a name signature → one FEED rep,
    // which joins the "Bayern 1" brand rather than forming a rejected sub-family.
    const fams = detectFamilies([
      S('Bayern 1', 'DE', 'https://br.de'),
      S('Bayern 1 Franken', 'DE', 'https://br.de'),
      S('Bayern 1 Oberbayern (HLS 96)', 'DE', 'https://br.de'),
      S('Bayern 1 Oberbayern (HLS 192)', 'DE', 'https://br.de'),
    ]);
    expect(fams).toHaveLength(1);
    expect(fams[0].core).toBe('1 bayern');
    expect(fams[0].members.map((m) => m.name).sort()).toEqual([
      'Bayern 1', 'Bayern 1 Franken',
      'Bayern 1 Oberbayern (HLS 192)', 'Bayern 1 Oberbayern (HLS 96)',
    ]);
  });

  it('a same-signature feed-variant pair alone is not a family', () => {
    expect(detectFamilies([
      S('Bayern 1 Oberbayern (HLS 96)', 'DE', 'https://br.de'),
      S('Bayern 1 Oberbayern (HLS 192)', 'DE', 'https://br.de'),
    ])).toEqual([]);
  });

  it('does NOT treat byte-identical duplicates as a family', () => {
    const fams = detectFamilies([
      S('Radio X', 'DE', 'https://radiox.de'),
      S('Radio X', 'DE', 'https://radiox.de'),
    ]);
    expect(fams).toEqual([]);
  });

  it('ignores aggregator-hosted stations entirely', () => {
    const fams = detectFamilies([
      S('Cool Jazz', 'DE', 'https://laut.fm/cool-jazz'),
      S('Cool Rock', 'DE', 'https://laut.fm/cool-rock'),
    ]);
    expect(fams).toEqual([]);
  });

  it('produces a stable, deterministic family id', () => {
    const input = [
      S('Bayern 1 Schwaben', 'DE', 'https://br.de'),
      S('Bayern 1 Franken', 'DE', 'https://br.de'),
    ];
    expect(detectFamilies(input)[0].id).toBe('DE|br.de|1 bayern');
  });
});
