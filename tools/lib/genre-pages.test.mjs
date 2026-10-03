import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  GENRES,
  GENRE_PAGE_LIMIT,
  genreForTag,
  genreStations,
  renderGenreIndex,
  renderGenrePage,
} from './genre-pages.mjs';

const jazz = GENRES.find((g) => g.id === 'jazz');
const st = (id, extra = {}) => ({ id, name: id, streamUrl: `https://x/${id}`, tags: ['jazz'], ...extra });
const opts = { site: 'https://rrradio.org', countryName: (c) => c, total: 3 };

describe('genreStations', () => {
  it('keeps only genre matches, curated/healthy first', () => {
    const list = [
      st('plain', { status: 'stream-only' }),
      st('logo', { status: 'stream-only', favicon: 'f' }),
      st('icy', { status: 'icy-only' }),
      st('work', { status: 'working' }),
      st('feat', { status: 'stream-only', featured: true }),
      st('rock', { tags: ['rock'], status: 'working' }),
    ];
    expect(genreStations(list, jazz).map((s) => s.id)).toEqual(['feat', 'work', 'icy', 'logo', 'plain']);
  });

  it('drops stream-bad stations and same-name repeats in one country', () => {
    const list = [
      st('a', { name: 'Jazz FM', country: 'GB' }),
      st('b', { name: 'jazz fm ', country: 'gb' }),
      st('c', { name: 'Jazz FM', country: 'US' }),
      st('bad'),
    ];
    const ids = genreStations(list, jazz, (id) => id === 'bad').map((s) => s.id);
    expect(ids).toEqual(['a', 'c']);
  });
});

describe('genreForTag', () => {
  it('maps raw tags onto the taxonomy', () => {
    expect(genreForTag('smooth jazz')?.id).toBe('jazz');
    expect(genreForTag('news')?.id).toBe('news');
    expect(genreForTag('zzz')).toBeUndefined();
  });
});

describe('renderGenrePage', () => {
  const items = Array.from({ length: GENRE_PAGE_LIMIT + 5 }, (_, i) => st(`s${i}`, { country: 'DE' }));
  const html = renderGenrePage(jazz, items, { ...opts, total: items.length });

  it('has canonical, og and the open-in-app deep link', () => {
    expect(html).toContain('<link rel="canonical" href="https://rrradio.org/genre/jazz/" />');
    expect(html).toContain('<meta property="og:url" content="https://rrradio.org/genre/jazz/" />');
    expect(html).toContain('href="/?genre=jazz"');
  });

  it('links stations, capped at the page limit', () => {
    expect(html.match(/href="\/station\//g)?.length).toBe(GENRE_PAGE_LIMIT);
  });

  it('ships a strict CSP whose hashes match the inline script + style', () => {
    const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] ?? '';
    expect(csp).not.toContain('unsafe-inline');
    const sha = (b) => `sha256-${createHash('sha256').update(b, 'utf8').digest('base64')}`;
    const script = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
    const style = html.match(/<style>([\s\S]*?)<\/style>/)[1];
    expect(csp).toContain(sha(script));
    expect(csp).toContain(sha(style));
    expect(JSON.parse(script)['@type']).toBe('CollectionPage');
  });

  it('escapes station names in HTML and JSON-LD', () => {
    const evil = renderGenrePage(jazz, [st('x', { name: '</script><b>' })], opts);
    expect(evil).not.toContain('</script><b>');
  });
});

describe('renderGenreIndex', () => {
  it('links every genre page', () => {
    const html = renderGenreIndex([{ genre: jazz, total: 700 }], { site: 'https://rrradio.org' });
    expect(html).toContain('href="/genre/jazz/"');
    expect(html).toContain('<link rel="canonical" href="https://rrradio.org/genre/" />');
  });
});
