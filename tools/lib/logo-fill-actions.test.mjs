/**
 * Rule 9 (fill-logo) through the loop's contracts: policy → actuator →
 * dashboard. The finder and the judge have their own test files.
 */
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { decide } from './health-policy.mjs';
import { applyActions, applyFillLogo, iosFaviconSyncs, renderSummary } from './catalog-actions.mjs';
import { compactHistory, summariseActions, summariseLogoFills } from './health-dashboard.mjs';
import { userAgentFor } from './logo-probe.mjs';

const NOW = '2026-11-23T06:00:00.000Z';
const fill = (verdict, extra = {}) => ({
  newFavicon: 'https://radio.example/apple-touch-icon.png',
  sourceUrl: 'https://radio.example/',
  kind: 'apple-touch-icon',
  judge: verdict ? { verdict, why: 'station name in the mark' } : null,
  ...extra,
});
const missing = { o: 'bad', c: 'hard', n: 9, first: '2026-09-14', last: '2026-11-22' };

function run(logoFills, over = {}) {
  const ids = [...logoFills.keys()];
  return decide({
    streaks: Object.fromEntries(ids.map((id) => [id, { logo: missing }])),
    latestLogoDetail: new Map(ids.map((id) => [id, 'missing'])),
    tiers: Object.fromEntries(ids.map((id) => [id, id.startsWith('cur') ? 'curated' : 'long-tail'])),
    yamlById: new Map(ids.map((id) => [id, { id, status: 'stream-only' }])),
    publishedIds: new Set(ids),
    logoFills,
    metrics: { published: 1000, stream: { ok: 990, warn: 0, bad: 10 }, logo: { ok: 400, warn: 200, bad: 400, structural: 300 } },
    now: NOW,
    ...over,
  });
}

describe('rule 9 — fill-logo', () => {
  it('acts only on a judge yes: long tail automatic, curated to review', () => {
    const r = run(new Map([['tail-yes', fill('yes')], ['cur-yes', fill('yes')], ['tail-no', fill('no')], ['tail-unsure', fill('unsure')], ['tail-unjudged', fill(null)]]));
    expect(r.actions.map((a) => [a.id, a.action, a.auto, a.proposed ?? null])).toEqual([
      ['tail-yes', 'fill-logo', true, null],
      ['cur-yes', 'review', false, 'fill-logo'],
    ]);
    expect(r.actions[0]).toMatchObject({ newFavicon: fill('yes').newFavicon, sourceUrl: 'https://radio.example/', kind: 'apple-touch-icon' });
    expect(r.actions[0].reason).toBe("no logo · apple-touch-icon on the station's site · judge yes");
    expect(r.skipped).toEqual([
      { id: 'tail-no', why: 'fill-judge-no' },
      { id: 'tail-unjudged', why: 'fill-unjudged' },
      { id: 'tail-unsure', why: 'fill-judge-unsure' },
    ]);
  });

  it('never fills a station that has a logo verdict other than missing, is unpublished, or gets an http URL', () => {
    const fills = new Map([['a', fill('yes')], ['b', fill('yes')], ['c', fill('yes', { newFavicon: 'http://radio.example/x.png' })]]);
    const r = run(fills, {
      latestLogoDetail: new Map([['a', 'poor'], ['b', 'missing'], ['c', 'missing']]),
      publishedIds: new Set(['a', 'c']),
    });
    expect(r.actions.filter((x) => x.action === 'fill-logo' || x.proposed === 'fill-logo')).toEqual([]);
  });

  it('has its own cap and leaves the stream cap alone', () => {
    const fills = new Map(Array.from({ length: 5 }, (_, i) => [`t${i}`, fill('yes')]));
    const r = run(fills, { caps: { auto: 0, fill: 2 } });
    expect(r.actions.map((a) => a.id)).toEqual(['t0', 't1']);
    expect(r.skipped.filter((s) => s.why === 'cap')).toHaveLength(3);
  });

  it('is held by the stream circuit breaker like everything else', () => {
    const r = run(new Map([['tail-yes', fill('yes')]]), { metrics: { published: 1000, stream: { ok: 500, warn: 0, bad: 500 } } });
    expect(r.circuitBreaker).toBe(true);
    expect(r.skipped).toEqual([{ id: 'tail-yes', why: 'circuit-breaker' }]);
  });

  it('works for a station the probe has no logo streak for yet', () => {
    const r = run(new Map([['tail-yes', fill('yes')]]), { streaks: {} });
    expect(r.actions[0].streak).toMatchObject({ n: 0, first: '2026-11-23', d: 'missing' });
  });
});

