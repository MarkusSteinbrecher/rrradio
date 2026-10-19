import { describe, it, expect } from 'vitest';
import { emptyRecord, applyFacet, pruneStations } from './health-record.mjs';
import {
  observedIds,
  latestByStationFacet,
  toFacetUpdates,
  computeStreaks,
  computeMetrics,
  coverage,
  rollupCutoffDay,
  serialiseStreaks,
  ICY_DETAILS,
  catalogFacetUpdates,
  facetUpdates,
} from './derive-health.mjs';

const NOW = '2026-09-10T06:00:00Z';

/** Minimal observation row; `o`/`c`/`d` are what the tests actually vary. */
function obs(id, day, o, extra = {}) {
  return {
    id,
    at: `${day}T05:00:00Z`,
    v: 'gha',
    f: 'stream',
    o,
    c: o === 'bad' ? (extra.c ?? 'soft') : null,
    s: null,
    ct: null,
    ms: 100,
    d: extra.d ?? (o === 'ok' ? 'audio/mpeg' : 'timeout'),
    icy: extra.icy ?? 'na',
    r: extra.r ?? false,
    ...(extra.at ? { at: extra.at } : {}),
  };
}

describe('latestByStationFacet', () => {
  it('keeps the newest row per station and facet', () => {
    const latest = latestByStationFacet([
      obs('a', '2026-09-08', 'ok'),
      obs('a', '2026-09-09', 'bad'),
      obs('b', '2026-09-09', 'ok'),
    ]);
    expect(latest.get('a').get('stream').o).toBe('bad');
    expect(latest.get('b').get('stream').o).toBe('ok');
  });

  it('breaks a timestamp tie by file order — the retry row is appended last', () => {
    const first = obs('a', '2026-09-09', 'bad', { at: '2026-09-09T05:00:00Z' });
    const retry = obs('a', '2026-09-09', 'ok', { at: '2026-09-09T05:00:00Z', r: true });
    expect(latestByStationFacet([first, retry]).get('a').get('stream')).toBe(retry);
  });
});

describe('toFacetUpdates', () => {
  it('maps stream outcome and detail straight through', () => {
    const latest = latestByStationFacet([obs('a', '2026-09-09', 'bad', { d: 'HTTP 404', c: 'hard' })]);
    expect([...toFacetUpdates(latest, 'stream')]).toEqual([['a', { v: 'bad', d: 'HTTP 404' }]]);
  });

  it('derives icy from the stream row using the probe vocabulary', () => {
    const latest = latestByStationFacet([
      obs('a', '2026-09-09', 'ok', { icy: 'ok' }),
      obs('b', '2026-09-09', 'ok', { icy: 'warn' }),
    ]);
    expect([...toFacetUpdates(latest, 'icy')]).toEqual([
      ['a', { v: 'ok', d: ICY_DETAILS.ok }],
      ['b', { v: 'warn', d: 'icy-metaint advertised, no StreamTitle in 64 KB' }],
    ]);
  });

  it('derives nothing for a facet with no rows', () => {
    expect(toFacetUpdates(new Map(), 'stream').size).toBe(0);
    const noIcy = latestByStationFacet([{ ...obs('a', '2026-09-09', 'ok'), icy: undefined }]);
    expect(toFacetUpdates(noIcy, 'icy').size).toBe(0);
  });
});

