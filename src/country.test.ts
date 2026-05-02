import { describe, expect, it } from 'vitest';
import { countryName } from './country';

describe('countryName', () => {
  it('returns curated name for known codes', () => {
    expect(countryName('AT')).toBe('Austria');
    expect(countryName('CH')).toBe('Switzerland');
    expect(countryName('DE')).toBe('Germany');
  });

  it('uppercases the input', () => {
    expect(countryName('us')).toBe('United States');
  });

  it('falls back to Intl.DisplayNames for codes not in the curated table', () => {
    // JM (Jamaica) isn't in the curated short list. happy-dom + Node
    // both ship Intl.DisplayNames so we get a real name back.
    const result = countryName('JM');
    expect(result.toLowerCase()).toBe('jamaica');
  });

  it('returns whatever Intl.DisplayNames says when not in the curated table', () => {
    // ZZ is the ISO 3166-1 reserved/private-use code. Different
    // ICU versions map it to "Unknown Region" or pass it through.
    // Either way, the helper never throws.
    const result = countryName('zz');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});
