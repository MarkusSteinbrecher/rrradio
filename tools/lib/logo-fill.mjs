/**
 * Pure logic for the logo-fill rule (ADR 002, rule 9): find a logo for a
 * published station that has none, on the station's own homepage.
 *
 * Why not the vision-agent sweeps (#522 …): they were accurate but cost one
 * agent per station and never ran unattended. A 150-station sample
 * (2026-11-23) showed 30 % of missing-logo stations declare a usable icon on
 * their own site (apple-touch-icon / manifest icon ≥ 120 px), and about three
 * in four of those are the real brand mark. So: find deterministically, guard
 * deterministically, and spend eyes only on the last yes/no — a scheduled
 * Claude session working through a queue (tools/lib/logo-fill-queue.mjs,
 * docs/logo-fill-judge.md). No DOM, no network here — the I/O lives in
 * tools/lib/logo-fill-fetch.mjs; unit-tested in logo-fill.test.mjs.
 */

import { DENY_HOSTS } from './logo-candidates.mjs';

/** A station whose homepage search came up empty is not asked again for this long. */
export const FILL_RETRY_DAYS = 30;
/** Smallest side we accept; matches the probe's "acceptable" bucket floor. */
export const MIN_SIDE = 120;
/** og:image / JSON-LD images are often photos or banners: only near-square ones pass. */
export const LOOSE_KIND_MIN_SIDE = 200;
/** The same picture on this many unrelated sites is a platform default, not a brand. */
export const GENERIC_SITE_COUNT = 3;
/** dHash bits that may differ for two pictures to count as the same. */
export const HASH_NEAR = 4;

/**
 * Homepages that are a directory, a social profile or a stream host — the
 * icon there belongs to the platform, not the station.
 */
export const AGGREGATOR_HOSTS = Object.freeze([
  'radio.garden', 'tunein.com', 'radio-browser.info', 'facebook.com', 'fb.com', 'instagram.com',
  'twitter.com', 'x.com', 'youtube.com', 'youtu.be', 'tiktok.com', 'linktr.ee', 't.me', 'vk.com',
  'zeno.fm', 'streema.com', 'onlineradiobox.com', 'radio.net', 'radio.de', 'mytuner-radio.com',
  'radioline.co', 'radio.co', 'laut.fm', 'live365.com', 'radionomy.com', 'shoutcast.com',
  'icecast.org', 'radiojar.com', 'streamtheworld.com', 'mixcloud.com', 'soundcloud.com',
  'spotify.com', 'blogspot.com', 'wixsite.com', 'wordpress.com', 'weebly.com', 'sites.google.com',
  'github.io', 'wikipedia.org', 'radioking.com', 'airtime.pro', 'caster.fm', 'listen2myradio.com',
  'pcradio.app', 'pcradio.ru', 'exclusive.radio', 'streamafrica.net', 'radio-en-ligne.fr', 'fmstream.org',
]);

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

const onHost = (host, list) => list.some((h) => host === h || host.endsWith(`.${h}`));

/** Site key for "unrelated sites": hostname without a leading www. */
export function siteOf(url) {
  return hostOf(url).replace(/^www\d*\./, '');
}

export function isAggregatorHomepage(url) {
  const host = hostOf(url);
  return !host || onHost(host, AGGREGATOR_HOSTS);
}

/** https, and not a fan-upload / UGC host. The page itself declared the
 *  image, so a CDN on another domain is fine — a deny-listed one is not. */
export function candidateUrlAllowed(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  return !DENY_HOSTS.some((bad) => host === bad || host.endsWith(`.${bad}`) || host.includes(bad));
}

const attr = (tag, name) => {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? '').trim() : '';
};

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#x2F;/gi, '/').replace(/&#47;/g, '/');

function absolute(href, base) {
  if (!href || /^(data|javascript|blob):/i.test(href)) return null;
  try {
    return new URL(decode(href), base).href;
  } catch {
    return null;
  }
}

/** Largest `NxN` in a sizes attribute, 0 when absent or `any`. */
function declaredSize(sizes) {
  let best = 0;
  for (const m of String(sizes ?? '').matchAll(/(\d+)\s*x\s*(\d+)/gi)) best = Math.max(best, Math.min(Number(m[1]), Number(m[2])));
  return best;
}

