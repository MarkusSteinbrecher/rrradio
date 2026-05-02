/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * CSP regression tests (audit #75). Parse the meta-CSP from
 * `index.html` and assert the directives the policy must hold —
 * surfaces accidental loosening (e.g. someone wiring 'unsafe-eval'
 * for a quick dep) at PR time instead of in production.
 *
 * Tests parse the static HTML by string match — no JSDOM needed.
 */

const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');

function getCsp(): string {
  const m = html.match(
    /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i,
  );
  if (!m) throw new Error('CSP meta tag not found in index.html');
  return m[1].replace(/\s+/g, ' ').trim();
}

function hasDirective(csp: string, name: string): string | null {
  const re = new RegExp(`(?:^|;\\s*)${name}\\s+([^;]+)`, 'i');
  const m = csp.match(re);
  return m ? m[1].trim() : null;
}

describe('Content-Security-Policy meta tag', () => {
  it('exists in index.html', () => {
    expect(getCsp()).toBeTruthy();
  });

  it('declares default-src self', () => {
    const v = hasDirective(getCsp(), 'default-src');
    expect(v).toContain("'self'");
  });

  it('script-src is restricted to self + the GoatCounter host', () => {
    const v = hasDirective(getCsp(), 'script-src');
    expect(v).not.toBeNull();
    expect(v).toContain("'self'");
    expect(v).toContain('https://gc.zgo.at');
    // unsafe-eval must never appear — that opens the door to eval(),
    // new Function(), setTimeout(string), etc.
    expect(v).not.toContain('unsafe-eval');
  });

  it('object-src is none', () => {
    expect(hasDirective(getCsp(), 'object-src')).toContain("'none'");
  });

  it('base-uri is restricted to self (prevents <base href> hijack)', () => {
    expect(hasDirective(getCsp(), 'base-uri')).toContain("'self'");
  });

  it('form-action is restricted to self', () => {
    expect(hasDirective(getCsp(), 'form-action')).toContain("'self'");
  });

  it('media-src allows the two audit-#71 HTTP-only stations', () => {
    const v = hasDirective(getCsp(), 'media-src');
    expect(v).not.toBeNull();
    expect(v).toContain('http://shoutcast.rtvc.gov.co');
    expect(v).toContain('http://162.244.80.52');
  });
});

describe('other browser-hardening meta tags', () => {
  it('Referrer-Policy is strict-origin-when-cross-origin', () => {
    const m = html.match(/<meta\s+name="referrer"\s+content="([^"]+)"/i);
    expect(m?.[1]).toBe('strict-origin-when-cross-origin');
  });

  it('Permissions-Policy exists and disables sensors / payment / camera', () => {
    const m = html.match(
      /<meta\s+http-equiv="Permissions-Policy"\s+content="([^"]+)"/i,
    );
    expect(m).not.toBeNull();
    const v = m![1];
    expect(v).toContain('camera=()');
    expect(v).toContain('microphone=()');
    expect(v).toContain('geolocation=()');
    expect(v).toContain('payment=()');
  });
});

describe('analytics is loaded as an external script (not inline)', () => {
  it('references /analytics.js via src', () => {
    expect(html).toMatch(/<script\s+src="\/analytics\.js"/);
  });

  it("doesn't carry an inline GoatCounter bootstrap (CSP would block it)", () => {
    // Old inline form had `gc.zgo.at` inside a <script>...</script> body.
    // After the refactor, gc.zgo.at appears only via /analytics.js (or
    // as a bare host string in the CSP itself / a rationale comment,
    // which are allowed). Strip HTML comments before scanning so they
    // don't mask false positives by colliding with the regex.
    const commentless = html.replace(/<!--[\s\S]*?-->/g, '');
    const inlineScripts = [
      ...commentless.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g),
    ];
    for (const [, body] of inlineScripts) {
      expect(body).not.toContain('gc.zgo.at');
    }
  });
});
