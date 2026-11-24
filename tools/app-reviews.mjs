#!/usr/bin/env node
/**
 * Print App Store reviews that are not yet handled in data/app-reviews.yaml.
 *
 *   npm run app-reviews
 *   npm run app-reviews -- --storefronts ch,es,de
 *   npm run app-reviews -- --all          # also print listed and ignored ones
 *
 * Reads Apple's public customer-reviews feed, one request per storefront:
 *   https://itunes.apple.com/<cc>/rss/customerreviews/id=<app id>/sortBy=mostRecent/json
 *
 * It only prints. Each new review comes out as a YAML block to paste under
 * `reviews:` (to show it on /ios) or as an id to put under `ignored:` (to
 * stop seeing it here). Nothing is written and nothing is published; the
 * site changes only when the data file is committed. Check `lang` before
 * pasting: the feed does not say which language a review is written in.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_STORE_ID, loadAppReviews, storefrontName } from './lib/app-reviews.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data/app-reviews.yaml');
const UA = 'rrradio-app-reviews/1.0 (+https://github.com/MarkusSteinbrecher/rrradio)';
// The feed has no "all storefronts" form. These are the storefronts worth
// asking by default; pass --storefronts for others.
const DEFAULT_STOREFRONTS = [
  'ch', 'de', 'at', 'es', 'fr', 'it', 'gb', 'ie', 'us', 'ca', 'nl', 'be', 'lu',
  'se', 'no', 'dk', 'fi', 'pl', 'pt', 'cz', 'hu', 'gr', 'au', 'nz', 'br', 'mx',
  'jp', 'in',
];

const argv = process.argv.slice(2);
const argVal = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const SHOW_ALL = argv.includes('--all');
const storefronts = (argVal('--storefronts') ?? DEFAULT_STOREFRONTS.join(','))
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter((s) => /^[a-z]{2}$/.test(s));

/** One feed entry → the fields of data/app-reviews.yaml. Exported for tests. */
export function parseFeed(json, storefront) {
  const entry = json?.feed?.entry;
  const list = !entry ? [] : Array.isArray(entry) ? entry : [entry];
  return list
    .filter((e) => e?.id?.label && e?.content?.label !== undefined)
    .map((e) => ({
      id: String(e.id.label),
      date: String(e.updated?.label ?? '').slice(0, 10),
      storefront,
      author: String(e.author?.name?.label ?? '').trim(),
      rating: Number(e['im:rating']?.label ?? 0),
      version: String(e['im:version']?.label ?? ''),
      title: String(e.title?.label ?? '').trim(),
      text: String(e.content.label).replace(/\s*\n+\s*/g, ' ').trim(),
    }));
}

/** A review as a block to paste under `reviews:`. Exported for tests. */
export function toYamlBlock(r) {
  const q = (s) => JSON.stringify(String(s));
  return [
    `  - id: ${q(r.id)}`,
    `    date: ${q(r.date)}`,
    `    storefront: ${r.storefront}`,
    `    lang: ${r.lang ?? 'en'}   # check: the feed does not give the language`,
    `    author: ${q(r.author)}`,
    `    rating: ${r.rating}`,
    `    version: ${q(r.version)}`,
    `    title: ${q(r.title)}`,
    `    text: ${q(r.text)}`,
  ].join('\n');
}

async function fetchStorefront(cc) {
  const url = `https://itunes.apple.com/${cc}/rss/customerreviews/id=${APP_STORE_ID}/sortBy=mostRecent/json`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseFeed(await res.json(), cc);
}

async function main() {
  const { reviews, ignored } = loadAppReviews(DATA);
  const listed = new Set(reviews.map((r) => r.id));
  const skipped = new Set(ignored);

  const found = [];
  const failed = [];
  for (const cc of storefronts) {
    try {
      found.push(...(await fetchStorefront(cc)));
    } catch (err) {
      failed.push(`${cc} (${err instanceof Error ? err.message : String(err)})`);
    }
  }
  // A review belongs to one storefront; keep the first copy of an id anyway.
  const byId = new Map();
  for (const r of found) if (!byId.has(r.id)) byId.set(r.id, r);
  const all = [...byId.values()].sort((a, b) => b.date.localeCompare(a.date));
  const fresh = all.filter((r) => !listed.has(r.id) && !skipped.has(r.id));

  console.log(
    `app-reviews: ${storefronts.length} storefront(s) asked, ${all.length} written review(s) in the feed: ` +
      `${all.filter((r) => listed.has(r.id)).length} listed, ` +
      `${all.filter((r) => skipped.has(r.id)).length} ignored, ${fresh.length} new`,
  );
  if (failed.length > 0) console.log(`app-reviews: no answer from ${failed.join(', ')}`);

  const missing = reviews.filter((r) => storefronts.includes(r.storefront) && !byId.has(r.id));
  if (missing.length > 0) {
    console.log(
      `app-reviews: ${missing.length} listed review(s) no longer in the feed (removed, edited, or older than its newest 50): ` +
        missing.map((r) => `${r.id} (${r.author})`).join(', '),
    );
  }

  for (const r of SHOW_ALL ? all : fresh) {
    const state = listed.has(r.id) ? 'listed' : skipped.has(r.id) ? 'ignored' : 'NEW';
    console.log(`\n# ${state} · ${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)} · ${storefrontName(r.storefront)} · ${r.date}`);
    console.log(toYamlBlock(r));
  }
  if (fresh.length > 0) {
    console.log('\nPaste a block under `reviews:` in data/app-reviews.yaml to show it, or its id under `ignored:`.');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(`app-reviews: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
