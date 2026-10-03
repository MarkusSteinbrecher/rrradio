/**
 * Static SEO landing pages per genre (#61): /genre/<id>/ plus a /genre/
 * index. Rendered by tools/build-station-pages.mjs after `vite build`.
 *
 * Unlike /station/<id>/ (the SPA shell with an sr-only prose block), these
 * are standalone, visible pages — like /recently-added/ — listing the top
 * stations of one genre with links to their /station/ pages and an
 * "Open in app" link (`/?genre=<id>`, handled in src/main.ts) that opens the
 * player with that genre filter applied.
 *
 * Genre membership reuses the runtime taxonomy (src/genre-taxonomy.data.mjs)
 * so a page lists exactly the stations the in-app genre chip shows.
 */
import { createHash } from 'node:crypto';
import { GENRES, stationMatchesGenre } from '../../src/genre-taxonomy.data.mjs';

export const GENRE_PAGE_LIMIT = 60;

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const STATUS_RANK = { working: 0, 'icy-only': 1, 'stream-only': 2 };

/** Curated / healthy first: featured → working → icy-only → stream-only
 *  with a logo → the rest, catalog order within a rank. */
function rank(s) {
  if (s.featured) return 0;
  const status = STATUS_RANK[s.status] ?? 2;
  if (status < 2) return 1 + status;
  return s.favicon ? 3 : 4;
}

/**
 * All stations of a genre, ranked, with stream-bad stations dropped and
 * same-name-same-country repeats collapsed. `isStreamBad(id)` comes from the
 * station health record.
 */