const YAML = `- id: de-blocked
  faviconBlocked: true
  faviconBlockedBy: station-probe
  faviconBlockedReason: HTTP 404 ×6 · 2026-09-12→2026-10-17
  stationuuid: 62e78417-563d-11ea-be63-52543be04c81
  status: stream-only
- id: de-plain
  name: Plain FM
  streamUrl: "https://plain.example/stream"
  status: stream-only
- id: de-has
  favicon: "https://has.example/logo.png"
  status: stream-only
`;
const stations = () => [
  { id: 'de-blocked', name: 'Blocked', streamUrl: 'https://b.example/s', homepage: 'https://b.example/', country: 'DE', tags: ['pop'], bitrate: 128, status: 'stream-only' },
  { id: 'de-plain', name: 'Plain FM', streamUrl: 'https://plain.example/stream', status: 'stream-only' },
  { id: 'de-has', name: 'Has', streamUrl: 'https://has.example/s', favicon: 'https://has.example/logo.png', status: 'stream-only' },
];
const action = (id) => ({ id, action: 'fill-logo', auto: true, tier: 'long-tail', newFavicon: `https://${id}.example/icon.png`, sourceUrl: `https://${id}.example/`, reason: 'no logo' });

describe('applyFillLogo', () => {
  it('writes favicon + provenance, lifts the bot block, and puts the JSON fields where the builder would', () => {
    const list = stations();
    const { yamlText } = applyFillLogo({ yamlText: YAML, stations: list, action: action('de-blocked') });
    const row = parseYaml(yamlText).find((s) => s.id === 'de-blocked');
    expect(row).toEqual({
      id: 'de-blocked',
      favicon: 'https://de-blocked.example/icon.png',
      faviconSource: 'broadcaster-site',
      faviconSourceType: 'cdn',
      faviconSourceUrl: 'https://de-blocked.example/',
      faviconLicense: 'broadcaster-implicit',
      stationuuid: '62e78417-563d-11ea-be63-52543be04c81',
      status: 'stream-only',
    });
    expect(Object.keys(list[0])).toEqual(['id', 'name', 'streamUrl', 'homepage', 'country', 'tags', 'favicon', 'faviconSource', 'faviconSourceType', 'faviconSourceUrl', 'faviconLicense', 'bitrate', 'status']);
    // The other rows are untouched, byte for byte.
    expect(yamlText.slice(yamlText.indexOf('- id: de-plain'))).toBe(YAML.slice(YAML.indexOf('- id: de-plain')));
  });

  it('refuses to replace a logo, an http URL, or an unknown station', () => {
    expect(() => applyFillLogo({ yamlText: YAML, stations: stations(), action: action('de-has') })).toThrow(/never replaces/);
    expect(() => applyFillLogo({ yamlText: YAML, stations: stations(), action: { ...action('de-plain'), newFavicon: 'http://x.example/i.png' } })).toThrow(/https/);
    expect(() => applyFillLogo({ yamlText: YAML, stations: stations(), action: action('nope') })).toThrow(/stations\.yaml/);
  });

  it('runs through applyActions, the PR summary and the iOS-local sync', () => {
    const list = stations();
    const r = applyActions({ yamlText: YAML, stations: list, actions: [action('de-plain'), action('de-has')], day: '2026-11-23', mode: 'auto' });
    expect(r.applied.map((a) => [a.id, a.action, a.newFavicon])).toEqual([['de-plain', 'fill-logo', 'https://de-plain.example/icon.png']]);
    expect(r.errors.map((e) => e.id)).toEqual(['de-has']);
    const body = renderSummary({ applied: r.applied, errors: r.errors, mode: 'auto', day: '2026-11-23' });
    expect(body).toContain('fill-logo 1');
    expect(body).toContain('- `de-plain` · Plain FM · fill-logo · no logo');
    expect(body).toContain('  - logo: https://de-plain.example/icon.png');
    expect(body.split('\n').filter((l) => l.startsWith('- `'))).toHaveLength(1);
    expect(iosFaviconSyncs(r.applied, list).map((s) => [s.id, s.newFavicon])).toEqual([['de-plain', 'https://de-plain.example/icon.png']]);
  });
});

