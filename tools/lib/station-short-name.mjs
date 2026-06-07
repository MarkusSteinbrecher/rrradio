// Build-time derivation of a station's "short name" — the distinguishing tail
// of a name within its brand family, so a tight UI (the iOS icon grid, an
// Android equivalent) can show "Top 50" instead of a truncated
// "Radio Gong 96.3 - …". This is the catalog-side half of the hybrid: we
// derive *what* the short name is here (once, with global family knowledge,
// curatable via `shortName:` in stations.yaml); each client decides *when* to
// show it (only when the full name won't fit its cell).
//
// Ported verbatim from the iOS `StationGridLabel` (Shared/Station.swift) so
// the two never disagree. The one difference: the app runs it over the handful
// of stations rendered together, whereas the catalog runs it over the whole
// roster — a station's short name is therefore resolved against every other
// station that shares its leading brand words.

/** Punctuation that marks a sub-channel boundary rather than a word. */
const CONNECTORS = new Set(['-', '–', '—', '|', '•', '·', '∙', '‧', ':', '/', '~']);

/** Case- and diacritic-fold a token, matching Swift's `.caseInsensitive`
 *  + `.diacriticInsensitive` folding closely enough for stable grouping. */
function fold(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Whitespace-tokenise, dropping empties (mirrors Swift `parse`). */
function tokenize(name) {
  return String(name ?? '')
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

function parse(name) {
  const tokens = tokenize(name);
  return {
    full: tokens.join(' '),
    tokens,
    folded: tokens.map(fold),
  };
}

function commonPrefixLength(lhs, rhs) {
  const limit = Math.min(lhs.length, rhs.length);
  let n = 0;
  while (n < limit && lhs[n] === rhs[n]) n += 1;
  return n;
}

/** Word-wise lexicographic ordering; shorter-is-smaller on a tie. */
function tokensPrecede(lhs, rhs) {
  const limit = Math.min(lhs.length, rhs.length);
  for (let i = 0; i < limit; i += 1) {
    if (lhs[i] !== rhs[i]) return lhs[i] < rhs[i] ? -1 : 1;
  }
  if (lhs.length !== rhs.length) return lhs.length < rhs.length ? -1 : 1;
  return 0;
}

/** The stripped label for one parsed name given how many leading words it
 *  shares with a neighbour. Returns the full name when nothing should be
 *  stripped (mirrors Swift `label(for:sharedLeadingWords:)`). */
function label(parsed, sharedLeadingWords) {
  // Need ≥2 shared leading words to strip — a lone shared word (`Radio`,
  // `Jazz`) is too weak. Never strip the whole name: a station that *is* the
  // shared prefix keeps its brand.
  if (sharedLeadingWords < 2 || sharedLeadingWords >= parsed.tokens.length) {
    return parsed.full;
  }

  const brandWords = new Set(
    parsed.folded.slice(0, sharedLeadingWords).filter((w) => !CONNECTORS.has(w)),
  );
  let remainder = parsed.tokens.slice(sharedLeadingWords);
  let remainderFolded = parsed.folded.slice(sharedLeadingWords);

  // Drop a leading connector left behind when the shared run stopped just
  // before the `-` / `|` boundary.
  while (remainderFolded.length > 0 && CONNECTORS.has(remainderFolded[0])) {
    remainder = remainder.slice(1);
    remainderFolded = remainderFolded.slice(1);
  }

  // Radio-Browser imports often restate the brand inside the suffix
  // (`Radio Gong 96.3 - Top 50 Gong Top 50`). Cut at the brand's reoccurrence
  // so the label reads `Top 50`. Index 0 is exempt, so a suffix that simply
  // opens on a brand word (`Energy Saving Mix`) survives intact.
  for (let i = 1; i < remainderFolded.length; i += 1) {
    if (brandWords.has(remainderFolded[i])) {
      remainder = remainder.slice(0, i);
      break;
    }
  }

  const stripped = remainder.join(' ');
  return stripped.length === 0 ? parsed.full : stripped;
}

/**
 * Derive the short name for every station in `stations`, resolved against the
 * whole set. Returns a `Map<id, shortName>` containing **only** the stations
 * whose short name differs from their (whitespace-normalised) full name — i.e.
 * the family members worth shortening. Stations that stand alone, or that *are*
 * their family's shared prefix, are absent (the client falls back to `name`).
 *
 * @param {{id: string, name: string}[]} stations
 * @returns {Map<string, string>}
 */
export function deriveShortNames(stations) {
  const parsed = stations.map((s) => parse(s.name));

  // The longest leading-word run a station shares with *any* other is always
  // shared with an immediate neighbour once the set is sorted
  // word-lexicographically, so sort once and compare only neighbours.
  const order = parsed.map((_, i) => i).sort((a, b) => tokensPrecede(parsed[a].folded, parsed[b].folded));
  const sharedLeadingWords = new Array(parsed.length).fill(0);
  for (let pos = 0; pos < order.length; pos += 1) {
    const index = order[pos];
    let longest = 0;
    if (pos > 0) {
      longest = Math.max(longest, commonPrefixLength(parsed[index].folded, parsed[order[pos - 1]].folded));
    }
    if (pos < order.length - 1) {
      longest = Math.max(longest, commonPrefixLength(parsed[index].folded, parsed[order[pos + 1]].folded));
    }
    sharedLeadingWords[index] = longest;
  }

  const result = new Map();
  for (let i = 0; i < stations.length; i += 1) {
    const short = label(parsed[i], sharedLeadingWords[i]);
    if (short !== parsed[i].full) {
      result.set(stations[i].id, short);
    }
  }
  return result;
}
