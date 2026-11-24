/**
 * Smart App Banner (`apple-itunes-app`): the home page carries it inside
 * the `#seo:appbanner` block, and tools/build-station-pages.mjs rewrites
 * that block on every /station/<id>/ page to add the station's link. The
 * three places that name the App Store id must agree.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8');
const home = read('index.html');
const builder = read('tools/build-station-pages.mjs');
const landing = read('ios/index.html');

const block = /<!--\s*#seo:appbanner\s*-->([\s\S]*?)<!--\s*\/#seo:appbanner\s*-->/.exec(home)?.[1] ?? '';
const homeId = /<meta name="apple-itunes-app" content="app-id=(\d+)" \/>/.exec(block)?.[1];

describe('Smart App Banner', () => {
  it('is on the home page, inside the block the station pages rewrite', () => {
    expect(homeId).toMatch(/^\d+$/);
    expect(home.match(/name="apple-itunes-app"/g)).toHaveLength(1);
  });

  it('uses the App Store id of the listing /ios links to', () => {
    expect(landing).toContain(`https://apps.apple.com/app/rrradio-org/id${homeId}`);
    expect(builder).toContain(`const IOS_APP_ID = '${homeId}';`);
  });

  it('is rewritten per station with the link the app opens', () => {
    expect(builder).toContain("'appbanner'");
    expect(builder).toContain('app-argument=');
    expect(builder).toContain('/?play=${encodeURIComponent(s.id)}');
  });
});