describe('computeStreaks', () => {
  it('counts distinct UTC days, not rows', () => {
    const streaks = computeStreaks([
      obs('a', '2026-09-08', 'bad'),
      { ...obs('a', '2026-09-08', 'bad'), at: '2026-09-08T17:00:00Z' },
      obs('a', '2026-09-09', 'bad'),
    ]);
    expect(streaks.a.stream).toEqual({ o: 'bad', c: 'soft', n: 2, first: '2026-09-08', last: '2026-09-09' });
  });

  it('lets the later row of a day decide that day', () => {
    const streaks = computeStreaks([
      obs('a', '2026-09-09', 'bad'),
      { ...obs('a', '2026-09-09', 'ok'), at: '2026-09-09T17:00:00Z' },
    ]);
    expect(streaks.a.stream).toMatchObject({ o: 'ok', c: null, n: 1 });
  });

  it('resets on an outcome change', () => {
    const streaks = computeStreaks([
      obs('a', '2026-09-07', 'bad'),
      obs('a', '2026-09-08', 'ok'),
      obs('a', '2026-09-09', 'ok'),
    ]);
    expect(streaks.a.stream).toEqual({ o: 'ok', c: null, n: 2, first: '2026-09-08', last: '2026-09-09' });
  });

  it('resets on a failure-class change even though the outcome is unchanged', () => {
    const streaks = computeStreaks([
      obs('a', '2026-09-07', 'bad', { c: 'soft' }),
      obs('a', '2026-09-08', 'bad', { c: 'hard', d: 'HTTP 404' }),
      obs('a', '2026-09-09', 'bad', { c: 'hard', d: 'HTTP 404' }),
    ]);
    expect(streaks.a.stream).toEqual({ o: 'bad', c: 'hard', n: 2, first: '2026-09-08', last: '2026-09-09' });
  });

  it('keeps facets apart', () => {
    const streaks = computeStreaks([
      obs('a', '2026-09-09', 'ok'),
      { ...obs('a', '2026-09-09', 'bad'), f: 'logo' },
    ]);
    expect(streaks.a.stream.o).toBe('ok');
    expect(streaks.a.logo.o).toBe('bad');
  });
});

describe('computeMetrics', () => {
  const catalog = [
    { id: 'a', name: 'A', status: 'working' },
    { id: 'b', name: 'B', status: 'stream-only' },
    { id: 'c', name: 'C', status: 'stream-only' },
    { id: 'd', name: 'D', status: 'stream-only' },
  ];
  const latest = latestByStationFacet([
    obs('a', '2026-09-10', 'ok'),
    obs('b', '2026-09-10', 'bad', { c: 'hard', d: 'HTTP 404' }),
    obs('c', '2026-09-10', 'warn', { d: 'content-type "text/html"' }),
    obs('gone', '2026-09-10', 'ok'), // no longer in the catalog
  ]);

  it('counts, weights by plays and reports the hot set', () => {
    // `d` has plays but no observation yet — unknown, not broken.
    const plan = { hot: ['a', 'b'], plays: { a: 90, b: 10, d: 25, gone: 1000 } };
    expect(computeMetrics({ catalog, latest, plan, streaks: {}, now: NOW })).toEqual({
      at: NOW,
      published: 4,
      observed7d: 3,
      freshness: 0.75,
      plays7d: 125,
      playsObserved: 100,
      playsUnobserved: 25,
      playsOnOk: 90,
      availability: 0.9,
      stream: { ok: 1, warn: 1, bad: 1, hard: 1, soft: 0 },
      logo: { ok: 0, warn: 0, bad: 0, hard: 0, soft: 0, structural: 0 },
      hotSet: { size: 2, bad: 1, logoOk: 0 },
    });
  });

  it('reports availability as null when played stations were never observed', () => {
    const m = computeMetrics({ catalog, latest, plan: { hot: [], plays: { d: 40 } }, streaks: {}, now: NOW });
    expect(m.availability).toBeNull();
    expect(m.playsUnobserved).toBe(40);
  });

  it('reports availability as null when nothing was played', () => {
    const m = computeMetrics({ catalog, latest, plan: { hot: [], plays: {} }, streaks: {}, now: NOW });
    expect(m.availability).toBeNull();
    expect(m.plays7d).toBe(0);
  });

  it('survives a missing plan', () => {
    const m = computeMetrics({ catalog, latest, plan: null, streaks: {}, now: NOW });
    expect(m).toMatchObject({ availability: null, hotSet: { size: 0, bad: 0, logoOk: 0 } });
  });

  it('does not count observations older than 7 days as fresh', () => {
    const stale = latestByStationFacet([obs('a', '2026-09-01', 'ok'), obs('b', '2026-09-10', 'ok')]);
    expect(computeMetrics({ catalog, latest: stale, plan: null, streaks: {}, now: NOW }).observed7d).toBe(1);
  });
});

describe('coverage', () => {
  const latest = latestByStationFacet([
    obs('a', '2026-09-10', 'ok', { icy: 'ok' }),
    obs('b', '2026-09-09', 'ok', { icy: 'na' }),
    obs('c', '2026-08-01', 'ok', { icy: 'ok' }),
  ]);

  it('counts stations observed in the last 7 days', () => {
    expect(coverage(latest, 'stream', NOW)).toBe(2);
  });

  it('counts icy coverage off the stream rows that carry an icy verdict', () => {
    expect(coverage(latest, 'icy', NOW)).toBe(2);
  });
});

