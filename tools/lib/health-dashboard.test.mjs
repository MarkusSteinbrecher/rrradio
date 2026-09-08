import { describe, it, expect } from 'vitest';
import {
  COLS,
  buildDashboard,
  buildRow,
  compactHistory,
  nowPlayingKind,
  serialiseDashboard,
  tierOf,
} from './health-dashboard.mjs';

const NOW = '2026-09-09T06:00:00Z';

function facet(v, extra = {}) {
  return { v, since: '2026-09-01', ...extra };
}

describe('tierOf', () => {
  it('prefers the plan', () => {
    expect(tierOf({ id: 'a', status: 'stream-only' }, { a: 'curated' })).toBe('curated');
    expect(tierOf({ id: 'a', status: 'working' }, { a: 'long-tail' })).toBe('long-tail');
  });
  it('falls back to the status / featured rule', () => {
    expect(tierOf({ id: 'a', status: 'working' }, undefined)).toBe('curated');
    expect(tierOf({ id: 'a', status: 'icy-only' }, {})).toBe('curated');
    expect(tierOf({ id: 'a', status: 'stream-only', featured: true }, {})).toBe('curated');
    expect(tierOf({ id: 'a', status: 'stream-only' }, {})).toBe('long-tail');
  });
});

describe('nowPlayingKind', () => {
  it('folds the three metadata facets into one word', () => {
    expect(nowPlayingKind({ fetcher: facet('ok'), icy: facet('bad') })).toBe('api');
    expect(nowPlayingKind({ metadata: facet('ok'), icy: facet('bad') })).toBe('api');
    expect(nowPlayingKind({ fetcher: facet('na'), icy: facet('ok') })).toBe('icy');
    expect(nowPlayingKind({ icy: facet('warn') })).toBe('silent');
    expect(nowPlayingKind({ icy: facet('na') })).toBe('hls');
    expect(nowPlayingKind({ icy: facet('bad') })).toBe('none');
    expect(nowPlayingKind({})).toBe('');
  });
});

describe('buildRow', () => {
  const station = {
    id: 'de-dlf',
    name: 'Deutschlandfunk',
    country: 'de',
    status: 'working',
  };

  it('lays the row out in COLS order', () => {
    const row = buildRow(
      station,
      {
        stream: facet('ok', { d: 'audio/mpeg' }),
        icy: facet('ok'),
        fetcher: facet('ok', { d: 'dlf' }),
        logo: facet('ok', { d: 'curated' }),
        homepage: facet('bad', { d: 'HTTP 404' }),
      },
      { o: 'ok', c: null, n: 4, first: '2026-09-04', last: '2026-09-08' },
      'curated',
    );
    expect(row).toHaveLength(COLS.length);
    const byName = Object.fromEntries(COLS.map((c, i) => [c, row[i]]));
    expect(byName).toEqual({
      id: 'de-dlf',
      name: 'Deutschlandfunk',
      cc: 'DE',
      tier: 'curated',
      status: 'working',
      stream: 'ok',
      streamDetail: 'audio/mpeg',
      streamSince: '2026-09-01',
      streakDays: 0,
      streakClass: '',
      checked: '2026-09-08',
      np: 'api',
      logo: 'ok',
      logoDetail: 'curated',
      home: 'bad',
    });
  });

  it('carries the failing streak only while the stream is bad', () => {
    const bad = buildRow(
      station,
      { stream: facet('bad', { d: 'HTTP 404' }) },
      { o: 'bad', c: 'hard', n: 3, first: '2026-09-06', last: '2026-09-08' },
      'curated',
    );
    expect(bad[COLS.indexOf('streakDays')]).toBe(3);
    expect(bad[COLS.indexOf('streakClass')]).toBe('hard');
    const recovered = buildRow(
      station,
      { stream: facet('ok') },
      { o: 'ok', c: null, n: 2, first: '2026-09-07', last: '2026-09-08' },
      'curated',
    );
    expect(recovered[COLS.indexOf('streakDays')]).toBe(0);
    expect(recovered[COLS.indexOf('streakClass')]).toBe('');
  });

  it('cleans whitespace out of names', () => {
    const row = buildRow({ id: 'x', name: '\t  Radio  Foo ' }, {}, undefined, 'long-tail');
    expect(row[COLS.indexOf('name')]).toBe('Radio Foo');
    expect(buildRow({ id: 'y', name: '   ' }, {}, undefined, 'long-tail')[COLS.indexOf('name')]).toBe('y');
  });

  it('tolerates a station nothing has observed yet', () => {
    const row = buildRow({ id: 'x', name: 'X' }, {}, undefined, 'long-tail');
    expect(row[COLS.indexOf('stream')]).toBe('');
    expect(row[COLS.indexOf('checked')]).toBe('');
    expect(row[COLS.indexOf('np')]).toBe('');
    expect(row[COLS.indexOf('cc')]).toBe('');
  });
});

