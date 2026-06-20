/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * App Store web-deliverable pages (#582 support, #583 marketing).
 *
 * `public/support.html` → https://rrradio.org/support (App Store Support URL)
 * `public/ios.html`     → https://rrradio.org/ios     (App Store Marketing URL)
 *
 * These ship as static files copied verbatim into `dist/` (like
 * `privacy.html`), so GitHub Pages serves them at clean URLs. App Review
 * rejects a 404 Support URL, so these tests lock the pieces App Review
 * and the privacy stance care about: live contact + report channel, the
 * cross-links, the screenshots, and the absence of any tracker/script.
 */

const PUBLIC = resolve(process.cwd(), 'public');
const read = (rel: string): string => readFileSync(resolve(PUBLIC, rel), 'utf8');

describe('App Store web pages', () => {
  describe('support.html (#582 — Support URL)', () => {
    const html = read('support.html');

    it('lists a working contact method and a public report channel', () => {
      expect(html).toContain('mailto:support@rrradio.org');
      // Must be the PUBLIC repo — the private rrradio-ios issues page 404s
      // for reviewers (the bug this issue fixes).
      expect(html).toContain('https://github.com/MarkusSteinbrecher/rrradio/issues');
      expect(html).not.toContain('rrradio-ios/issues');
    });

    it('links back to home and privacy', () => {
      expect(html).toMatch(/href="\/"/);
      expect(html).toMatch(/href="\/privacy/);
    });
  });

  describe('ios.html (#583 — Marketing URL)', () => {
    const html = read('ios.html');

    it('shows app screenshots that exist on disk', () => {
      for (const shot of ['screen-now-playing', 'screen-library', 'screen-browse']) {
        expect(html).toContain(`/ios-media/${shot}.webp`);
        expect(existsSync(resolve(PUBLIC, `ios-media/${shot}.webp`))).toBe(true);
      }
    });

    it('has an App Store badge and links to privacy + support', () => {
      expect(html.toLowerCase()).toContain('app store');
      expect(html).toMatch(/href="\/privacy/);
      expect(html).toMatch(/href="\/support/);
    });
  });

  // The privacy stance is the whole point of these pages — no analytics,
  // no third-party scripts. Mirrors privacy.html, which ships script-free.
  it.each(['support.html', 'ios.html'])('%s carries no scripts or trackers', (page) => {
    const html = read(page);
    expect(html).not.toMatch(/<script/i);
    expect(html.toLowerCase()).not.toContain('goatcounter');
  });
});
