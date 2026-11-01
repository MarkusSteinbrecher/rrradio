import { describe, expect, it } from 'vitest';
import { byCountry, byCountryFailing, byLogoIssue, byNowPlaying, byReason } from './aggregate';
import {
  DEFAULT_FILTERS,
  activeFilters,
  failReason,
  filterRows,
  filtersFromParams,
  filtersToParams,
  logoIssue,
  sortRows,
  toggle,
  type Filters,
} from './filters';
import { parseDashboard, type HealthRow } from './model';

const COLS = [
  'id', 'name', 'cc', 'tier', 'status', 'stream', 'streamDetail', 'streamSince',
  'streakDays', 'streakClass', 'checked', 'np', 'logo', 'logoDetail', 'home',
];
const ROWS: unknown[][] = [
  ['de-dlf', 'Deutschlandfunk', 'DE', 'curated', 'working', 'ok', 'audio/mpeg', '', 0, '', '', 'api', 'ok', 'curated', 'ok'],
  ['de-arabella', 'Radio Arabella', 'DE', 'curated', 'working', 'bad', 'HTTP 404', '', 6, 'hard', '', 'none', 'warn', 'poor', 'ok'],
  ['gb-heart', 'Heart 90s', 'GB', 'long-tail', 'stream-only', 'ok', 'audio/aacp', '', 0, '', '', 'icy', 'bad', 'missing', 'bad'],
  ['fr-x', 'Radio X', 'FR', 'long-tail', 'stream-only', 'warn', 'content-type "application/ogg"', '', 0, '', '', 'silent', 'bad', 'HTTP 403', ''],
  ['gb-t', '__T', 'GB', 'long-tail', 'stream-only', 'bad', 'timeout', '', 2, 'soft', '', 'icy', 'ok', 'good', 'ok'],
  ['xx-new', 'WDR 5', '', 'long-tail', 'stream-only', '', '', '', 0, '', '', '', '', '', ''],
];
const rows = parseDashboard({ cols: COLS, rows: ROWS }).rows;
const ids = (rs: HealthRow[]): string[] => rs.map((r) => r.id);
const f = (over: Partial<Filters> = {}): Filters => ({ ...DEFAULT_FILTERS, ...over });
const row = (id: string): HealthRow => rows.find((r) => r.id === id) as HealthRow;

describe('reasons', () => {
  it('folds probe details into a few plain reasons', () => {
    expect(failReason(row('de-arabella'))).toBe('not-found');
    expect(failReason(row('gb-t'))).toBe('timeout');
    expect(failReason(row('fr-x'))).toBe('odd');
    expect(failReason(row('de-dlf'))).toBe('');
    const bad = { ...row('gb-t') };
    expect(failReason({ ...bad, streamDetail: 'HTTP 403' })).toBe('blocked');
    expect(failReason({ ...bad, streamDetail: 'HTTP 502' })).toBe('server');
    expect(failReason({ ...bad, streamDetail: 'refused' })).toBe('network');
    expect(failReason({ ...bad, streamDetail: 'tls' })).toBe('tls');
    expect(failReason({ ...bad, streamDetail: 'HTTP 400' })).toBe('other');
  });
  it('folds logo details into issues', () => {
    expect(logoIssue(row('de-arabella'))).toBe('small');
    expect(logoIssue(row('gb-heart'))).toBe('missing');
    expect(logoIssue(row('fr-x'))).toBe('dead');
    expect(logoIssue(row('de-dlf'))).toBe('');
  });
});