export function genreStations(stations, genre, isStreamBad = () => false) {
  const seen = new Set();
  const out = [];
  stations.forEach((s, i) => {
    if (!stationMatchesGenre(s, genre) || isStreamBad(s.id)) return;
    const key = `${String(s.country ?? '').toUpperCase()}|${String(s.name).trim().toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ s, r: rank(s), i });
  });
  out.sort((a, b) => a.r - b.r || a.i - b.i);
  return out.map((x) => x.s);
}

/** First taxonomy genre a single raw tag belongs to, or undefined. */
export function genreForTag(tag) {
  return GENRES.find((g) => stationMatchesGenre({ tags: [tag] }, g));
}

const hash = (body) => `'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`;

/** Strict per-page CSP: hash every inline <script> and <style> body. */
export function withCsp(html) {
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => hash(m[1]));
  const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => hash(m[1]));
  const csp = [
    "default-src 'self'",
    `script-src 'self' ${scripts.join(' ')}`.trim(),
    `style-src 'self' ${styles.join(' ')}`.trim(),
    "img-src 'self' https: data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  return html.replace('<!--CSP-->', `<meta http-equiv="Content-Security-Policy" content="${csp};" />`);
}

const STYLE = `
      :root { color-scheme: dark; }
      body { font-family: system-ui, -apple-system, sans-serif; max-width: 720px; margin: 2.5rem auto; padding: 0 1.25rem; background: #1a1a1a; color: #eee; line-height: 1.5; }
      h1 { font-size: 1.5rem; margin: 0 0 0.5rem; }
      p { margin: 0 0 1.25rem; color: #b8b8b8; }
      a { color: #ffcc33; text-decoration: none; }
      a:hover { text-decoration: underline; }
      ul { list-style: none; padding: 0; margin: 0; }
      li { padding: 0.65rem 0; border-bottom: 1px solid #2a2a2a; }
      li a { font-weight: 500; }
      .meta { display: block; color: #888; font-size: 0.85rem; margin-top: 0.15rem; }
      .open { display: inline-block; margin: 0 0 1.5rem; padding: 0.55rem 1rem; border: 1px solid #ffcc33; border-radius: 999px; font-weight: 600; }
      .chips { display: flex; flex-wrap: wrap; gap: 0.5rem; }
      .chips li { border: 1px solid #333; border-radius: 999px; padding: 0.35rem 0.8rem; }
      .chips .meta { display: inline; margin-left: 0.35rem; }
      nav { margin-top: 1.75rem; font-size: 0.95rem; }
    `;

function shell({ site, path, title, description, jsonld, body }) {
  const url = `${site}${path}`;
  return withCsp(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <!--CSP-->
    <meta name="referrer" content="strict-origin-when-cross-origin" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}" />
    <link rel="canonical" href="${url}" />
    <meta name="robots" content="index, follow" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="rrradio" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(description)}" />
    <meta property="og:url" content="${url}" />
    <meta property="og:image" content="${site}/og-image.png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(title)}" />
    <meta name="twitter:description" content="${esc(description)}" />
    <meta name="twitter:image" content="${site}/og-image.png" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>
    <style>${STYLE}</style>
  </head>
  <body>
${body}
  </body>
</html>
`);
}

function stationLi(s, countryName) {
  const meta = [countryName(s.country), (s.tags ?? []).slice(0, 3).join(', ')].filter(Boolean).join(' · ');
  return `      <li>
        <a href="/station/${esc(s.id)}/">${esc(s.name)}</a>
        ${meta ? `<span class="meta">${esc(meta)}</span>` : ''}
      </li>`;
}

/** One /genre/<id>/ page. `items` is the ranked genreStations() list. */
export function renderGenrePage(genre, items, { site, countryName, total }) {
  const path = `/genre/${genre.id}/`;
  const shown = items.slice(0, GENRE_PAGE_LIMIT);
  const title = `${genre.label} radio stations · listen live online · rrradio.org`;
  const description = `Listen to ${total.toLocaleString('en-US')} ${genre.label} internet radio stations live in your browser — free, no signup, no app, no tracking.`;
  const jsonld = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `${genre.label} radio stations`,
    url: `${site}${path}`,
    description,
    isPartOf: { '@type': 'WebSite', name: 'rrradio', url: `${site}/` },
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: shown.length,
      itemListElement: shown.map((s, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: `${site}/station/${s.id}/`,
        name: s.name,
      })),
    },
  };
  const body = `    <h1>${esc(genre.label)} radio stations</h1>
    <p>${esc(total.toLocaleString('en-US'))} ${esc(genre.label)} stations on <a href="/">rrradio.org</a>, the free, ad-free browser radio player. Curated stations with live track info come first.</p>
    <a class="open" href="/?genre=${esc(genre.id)}">Open ${esc(genre.label)} in the player →</a>
    <ul>
${shown.map((s) => stationLi(s, countryName)).join('\n')}
    </ul>
    <nav><a href="/genre/">All genres</a> · <a href="/">Browse all stations</a></nav>`;
  return shell({ site, path, title, description, jsonld, body });
}

/** The /genre/ index: every genre with a station count. */
export function renderGenreIndex(entries, { site }) {
  const title = 'Internet radio by genre · rrradio.org';
  const description =
    'Browse free internet radio by genre — jazz, classical, rock, news, electronic and more. Listen live in your browser, no signup, no app.';
  const jsonld = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Internet radio by genre',
    url: `${site}/genre/`,
    description,
    isPartOf: { '@type': 'WebSite', name: 'rrradio', url: `${site}/` },
  };
  const lis = entries
    .map(
      ({ genre, total }) =>
        `      <li><a href="/genre/${esc(genre.id)}/">${esc(genre.label)}</a><span class="meta">${esc(total.toLocaleString('en-US'))}</span></li>`,
    )
    .join('\n');
  const body = `    <h1>Internet radio by genre</h1>
    <p>Pick a genre to see its stations on <a href="/">rrradio.org</a>, the free, ad-free browser radio player.</p>
    <ul class="chips">
${lis}
    </ul>
    <nav><a href="/">← Back to all stations</a></nav>`;
  return shell({ site, path: '/genre/', title, description, jsonld, body });
}

export { GENRES };
