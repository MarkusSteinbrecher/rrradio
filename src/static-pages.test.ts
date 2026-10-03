/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * App Store web-deliverable pages (#582 support).
 *
 * `public/support.html` → https://rrradio.org/support (App Store Support URL)
 *
 * The Marketing URL https://rrradio.org/ios is now served by the richer
 * Vite "vintage tuner" landing built from `ios/index.html` (it replaced the
 * earlier static `public/ios.html`).
 *
 * support.html ships as a static file copied verbatim into `dist/` (like
 * `privacy.html`), so GitHub Pages serves it at a clean URL. App Review
 * rejects a 404 Support URL, so these tests lock the pieces App Review
 * and the privacy stance care about: live contact + report channel, the
 * cross-links, and the absence of any tracker/script.
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

  describe('wake-to-radio.html (#624 — iOS About → Wake to radio link)', () => {
    const html = read('wake-to-radio.html');

    it('is the reader-facing guide at the clean URL the iOS app links to', () => {
      expect(html).toContain('<link rel="canonical" href="https://rrradio.org/wake-to-radio" />');
      expect(html).toContain('Keep playing until wake');
    });

    it('stays non-technical', () => {
      expect(html).not.toMatch(/audio session|force-quit|suspen|Shortcuts/i);
    });

    it('links back to home and support', () => {
      expect(html).toMatch(/href="\/"/);
      expect(html).toMatch(/href="\/support"/);
    });
  });

  // The privacy stance is the whole point of this page — no analytics,
  // no third-party scripts. Mirrors privacy.html, which ships script-free.
  it.each(['support.html', 'wake-to-radio.html'])('%s carries no scripts or trackers', (page) => {
    const html = read(page);
    expect(html).not.toMatch(/<script/i);
    expect(html.toLowerCase()).not.toContain('goatcounter');
  });
});
