import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILTERS,
  filterRows,
  filtersFromParams,
  filtersToParams,
  hasProblem,
  isDefaultFilters,
  logoDetailLabel,
  parseDashboard,
  sortRows,
  streamDetailLabel,
  tally,
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

  it('filters by country, tier, status and each facet', () => {
    expect(filterRows(dash.rows, f({ cc: 'de' })).map((r) => r.id)).toEqual(['de-dlf', 'de-arabella']);
    expect(filterRows(dash.rows, f({ tier: 'curated' }))).toHaveLength(2);
    expect(filterRows(dash.rows, f({ status: 'stream-only' }))).toHaveLength(3);
    expect(filterRows(dash.rows, f({ stream: 'bad' })).map((r) => r.id)).toEqual(['de-arabella']);
    expect(filterRows(dash.rows, f({ stream: 'unobserved' })).map((r) => r.id)).toEqual(['xx-new']);
    expect(filterRows(dash.rows, f({ np: 'silent' })).map((r) => r.id)).toEqual(['fr-x']);
    expect(filterRows(dash.rows, f({ logo: 'bad' })).map((r) => r.id)).toEqual(['gb-heart']);
    expect(filterRows(dash.rows, f({ home: 'ok' }))).toHaveLength(2);
  });

  it('"problems only" keeps failing streams, dead homepages and missing logos', () => {
    expect(filterRows(dash.rows, f({ problems: true })).map((r) => r.id)).toEqual(['de-arabella', 'gb-heart', 'fr-x']);
    expect(hasProblem(byId('de-dlf'))).toBe(false);
    expect(hasProblem(byId('xx-new'))).toBe(false);
  });

  it('searches name, id and country, whitespace-insensitively', () => {
    expect(filterRows(dash.rows, f({ q: 'arabella' })).map((r) => r.id)).toEqual(['de-arabella']);
    expect(filterRows(dash.rows, f({ q: 'WDR5' })).map((r) => r.id)).toEqual(['xx-new']);
    expect(filterRows(dash.rows, f({ q: 'gb-he' })).map((r) => r.id)).toEqual(['gb-heart']);
    expect(filterRows(dash.rows, f({ q: '   ' }))).toHaveLength(5);
  });

  it('combines filters', () => {
    expect(filterRows(dash.rows, f({ cc: 'DE', stream: 'ok' })).map((r) => r.id)).toEqual(['de-dlf']);
    expect(filterRows(dash.rows, f({ tier: 'long-tail', problems: true })).map((r) => r.id)).toEqual(['gb-heart', 'fr-x']);
  });
});

describe('sortRows', () => {
  it('sorts by name (case-insensitive) by default', () => {
    expect(sortRows(dash.rows, 'name').map((r) => r.name)).toEqual(['Deutschlandfunk', 'Heart 90s', 'Radio Arabella', 'Radio X', 'WDR 5']);
  });
  it('sorts worst stream first, longest streak on top', () => {
    const rows = [...dash.rows, { ...byId('de-arabella'), id: 'other', name: 'Zed', streakDays: 2 }];
    expect(sortRows(rows, 'stream').map((r) => r.id)).toEqual(['de-arabella', 'other', 'fr-x', 'xx-new', 'de-dlf', 'gb-heart']);
  });
  it('sorts by country then name, by most recent change, and by most recent check', () => {
    expect(sortRows(dash.rows, 'country').map((r) => r.id)).toEqual(['xx-new', 'de-dlf', 'de-arabella', 'fr-x', 'gb-heart']);
    expect(sortRows(dash.rows, 'since')[0].id).toBe('fr-x');
    expect(sortRows(dash.rows, 'checked').slice(0, 2).map((r) => r.id)).toEqual(['de-dlf', 'de-arabella']);
  });
  it('does not mutate the input', () => {
    const before = dash.rows.map((r) => r.id);
    sortRows(dash.rows, 'stream');
    expect(dash.rows.map((r) => r.id)).toEqual(before);
  });
});

describe('tally', () => {
  it('counts verdicts including unobserved', () => {
    expect(tally(dash.rows, 'stream')).toEqual({ ok: 2, warn: 1, bad: 1, na: 0, unobserved: 1 });
    expect(tally(dash.rows, 'home')).toEqual({ ok: 2, warn: 0, bad: 1, na: 0, unobserved: 2 });
  });
});

describe('URL state', () => {
  it('round-trips non-default filters and omits defaults', () => {
    const filters = f({ q: 'heart', cc: 'gb', tier: 'long-tail', stream: 'bad', np: 'icy', logo: 'warn', home: 'bad', problems: true, sort: 'stream', status: 'stream-only' });
    const params = filtersToParams(filters);
    expect(params.toString()).toBe('q=heart&cc=GB&tier=long-tail&status=stream-only&stream=bad&np=icy&logo=warn&home=bad&problems=1&sort=stream');
    expect(filtersFromParams(params)).toEqual({ ...filters, cc: 'GB' });
    expect(filtersToParams(DEFAULT_FILTERS).toString()).toBe('');
    expect(isDefaultFilters(f())).toBe(true);
    expect(isDefaultFilters(f({ problems: true }))).toBe(false);
  });

  it('ignores unknown values', () => {
    const parsed = filtersFromParams(new URLSearchParams('stream=meh&sort=nope&np=x&tier=gold&cc=ALL&problems=yes'));
    expect(parsed).toEqual(DEFAULT_FILTERS);
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
  });
});
