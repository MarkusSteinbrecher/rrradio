/**
 * The finder end to end against a fake site: real sharp, fake fetch.
 */
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { findLogo, findLogos, inspectImage } from './logo-fill-fetch.mjs';
import { hamming, HASH_NEAR } from './logo-fill.mjs';

const png = (w, h, rgb, alpha = 1) => sharp({ create: { width: w, height: h, channels: 4, background: { ...rgb, alpha } } }).png().toBuffer();
/** A square with a bright block in one corner, so pictures hash apart. */
const mark = async (size, corner) => sharp(await png(size, size, { r: 200, g: 30, b: 30 }))
  .composite([{ input: await png(size / 2, size / 2, { r: 255, g: 255, b: 255 }), gravity: corner }]).png().toBuffer();

const page = (head) => `<html><head>${head}</head></html>`;
function site(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, referer: init.headers?.Referer ?? null });
    const route = routes[url];
    const r = typeof route === 'function' ? route(init) : route;
    if (!r) return new Response('nope', { status: 404, headers: { 'content-type': 'text/html' } });
    const res = new Response(r.body, { status: r.status ?? 200, headers: { 'content-type': r.type ?? 'image/png' } });
    Object.defineProperty(res, 'url', { value: url });
    return res;
  };
  return { fetchImpl, calls };
}
const okProbe = async () => ({ status: 200, contentType: 'image/png', header: { format: 'png', width: 180, height: 180 }, bytes: 4000, ms: 1 });
const station = { id: 'x-test', homepage: 'https://radio.example/' };

describe('findLogo', () => {
  it('returns the first declared icon that passes every guard, with a tile and a hash', async () => {
    const logo = await mark(180, 'northwest');
    const { fetchImpl, calls } = site({
      'https://radio.example/': { type: 'text/html', body: page('<link rel="apple-touch-icon" href="/tiny.png"><link rel="apple-touch-icon" sizes="180x180" href="/touch.png">') },
      'https://radio.example/touch.png': { body: logo },
      'https://radio.example/tiny.png': { body: await mark(60, 'northwest') },
    });
    const r = await findLogo(station, { fetchImpl, probe: okProbe });
    expect(r.outcome).toBe('found');
    expect(r.find).toMatchObject({ id: 'x-test', site: 'radio.example', url: 'https://radio.example/touch.png', kind: 'apple-touch-icon', width: 180, height: 180 });
    expect(r.find.hash).toMatch(/^[0-9a-f]{16}$/);
    expect((await sharp(r.find.tile).metadata()).width).toBe(200);
    // The image is fetched the way the app will: with the app as Referer.
    expect(calls.find((c) => c.url.endsWith('/touch.png')).referer).toBe('https://rrradio.org/');
  });

  it('rejects a mark that is invisible on the dark theme', async () => {
    const { fetchImpl } = site({
      'https://radio.example/': { type: 'text/html', body: page('<link rel="apple-touch-icon" href="/dark.png">') },
      'https://radio.example/dark.png': { body: await png(180, 180, { r: 20, g: 20, b: 20 }) },
    });
    expect(await findLogo(station, { fetchImpl, probe: okProbe })).toMatchObject({ outcome: 'rejected', detail: 'invisible-on-dark' });
  });

  it('rejects a site that swaps the image for foreign Referers', async () => {
    const real = await mark(180, 'northwest');
    const stop = await mark(180, 'southeast');
    const { fetchImpl } = site({
      'https://radio.example/': { type: 'text/html', body: page('<link rel="apple-touch-icon" href="/touch.png">') },
      'https://radio.example/touch.png': (init) => ({ body: init.headers?.Referer === 'https://radio.example/' ? real : stop }),
    });
    expect(await findLogo(station, { fetchImpl, probe: okProbe })).toMatchObject({ outcome: 'rejected', detail: 'hotlink-protected' });
  });

  it('lets the probe veto, and reports empty and dead homepages', async () => {
    const logo = await mark(180, 'northwest');
    const routes = {
      'https://radio.example/': { type: 'text/html', body: page('<link rel="apple-touch-icon" href="/touch.png">') },
      'https://radio.example/touch.png': { body: logo },
    };
    const poorProbe = async () => ({ status: 200, contentType: 'image/png', header: { format: 'png', width: 40, height: 40 }, bytes: 400, ms: 1 });
    expect(await findLogo(station, { fetchImpl: site(routes).fetchImpl, probe: poorProbe })).toMatchObject({ outcome: 'rejected', detail: 'probe poor' });
    expect(await findLogo(station, { fetchImpl: site({ 'https://radio.example/': { type: 'text/html', body: page('') } }).fetchImpl })).toEqual({ id: 'x-test', outcome: 'none' });
    expect(await findLogo(station, { fetchImpl: site({}).fetchImpl })).toEqual({ id: 'x-test', outcome: 'fetch-failed', detail: 'HTTP 404' });
    expect(await findLogo(station, { fetchImpl: site({ 'https://radio.example/': { type: 'audio/mpeg', body: 'x' } }).fetchImpl })).toMatchObject({ outcome: 'fetch-failed', detail: 'stream' });
  });

  it('reads icons from the web app manifest', async () => {
    const { fetchImpl } = site({
      'https://radio.example/': { type: 'text/html', body: page('<link rel="manifest" href="/m.json">') },
      'https://radio.example/m.json': { type: 'application/json', body: JSON.stringify({ icons: [{ src: '/i512.png', sizes: '512x512' }] }) },
      'https://radio.example/i512.png': { body: await mark(512, 'northwest') },
    });
    expect((await findLogo(station, { fetchImpl, probe: okProbe })).find).toMatchObject({ kind: 'manifest-icon', width: 512 });
  });
});

describe('findLogos', () => {
  it('keeps order and turns a hung station into a failed one', async () => {
    const hang = () => new Promise(() => {});
    const fetchImpl = (url) => (url.includes('slow') ? hang() : Promise.resolve(new Response('', { status: 500 })));
    const out = await findLogos([{ id: 'a', homepage: 'https://slow.example/' }, { id: 'b', homepage: 'https://b.example/' }], { fetchImpl, deadline: 50, concurrency: 2 });
    expect(out).toEqual([{ id: 'a', outcome: 'fetch-failed', detail: 'deadline' }, { id: 'b', outcome: 'fetch-failed', detail: 'HTTP 500' }]);
  });
});

describe('inspectImage', () => {
  it('hashes the same picture alike at two sizes and a different one apart', async () => {
    const a = await inspectImage(await mark(180, 'northwest'));
    const b = await inspectImage(await mark(512, 'northwest'));
    const c = await inspectImage(await mark(180, 'southeast'));
    expect(hamming(a.hash, b.hash)).toBeLessThanOrEqual(HASH_NEAR);
    expect(hamming(a.hash, c.hash)).toBeGreaterThan(10);
    expect(a.contrast).toBeGreaterThan(48);
  });
});