describe('dashboard', () => {
  const files = [
    { day: '2026-11-20', actions: [{ id: 'a', action: 'fill-logo', auto: true, newFavicon: 'https://a/1.png' }, { id: 'b', action: 'fill-logo', auto: true, newFavicon: 'https://b/1.png' }] },
    { day: '2026-11-21', actions: [{ id: 'c', action: 'fill-logo', auto: true, newFavicon: 'https://c/1.png' }, { id: 'd', action: 'fill-logo', auto: true, newFavicon: 'https://d/1.png' }, { id: 'e', action: 'review', auto: false, proposed: 'fill-logo', newFavicon: 'https://e/1.png' }, { id: 'f', action: 'clear-logo', auto: true }] },
  ];

  it('counts fills per day next to the other automatic actions', () => {
    expect(summariseActions(files).map((p) => [p.day, p.logoFilled, p.logoCleared, p.review])).toEqual([['2026-11-20', 2, 0, 0], ['2026-11-21', 2, 1, 1]]);
  });

  it('reports how many fills landed and still grade ok', () => {
    const catalog = [{ id: 'a', favicon: 'https://a/1.png' }, { id: 'b', favicon: 'https://b/1.png' }, { id: 'c', favicon: 'https://c/1.png' }, { id: 'd' }];
    const record = { stations: { a: { logo: { v: 'ok', d: 'good' } }, b: { logo: { v: 'bad', d: 'HTTP 404' } }, c: { logo: { v: 'bad', d: 'missing' } } } };
    expect(summariseLogoFills(files, catalog, record)).toEqual({ proposed: 4, landed: 3, graded: 2, ok: 1, survival: 0.5 });
    expect(summariseLogoFills([], catalog, record)).toEqual({ proposed: 0, landed: 0, graded: 0, ok: 0, survival: null });
  });

  it('carries logo coverage into the history points', () => {
    const [p] = compactHistory([{ at: '2026-11-22T13:00:00Z', logo: { ok: 10, warn: 2, bad: 8 }, hotSet: { size: 5, bad: 1, logoOk: 3 } }]);
    expect(p).toMatchObject({ logoOk: 10, logoWarn: 2, logoBad: 8, hotSize: 5, hotLogoOk: 3 });
  });
});

describe('userAgentFor', () => {
  const env = { LOGO_PROBE_BOT_UA: 'probe/1.0 (https://example.org/probe)' };
  it('names itself to Wikimedia only, and only when configured', () => {
    expect(userAgentFor('https://upload.wikimedia.org/wikipedia/commons/a/b.svg', env)).toBe(env.LOGO_PROBE_BOT_UA);
    expect(userAgentFor('https://cdn.example.net/logo.png', env)).toMatch(/^Mozilla/);
    expect(userAgentFor('https://notwikimedia.org/logo.png', env)).toMatch(/^Mozilla/);
    expect(userAgentFor('https://upload.wikimedia.org/x.png', {})).toMatch(/^Mozilla/);
  });
});
