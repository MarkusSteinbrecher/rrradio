import { describe, expect, it } from 'vitest';
import { faviconClass, stationInitials } from './station-display';

describe('stationInitials', () => {
  it('takes the first letter of up to two words', () => {
    expect(stationInitials('Bayern 1')).toBe('B1');
    expect(stationInitials('Radio Eins')).toBe('RE');
    expect(stationInitials('BBC')).toBe('B');
  });

  it('uppercases', () => {
    expect(stationInitials('soma fm')).toBe('SF');
  });

  it('strips punctuation', () => {
    expect(stationInitials('FM-4')).toBe('F4');
    expect(stationInitials('98.8 Kiss FM')).toBe('98');
  });

  it('falls back to "··" when nothing usable', () => {
    expect(stationInitials('')).toBe('··');
    expect(stationInitials('!@#$%')).toBe('··');
  });

  it('caps at 2 letters', () => {
    expect(stationInitials('Three Word Title')).toBe('TW');
  });
});

describe('faviconClass', () => {
  it('returns "fav" for empty id', () => {
    expect(faviconClass('')).toBe('fav');
  });

  it('returns one of four broadcaster classes deterministically', () => {
    const c = faviconClass('bbc');
    expect(['fav', 'fav fav-bbc', 'fav fav-soma', 'fav fav-fip']).toContain(c);
  });

  it('the same id maps to the same class across calls', () => {
    expect(faviconClass('bbc')).toBe(faviconClass('bbc'));
    expect(faviconClass('builtin-fm4')).toBe(faviconClass('builtin-fm4'));
  });
});
