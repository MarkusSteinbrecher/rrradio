/**
 * App Store review quotes for the /ios landing page.
 *
 * The quotes are curated in data/app-reviews.yaml. This module validates
 * that file and turns it into what the page needs; vite.config.ts calls it
 * at build time, so the published page holds the quotes as static content
 * and never asks Apple for anything. tools/app-reviews.mjs (the helper that
 * prints new reviews) reads the same file to know what is already handled.
 */

import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

/** App Store id of the iOS app (apps.apple.com/app/rrradio-org/id<this>). */
export const APP_STORE_ID = '6767256355';

const REQUIRED = ['id', 'date', 'storefront', 'lang', 'author', 'rating', 'title', 'text'];
const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;
const STOREFRONT_RX = /^[a-z]{2}$/;

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The app's listing in one storefront. */
export function listingUrl(storefront) {
  return `https://apps.apple.com/${storefront}/app/rrradio-org/id${APP_STORE_ID}`;
}

/** English country name of a storefront code ("ch" → "Switzerland"). */
export function storefrontName(storefront) {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(storefront.toUpperCase()) ?? storefront.toUpperCase();
  } catch {
    return storefront.toUpperCase();
  }
}

/** "2026-06-25" → "25 Jun 2026". */
export function formatReviewDate(date) {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}

/**
 * Check the parsed YAML document and return `{ reviews, ignored }` with
 * plain string fields. Throws with every problem listed, so a bad edit
 * fails the build instead of publishing a broken quote.
 */
export function validateAppReviews(doc) {
  const problems = [];
  const list = doc && Array.isArray(doc.reviews) ? doc.reviews : null;
  if (!list) throw new Error('app-reviews: `reviews` must be a list');
  const seen = new Set();
  const reviews = list.map((raw, i) => {
    const where = `reviews[${i}]`;
    const r = raw && typeof raw === 'object' ? raw : {};
    for (const key of REQUIRED) {
      if (r[key] === undefined || r[key] === null || String(r[key]).trim() === '') {
        problems.push(`${where}: missing ${key}`);
      }
    }
    const id = String(r.id ?? '');
    if (seen.has(id)) problems.push(`${where}: duplicate id ${id}`);
    seen.add(id);
    if (r.date !== undefined && !DATE_RX.test(String(r.date))) {
      problems.push(`${where}: date must be a quoted YYYY-MM-DD string`);
    }
    if (r.storefront !== undefined && !STOREFRONT_RX.test(String(r.storefront))) {
      problems.push(`${where}: storefront must be a two-letter lowercase code`);
    }
    if (r.rating !== undefined && !(Number.isInteger(r.rating) && r.rating >= 1 && r.rating <= 5)) {
      problems.push(`${where}: rating must be a whole number from 1 to 5`);
    }
    return {
      id,
      date: String(r.date ?? ''),
      storefront: String(r.storefront ?? ''),
      lang: String(r.lang ?? ''),
      author: String(r.author ?? '').trim(),
      rating: r.rating,
      version: r.version === undefined ? undefined : String(r.version),
      title: String(r.title ?? '').trim(),
      text: String(r.text ?? '').trim(),
    };
  });
  const ignored = (Array.isArray(doc.ignored) ? doc.ignored : []).map((id) => String(id));
  for (const id of ignored) {
    if (seen.has(id)) problems.push(`ignored: ${id} is also listed under reviews`);
  }
  if (problems.length > 0) throw new Error(`app-reviews: ${problems.join('; ')}`);
  return { reviews, ignored };
}

export function loadAppReviews(path) {
  return validateAppReviews(parseYaml(readFileSync(path, 'utf8')));
}

const stars = (rating) => '★'.repeat(rating) + '☆'.repeat(5 - rating);
const starsLabel = (rating) => `${rating} out of 5 stars`;

/**
 * One slide per review (they follow the NO CATCH station's own copy), in the shape ios/tunein.js
 * renders: `head` and `copy` are plain text (the tuning effect scrambles
 * them), `html` is the same content with the attribution and the link to the
 * listing, shown once the station is locked in.
 */
export function reviewSlides(reviews) {
  return reviews.map((r, i) => {
    const store = `App Store ${storefrontName(r.storefront)}`;
    const date = formatReviewDate(r.date);
    return {
      name: `Listeners ${i + 1}/${reviews.length}`,
      head: `“${r.title}”`,
      lang: r.lang,
      copy: `${r.text} ${stars(r.rating)} ${r.author}, ${store}, ${date}`,
      html:
        `<span class="quote" lang="${escapeHtml(r.lang)}">${escapeHtml(r.text)}</span>` +
        `<span class="cite">` +
        `<span class="hl" role="img" aria-label="${starsLabel(r.rating)}">${stars(r.rating)}</span> ` +
        `${escapeHtml(r.author)} · ` +
        `<a class="bodylink" href="${escapeHtml(listingUrl(r.storefront))}" target="_blank" rel="noopener">${escapeHtml(store)}</a>` +
        ` · ${escapeHtml(date)}</span>`,
    };
  });
}

/** The quotes as plain markup for the page's screen-reader / no-script transcript. */
export function reviewsTranscriptHtml(reviews) {
  if (reviews.length === 0) return '';
  const items = reviews
    .map((r) => {
      const store = `App Store ${storefrontName(r.storefront)}`;
      return (
        `    <figure>\n` +
        `      <blockquote lang="${escapeHtml(r.lang)}"><p><strong>${escapeHtml(r.title)}</strong></p><p>${escapeHtml(r.text)}</p></blockquote>\n` +
        `      <figcaption>${starsLabel(r.rating)}. ${escapeHtml(r.author)}, ` +
        `<a href="${escapeHtml(listingUrl(r.storefront))}">${escapeHtml(store)}</a>, ${escapeHtml(formatReviewDate(r.date))}.</figcaption>\n` +
        `    </figure>`
      );
    })
    .join('\n');
  return `    <h2>What listeners say</h2>\n${items}`;
}

/** Replace what sits between the `#app-reviews` markers of the page. */
export function injectReviewsTranscript(html, reviews) {
  const rx = /(<!--\s*#app-reviews\b[^>]*-->)([\s\S]*?)(<!--\s*\/#app-reviews\s*-->)/;
  if (!rx.test(html)) return html;
  return html.replace(rx, (_m, open, _old, close) => `${open}\n${reviewsTranscriptHtml(reviews)}\n    ${close}`);
}
