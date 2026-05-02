/**
 * ISO 3166-1 alpha-2 → display name. Pulled out of `src/main.ts`
 * (audit #77).
 *
 * Strategy: a curated short table for the codes we'd plausibly see
 * in the catalog or Radio Browser results (so the country dropdown
 * stays tight and consistent), `Intl.DisplayNames` for less-common
 * codes RB returns (e.g. "JM"), and finally the raw code itself.
 */

const COUNTRY_NAMES: Record<string, string> = {
  AT: 'Austria',
  AU: 'Australia',
  BE: 'Belgium',
  BR: 'Brazil',
  CA: 'Canada',
  CH: 'Switzerland',
  CZ: 'Czechia',
  DE: 'Germany',
  DK: 'Denmark',
  ES: 'Spain',
  FI: 'Finland',
  FR: 'France',
  GB: 'United Kingdom',
  GR: 'Greece',
  IE: 'Ireland',
  IT: 'Italy',
  JP: 'Japan',
  NL: 'Netherlands',
  NO: 'Norway',
  PL: 'Poland',
  PT: 'Portugal',
  RU: 'Russia',
  SE: 'Sweden',
  TR: 'Turkey',
  UA: 'Ukraine',
  UK: 'United Kingdom',
  US: 'United States',
};

/** ISO 3166-1 alpha-2 → display name. */
export function countryName(code: string): string {
  const c = code.toUpperCase();
  if (COUNTRY_NAMES[c]) return COUNTRY_NAMES[c];
  try {
    const name = new Intl.DisplayNames(undefined, { type: 'region' }).of(c);
    if (name && name !== c) return name;
  } catch {
    /* unsupported locale → fall through */
  }
  return c;
}