describe('applyFacet through derived updates', () => {
  it('preserves `since` when the derived verdict and detail do not change', () => {
    const rec = emptyRecord();
    const day1 = latestByStationFacet([obs('a', '2026-09-08', 'ok', { icy: 'ok' })]);
    applyFacet(rec, 'stream', toFacetUpdates(day1, 'stream'), {
      tool: 'derive-health',
      scope: 'rolling',
      at: '2026-09-08T06:00:00Z',
    });
    const day2 = latestByStationFacet([obs('a', '2026-09-09', 'ok', { icy: 'ok' })]);
    applyFacet(rec, 'stream', toFacetUpdates(day2, 'stream'), {
      tool: 'derive-health',
      scope: 'rolling',
      at: '2026-09-09T06:00:00Z',
    });
    expect(rec.stations.a.stream).toEqual({ v: 'ok', since: '2026-09-08', d: 'audio/mpeg' });
    expect(rec.runs.stream.lastRun).toBe('2026-09-09T06:00:00Z');
  });
});

describe('observedIds', () => {
  const catalog = [{ id: 'a' }, { id: 'b' }];

  it('is the catalog plus plan.extra, ignoring malformed entries', () => {
    const plan = { extra: [{ id: 'gone', tier: 'unpublished' }, null, { name: 'no id' }, { id: 'a' }] };
    expect([...observedIds(catalog, plan)].sort()).toEqual(['a', 'b', 'gone']);
  });

  it('survives a missing plan or a plan without extra', () => {
    expect([...observedIds(catalog, null)]).toEqual(['a', 'b']);
    expect([...observedIds(catalog, { hot: [] })]).toEqual(['a', 'b']);
  });

  it('keeps a bot-unpublished station in the record when pruning', () => {
    const record = emptyRecord();
    const updates = new Map([
      ['a', { v: 'ok', d: 'audio/mpeg' }],
      ['gone', { v: 'ok', d: 'audio/mpeg' }],
    ]);
    applyFacet(record, 'stream', updates, { tool: 't', scope: 'rolling', at: NOW });
    expect(pruneStations(structuredClone(record), observedIds(catalog, null))).toBe(1);
    expect(pruneStations(record, observedIds(catalog, { extra: [{ id: 'gone' }] }))).toBe(0);
    expect(Object.keys(record.stations).sort()).toEqual(['a', 'gone']);
  });
});

describe('rollupCutoffDay', () => {
  it('is 90 days before now by default', () => {
    expect(rollupCutoffDay('2026-09-10T06:00:00Z')).toBe('2026-06-12');
    expect(rollupCutoffDay('2026-09-10T06:00:00Z', 7)).toBe('2026-09-03');
  });
});

describe('serialiseStreaks', () => {
  it('writes one sorted station per line with stream first', () => {
    const text = serialiseStreaks({
      b: { logo: { o: 'ok', c: null, n: 1, first: 'x', last: 'x' } },
      a: {
        icy: { o: 'bad', c: null, n: 2, first: '2026-09-08', last: '2026-09-09' },
        stream: { o: 'ok', c: null, n: 2, first: '2026-09-08', last: '2026-09-09' },
      },
    });
    const lines = text.trimEnd().split('\n');
    expect(lines[0]).toBe('{');
    expect(lines[1].startsWith('"a": {"stream":')).toBe(true);
    expect(lines[2].startsWith('"b":')).toBe(true);
    expect(() => JSON.parse(text)).not.toThrow();
  });
});

describe('metadata + homepage rows', () => {
  const row = (id, f, o, d, day = '2026-09-09') => ({ ...obs(id, day, o, { d }), f, icy: undefined });

  it('maps metadata and homepage rows like the logo facet', () => {
    const latest = latestByStationFacet([row('a', 'metadata', 'bad', 'HTTP 404'), row('a', 'homepage', 'warn', 'HTTP 403')]);
    expect([...toFacetUpdates(latest, 'metadata')]).toEqual([['a', { v: 'bad', d: 'HTTP 404' }]]);
    expect([...toFacetUpdates(latest, 'homepage')]).toEqual([['a', { v: 'warn', d: 'HTTP 403' }]]);
  });
});

