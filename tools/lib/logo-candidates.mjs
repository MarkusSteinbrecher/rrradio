/**
 * Pure candidate-logo logic for browser-logo-scout.mjs (issue: vision-agent
 * logo discovery). The browser collects raw asset descriptors from a live
 * page; these functions normalize, filter, and rank them so the vision judge
 * (an Opus 4.8 agent, or the --judge api path) only ever sees a short,
 * sane shortlist. No DOM, no network — unit-tested in logo-candidates.test.mjs.
 */

/** UGC / fan-upload hosts a broadcaster logo must never come from. Mirrors the
 *  deny-list in tools/flag-suspicious-favicons.mjs — keep the two in sync. */
export const DENY_HOSTS = Object.freeze([
  'postimg.cc',
  'i.ibb.co',
  'ibb.co',
  'imgur.com',
  'i.imgur.com',
  'fbcdn.net',
  'blogger.googleusercontent.com',
  'googleusercontent.com',
  'static.wixstatic.com',
  'cdn.onlineradiobox.com',
  'pbs.twimg.com',
  'scontent',
]);

/** Wikimedia is always an allowed logo host (Commons + per-wiki uploads). */
function isWikimedia(host) {
  return host === 'upload.wikimedia.org' || host.endsWith('.wikimedia.org') || host === 'commons.wikimedia.org';
}

function denied(host) {
  return DENY_HOSTS.some((bad) => host === bad || host.endsWith(`.${bad}`) || host.includes(bad));
}

/** Registrable-ish suffix match: does `host` belong to the broadcaster domain
 *  `base` (exact or a subdomain)? e.g. host "www1.wdr.de" ~ base "wdr.de". */
export function sameSite(host, base) {
  if (!host || !base) return false;
  host = host.toLowerCase();
  base = base.toLowerCase();
  return host === base || host.endsWith(`.${base}`);
}

/** Extract the broadcaster base domain from a homepage URL (drop leading www). */
export function broadcasterBase(homepage) {
  try {
    const h = new URL(homepage).hostname.toLowerCase();
    return h.replace(/^www\d*\./, '');
  } catch {
    return '';
  }
}

/** A candidate is admissible if it is https, an allowed host, and not denied. */
export function hostAllowed(url, broadcasterHost) {
  let host;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    host = u.hostname.toLowerCase();
  } catch {
    return false;
  }
  if (denied(host)) return false;
  if (isWikimedia(host)) return true;
  return broadcasterHost ? sameSite(host, broadcasterHost) : false;
}

/** Square-ish within 0.8–1.2, or unknown (null) — vectors pass regardless. */
export function aspectOk(width, height, format) {
  if (format === 'svg') return true;
  if (!width || !height) return true; // unknown — let the vision judge decide
  const r = width / height;
  return r >= 0.8 && r <= 1.2;
}

function formatOf(url, declared) {
  if (declared) return declared;
  const m = /\.(svg|png|jpe?g|webp|ico|gif)(?:[?#]|$)/i.exec(url || '');
  if (!m) return null;
  const ext = m[1].toLowerCase();
  return ext === 'jpeg' ? 'jpg' : ext;
}

const FORMAT_SCORE = { svg: 5, png: 4, webp: 2, jpg: 2, gif: 0, ico: -2 };
const KIND_SCORE = {
  'manifest-icon': 4,
  'apple-touch-icon': 3,
  'header-img': 3,
  'header-svg': 4,
  'og:image': 2,
  'twitter:image': 1,
  'link-icon': 0,
};

/** Heuristic score — higher is a more likely real, station-specific logo.
 *  The vision judge makes the final call; this only orders the shortlist. */
export function scoreCandidate(c, { stationName = '', broadcasterHost = '' } = {}) {
  const url = c.url || '';
  const fmt = formatOf(url, c.format);
  let s = 0;
  s += KIND_SCORE[c.kind] ?? 0;
  s += FORMAT_SCORE[fmt] ?? 0;
  if (aspectOk(c.width, c.height, fmt)) s += 2;
  else s -= 3;
  const maxDim = Math.max(c.width || 0, c.height || 0);
  if (maxDim >= 512) s += 2;
  else if (maxDim >= 192) s += 1;
  else if (maxDim && maxDim < 64) s -= 2;
  if (c.inHeader) s += 2;
  // name / keyword affinity in url + alt
  const hay = `${url} ${c.alt || ''}`.toLowerCase();
  const tokens = stationName.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 2);
  if (tokens.some((t) => hay.includes(t))) s += 2;
  if (/logo|icon|brand|signet/.test(hay)) s += 1;
  // obvious junk
  if (/dummy|placeholder|sprite|spinner|default[-_]?(av|logo)/.test(hay)) s -= 6;
  if (broadcasterHost) {
    try {
      if (sameSite(new URL(url).hostname, broadcasterHost)) s += 1;
    } catch { /* ignore */ }
  }
  return s;
}

/** Normalize raw browser descriptors → admissible, deduped, ranked shortlist. */
export function rankCandidates(raw, { stationName = '', broadcasterHost = '', limit = 8 } = {}) {
  const seen = new Set();
  const out = [];
  for (const c of raw || []) {
    if (!c || !c.url) continue;
    if (!hostAllowed(c.url, broadcasterHost)) continue;
    if (seen.has(c.url)) continue;
    seen.add(c.url);
    out.push({ ...c, format: formatOf(c.url, c.format), score: scoreCandidate(c, { stationName, broadcasterHost }) });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}
