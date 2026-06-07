// Channel-art matching — match per-channel cover images scraped from a
// broadcaster's listing page to the right station in a brand family.
//
// The homepage logo scraper (tools/scrape-logos.mjs) finds ONE logo per
// homepage, so every sibling channel of a broadcaster would get the same brand
// mark. Multi-channel broadcasters (Radio Gong 96.3, bigFM, Gong FM, …) instead
// publish a grid/slider of per-channel cover images, each labelled with the
// channel name (in alt text or the filename, e.g.
// `Gong 96.3_Top 50_600x600.<hash>.png`). This module turns that grid into a
// {station → image} mapping.
//
// Matching is deliberately conservative: a station is only assigned art when the
// match is confident AND unambiguous. Unmatched stations fall back to the
// brand/homepage logo elsewhere — we never guess.

import { nameTokens } from './station-name-signature.mjs';

const MIN_SCORE = 0.6; // below this, not a match
const MIN_CONTAIN_RATIO = 0.6; // collapsed-substring length ratio floor

/**
 * Human label for an image from its filename. Strips the extension, a trailing
 * content-hash segment, and WxH dimension tokens, then normalises separators.
 *
 *   "Gong 96.3_Top 50_600x600.68a866af.png" -> "Gong 96.3 Top 50"
 *   "CHILL.d52e3685.webp"                   -> "CHILL"
 *
 * @param {string} url
 * @returns {string}
 */
export function labelFromFilename(url) {
  let base;
  try {
    base = decodeURIComponent(new URL(url, 'https://x.invalid/').pathname.split('/').pop() || '');
  } catch {
    base = String(url || '').split('?')[0].split('/').pop() || '';
  }
  base = base.replace(/\.(png|jpe?g|webp|gif|svg|avif|bmp|ico)$/i, ''); // extension
  base = base.replace(/\.[a-f0-9]{6,}$/i, ''); // fingerprint hash segment
  base = base.replace(/[_\- ]?\d{2,4}\s*x\s*\d{2,4}\b/gi, ''); // WxH dimensions
  base = base.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return base;
}

/**
 * Extract candidate images with a label from listing-page HTML. Pure (no
 * network). Resolves relative URLs against baseUrl; the caller filters scheme.
 *
 * @param {string} html
 * @param {string} baseUrl
 * @returns {Array<{url: string, label: string, alt: string, size: number}>}
 */
export function extractLabeledImages(html, baseUrl) {
  const out = [];
  const imgRe = /<img\s+([^>]*?)\/?>/gi;
  let m;
  while ((m = imgRe.exec(html)) !== null) {
    const a = parseAttrs(m[1]);
    let src = a.src || a['data-src'] || a['data-lazy-src'] || a['data-original'] || '';
    if (!src && a.srcset) src = firstSrcsetUrl(a.srcset);
    if (!src) continue;
    let url;
    try {
      url = new URL(src, baseUrl).href;
    } catch {
      continue;
    }
    const alt = (a.alt || a.title || a['aria-label'] || '').trim();
    const label = alt || labelFromFilename(url);
    if (!label) continue;
    out.push({
      url,
      label,
      alt,
      size: Math.max(Number(a.width) || 0, Number(a.height) || 0, parseSizeToken(a.sizes)),
    });
  }
  // De-dupe by URL, keep the richest label / largest size.
  const byUrl = new Map();
  for (const c of out) {
    const prev = byUrl.get(c.url);
    if (!prev || (c.alt && !prev.alt) || c.size > prev.size) byUrl.set(c.url, c);
  }
  return [...byUrl.values()];
}

/**
 * Match channel art candidates to family members. 1:1, confident-only.
 *
 * @param {{
 *   members: Array<{id: string, shortName?: string|null, name?: string}>,
 *   candidates: Array<{url: string, label: string}>,
 *   coreTokens?: string[],
 * }} opts
 * @returns {{
 *   matches: Array<{id: string, url: string, label: string, score: number, exact: boolean}>,
 *   unmatched: string[],
 *   ambiguous: Array<{id: string, label: string, score: number}>,
 * }}
 */
