import { describe, expect, it } from 'vitest';
import { deriveShortNames } from './station-short-name.mjs';

// Parity with the iOS `StationGridLabelTests` (rrradio-ios). `deriveShortNames`
// returns a Map of id → short name, present only for stations that should be
// shortened; absent means "use the full name".
function shorts(names) {
  const stations = names.map((name, i) => ({ id: String(i), name }));
  const map = deriveShortNames(stations);
  return names.map((_, i) => map.get(String(i)) ?? null);
}

describe('deriveShortNames', () => {
  it('drops a shared prefix in a separator family', () => {
    expect(shorts([
      'Radio Gong 96.3 - Top 50',
      'Radio Gong 96.3 - 80er Hits',
      'Radio Gong 96.3 - Chill',
    ])).toEqual(['Top 50', '80er Hits', 'Chill']);
  });

  it('handles a pipe separator family', () => {
    expect(shorts(['SomaFM | Groove Salad', 'SomaFM | Drone Zone']))
      .toEqual(['Groove Salad', 'Drone Zone']);
  });

  it('only treats the first separator as implicit', () => {
    expect(shorts([
      'Radio Gong 96.3 - Top 50 - Extended',
      'Radio Gong 96.3 - Chill',
    ])).toEqual(['Top 50 - Extended', 'Chill']);
  });

  it('drops shared words with no explicit separator', () => {
    expect(shorts([
      'Gong FM Workout',
      'Gong FM Chartshow',
      "Gong FM R'n'B",
    ])).toEqual(['Workout', 'Chartshow', "R'n'B"]);
  });

  it('disambiguates a same-brand non-separator collision', () => {
    expect(shorts(['Radio Gong 97.1', 'Radio Gong Würzburg']))
      .toEqual(['97.1', 'Würzburg']);
  });

  it('does not strip a single shared word', () => {
    expect(shorts(['Jazz FM', 'Jazz Radio Paris'])).toEqual([null, null]);
  });

  it('keeps a unique series at full length (no sibling shares the prefix)', () => {
    expect(shorts([
      'Radio Gong 96.3 - Top 50',
      'Bayern 3 - Die große ABBA Show',
    ])).toEqual([null, null]);
  });

  it('leaves names without a shared prefix unchanged', () => {
    expect(shorts(['France Inter', 'Rock-Antenne', 'Classic FM']))
      .toEqual([null, null, null]);
  });

  it('keeps the bare brand alongside its sub-channels', () => {
    expect(shorts([
      'Radio Gong 96.3',
      'Radio Gong 96.3 - Top 50',
      'Radio Gong 96.3 - Chill',
    ])).toEqual([null, 'Top 50', 'Chill']);
  });

  it('only disambiguates the colliding family', () => {
    expect(shorts([
      'Radio Gong 96.3 - Top 50',
      'Radio Gong 96.3 - Chill',
      'Jazz Radio Bebop',
    ])).toEqual(['Top 50', 'Chill', null]);
  });

  it('trims a restated brand in the suffix', () => {
    expect(shorts([
      'Radio Gong 96.3 - Top 50 Gong Top 50',
      'Radio Gong 96.3 - 80er Hits Gong 80er Hits',
    ])).toEqual(['Top 50', '80er Hits']);
  });

  it('keeps a suffix that opens on a brand word', () => {
    expect(shorts([
      'Radio Energy - Energy Saving Mix',
      'Radio Energy - Dance',
    ])).toEqual(['Energy Saving Mix', 'Dance']);
  });

  it('groups case- and diacritic-insensitively', () => {
    expect(shorts(['Radio Gong 96.3 - Top 50', 'RADIO GONG 96.3 - Chill']))
      .toEqual(['Top 50', 'Chill']);
  });

  it('collapses internal whitespace', () => {
    expect(shorts(['Radio   Gong  96.3  -  Top 50', 'Radio Gong 96.3 - Chill']))
      .toEqual(['Top 50', 'Chill']);
  });

  it('shortens a BBC Radio family to the channel discriminator', () => {
    expect(shorts(['BBC Radio 3', 'BBC Radio 4'])).toEqual(['3', '4']);
  });

  it('returns nothing for a single station', () => {
    expect(shorts(['Radio Gong 96.3 - Top 50'])).toEqual([null]);
  });

  it('returns nothing for an empty set', () => {
    expect(deriveShortNames([]).size).toBe(0);
  });
});