describe('catalogFacetUpdates', () => {
  const verdictsOf = (s) => ({
    https: s.streamUrl.startsWith('https:') ? { v: 'ok' } : { v: 'bad', d: 'http (mixed content)' },
    fetcher: { v: 'na', d: 'generic' },
    program: { v: 'na' },
    ...(s.metadataUrl ? {} : { metadata: { v: 'na', d: 'not declared' } }),
  });

  it('decides the request-free facets for every catalogued station', () => {
    const out = catalogFacetUpdates(
      [
        { id: 'a', streamUrl: 'https://a', homepage: 'https://a.example' },
        { id: 'b', streamUrl: 'http://b', metadataUrl: 'https://b/m' },
      ],
      verdictsOf,
    );
    expect(out.get('https').get('b')).toEqual({ v: 'bad', d: 'http (mixed content)' });
    expect(out.get('program').get('a')).toEqual({ v: 'na', d: null });
    expect(out.get('metadata').has('a')).toBe(true);
    expect(out.get('metadata').has('b')).toBe(false); // needs the probe
    expect(out.get('homepage').has('a')).toBe(false); // needs check-homepages
    expect(out.get('homepage').get('b')).toEqual({ v: 'na', d: 'no homepage' });
  });
});

describe('facetUpdates', () => {
  const metaRow = (id, day, o, d) => ({ ...obs(id, day, o), d, f: 'metadata', icy: undefined });

  it('merges observed rows with catalog verdicts; the catalog wins', () => {
    const latest = latestByStationFacet([metaRow('a', '2026-09-09', 'ok', null), metaRow('b', '2026-09-09', 'bad', 'HTTP 500')]);
    // b dropped its metadataUrl since it was probed: the catalog decides now.
    const fromCatalog = new Map([['metadata', new Map([['b', { v: 'na', d: 'not declared' }], ['c', { v: 'na', d: 'not declared' }]])]]);
    const { updates, checked, observed } = facetUpdates(latest, 'metadata', fromCatalog, NOW);
    expect([...updates]).toEqual([
      ['a', { v: 'ok', d: null }],
      ['b', { v: 'na', d: 'not declared' }],
      ['c', { v: 'na', d: 'not declared' }],
    ]);
    expect(checked).toBe(3);
    expect(observed).toBe(2);
  });

  it('counts only last-7-day rows as checked, but keeps older verdicts', () => {
    const latest = latestByStationFacet([metaRow('a', '2026-08-01', 'ok', null), metaRow('b', '2026-09-09', 'ok', null)]);
    const { updates, checked } = facetUpdates(latest, 'metadata', new Map(), NOW);
    expect(updates.size).toBe(2);
    expect(checked).toBe(1);
  });

  it('is a pure catalog facet when no rows exist (https/fetcher/program)', () => {
    const fromCatalog = new Map([['https', new Map([['a', { v: 'ok', d: null }]])]]);
    expect(facetUpdates(new Map(), 'https', fromCatalog, NOW)).toEqual({
      updates: new Map([['a', { v: 'ok', d: null }]]),
      checked: 1,
      observed: 0,
    });
  });

  it('matches coverage() for the rolling facets it replaced', () => {
    const latest = latestByStationFacet([
      obs('a', '2026-09-09', 'ok', { icy: 'ok' }),
      obs('b', '2026-08-01', 'ok', { icy: 'bad' }),
    ]);
    for (const facet of ['stream', 'icy']) {
      expect(facetUpdates(latest, facet, new Map(), NOW).checked).toBe(coverage(latest, facet, NOW));
    }
  });

  it('a re-derive with unchanged inputs makes no transitions', () => {
    const latest = latestByStationFacet([metaRow('a', '2026-09-09', 'warn', 'content-type "text/html"')]);
    const record = emptyRecord();
    const { updates } = facetUpdates(latest, 'metadata', new Map(), NOW);
    applyFacet(record, 'metadata', updates, { tool: 'derive-health', at: NOW });
    const again = applyFacet(record, 'metadata', updates, { tool: 'derive-health', at: '2026-09-11T06:00:00Z' });
    expect(again.transitions).toBe(0);
    expect(record.stations.a.metadata.since).toBe('2026-09-10');
  });
});
