import { describe, expect, it } from 'vitest';
import { nameSignature } from './station-name-signature.mjs';

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
});
