/**
 * Pre-render per-station landing pages for SEO.
 *
 * Reads dist/index.html (the home page produced by `vite build`) plus
 * dist/stations.json and writes one dist/station/<id>/index.html per
 * curated station, with unique <title> / <meta description> /
 * <link rel="canonical"> / og:* / twitter:* / JSON-LD, plus a
 * visually-hidden <h1> + paragraph for crawlers, plus a
 * `window.__STATION_ID__` boot hint that the SPA reads to auto-load
 * that station on page load.
 *
 * Also rewrites dist/sitemap.xml with every station URL so Search
 * Console can pick them all up.
 *
 * Markers in index.html have the shape:
 *
 *   <!-- #seo:title -->
 *   <title>...</title>
 *   <!-- /#seo:title -->
 *
 * The replaceBlock() helper rewrites everything between matching
 * comment markers (markers themselves are preserved so the next
 * build can run idempotently).
 *
 * Usage: `npm run build` runs this after vite.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const DIST = 'dist';
const SITE = 'https://rrradio.org';

// ─── 1. Inputs ──────────────────────────────────────────────────────
if (!existsSync(`${DIST}/index.html`)) {
  console.error(`build-station-pages: ${DIST}/index.html not found — run \`vite build\` first.`);
  process.exit(1);
}
const template = readFileSync(`${DIST}/index.html`, 'utf8');
const catalog = JSON.parse(readFileSync(`${DIST}/stations.json`, 'utf8'));
const stations = (catalog.stations ?? []).filter((s) => s.id && s.name && s.streamUrl);

// `reviewedAt` lives in station-curation.json (not stations.json — see
// build-catalog.mjs, which deliberately keeps editorial metadata out
// of the public catalog). Read it separately and join on station id.
let reviewedAtById = new Map();
try {
  const curation = JSON.parse(readFileSync(`${DIST}/station-curation.json`, 'utf8'));
  for (const row of curation?.stations ?? []) {
    if (row.id && row.reviewedAt) reviewedAtById.set(row.id, row.reviewedAt);
  }
} catch {
  // Non-fatal: recently-added section just renders empty when the
  // curation file is missing (e.g. fresh checkout, dist not built yet).
}

// ─── 2. Helpers ─────────────────────────────────────────────────────
const escapeHtml = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const escapeAttr = escapeHtml;

/** Replace everything between `<!-- #seo:NAME -->` and `<!-- /#seo:NAME -->`
 *  with `inner`. Markers are preserved. */
function replaceBlock(html, name, inner) {
  const re = new RegExp(
    `(<!--\\s*#seo:${name}\\s*-->)([\\s\\S]*?)(<!--\\s*/#seo:${name}\\s*-->)`,
    'g',
  );
  if (!re.test(html)) {
    console.warn(`build-station-pages: marker #seo:${name} not found in template`);
    return html;
  }
  return html.replace(
    new RegExp(`(<!--\\s*#seo:${name}\\s*-->)([\\s\\S]*?)(<!--\\s*/#seo:${name}\\s*-->)`, 'g'),
    `$1\n${inner}\n$3`,
  );
}

let countryDisplay;
try {
  countryDisplay = new Intl.DisplayNames(['en'], { type: 'region' });
} catch {
  countryDisplay = null;
}
function countryName(code) {
  if (!code) return undefined;
  const c = String(code).toUpperCase();
  try {
    const n = countryDisplay?.of(c);
    return n && n !== c ? n : c;
  } catch {
    return c;
  }
}

/** Truncate to ~155 chars on a word boundary so meta-description
 *  doesn't get cut mid-word in SERPs. */
function clip(s, max = 155) {
  if (!s || s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max - 30 ? cut.slice(0, lastSpace) : cut).trim() + '…';
}