export function matchChannelArt({ members, candidates, coreTokens }) {
  const core = coreTokens ?? commonPrefixTokens(members.map((s) => nameTokens(s.name)));

  // Discriminator tokens per member: prefer shortName (already brand-free),
  // else strip the family core prefix from the full name.
  const memberDiscr = members.map((s) => {
    const fromShort = s.shortName ? nameTokens(s.shortName) : null;
    const discr = fromShort && fromShort.length ? fromShort : stripPrefix(nameTokens(s.name), core);
    return { id: s.id, tokens: discr, collapsed: discr.join('') };
  });

  // Discriminator per candidate: strip the family core prefix from the label.
  const candDiscr = candidates
    .map((c) => {
      const discr = stripPrefix(nameTokens(c.label), core);
      return { url: c.url, label: c.label, tokens: discr, collapsed: discr.join('') };
    })
    .filter((c) => c.collapsed.length > 0);

  // Score every member×candidate pair, keep the scoring ones.
  const pairs = [];
  for (const mem of memberDiscr) {
    if (!mem.collapsed) continue;
    for (const cand of candDiscr) {
      const { score, exact } = scorePair(mem, cand);
      if (score >= MIN_SCORE) pairs.push({ memId: mem.id, url: cand.url, label: cand.label, score, exact });
    }
  }
  pairs.sort((a, b) => b.score - a.score || Number(b.exact) - Number(a.exact));

  // Greedy 1:1 assignment, best score first.
  const matches = [];
  const usedMembers = new Set();
  const usedUrls = new Set();
  const bestByMember = new Map(); // memId -> top two scores, for ambiguity check
  for (const p of pairs) {
    const arr = bestByMember.get(p.memId) ?? [];
    if (arr.length < 2) arr.push(p.score);
    bestByMember.set(p.memId, arr);
  }
  const ambiguous = [];
  for (const p of pairs) {
    if (usedMembers.has(p.memId) || usedUrls.has(p.url)) continue;
    // Reject a non-exact win that ties the runner-up — too ambiguous to trust.
    const top = bestByMember.get(p.memId) ?? [];
    if (!p.exact && top.length >= 2 && top[0] - top[1] < 0.05) {
      ambiguous.push({ id: p.memId, label: p.label, score: p.score });
      continue;
    }
    usedMembers.add(p.memId);
    usedUrls.add(p.url);
    matches.push({ id: p.memId, url: p.url, label: p.label, score: p.score, exact: p.exact });
  }

  const matchedIds = new Set(matches.map((m) => m.id));
  const ambiguousIds = new Set(ambiguous.map((a) => a.id));
  const unmatched = members.map((s) => s.id).filter((id) => !matchedIds.has(id) && !ambiguousIds.has(id));
  return { matches, unmatched, ambiguous: ambiguous.filter((a) => !matchedIds.has(a.id)) };
}

// ─── scoring ────────────────────────────────────────────────────────────────

function scorePair(mem, cand) {
  if (mem.collapsed === cand.collapsed) return { score: 1, exact: true };
  // Collapsed-substring containment (handles "Weihnachtshits" vs "Weihnachts
  // Hits" and a trailing "-om" suffix), length-ratio gated to avoid "rock" ⊂
  // "rockballads" false hits.
  let contain = 0;
  const [short, long] =
    mem.collapsed.length <= cand.collapsed.length
      ? [mem.collapsed, cand.collapsed]
      : [cand.collapsed, mem.collapsed];
  if (long.includes(short)) {
    const ratio = short.length / long.length;
    if (ratio >= MIN_CONTAIN_RATIO) contain = 0.6 + 0.4 * ratio;
  }
  // Token-set overlap.
  const setM = new Set(mem.tokens);
  const setC = new Set(cand.tokens);
  let shared = 0;
  for (const t of setM) if (setC.has(t)) shared++;
  const union = new Set([...setM, ...setC]).size;
  const jaccard = union ? shared / union : 0;
  const subset = shared > 0 && (shared === setM.size || shared === setC.size) ? 0.6 + 0.4 * (shared / union) : 0;
  return { score: Math.max(contain, jaccard >= 0.5 ? jaccard : 0, subset), exact: false };
}

// ─── token helpers ────────────────────────────────────────────────────────────

/** Longest common leading token sequence across all token arrays. */
export function commonPrefixTokens(tokenArrays) {
  const arrays = tokenArrays.filter((a) => a && a.length);
  if (arrays.length < 2) return [];
  const out = [];
  const first = arrays[0];
  for (let i = 0; i < first.length; i++) {
    const tok = first[i];
    if (arrays.every((a) => a[i] === tok)) out.push(tok);
    else break;
  }
  return out;
}

/** Drop a leading token prefix if present; otherwise return tokens unchanged. */
function stripPrefix(tokens, prefix) {
  if (!prefix?.length) return tokens;
  for (let i = 0; i < prefix.length; i++) {
    if (tokens[i] !== prefix[i]) return tokens;
  }
  const rest = tokens.slice(prefix.length);
  return rest.length ? rest : tokens; // never strip to empty
}

function firstSrcsetUrl(srcset) {
  const first = String(srcset).split(',')[0]?.trim().split(/\s+/)[0];
  return first || '';
}

function parseSizeToken(sizes) {
  const m = /(\d{2,4})\s*x\s*\d{2,4}/i.exec(String(sizes || ''));
  return m ? Number(m[1]) : 0;
}

function parseAttrs(raw) {
  const attrs = {};
  const re = /([a-zA-Z][a-zA-Z0-9_:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s/>]+)))?/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return attrs;
}
