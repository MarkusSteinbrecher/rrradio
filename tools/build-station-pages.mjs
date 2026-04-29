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

function pickTags(s) {
  const tags = (s.tags ?? []).map((t) => String(t).trim().toLowerCase()).filter(Boolean);
  // Prefer the first 3 short, descriptive tags; drop noise like "uk".
  return tags.slice(0, 3);
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

  const jsonld = {
    '@context': 'https://schema.org',
    '@type': 'RadioStation',
    name: s.name,
    url,
    description,
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
  const prose = `<aside class="seo-prose" aria-hidden="true">
      <h1>${escapeHtml(s.name)} — listen live online</h1>
      <p>${escapeHtml(proseCountry)}${escapeHtml(s.name)} live stream${tags.length ? ` (${escapeHtml(tags.join(', '))})` : ''}. Listen in any browser at rrradio.org — no signup, no app install, no tracking.</p>
      ${proseTags ? `<p>${escapeHtml(proseTags)}</p>` : ''}
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
    ].join('\n'),
  );
  html = replaceBlock(
    html,
    'twitter',
    [
      `    <meta name="twitter:card" content="summary" />`,
      `    <meta name="twitter:title" content="${escapeAttr(title)}" />`,
      `    <meta name="twitter:description" content="${escapeAttr(description)}" />`,
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

  // The home page has the favicon, GoatCounter snippet, and Vite's
  // hashed bundle references at root-relative paths (e.g. /assets/...).
  // Those still work on /station/<id>/ because every <link>/<script>
  // src starts with `/`. No path rewrites needed.
  return html;
}

// ─── 4. Emit pages ──────────────────────────────────────────────────
let written = 0;
for (const s of stations) {
  const dir = join(DIST, 'station', s.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), renderStationPage(s), 'utf8');
  written += 1;
}

// ─── 5. Sitemap ─────────────────────────────────────────────────────
const today = new Date().toISOString().slice(0, 10);
const sitemapEntries = [
  `  <url><loc>${SITE}/</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>`,
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
