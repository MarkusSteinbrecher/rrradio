/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Apple App Site Association (AASA) regression tests (issue #563).
 *
 * The web→app handoff (Universal Links) only fires when rrradio.org
 * serves a valid AASA at `/.well-known/apple-app-site-association`.
 * The file ships as a static asset under `public/`, so Vite copies it
 * verbatim into `dist/` and GitHub Pages serves it at the apex.
 *
 * These tests assert the SOURCE file's shape so an accidental edit
 * (wrong appID, dropped query constraint, a `.json` rename, a BOM that
 * breaks JSON parsing) surfaces at PR time rather than as a silently
 * broken handoff on a real device. The structure must stay in lockstep
 * with the iOS entitlement (`applinks:rrradio.org`) in rrradio-ios #25.
 */

const AASA_PATH = resolve(process.cwd(), 'public/.well-known/apple-app-site-association');

interface AasaComponent {
  '/': string;
  '?'?: Record<string, string>;
  comment?: string;
}
interface AasaDetail {
  appIDs: string[];
  components: AasaComponent[];
}
interface Aasa {
  applinks: { details: AasaDetail[] };
}

const raw = readFileSync(AASA_PATH, 'utf8');
const aasa = JSON.parse(raw) as Aasa;

describe('apple-app-site-association', () => {
  it('survives the Pages deploy — upload-pages-artifact keeps hidden files', () => {
    // upload-pages-artifact@v5 excludes dot-directories by default
    // (`--exclude=.[^/]*`), which dropped .well-known from the deployed
    // tarball: the file passed CI but 404'd live. The deploy workflow
    // must opt back in, or this whole file never reaches the site.
    const deploy = readFileSync(resolve(process.cwd(), '.github/workflows/deploy.yml'), 'utf8');
    expect(deploy).toMatch(/upload-pages-artifact/);
    expect(deploy).toMatch(/include-hidden-files:\s*true/);
  });

  it('is served extensionless — no `.json` sibling that would shadow it', () => {
    // Apple requires the raw filename with no extension. A `.json`
    // variant in the same dir would be a sign someone "fixed" the
    // missing extension and broke the handoff.
    expect(existsSync(`${AASA_PATH}.json`)).toBe(false);
  });

  it('parses as JSON with no UTF-8 BOM', () => {
    // Apple's parser (and JSON.parse) choke on a leading BOM. readFileSync
    // surfaces it as U+FEFF at index 0.
    expect(raw.charCodeAt(0)).not.toBe(0xfeff);
    expect(raw.trimStart().startsWith('{')).toBe(true);
  });

  it('declares exactly the rrradio iOS app ID', () => {
    expect(aasa.applinks.details).toHaveLength(1);
    // <TeamID>.<bundleID> = AMWM3DHJSG . ios.rrradio.org
    expect(aasa.applinks.details[0].appIDs).toEqual(['AMWM3DHJSG.ios.rrradio.org']);
  });

  it('hands off only ?play= and ?list= links, scoped to the root path', () => {
    const components = aasa.applinks.details[0].components;
    // One component per recognised query key — and nothing else, so a
    // plain https://rrradio.org/ (or any other query) stays in the
    // browser and the web player isn't hijacked.
    const queryKeys = components.map((c) => Object.keys(c['?'] ?? {}).join(','));
    expect(queryKeys.sort()).toEqual(['list', 'play']);
    for (const c of components) {
      expect(c['/']).toBe('/');
      const constraint = c['?'] ?? {};
      // `?*` = "key present with any value".
      expect(Object.values(constraint)).toEqual(['?*']);
    }
  });
});
