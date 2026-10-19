import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILTERS,
  filterRows,
  filtersFromParams,
  filtersToParams,
  isDefaultFilters,
  logoDetailLabel,
  parseDashboard,
  sortRows,
  streamDetailLabel,
  type Filters,
  type HealthRow,
} from './model';

const COLS = [
  'id', 'name', 'cc', 'tier', 'status', 'stream', 'streamDetail', 'streamSince',
  'streakDays', 'streakClass', 'checked', 'np', 'logo', 'logoDetail', 'home',
];

function raw(rows: unknown[][], extra: Record<string, unknown> = {}) {
  return { version: 1, generatedAt: '2026-09-09T05:30:00Z', cols: COLS, rows, ...extra };
}

const ROWS: unknown[][] = [
  ['de-dlf', 'Deutschlandfunk', 'DE', 'curated', 'working', 'ok', 'audio/mpeg', '2026-06-01', 0, '', '2026-09-08', 'api', 'ok', 'curated', 'ok'],
  ['de-arabella', 'Radio Arabella', 'DE', 'curated', 'working', 'bad', 'HTTP 404', '2026-09-03', 6, 'hard', '2026-09-08', 'none', 'warn', 'remote', 'ok'],
  ['gb-heart', 'Heart 90s', 'GB', 'long-tail', 'stream-only', 'ok', 'audio/aacp', '2026-09-04', 0, '', '2026-09-04', 'icy', 'bad', 'missing', 'bad'],
  ['fr-x', 'Radio X', 'FR', 'long-tail', 'stream-only', 'warn', 'content-type "application/ogg"', '2026-09-05', 0, '', '2026-09-05', 'silent', 'warn', 'weak', ''],
  ['xx-new', 'WDR 5', '', 'long-tail', 'stream-only', '', '', '', 0, '', '', '', '', '', ''],
];

const dash = parseDashboard(raw(ROWS, { counts: { published: 5, curated: 2, longTail: 3, countries: 3 } }));
const byId = (id: string): HealthRow => {
  const r = dash.rows.find((x) => x.id === id);
  if (!r) throw new Error(id);
  return r;
};
const f = (over: Partial<Filters> = {}): Filters => ({ ...DEFAULT_FILTERS, ...over });

describe('parseDashboard', () => {
  it('reads rows by column name and normalises values', () => {
    expect(dash.rows).toHaveLength(5);
    const dlf = byId('de-dlf');
    expect(dlf).toMatchObject({ name: 'Deutschlandfunk', cc: 'DE', tier: 'curated', stream: 'ok', np: 'api', logo: 'ok', home: 'ok', streakDays: 0 });
    const arabella = byId('de-arabella');
    expect(arabella).toMatchObject({ stream: 'bad', streakDays: 6, streakClass: 'hard', streamDetail: 'HTTP 404' });
    const fresh = byId('xx-new');
    expect(fresh).toMatchObject({ stream: '', np: '', logo: '', home: '', cc: '', checked: '' });
    expect(dash.counts).toEqual({ published: 5, curated: 2, longTail: 3, countries: 3 });
  });

  it('tolerates a reordered or partial column header', () => {
    const d = parseDashboard({ cols: ['name', 'id', 'stream'], rows: [['B', 'b', 'bad'], ['A', 'a', 'ok'], ['nope']] });
    expect(d.rows.map((r) => r.id)).toEqual(['b', 'a']);
    expect(d.rows[0]).toMatchObject({ name: 'B', stream: 'bad', cc: '', tier: 'long-tail', np: '' });
    expect(d.counts.published).toBe(2);
    expect(d.history).toEqual([]);
    expect(d.metrics).toBeNull();
  });

  it('drops rows without an id and survives junk', () => {
    const d = parseDashboard({ cols: COLS, rows: [['', 'x'], 'junk' as unknown as unknown[], [null]] });
    expect(d.rows).toEqual([]);
  });
});

