/**
 * Tokenized, diacritic-folded search for the tracker tables.
 *
 * A query like "bandit rock" must match "Bandit ÍRock" (folded accent),
 * "se-bandit-rock" (separator differences), and "Bandit Classic Rock"
 * (terms in any position) — a naive substring `includes` matches none
 * of these. Every whitespace-separated term must appear somewhere in
 * the folded haystack (AND semantics).
 */

function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');
}

export function searchMatcher(query: string): (...fields: (string | null | undefined)[]) => boolean {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return () => true;
  return (...fields) => {
    const text = fold(fields.filter(Boolean).join(' '));
    return terms.every((t) => text.includes(t));
  };
}