describe('compactHistory', () => {
  it('keeps the last row per day, oldest first, trimmed to the window', () => {
    const history = [
      { at: '2026-09-08T05:00:00Z', availability: 0.9, freshness: 0.5, stream: { ok: 1, bad: 9 } },
      { at: '2026-09-07T05:00:00Z', availability: 0.8, freshness: 0.4, stream: { ok: 2, bad: 8 } },
      { at: '2026-09-08T15:00:00Z', availability: 0.95, freshness: 0.6, stream: { ok: 3, bad: 7, hard: 2, soft: 5 }, hotSet: { bad: 1 } },
    ];
    const out = compactHistory(history, 2);
    expect(out.map((p) => p.day)).toEqual(['2026-09-07', '2026-09-08']);
    expect(out[1]).toMatchObject({ availability: 0.95, ok: 3, bad: 7, hard: 2, soft: 5, hotBad: 1 });
    expect(out[0].hotBad).toBeNull();
    expect(compactHistory(history, 1)).toHaveLength(1);
  });
});

describe('buildDashboard', () => {
  const catalog = [
    { id: 'zz-last', name: 'Last', country: 'ZZ', status: 'stream-only' },
    { id: 'de-dlf', name: 'DLF', country: 'DE', status: 'working' },
    { id: 'de-other', name: 'Other', country: 'de', status: 'stream-only' },
  ];
  const record = {
    runs: { stream: { lastRun: '2026-09-08T05:00:00Z' }, logo: { lastRun: '2026-09-08T05:01:00Z' } },
    stations: {
      'de-dlf': { stream: facet('ok', { d: 'audio/mpeg' }), icy: facet('ok') },
      'de-other': { stream: facet('bad', { d: 'dns' }) },
      'gone-station': { stream: facet('ok') },
    },
  };
  const streaks = {
    'de-other': { stream: { o: 'bad', c: 'hard', n: 5, first: '2026-09-04', last: '2026-09-08' } },
  };

  it('emits one row per published station, sorted by id, with counts and runs', () => {
    const d = buildDashboard({
      catalog,
      record,
      streaks,
      plan: { tiers: { 'de-other': 'curated' } },
      metrics: { availability: 0.93 },
      history: [{ at: '2026-09-08T05:00:00Z', availability: 0.93 }],
      now: NOW,
    });
    expect(d.version).toBe(1);
    expect(d.generatedAt).toBe(NOW);
    expect(d.cols).toEqual([...COLS]);
    expect(d.rows.map((r) => r[0])).toEqual(['de-dlf', 'de-other', 'zz-last']);
    expect(d.counts).toEqual({ published: 3, curated: 2, longTail: 1, countries: 2 });
    expect(d.runs).toEqual({ stream: '2026-09-08T05:00:00Z', logo: '2026-09-08T05:01:00Z' });
    expect(d.metrics).toEqual({ availability: 0.93 });
    expect(d.history).toHaveLength(1);
    const other = d.rows[1];
    expect(other[COLS.indexOf('tier')]).toBe('curated');
    expect(other[COLS.indexOf('streakDays')]).toBe(5);
  });

  it('works with nothing but a catalog', () => {
    const d = buildDashboard({ catalog, record: null, now: NOW });
    expect(d.rows).toHaveLength(3);
    expect(d.runs).toEqual({});
    expect(d.metrics).toBeNull();
    expect(d.history).toEqual([]);
  });
});

describe('serialiseDashboard', () => {
  it('round-trips and puts every row on its own line', () => {
    const d = buildDashboard({
      catalog: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
      record: null,
      now: NOW,
    });
    const text = serialiseDashboard(d);
    expect(JSON.parse(text)).toEqual(d);
    const lines = text.split('\n');
    expect(lines.filter((l) => l.startsWith('["a"') || l.startsWith('["b"'))).toHaveLength(2);
    expect(text.endsWith('\n')).toBe(true);
  });
});