function jsonLdLogos(html) {
  const out = [];
  for (const m of html.matchAll(/<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data;
    try {
      data = JSON.parse(m[1]);
    } catch {
      continue;
    }
    const visit = (node, depth) => {
      if (!node || typeof node !== 'object' || depth > 4) return;
      if (Array.isArray(node)) return node.forEach((n) => visit(n, depth + 1));
      const logo = node.logo;
      if (typeof logo === 'string') out.push(logo);
      else if (logo && typeof logo === 'object' && typeof logo.url === 'string') out.push(logo.url);
      if (node['@graph']) visit(node['@graph'], depth + 1);
      if (node.publisher) visit(node.publisher, depth + 1);
    };
    visit(data, 0);
  }
  return out;
}

/** Order of trust: what a site declares as its own icon first, images that
 *  merely describe the page last. */
const KIND_ORDER = ['apple-touch-icon', 'manifest-icon', 'icon', 'jsonld-logo', 'og:image'];

/**
 * Logo candidates a homepage declares, most trusted first.
 * @param {string} html
 * @param {string} baseUrl the URL the page was finally served from
 * @returns {{candidates: Array<{url: string, kind: string, declared: number}>, manifestUrl: string|null}}
 */
export function extractLogoCandidates(html, baseUrl) {
  const head = String(html ?? '').slice(0, 600_000);
  const baseHref = attr((/<base[^>]+>/i.exec(head) ?? [''])[0], 'href');
  const base = absolute(baseHref, baseUrl) ?? baseUrl;
  /** @type {Array<{url: string, kind: string, declared: number}>} */
  const found = [];
  let manifestUrl = null;

  for (const m of head.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const rel = attr(tag, 'rel').toLowerCase();
    const url = absolute(attr(tag, 'href'), base);
    if (!url) continue;
    const declared = declaredSize(attr(tag, 'sizes'));
    if (rel.includes('apple-touch-icon')) found.push({ url, kind: 'apple-touch-icon', declared: declared || 180 });
    else if (rel === 'manifest') manifestUrl ??= url;
    else if (/(^|\s)icon(\s|$)/.test(rel) && (declared >= MIN_SIDE || /\.svg(?:[?#]|$)/i.test(url))) {
      found.push({ url, kind: 'icon', declared: declared || 512 });
    }
  }
  for (const logo of jsonLdLogos(head)) {
    const url = absolute(logo, base);
    if (url) found.push({ url, kind: 'jsonld-logo', declared: 0 });
  }
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const key = (attr(tag, 'property') || attr(tag, 'name')).toLowerCase();
    if (key !== 'og:image' && key !== 'og:image:secure_url') continue;
    const url = absolute(attr(tag, 'content'), base);
    if (url) found.push({ url, kind: 'og:image', declared: 0 });
  }
  return { candidates: orderCandidates(found), manifestUrl };
}

/** Icons from a web app manifest, in the same shape as page candidates. */
export function manifestIcons(manifest, manifestUrl) {
  const out = [];
  for (const icon of Array.isArray(manifest?.icons) ? manifest.icons : []) {
    if (typeof icon?.src !== 'string') continue;
    if (/\bmonochrome\b/.test(String(icon.purpose ?? ''))) continue;
    const url = absolute(icon.src, manifestUrl);
    const declared = declaredSize(icon.sizes);
    if (url && declared >= MIN_SIDE) out.push({ url, kind: 'manifest-icon', declared });
  }
  return out;
}

/** Admissible, deduped, most trusted kind first and the largest declared size within a kind. */
export function orderCandidates(candidates) {
  const seen = new Set();
  return candidates
    .filter((c) => c?.url && candidateUrlAllowed(c.url) && !seen.has(c.url) && seen.add(c.url))
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || b.declared - a.declared);
}

/**
 * Size / shape gate. Correctness is the judge's call; this only keeps out
 * what cannot be a usable logo: too small, or — for the kinds that are
 * usually photos — not square.
 * @returns {string|null} a rejection reason, null when acceptable
 */
export function rejectDimensions(kind, width, height, format) {
  if (format === 'svg') return null;
  if (!width || !height) return 'undecodable';
  const min = Math.min(width, height);
  if (min < MIN_SIDE) return 'too-small';
  if (kind === 'og:image' || kind === 'jsonld-logo') {
    if (min < LOOSE_KIND_MIN_SIDE) return 'too-small';
    const ratio = width / height;
    if (ratio < 0.8 || ratio > 1.25) return 'not-square';
  }
  return null;
}

/**
 * Difference hash of a 9×8 grayscale thumbnail (72 bytes, row-major): one
 * bit per horizontally adjacent pair. Robust to rescaling and recompression,
 * which is what a platform's default icon looks like across its sites.
 * @param {Uint8Array} gray9x8
 * @returns {string} 16 hex chars
 */
export function dhashHex(gray9x8) {
  if (!gray9x8 || gray9x8.length < 72) throw new Error('dhash needs 9×8 = 72 grayscale bytes');
  let hex = '';
  for (let row = 0; row < 8; row += 1) {
    let byte = 0;
    for (let col = 0; col < 8; col += 1) {
      byte = (byte << 1) | (gray9x8[row * 9 + col] > gray9x8[row * 9 + col + 1] ? 1 : 0);
    }
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

export function hamming(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return Infinity;
  let bits = 0;
  for (let i = 0; i < a.length; i += 2) {
    let x = parseInt(a.slice(i, i + 2), 16) ^ parseInt(b.slice(i, i + 2), 16);
    while (x) {
      bits += x & 1;
      x >>= 1;
    }
  }
  return bits;
}

/**
 * Drop finds whose picture is a platform default: already known as generic,
 * or shared by GENERIC_SITE_COUNT unrelated sites in this batch (a hosting
 * panel's icon, a CMS logo, a stream provider's headphones). Sub-channels of
 * one broadcaster share a site, so a family mark is never counted twice.
 *
 * @param {Array<{id: string, site: string, hash: string}>} finds
 * @param {Iterable<string>} [knownGeneric] hashes rejected on earlier days
 * @returns {{kept: object[], dropped: object[], generic: string[]}} `generic` = known + newly learned
 */
export function dropPlatformDefaults(finds, knownGeneric = []) {
  const generic = [...new Set(knownGeneric)];
  const isGeneric = (hash) => generic.some((g) => hamming(g, hash) <= HASH_NEAR);

  const clusters = [];
  for (const f of finds) {
    const cluster = clusters.find((c) => hamming(c.hash, f.hash) <= HASH_NEAR);
    if (cluster) cluster.sites.add(f.site);
    else clusters.push({ hash: f.hash, sites: new Set([f.site]) });
  }
  for (const c of clusters) {
    if (c.sites.size >= GENERIC_SITE_COUNT && !isGeneric(c.hash)) generic.push(c.hash);
  }
  const kept = [];
  const dropped = [];
  for (const f of finds) (isGeneric(f.hash) ? dropped : kept).push(f);
  return { kept, dropped, generic };
}

/** FNV-1a — spreads ids so a daily batch is not one country prefix. */
function spread(id) {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const get = (m, k) => (m instanceof Map ? m.get(k) : m?.[k]);

/**
 * Which stations to look for today: published, logo verdict `missing`, a
 * homepage that is the station's own and not known dead, not tried within
 * FILL_RETRY_DAYS. Most-played first, then curated, then a stable spread.
 *
 * @param {{published: Iterable<{id: string, homepage?: string}>,
 *          latestLogoDetail: Map<string, string|null>|Record<string, string|null>,
 *          homepageVerdict?: Map<string, string>|Record<string, string>,
 *          tiers?: Record<string, string>, plays?: Record<string, number>, hot?: string[],
 *          attempts?: Record<string, {day: string}>, day: string, max: number}} input
 * @returns {Array<{id: string, homepage: string}>}
 */
export function fillTargets({ published, latestLogoDetail, homepageVerdict, tiers = {}, plays = {}, hot = [], attempts = {}, day, max }) {
  const hotSet = new Set(hot);
  const out = [];
  for (const s of published) {
    if (!s?.id || get(latestLogoDetail, s.id) !== 'missing') continue;
    if (typeof s.favicon === 'string' && s.favicon.trim()) continue; // filled since the last probe
    if (typeof s.homepage !== 'string' || !/^https?:\/\//i.test(s.homepage)) continue;
    if (isAggregatorHomepage(s.homepage)) continue;
    if (get(homepageVerdict, s.id) === 'bad') continue;
    const last = attempts?.[s.id]?.day;
    if (last && (Date.parse(day) - Date.parse(last)) / 86_400_000 < FILL_RETRY_DAYS) continue;
    const rank = hotSet.has(s.id) || plays[s.id] ? 0 : tiers[s.id] === 'curated' ? 1 : 2;
    out.push({ id: s.id, homepage: s.homepage, rank, plays: plays[s.id] ?? 0 });
  }
  out.sort((a, b) => a.rank - b.rank || b.plays - a.plays || spread(a.id) - spread(b.id) || a.id.localeCompare(b.id));
  return out.slice(0, Math.max(0, max)).map(({ id, homepage }) => ({ id, homepage }));
}
