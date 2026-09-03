import { describe, it, expect } from 'vitest';
import { emptyRecord, applyFacet } from './health-record.mjs';
import {
  latestByStationFacet,
  toFacetUpdates,
  computeStreaks,
  computeMetrics,
  coverage,
  rollupCutoffDay,
  serialiseStreaks,
  ICY_DETAILS,
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
      hotSet: { size: 2, bad: 1 },
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
    expect(m).toMatchObject({ availability: null, hotSet: { size: 0, bad: 0 } });
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
