const GENERIC_HOST_PATTERNS = [
  /(^|\.)facebook\.com$/i,
  /^static\.xx\.fbcdn\.net$/i,
  /(^|\.)control\.divio\.com$/i,
  /(^|\.)hugedomains\.com$/i,
  /(^|\.)media-ssl\.musicradio\.com$/i,
  /^zeno\.fm$/i,
  /^www\.zeno\.fm$/i,
  /^www\.zenolive\.com$/i,
  /^www\.radio\.co$/i,
  /^www\.radioking\.com$/i,
  /^external\.spcast\.eu$/i,
];

const THIRD_PARTY_HOST_PATTERNS = [
  /(^|\.)streema\.com$/i,
  /(^|\.)tunein\.com$/i,
  /(^|\.)mytuner\.mobi$/i,
  /(^|\.)radio\.net$/i,
  /(^|\.)radio-browser\.info$/i,
];

const GENERIC_PATH_PATTERNS = [
  /\/favicon(?:[-_.]?\d+x\d+)?\.(?:ico|png|jpg|jpeg|webp|svg)$/i,
  /favicon[^/]*\.(?:ico|png|jpg|jpeg|webp|svg)$/i,
  /\/apple-touch-icon(?:[-_.]?\d+x\d+)?\.(?:png|jpg|jpeg|webp)$/i,
  /\/apple-icon-\d+x\d+\.(?:png|jpg|jpeg|webp)$/i,
  /\/android-chrome-\d+x\d+\.(?:png|jpg|jpeg|webp)$/i,
  /\/safari-pinned-tab\.svg$/i,
  /\/assets\/images\/touch-icons\//i,
  /\/lautfm-logo-share-image\.(?:png|jpg|jpeg|webp)$/i,
  /\/og-image\.(?:png|jpg|jpeg|webp)$/i,
  /webclip[^/]*\.(?:png|jpg|jpeg|webp)$/i,
  /\/static\/icons\/production\/\d+\.(?:png|jpg|jpeg|webp)$/i,
  /\/icon(?:[-_.]?\d+x\d+)?\.(?:ico|png|jpg|jpeg|webp|svg)$/i,
  /\/static\/favicon\.(?:ico|png|jpg|jpeg|webp|svg)$/i,
];

const GENERIC_FULL_URL_PATTERNS = [
  /\/\/static\.xx\.fbcdn\.net\/rsrc\.php\//i,
  /\/\/[^/]*hugedomains\.com\/images\/hdv\d?-img\/og_hugedomains\.(?:png|jpg|jpeg|webp)$/i,
  /\/\/www\.radioking\.com\/wp-content\/uploads\/\d{4}\/\d{2}\/(?:logo-\d|cropped-faviconrk)[^/]*\.(?:png|jpg|jpeg|webp)$/i,
  /\/\/www\.zenolive\.com\/apple-icon-precomposed\.png$/i,
  /\/\/panelradiowy\.pl\/images\/playfacebook\.png$/i,
  /\/\/slotex\.pl\/static\/img\/og\/homepage\.png/i,
];

const GOOD_PATH_HINTS = [
  /(^|[\/_.\-\s])logo([_.\-\s]|\d|$)/i,
  /(^|[\/_.\-\s])brand([_.\-\s]|\d|$)/i,
  /(^|[\/_.\-\s])radio([_.\-\s]|\d|$)/i,
  /(^|[\/_.\-\s])station([_.\-\s]|\d|$)/i,
];

const SMALL_SIZE_RE = /(?:^|[^\d])(?:16|24|32|48|64)x(?:16|24|32|48|64)(?:[^\d]|$)/i;
const GOOD_SIZE_RE = /(?:^|[^\d])(?:128|144|150|180|192|256|288|300|400|500|512|600|768|800|1000|1024)x(?:128|144|150|180|192|256|288|300|400|500|512|600|768|800|1000|1024)(?:[^\d]|$)/i;

function matchAny(patterns, value) {
  return patterns.some((pattern) => pattern.test(value));
}

