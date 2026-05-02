/// <reference types="node" />
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import manifest from './fetchers.json';

/**
 * Pin the runtime fetcher registry to src/fetchers.json so the offline
 * analyzer (`tools/analyze.mjs`) and the runtime stay in sync. Adding a
 * fetcher to one without the other fails this test — exactly the
 * regression the audit (#68) caught when KNOWN_FETCHERS in analyze.mjs
 * lagged behind src/builtins.ts by 16 entries.
 *
 * We can't safely import the runtime FETCHERS_BY_KEY directly (loading
 * src/builtins.ts pulls in icyFetcher → AbortController + fetch glue +
 * a worker-proxy URL, which is heavy and noisy in a unit-test env). So
 * we read the source as text and grep the registry block — fragile in
 * theory, robust in practice because the block is a flat object literal
 * the codebase has good reason to keep that way.
 */

import { readFileSync } from 'node:fs';

function extractFetchersByKey(): string[] {
  // happy-dom doesn't expose a file:// import.meta.url, so resolve via
  // process.cwd() — vitest always runs with cwd at the repo root.
  const src = readFileSync(resolve(process.cwd(), 'src/builtins.ts'), 'utf8');
  const startMarker = 'const FETCHERS_BY_KEY:';
  const start = src.indexOf(startMarker);
  if (start < 0) throw new Error('FETCHERS_BY_KEY block not found in builtins.ts');
  const open = src.indexOf('{', start);
  const close = src.indexOf('};', open);
  const body = src.slice(open + 1, close);
  // Match the leading identifier of every entry, both bare keys (foo:)
  // and quoted keys ('foo-bar':). Skip blank/comment lines.
  const keys: string[] = [];
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('//') || line.startsWith('/*') || line.startsWith('*')) {
      continue;
    }
    const m = line.match(/^['"]?([a-z][a-z0-9-]*)['"]?\s*:/i);
    if (m) keys.push(m[1]);
  }
  return keys;
}

describe('fetcher registry stays in sync', () => {
  const manifestKeys = Object.keys(manifest.fetchers).sort();
  const runtimeKeys = extractFetchersByKey().sort();

  it('every fetcher in src/fetchers.json is registered in FETCHERS_BY_KEY', () => {
    const missing = manifestKeys.filter((k) => !runtimeKeys.includes(k));
    expect(missing).toEqual([]);
  });

  it('every entry in FETCHERS_BY_KEY appears in src/fetchers.json', () => {
    const missing = runtimeKeys.filter((k) => !manifestKeys.includes(k));
    expect(missing).toEqual([]);
  });

  it('manifest covers every shipped fetcher (count check, fast read)', () => {
    expect(runtimeKeys.length).toBeGreaterThan(0);
    expect(runtimeKeys.length).toBe(manifestKeys.length);
  });

  it('every fetcher entry has the expected schema', () => {
    for (const [key, entry] of Object.entries(manifest.fetchers)) {
      const e = entry as Record<string, unknown>;
      // broadcaster: string when the fetcher is tied to a single broadcaster,
      // null for generic fetchers like azuracast.
      expect(typeof e.broadcaster === 'string' || e.broadcaster === null,
        `${key}.broadcaster must be string or null`).toBe(true);
      expect(typeof e.schedule, `${key}.schedule must be boolean`).toBe('boolean');
      expect(typeof e.selfContained, `${key}.selfContained must be boolean`).toBe('boolean');
      expect(typeof e.notes, `${key}.notes must be string`).toBe('string');
    }
  });

  it('wireableBroadcasters is a string array', () => {
    expect(Array.isArray(manifest.wireableBroadcasters)).toBe(true);
    for (const b of manifest.wireableBroadcasters) expect(typeof b).toBe('string');
  });
});