function normalizeTags(tags) {
  if (tags === null || tags === undefined) return [];
  const source = Array.isArray(tags) ? tags : [tags];
  return source
    .flatMap((t) => String(t).split(/[,;]/))
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

function pickTags(s) {
  const tags = normalizeTags(s.tags);
  // Prefer the first 3 short, descriptive tags; drop noise like "uk".
  return tags.slice(0, 3);
}

// ─── 2b. Cross-link indexes ────────────────────────────────────────
// Each station page gets a "More from {country}" + "More {genre}
// stations" block in its SEO prose so crawlers see a dense internal
// link graph (~16 outbound links per page) rather than 703 islands
// each linking only to /. Order is catalog order (deterministic,
// reflects curator intent — featured stations naturally rise first).
const RELATED_MAX = 8;
const byCountry = new Map();
const byTag = new Map();
for (const s of stations) {
  if (s.country) {
    const c = String(s.country).toUpperCase();
    if (!byCountry.has(c)) byCountry.set(c, []);
    byCountry.get(c).push(s);
  }
  for (const t of normalizeTags(s.tags)) {
    const tag = String(t).trim().toLowerCase();
    if (!tag) continue;
    if (!byTag.has(tag)) byTag.set(tag, []);
    byTag.get(tag).push(s);
  }
}

function relatedByCountry(s) {
  if (!s.country) return [];
  const c = String(s.country).toUpperCase();
  return (byCountry.get(c) ?? [])
    .filter((o) => o.id !== s.id)
    .slice(0, RELATED_MAX);
}

function relatedByTag(s, exclude) {
  // Walk the picked tags in priority order; first match wins. Skips
  // stations already in the country list so the two blocks present
  // distinct alternatives instead of overlapping rosters.
  const tags = pickTags(s);
  if (!tags.length) return { tag: null, items: [] };
  const seen = new Set([s.id, ...exclude]);
  for (const tag of tags) {
    const items = [];
    for (const o of byTag.get(tag) ?? []) {
      if (seen.has(o.id)) continue;
      seen.add(o.id);
      items.push(o);
      if (items.length >= RELATED_MAX) break;
    }
    if (items.length) return { tag, items };
  }
  return { tag: null, items: [] };
}

function renderRelatedNav(heading, items) {
  if (!items.length) return '';
  const lis = items
    .map(
      (o) =>
        `        <li><a href="/station/${escapeAttr(o.id)}/">${escapeHtml(o.name)}</a></li>`,
    )
    .join('\n');
  return `      <nav>
        <h2>${escapeHtml(heading)}</h2>
        <ul>
${lis}
        </ul>
      </nav>`;
}

// ─── 2b. Recently added ────────────────────────────────────────────
// Sorted by `reviewedAt` desc (read from station-curation.json — see
// the top of the file for the join). It's not strictly "added";
// "Recently reviewed" would be more honest, but for Google's
// purposes a fresh timestamp is the signal that matters and
// "Recently added" reads better to anyone landing on it from search.
const recentlyAdded = stations
  .map((s) => ({ ...s, _reviewedAt: reviewedAtById.get(s.id) }))
  .filter((s) => s._reviewedAt)
  .sort((a, b) => String(b._reviewedAt).localeCompare(String(a._reviewedAt)));
const RECENT_HOME_LIMIT = 12;
const RECENT_PAGE_LIMIT = 30;

function renderRecentlyAddedNav(items) {
  if (!items.length) return '';
  const lis = items
    .map(
      (o) =>
        `        <li><a href="/station/${escapeAttr(o.id)}/">${escapeHtml(o.name)}</a></li>`,
    )
    .join('\n');
  return `      <nav>
        <h2>Recently added stations</h2>
        <ul>
${lis}
          <li><a href="/recently-added/">See all recently added →</a></li>
        </ul>
      </nav>`;
}

function renderRecentlyAddedPage(items) {
  const today = new Date().toISOString().slice(0, 10);
  const liHtml = items
    .map((s) => {
      const tags = pickTags(s);
      const country = countryName(s.country) || s.country || '';
      const metaParts = [];
      if (country) metaParts.push(country);
      if (tags.length) metaParts.push(tags.slice(0, 3).join(', '));
      const meta = metaParts.join(' · ');
      return `      <li>
        <a href="/station/${escapeAttr(s.id)}/">${escapeHtml(s.name)}</a>
        ${meta ? `<span class="meta">${escapeHtml(meta)}</span>` : ''}
      </li>`;
    })
    .join('\n');

  const jsonld = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Recently added stations',
    url: `${SITE}/recently-added/`,
    description:
      'The newest internet radio stations curated on rrradio.org — fresh additions to a free, ad-free, signup-free browser radio player.',
    isPartOf: { '@type': 'WebSite', name: 'rrradio', url: `${SITE}/` },
    dateModified: today,
  };

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Recently added stations · rrradio.org</title>
    <meta name="description" content="The newest internet radio stations curated on rrradio.org — fresh additions to a free, ad-free, signup-free browser radio player." />
    <link rel="canonical" href="${SITE}/recently-added/" />
    <meta name="robots" content="index, follow" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="rrradio" />
    <meta property="og:title" content="Recently added stations · rrradio.org" />
    <meta property="og:description" content="The newest internet radio stations curated on rrradio.org." />
    <meta property="og:url" content="${SITE}/recently-added/" />
    <meta property="og:image" content="${SITE}/og-image.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="Recently added stations · rrradio.org" />
    <meta name="twitter:image" content="${SITE}/og-image.png" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <script type="application/ld+json">${JSON.stringify(jsonld)}</script>
    <style>
      :root { color-scheme: dark; }
      body { font-family: system-ui, -apple-system, sans-serif; max-width: 720px; margin: 2.5rem auto; padding: 0 1.25rem; background: #1a1a1a; color: #eee; line-height: 1.5; }
      h1 { font-size: 1.5rem; margin: 0 0 0.5rem; }
      p { margin: 0 0 1.5rem; color: #b8b8b8; }
      a { color: #ffcc33; text-decoration: none; }
      a:hover { text-decoration: underline; }
      ul { list-style: none; padding: 0; margin: 0; }
      li { padding: 0.65rem 0; border-bottom: 1px solid #2a2a2a; }
      li a { font-weight: 500; }
      .meta { display: block; color: #888; font-size: 0.85rem; margin-top: 0.15rem; }
      nav { margin-top: 1.75rem; font-size: 0.95rem; }
    </style>
  </head>
  <body>
    <h1>Recently added stations</h1>
    <p>The newest internet radio stations on <a href="/">rrradio.org</a> — a free, ad-free, signup-free browser radio player.</p>
    <ul>
${liHtml}
    </ul>
    <nav><a href="/">← Back to all stations</a></nav>
  </body>
</html>
`;
}

// ─── 3. Per-station templates ──────────────────────────────────────
function renderStationPage(s) {
  const url = `${SITE}/station/${s.id}/`;
  const tags = pickTags(s);
  const country = countryName(s.country);
  const tagPhrase = tags.length ? tags.join(', ') : 'live radio';
  const countryPhrase = country ? ` from ${country}` : '';
  const title = `${s.name} · listen live online · rrradio.org`;
  const description = clip(
    `Listen to ${s.name} live online — ${tagPhrase} radio${countryPhrase}. Free in any browser, no signup, no app, no tracking.`,
  );

  const ogImage = `${SITE}/og-image.png`;

  const jsonld = {
    '@context': 'https://schema.org',
    '@type': 'RadioStation',
    name: s.name,
    url,
    description,
    image: ogImage,
    isAccessibleForFree: true,
    inLanguage: 'en',
  };
  if (tags.length) jsonld.genre = tags;
  if (country) jsonld.areaServed = { '@type': 'Country', name: country };
  if (s.homepage) jsonld.sameAs = s.homepage;

  const proseTags = tags.length
    ? `Genres: ${tags.join(', ')}.`
    : '';
  const proseCountry = country ? `${country} — ` : '';

  const countryRelated = relatedByCountry(s);
  const { tag: relatedTag, items: tagRelated } = relatedByTag(
    s,
    new Set(countryRelated.map((o) => o.id)),
  );
  const countryNav = renderRelatedNav(
    country ? `More radio from ${country}` : '',
    country ? countryRelated : [],
  );
  const tagNav = renderRelatedNav(
    relatedTag ? `More ${relatedTag} stations` : '',
    relatedTag ? tagRelated : [],
  );

  const prose = `<aside class="seo-prose" aria-hidden="true">
      <h1>${escapeHtml(s.name)} — listen live online</h1>
      <p>${escapeHtml(proseCountry)}${escapeHtml(s.name)} live stream${tags.length ? ` (${escapeHtml(tags.join(', '))})` : ''}. Listen in any browser at rrradio.org — no signup, no app install, no tracking.</p>
      ${proseTags ? `<p>${escapeHtml(proseTags)}</p>` : ''}
${countryNav}
${tagNav}
      <p><a href="/">Browse all stations</a></p>
    </aside>`;

  let html = template;
  html = replaceBlock(html, 'title', `    <title>${escapeHtml(title)}</title>`);
  html = replaceBlock(
    html,
    'description',
    `    <meta name="description" content="${escapeAttr(description)}" />`,
  );
  html = replaceBlock(html, 'canonical', `    <link rel="canonical" href="${url}" />`);
  html = replaceBlock(
    html,
    'og',
    [
      `    <meta property="og:type" content="website" />`,
      `    <meta property="og:site_name" content="rrradio" />`,
      `    <meta property="og:title" content="${escapeAttr(title)}" />`,
      `    <meta property="og:description" content="${escapeAttr(description)}" />`,
      `    <meta property="og:url" content="${url}" />`,
      `    <meta property="og:image" content="${ogImage}" />`,
      `    <meta property="og:image:width" content="1200" />`,
      `    <meta property="og:image:height" content="630" />`,
      `    <meta property="og:image:alt" content="${escapeAttr(`${s.name} on rrradio.org`)}" />`,
    ].join('\n'),
  );
  html = replaceBlock(
    html,
    'twitter',
    [
      `    <meta name="twitter:card" content="summary_large_image" />`,
      `    <meta name="twitter:title" content="${escapeAttr(title)}" />`,
      `    <meta name="twitter:description" content="${escapeAttr(description)}" />`,
      `    <meta name="twitter:image" content="${ogImage}" />`,
      `    <meta name="twitter:image:alt" content="${escapeAttr(`${s.name} on rrradio.org`)}" />`,
    ].join('\n'),
  );
  html = replaceBlock(
    html,
    'jsonld',
    `    <script type="application/ld+json">${JSON.stringify(jsonld)}</script>`,
  );
  html = replaceBlock(
    html,
    'bootstation',
    `    <script>window.__STATION_ID__=${JSON.stringify(s.id)};</script>`,
  );
  html = replaceBlock(html, 'prose', `    ${prose}`);
  // Recently-added is homepage-only; clear it on station pages so the
  // station page doesn't duplicate the homepage's "Recently added" nav.
  html = replaceBlock(html, 'recently-added', '');

  // The home page has the favicon, GoatCounter snippet, and Vite's
  // hashed bundle references at root-relative paths (e.g. /assets/...).
  // Those still work on /station/<id>/ because every <link>/<script>
  // src starts with `/`. No path rewrites needed.
  return html;
}

// ─── 3a. CSP hashing ───────────────────────────────────────────────
//
// Audit #75 follow-up: replace `script-src 'unsafe-inline'` with a
// per-page list of `'sha256-<hash>'` entries — one per inline
// <script> the page actually carries. The home + station pages each
// have two JSON-LD blocks (WebSite + WebApplication) and the station
// pages have an extra inline boot script that pins the
// `window.__STATION_ID__`. The hashes vary per page, so we compute
// them after the SEO blocks have been written.
//
// Strategy: find every `<script>...</script>` block (no `src` attr),
// SHA-256 the body, and inject the resulting source-list directive
// into the meta-CSP, dropping `'unsafe-inline'`. Robust against any
// future addition of an inline <script> as long as it's part of the
// static page HTML (dynamic scripts created at runtime are still
// covered by `script-src 'self'`).
function hashInline(body) {
  return 'sha256-' + createHash('sha256').update(body, 'utf8').digest('base64');
}

function applyCspHashes(html) {
  // Collect every inline <script> body (skip ones with src=).
  const scriptRe = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  const hashes = new Set();
  let m;
  while ((m = scriptRe.exec(html)) !== null) {
    hashes.add(hashInline(m[1]));
  }
  // No inline scripts on this page? Still rewrite to drop
  // `'unsafe-inline'` — no hashes needed.
  const hashSrc = [...hashes].map((h) => `'${h}'`).join(' ');

  return html.replace(
    /(<meta[^>]*http-equiv="Content-Security-Policy"[^>]*content=")([^"]+)(")/i,
    (_full, lead, content, tail) => {
      const next = content.replace(
        /script-src\s+([^;]+);/,
        (_dir, sources) => {
          const cleaned = sources
            .replace(/'unsafe-inline'/g, '')
            .replace(/\s+/g, ' ')
            .trim();
          return `script-src ${cleaned}${hashSrc ? ' ' + hashSrc : ''};`;
        },
      );
      return `${lead}${next}${tail}`;
    },
  );
}

// ─── 4. Emit pages ──────────────────────────────────────────────────
let written = 0;
for (const s of stations) {
  const dir = join(DIST, 'station', s.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), applyCspHashes(renderStationPage(s)), 'utf8');
  written += 1;
}

// Rewrite the home page too — fill the recently-added nav and run the
// same CSP hash sweep. It has the two JSON-LD blocks but no bootstation
// script (the SPA infers from the URL on station pages only). After
// this rewrite, neither the home nor the station pages carry
// `'unsafe-inline'` in their script-src.
const homepageHtml = replaceBlock(
  template,
  'recently-added',
  renderRecentlyAddedNav(recentlyAdded.slice(0, RECENT_HOME_LIMIT)),
);
writeFileSync(`${DIST}/index.html`, applyCspHashes(homepageHtml), 'utf8');

// Dedicated recently-added landing page. Standalone HTML, no SPA shell
// — Google can land users straight here from search and the page is
// instantly useful + indexable on its own.
const recentlyAddedDir = join(DIST, 'recently-added');
mkdirSync(recentlyAddedDir, { recursive: true });
writeFileSync(
  join(recentlyAddedDir, 'index.html'),
  renderRecentlyAddedPage(recentlyAdded.slice(0, RECENT_PAGE_LIMIT)),
  'utf8',
);

// ─── 5. Sitemap ─────────────────────────────────────────────────────
const today = new Date().toISOString().slice(0, 10);
const sitemapEntries = [
  `  <url><loc>${SITE}/</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>`,
  `  <url><loc>${SITE}/recently-added/</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>0.7</priority></url>`,
  ...stations.map(
    (s) =>
      `  <url><loc>${SITE}/station/${s.id}/</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`,
  ),
];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapEntries.join('\n')}
</urlset>
`;
writeFileSync(join(DIST, 'sitemap.xml'), sitemap, 'utf8');

console.log(
  `build-station-pages: wrote ${written} station page(s) + sitemap with ${sitemapEntries.length} entries`,
);