function parseUrl(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

export function isLocalLogo(favicon) {
  return typeof favicon === 'string' && /^stations\//.test(favicon);
}

export function classifyLogoUrl(favicon) {
  if (!favicon) {
    return {
      state: 'bad',
      tier: 'missing',
      source: 'missing',
      reason: 'no favicon',
      upgradeRecommended: true,
      score: 0,
    };
  }

  if (isLocalLogo(favicon)) {
    return {
      state: 'ok',
      tier: 'curated',
      source: 'local',
      reason: favicon,
      upgradeRecommended: false,
      score: 2000,
    };
  }

  const url = parseUrl(favicon);
  if (!url) {
    return {
      state: 'bad',
      tier: 'invalid',
      source: 'remote',
      reason: 'not a parseable URL',
      upgradeRecommended: true,
      score: 0,
    };
  }

  if (url.protocol === 'http:') {
    return {
      state: 'bad',
      tier: 'http',
      source: 'remote',
      reason: 'http image (mixed content)',
      upgradeRecommended: true,
      score: 50,
    };
  }

  if (url.protocol !== 'https:') {
    return {
      state: 'bad',
      tier: 'invalid',
      source: 'remote',
      reason: `unsupported image scheme ${url.protocol}`,
      upgradeRecommended: true,
      score: 0,
    };
  }

  const host = url.hostname.toLowerCase();
  const path = decodeURIComponent(url.pathname || '').toLowerCase();
  const full = decodeURIComponent(url.href).toLowerCase();

  if (matchAny(GENERIC_HOST_PATTERNS, host)) {
    return {
      state: 'bad',
      tier: 'generic',
      source: 'remote',
      reason: `generic host ${host}`,
      upgradeRecommended: true,
      score: 100,
    };
  }

  if (matchAny(GENERIC_FULL_URL_PATTERNS, full)) {
    return {
      state: 'bad',
      tier: 'generic',
      source: 'remote',
      reason: 'generic platform image',
      upgradeRecommended: true,
      score: 100,
    };
  }

  if (path === '/favicon.ico' || matchAny(GENERIC_PATH_PATTERNS, path)) {
    return {
      state: 'warn',
      tier: 'weak',
      source: 'remote',
      reason: 'generic favicon/icon path',
      upgradeRecommended: true,
      score: 220,
    };
  }

  if (SMALL_SIZE_RE.test(full) && !GOOD_SIZE_RE.test(full)) {
    return {
      state: 'warn',
      tier: 'weak',
      source: 'remote',
      reason: 'small icon-sized image',
      upgradeRecommended: true,
      score: 300,
    };
  }

  if (matchAny(THIRD_PARTY_HOST_PATTERNS, host)) {
    return {
      state: 'warn',
      tier: 'third-party',
      source: 'remote',
      reason: `third-party logo host ${host}`,
      upgradeRecommended: true,
      score: 500,
    };
  }

  if (matchAny(GOOD_PATH_HINTS, full) || GOOD_SIZE_RE.test(full) || path.endsWith('.svg')) {
    return {
      state: 'ok',
      tier: 'good-remote',
      source: 'remote',
      reason: 'logo-like remote image',
      upgradeRecommended: false,
      score: 900,
    };
  }

  return {
    state: 'warn',
    tier: 'remote',
    source: 'remote',
    reason: 'remote image, quality unknown',
    upgradeRecommended: true,
    score: 650,
  };
}

export function parseIconSize(sizes) {
  if (!sizes) return 0;
  const parts = String(sizes).toLowerCase().split(/\s+/);
  let max = 0;
  for (const p of parts) {
    if (p === 'any') return 1024;
    const m = /^(\d+)x(\d+)$/.exec(p);
    if (m) max = Math.max(max, Number(m[1]), Number(m[2]));
  }
  return max;
}

export function scoreLogoCandidate(candidate) {
  let base;
  switch (candidate.rel) {
    case 'jsonld-logo':
      base = 1250;
      break;
    case 'html-logo':
    case 'header-logo':
      base = 1150;
      break;
    case 'manifest-icon':
      base = 1100;
      break;
    case 'apple-touch-icon-precomposed':
      base = 1000;
      break;
    case 'apple-touch-icon':
      base = 950;
      break;
    case 'og:logo':
      base = 925;
      break;
    case 'og:image':
    case 'og:image:secure_url':
      base = 800;
      break;
    case 'twitter:image':
    case 'twitter:image:src':
      base = 700;
      break;
    case 'mask-icon':
      base = 200;
      break;
    case 'shortcut icon':
    case 'icon':
      base = 400;
      break;
    default:
      base = 100;
  }

  const size = Number(candidate.size) || 0;
  base += Math.min(size, 512);

  const classified = classifyLogoUrl(candidate.url);
  if (classified.tier === 'generic') base -= 500;
  if (classified.tier === 'weak') base -= 150;
  if (classified.tier === 'good-remote') base += 250;
  if (classified.tier === 'http' || classified.tier === 'invalid') base -= 1000;
  if (candidate.url?.startsWith('https://')) base += 50;

  return base;
}

export function shouldReplaceLogo(existingFavicon, candidate, { replaceGood = false } = {}) {
  const existing = classifyLogoUrl(existingFavicon);
  if (existing.source === 'local') return false;
  if (!replaceGood && !existing.upgradeRecommended) return false;
  return scoreLogoCandidate(candidate) >= existing.score + 100;
}
