import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import {
  APP_STORE_ID,
  formatReviewDate,
  injectReviewsTranscript,
  listingUrl,
  loadAppReviews,
  reviewSlides,
  reviewsTranscriptHtml,
  storefrontName,
  validateAppReviews,
} from './app-reviews.mjs';
import { parseFeed, toYamlBlock } from '../app-reviews.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const review = (over = {}) => ({
  id: '1',
  date: '2026-06-25',
  storefront: 'ch',
  lang: 'en',
  author: 'Listener',
  rating: 5,
  title: 'Great',
  text: 'Plays radio.',
  ...over,
});

describe('data/app-reviews.yaml', () => {
  const { reviews, ignored } = loadAppReviews(join(ROOT, 'data/app-reviews.yaml'));

  it('is valid and only holds positive reviews', () => {
    expect(reviews.length).toBeGreaterThan(0);
    for (const r of reviews) expect(r.rating).toBeGreaterThanOrEqual(4);
  });

  it('keeps the Spanish review in Spanish', () => {
    const es = reviews.find((r) => r.storefront === 'es');
    expect(es?.lang).toBe('es');
    expect(es?.title).toBe('Sencilla y perfecta');
  });

  it('never lists an ignored review', () => {
    for (const id of ignored) expect(reviews.some((r) => r.id === id)).toBe(false);
  });
});

describe('validateAppReviews', () => {
  it('reports every problem of a bad file', () => {
    expect(() =>
      validateAppReviews({
        reviews: [
          review({ rating: 6, date: '25 June', storefront: 'CH' }),
          review({ text: ' ' }),
        ],
        ignored: ['1'],
      }),
    ).toThrow(/rating.*|date/);
    expect(() => validateAppReviews({ reviews: [review(), review()] })).toThrow(/duplicate id/);
    expect(() => validateAppReviews({ reviews: [review()], ignored: ['1'] })).toThrow(/also listed/);
    expect(() => validateAppReviews({})).toThrow(/must be a list/);
  });
});

describe('rendering', () => {
  it('names the storefront and links to its listing', () => {
    expect(storefrontName('ch')).toBe('Switzerland');
    expect(listingUrl('es')).toBe(`https://apps.apple.com/es/app/rrradio-org/id${APP_STORE_ID}`);
    expect(formatReviewDate('2026-06-25')).toBe('25 Jun 2026');
  });

  it('builds one slide per review with attribution, stars and link', () => {
    const [slide] = reviewSlides([review({ rating: 4 })]);
    expect(slide.head).toBe('“Great”');
    expect(slide.name).toBe('Listeners 1/1');
    expect(slide.copy).toContain('Plays radio.');
    expect(slide.html).toContain('aria-label="4 out of 5 stars"');
    expect(slide.html).toContain('★★★★☆');
    expect(slide.html).toContain('Listener');
    expect(slide.html).toContain(`href="${listingUrl('ch')}"`);
    expect(slide.html).toContain('App Store Switzerland');
    expect(slide.html).toContain('25 Jun 2026');
  });

  it('escapes whatever a reviewer wrote', () => {
    const evil = review({ title: '<b>x</b>', text: '<img src=x onerror=alert(1)> & "q"', author: '<i>me</i>' });
    const [slide] = reviewSlides([evil]);
    const transcript = reviewsTranscriptHtml([evil]);
    for (const html of [slide.html, transcript]) {
      expect(html).not.toContain('<img');
      expect(html).not.toContain('<i>');
      expect(html).not.toContain('<b>');
      expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;q&quot;');
    }
  });

  it('fills the transcript between the page markers and nowhere else', () => {
    const page = 'a <!-- #app-reviews: note --> old <!-- /#app-reviews --> b';
    const out = injectReviewsTranscript(page, [review({ lang: 'es' })]);
    expect(out).toContain('<blockquote lang="es">');
    expect(out).not.toContain(' old ');
    expect(out.startsWith('a <!-- #app-reviews: note -->')).toBe(true);
    expect(out.endsWith('<!-- /#app-reviews --> b')).toBe(true);
    expect(injectReviewsTranscript('no markers', [review()])).toBe('no markers');
  });
});

describe('/ios landing page', () => {
  it('has the transcript markers and loads the quotes at build time only', () => {
    expect(read('ios/index.html')).toMatch(/<!--\s*#app-reviews\b[\s\S]*?<!--\s*\/#app-reviews\s*-->/);
    const js = read('ios/tunein.js');
    expect(js).toContain("from 'virtual:app-reviews'");
    // No request to Apple from the page: the feed is only read by the helper.
    for (const file of ['ios/tunein.js', 'ios/index.html']) {
      expect(read(file)).not.toMatch(/itunes\.apple\.com|fetch\(/);
    }
  });

  it('carries no review markup for search engines', () => {
    const html = read('ios/index.html');
    expect(html).not.toMatch(/AggregateRating|"@type":\s*"Review"/);
  });
});

describe('feed helper', () => {
  const feed = {
    feed: {
      entry: [
        {
          id: { label: '42' },
          updated: { label: '2026-06-25T01:12:13-07:00' },
          author: { name: { label: ' Someone ' } },
          'im:rating': { label: '5' },
          'im:version': { label: '1.0' },
          title: { label: 'Nice' },
          content: { label: 'Line one.\nLine "two".' },
        },
      ],
    },
  };

  it('reads a feed entry, a single-entry feed and an empty feed', () => {
    const [r] = parseFeed(feed, 'ch');
    expect(r).toEqual({
      id: '42',
      date: '2026-06-25',
      storefront: 'ch',
      author: 'Someone',
      rating: 5,
      version: '1.0',
      title: 'Nice',
      text: 'Line one. Line "two".',
    });
    expect(parseFeed({ feed: { entry: feed.feed.entry[0] } }, 'ch')).toHaveLength(1);
    expect(parseFeed({ feed: {} }, 'us')).toEqual([]);
  });

  it('prints a block the data file accepts', async () => {
    const { parse } = await import('yaml');
    const [r] = parseFeed(feed, 'ch');
    const doc = parse(`reviews:\n${toYamlBlock(r)}\n`);
    const { reviews } = validateAppReviews(doc);
    expect(reviews[0].text).toBe('Line one. Line "two".');
    expect(reviews[0].lang).toBe('en');
  });
});
