/**
 * Pure (network-free) helpers for the non-free-wiki logo migration (#472).
 *
 * The CLI `tools/migrate-nonfree-logos.mjs` layers Wikipedia/Commons HTTP
 * calls on top of these; everything here is deterministic so it can be
 * unit-tested without the network. The matching gates mirror the proven
 * predicates in `tools/wiki-logos.mjs`.
 */

// Country → native Wikipedia language to try before en. The native wiki is
// far more likely to host a free Commons logo for a local broadcaster (the
// en article's infobox image is the non-free upload we're migrating off).
export const COUNTRY_LANG = {
  AT: 'de', CH: 'de', DE: 'de', LI: 'de',
  IT: 'it', FR: 'fr', BE: 'fr', LU: 'fr', MC: 'fr', DZ: 'fr',
  ES: 'es', AR: 'es', CL: 'es', CO: 'es', MX: 'es', PE: 'es', UY: 'es', VE: 'es', EC: 'es',
  PT: 'pt', BR: 'pt',
  NL: 'nl',
  PL: 'pl', CZ: 'cs', SK: 'sk', HU: 'hu', RO: 'ro', BG: 'bg', HR: 'hr', RS: 'sr', UA: 'uk',
  RU: 'ru', SE: 'sv', NO: 'no', FI: 'fi', DK: 'da', IS: 'is',
  Estonia: 'et', Lithuania: 'lt', Slovenia: 'sl',
  JP: 'ja', CN: 'zh', TW: 'zh', GR: 'el', TR: 'tr', IL: 'he', MD: 'ro',
  ID: 'id', PH: 'tl', IN: 'hi', AE: 'ar', LK: 'si',
};

/** Native + en language list to try for a station, native first, deduped. */
export function langsForCountry(country) {
  const native = COUNTRY_LANG[String(country || '').toUpperCase()] || COUNTRY_LANG[country];
  return [...new Set([native, 'en'].filter(Boolean))];
}

// `radio`/`broadcast`/`rundfunk` match as bare substrings: native compounds
// like the Danish "radiokanal", "DABradio-kanal" and German "radiosender"
// must still count as a radio hint. This is only a soft sanity gate —
// title-match + "logo" filename + Commons host carry the real precision, and
// every emitted entry is reviewed before `apply-logos`.
export const RADIO_HINT_RE =
  /(radio|rádio|broadcast|rundfunk|funkhaus|\bstation\b|\bsender\b|\bdab\b|\bfm\b|emisora|emittente|emissora|emisión)/i;

export function looksLikeRadio(summary) {
  const fields = [summary?.description, summary?.extract].filter(Boolean).join(' ');
  return RADIO_HINT_RE.test(fields);
}

export function normalizeTitle(s) {
  return decodeURIComponent(s)
    .toLowerCase()
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Strict title↔name match: one contains the other after normalization,
 *  ignoring a parenthetical disambiguator ("RTN (Switzerland)" → "rtn"). */
export function titleMatchesStation(title, stationName) {
  const t = normalizeTitle(title);
  const n = normalizeTitle(stationName);
  if (!t || !n) return false;
  const tNoParen = t.replace(/\s*\([^)]*\)\s*/g, '').trim();
  return tNoParen === n || tNoParen.includes(n) || n.includes(tNoParen);
}

/** The image URL filename should carry "logo" — Wikipedia's consistent
 *  convention for broadcaster logos ("DR_P1_2017_logo.png"). Kills concert
 *  photos / building shots / unrelated diagrams. */
export function urlLooksLikeLogo(url) {
  const filename = decodeURIComponent(String(url).split('/').pop() || '').toLowerCase();
  return /(^|[\s_\-])logo(\.|[\s_\-])/i.test(filename);
}

/** Free Wikimedia Commons upload (the migration target). */
export function isCommons(url) {
  return /\/wikipedia\/commons\//.test(String(url));
}

export function articleSlug(name) {
  return encodeURIComponent(String(name).replace(/ /g, '_'));
}

/** Score a Commons File: hit by how plausibly it's a logo for the station.
 *  Negative = reject. Mirrors wiki-logos.mjs's scoreFileHit. */