describe('filterRows', () => {
  it('passes everything by default', () => {
    expect(filterRows(rows, f())).toHaveLength(6);
  });
  it('combines filters', () => {
    expect(ids(filterRows(rows, f({ cc: 'DE' })))).toEqual(['de-dlf', 'de-arabella']);
    expect(ids(filterRows(rows, f({ stream: 'bad' })))).toEqual(['de-arabella', 'gb-t']);
    expect(ids(filterRows(rows, f({ stream: 'bad', cc: 'GB' })))).toEqual(['gb-t']);
    expect(ids(filterRows(rows, f({ why: 'odd' })))).toEqual(['fr-x']);
    expect(ids(filterRows(rows, f({ np: 'icy', tier: 'long-tail' })))).toEqual(['gb-heart', 'gb-t']);
    expect(ids(filterRows(rows, f({ logoWhy: 'missing' })))).toEqual(['gb-heart']);
    expect(ids(filterRows(rows, f({ home: 'bad' })))).toEqual(['gb-heart']);
    expect(ids(filterRows(rows, f({ q: 'wdr5' })))).toEqual(['xx-new']);
  });
  it('leaves out one filter for crossfilter charts', () => {
    const picked = f({ cc: 'DE', stream: 'bad' });
    expect(ids(filterRows(rows, picked, 'cc'))).toEqual(['de-arabella', 'gb-t']);
    expect(ids(filterRows(rows, picked, 'stream'))).toEqual(['de-dlf', 'de-arabella']);
  });
});

describe('toggle and active filters', () => {
  it('clears a pick when clicked again', () => {
    const once = toggle(f(), 'cc', 'DE');
    expect(once.cc).toBe('DE');
    expect(toggle(once, 'cc', 'DE').cc).toBe('all');
    expect(activeFilters(toggle(once, 'stream', 'bad'))).toEqual(['cc', 'stream']);
  });
});

describe('sortRows', () => {
  it('defaults to curated first, failing longest first', () => {
    expect(ids(sortRows(rows, 'default', 'asc')).slice(0, 3)).toEqual(['de-arabella', 'de-dlf', 'gb-t']);
  });
  it('sorts by streak and name, punctuation last', () => {
    expect(ids(sortRows(rows, 'streak', 'asc')).slice(0, 2)).toEqual(['de-arabella', 'gb-t']);
    expect(ids(sortRows(rows, 'name', 'asc')).at(-1)).toBe('gb-t');
    expect(ids(sortRows(rows, 'name', 'desc'))[0]).toBe('gb-t');
  });
});

describe('URL state', () => {
  it('round-trips and keeps the bare URL bare', () => {
    expect(filtersToParams(f()).toString()).toBe('');
    const state = f({ q: 'heart', cc: 'GB', stream: 'bad', why: 'timeout', np: 'icy', sort: 'streak', dir: 'desc' });
    expect(filtersFromParams(filtersToParams(state))).toEqual(state);
  });
  it('ignores junk', () => {
    const s = filtersFromParams(new URLSearchParams('cc=germany&stream=meh&why=x&sort=y&dir=up'));
    expect(s).toEqual(f());
  });
});

describe('aggregates', () => {
  it('counts stream verdicts per country, biggest first', () => {
    const c = byCountry(rows);
    expect(c[0]).toEqual({ cc: 'DE', total: 2, good: 1, weak: 0, bad: 1 });
    expect(c.find((x) => x.cc === '')).toEqual({ cc: '', total: 1, good: 0, weak: 0, bad: 0 });
    expect(byCountryFailing(rows).map((x) => x.cc)).toEqual(['DE', 'GB', 'FR']);
  });
  it('tallies reasons, logo issues and now playing', () => {
    expect(byReason(rows)).toEqual([
      { key: 'timeout', value: 1 },
      { key: 'not-found', value: 1 },
      { key: 'odd', value: 1 },
    ]);
    expect(byLogoIssue(rows).map((x) => x.key)).toEqual(['missing', 'small', 'dead']);
    expect(byNowPlaying(rows)).toEqual([
      { key: 'api', value: 1 },
      { key: 'icy', value: 2 },
      { key: 'silent', value: 1 },
      { key: 'hls', value: 0 },
      { key: 'none', value: 1 },
    ]);
  });
});