describe('filterRows', () => {
  it('returns everything for the default filters', () => {
    expect(filterRows(dash.rows, f())).toHaveLength(5);
  });

  it('filters by country and view', () => {
    expect(filterRows(dash.rows, f({ cc: 'de' })).map((r) => r.id)).toEqual(['de-dlf', 'de-arabella']);
    expect(filterRows(dash.rows, f({ view: 'curated' })).map((r) => r.id)).toEqual(['de-dlf', 'de-arabella']);
    expect(filterRows(dash.rows, f({ view: 'attention' })).map((r) => r.id)).toEqual(['de-arabella', 'gb-heart', 'fr-x']);
  });

  it('filters by a dimension grade, or by weak-or-bad when no level is set', () => {
    expect(filterRows(dash.rows, f({ facet: 'stream', level: 'bad' })).map((r) => r.id)).toEqual(['de-arabella']);
    expect(filterRows(dash.rows, f({ facet: 'stream' })).map((r) => r.id)).toEqual(['de-arabella', 'fr-x']);
    expect(filterRows(dash.rows, f({ facet: 'np', level: 'bad' })).map((r) => r.id)).toEqual(['de-arabella']);
    expect(filterRows(dash.rows, f({ facet: 'logo', level: 'weak' })).map((r) => r.id)).toEqual(['de-arabella', 'fr-x']);
  });

  it('searches name, id and country, whitespace-insensitively', () => {
    expect(filterRows(dash.rows, f({ q: 'heart' })).map((r) => r.id)).toEqual(['gb-heart']);
    expect(filterRows(dash.rows, f({ q: 'WDR5' })).map((r) => r.id)).toEqual(['xx-new']);
    expect(filterRows(dash.rows, f({ q: 'fr-x' })).map((r) => r.id)).toEqual(['fr-x']);
  });
});

describe('sortRows', () => {
  it('puts curated stations first, then names', () => {
    expect(sortRows(dash.rows, 'curated').map((r) => r.id)).toEqual(['de-dlf', 'de-arabella', 'gb-heart', 'fr-x', 'xx-new']);
  });
  it('sorts lowest score first, unscored last', () => {
    const ids = sortRows(dash.rows, 'score').map((r) => r.id);
    expect(ids[0]).toBe('de-arabella');
    expect(ids[ids.length - 1]).toBe('xx-new');
  });
  it('sorts names starting with punctuation after real names', () => {
    const d = parseDashboard(raw([['a', '__1oldies'], ['b', 'Zeta'], ['c', 'alpha']]));
    expect(sortRows(d.rows, 'name').map((r) => r.name)).toEqual(['alpha', 'Zeta', '__1oldies']);
  });
  it('does not mutate the input', () => {
    const before = dash.rows.map((r) => r.id);
    sortRows(dash.rows, 'score');
    expect(dash.rows.map((r) => r.id)).toEqual(before);
  });
});

describe('URL state', () => {
  it('round-trips non-default filters and omits defaults', () => {
    expect(filtersToParams(DEFAULT_FILTERS).toString()).toBe('');
    expect(isDefaultFilters(f())).toBe(true);
    const custom = f({ q: 'dlf', cc: 'DE', view: 'attention', facet: 'logo', level: 'bad', sort: 'score' });
    const params = filtersToParams(custom);
    expect(filtersFromParams(params)).toEqual(custom);
  });
  it('ignores unknown values and a level without a facet', () => {
    const back = filtersFromParams(new URLSearchParams('view=nope&facet=x&level=bad&sort=zzz'));
    expect(back).toEqual(f());
  });
});

describe('labels', () => {
  it('names the codec family for playing streams and keeps failure vocabulary', () => {
    expect(streamDetailLabel(byId('de-dlf'))).toBe('MP3');
    expect(streamDetailLabel(byId('gb-heart'))).toBe('AAC');
    expect(streamDetailLabel({ ...byId('de-dlf'), streamDetail: 'application/vnd.apple.mpegurl' })).toBe('HLS');
    expect(streamDetailLabel(byId('de-arabella'))).toBe('HTTP 404');
    expect(streamDetailLabel(byId('fr-x'))).toBe('application/ogg');
    expect(streamDetailLabel(byId('xx-new'))).toBe('Not checked yet');
  });
  it('translates logo states', () => {
    expect(logoDetailLabel(byId('de-dlf'))).toBe('Curated');
    expect(logoDetailLabel(byId('gb-heart'))).toBe('Missing');
    expect(logoDetailLabel(byId('xx-new'))).toBe('Not checked');
    expect(logoDetailLabel({ ...byId('de-dlf'), logoDetail: 'acceptable' })).toBe('Good');
    expect(logoDetailLabel({ ...byId('de-dlf'), logo: 'bad', logoDetail: 'HTTP 404' })).toBe('HTTP 404');
    expect(logoDetailLabel({ ...byId('de-dlf'), logo: 'warn', logoDetail: 'poor' })).toBe('Too small');
  });
});