export function scoreFileHit(title, stationName) {
  const root = title.replace(/^[A-Za-z]+:/, '').replace(/\.[A-Za-z0-9]+$/, '');
  const t = title.toLowerCase();
  let formatScore;
  if (/\.svg$/i.test(t)) formatScore = 5;
  else if (/\.png$/i.test(t)) formatScore = 3;
  else if (/\.webp$/i.test(t)) formatScore = 2;
  else if (/\.(jpe?g|gif)$/i.test(t)) formatScore = 1;
  else return -1;
  const n = normalizeTitle(stationName);
  const r = normalizeTitle(root);
  if (!n || !r.includes(n)) return -1;
  if (!RADIO_HINT_RE.test(stationName) && !RADIO_HINT_RE.test(title)) return -1;
  let s = formatScore;
  if (/logo/i.test(t)) s += 5;
  if (r === n || r === `logo ${n}` || r === `${n} logo`) s += 5;
  // Token-level exactness: strongly reward the station name appearing as WHOLE
  // tokens (lets a logo-less exact match like "NRJ Radio.png" clear the bar),
  // and penalize a sub-brand token that merely *contains* a station token, so
  // "NRJ Radio" beats "NRJJunior" for the station "NRJ" (#478). The radio-
  // subject gate above still guards against off-topic exact-name files.
  const rootToks = new Set(r.split(' ').filter(Boolean));
  const nameToks = n.split(' ').filter(Boolean);
  if (nameToks.length && nameToks.every((tok) => rootToks.has(tok))) s += 5;
  if (nameToks.some((tok) => [...rootToks].some((rt) => rt !== tok && rt.includes(tok)))) s -= 4;
  return s;
}

export const FILE_HIT_MIN_SCORE = 8;

// Generic tokens that carry no brand identity — ignored when comparing two
// station names for a shared brand (#478 family propagation).
const BRAND_STOPWORDS = new Set([
  'radio', 'fm', 'am', 'the', 'station', 'hd', 'dab', 'hits', 'music',
]);

/** True if two station names share a significant (non-generic, non-numeric)
 *  token — the brand guard for propagating one sibling's logo to another. */
export function sharesBrandToken(nameA, nameB) {
  const toks = (name) =>
    new Set(
      normalizeTitle(name)
        .split(' ')
        .filter((tok) => tok && !BRAND_STOPWORDS.has(tok) && !/^\d+$/.test(tok)),
    );
  const a = toks(nameA);
  for (const tok of toks(nameB)) if (a.has(tok)) return true;
  return false;
}

/** Extract the underlying File: name from a Commons upload URL (handles the
 *  /thumb/x/xx/<File>/NNNpx-<File> form). Returns null if not a Commons URL. */
export function commonsFileName(commonsUrl) {
  const m = String(commonsUrl).match(
    /\/wikipedia\/commons\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/?]+)/i,
  );
  return m ? decodeURIComponent(m[1]) : null;
}

/** Extract the underlying File: name from a non-free /wikipedia/en/ upload URL.
 *  Stations sharing one en file share the same (non-free) artwork — this is the
 *  family-grouping key for propagation (#478). Returns null for non-en URLs. */
export function enWikiFileName(url) {
  const m = String(url).match(
    /\/wikipedia\/en\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/?]+)/i,
  );
  return m ? decodeURIComponent(m[1]) : null;
}

/** Country relationship between a resolved seed and a sibling sharing its
 *  non-free file. `same-country` is safe to auto-propagate (within-country
 *  sub-channels / regionals); `cross-country` needs review — a generic name
 *  ("Kiss", "Gold") is shared by UNRELATED stations across countries, while a
 *  real network (NRJ) is legitimately cross-country. Missing country → treat as
 *  cross-country (the conservative side). */
export function propagationTier(seedCountry, siblingCountry) {
  const a = String(seedCountry || '').toUpperCase().trim();
  const b = String(siblingCountry || '').toUpperCase().trim();
  if (!a || !b) return 'cross-country';
  return a === b ? 'same-country' : 'cross-country';
}

/** Normalize a Commons imageinfo `extmetadata` block to a short faviconLicense
 *  string matching the catalog convention (`public-domain`, `cc0`,
 *  `cc-by-sa-4.0`, …). Returns null when the licence can't be determined. */
export function normalizeLicense(extmeta) {
  const lic = (extmeta?.License?.value || '').toLowerCase();
  const short = (extmeta?.LicenseShortName?.value || '').trim();
  if (lic === 'pd' || /public domain/i.test(short)) return 'public-domain';
  if (/^cc0/i.test(short) || lic === 'cc0') return 'cc0';
  if (!short) return null;
  return short.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}
