import { describe, expect, it } from 'vitest';
import { composeBrowseFilter, looseSearchQuery, type BrowseInputs } from './stations';

const NO_FILTER: BrowseInputs = {
  query: '',
  activeTag: 'all',
  activeCountry: 'all',
  browseMode: null,
};

describe('looseSearchQuery', () => {
  it('inserts a space between letter and digit', () => {
    expect(looseSearchQuery('WDR5')).toBe('WDR 5');
    expect(looseSearchQuery('BR24')).toBe('BR 24');
    expect(looseSearchQuery('FFH80')).toBe('FFH 80');
    expect(looseSearchQuery('Antenne1')).toBe('Antenne 1');
  });

  it('inserts a space between digit and letter', () => {
    expect(looseSearchQuery('5live')).toBe('5 live');
    expect(looseSearchQuery('80er')).toBe('80 er');
  });

  it('preserves the query untouched when it already contains whitespace', () => {
    expect(looseSearchQuery('WDR 5')).toBe('WDR 5');
    expect(looseSearchQuery('Hit Radio FFH')).toBe('Hit Radio FFH');
    expect(looseSearchQuery(' wdr 5 ')).toBe('wdr 5');
  });

  it('preserves the query when there are no letter↔digit boundaries', () => {
    expect(looseSearchQuery('jazz')).toBe('jazz');
    expect(looseSearchQuery('100,5')).toBe('100,5'); // comma between digits — no boundary
  });

  it('handles undefined / empty input', () => {
    expect(looseSearchQuery(undefined)).toBeUndefined();
    expect(looseSearchQuery('')).toBe('');
    expect(looseSearchQuery('   ')).toBe('');
  });

  it('preserves case (RB substring search is case-insensitive anyway)', () => {
    expect(looseSearchQuery('wdr5')).toBe('wdr 5');
    expect(looseSearchQuery('WDR5')).toBe('WDR 5');
    expect(looseSearchQuery('WdR5')).toBe('WdR 5');
  });

  it('handles German diacritics on the letter side', () => {
    expect(looseSearchQuery('München1')).toBe('München 1');
  });
});

describe('composeBrowseFilter', () => {
  it('produces an all-undefined filter and hasAnyFilter=false on default state', () => {
    const { filter, hasAnyFilter } = composeBrowseFilter(NO_FILTER);
    expect(filter).toEqual({
      query: undefined,
      tag: undefined,
      countryCode: undefined,
      offset: undefined,
    });
    expect(hasAnyFilter).toBe(false);
  });

  it('passes through a search query, trimming whitespace', () => {
    const { filter, hasAnyFilter } = composeBrowseFilter({
      ...NO_FILTER,
      query: '  WDR 5  ',
    });
    expect(filter.query).toBe('WDR 5');
    expect(hasAnyFilter).toBe(true);
  });

  it('treats activeTag="all" as no genre filter', () => {
    const { filter } = composeBrowseFilter({ ...NO_FILTER, activeTag: 'all' });
    expect(filter.tag).toBeUndefined();
  });

  it('passes a non-"all" activeTag through as the tag', () => {
    const { filter, hasAnyFilter } = composeBrowseFilter({
      ...NO_FILTER,
      activeTag: 'jazz',
    });
    expect(filter.tag).toBe('jazz');
    expect(hasAnyFilter).toBe(true);
  });

  it('treats activeCountry="all" as no country filter', () => {
    const { filter } = composeBrowseFilter({ ...NO_FILTER, activeCountry: 'all' });
    expect(filter.countryCode).toBeUndefined();
  });

  it('passes a country code through (regression: loadMore was dropping it)', () => {
    const { filter, hasAnyFilter } = composeBrowseFilter({
      ...NO_FILTER,
      activeCountry: 'DE',
    });
    expect(filter.countryCode).toBe('DE');
    expect(hasAnyFilter).toBe(true);
  });

  it('news mode forces tag=news (regression: loadMore was dropping news mode)', () => {
    const { filter, hasAnyFilter } = composeBrowseFilter({
      ...NO_FILTER,
      browseMode: 'news',
    });
    expect(filter.tag).toBe('news');
    expect(hasAnyFilter).toBe(true);
  });

  it('news mode overrides an active genre tag', () => {
    // The user picked a genre in the dropdown, then switched to news
    // mode. News wins.
    const { filter } = composeBrowseFilter({
      ...NO_FILTER,
      activeTag: 'jazz',
      browseMode: 'news',
    });
    expect(filter.tag).toBe('news');
  });

  it('played mode never sets tag=news', () => {
    const { filter } = composeBrowseFilter({
      ...NO_FILTER,
      browseMode: 'played',
    });
    expect(filter.tag).toBeUndefined();
  });

  it('combines query + tag + country + offset all at once', () => {
    const { filter, hasAnyFilter } = composeBrowseFilter(
      {
        query: 'rock',
        activeTag: 'metal',
        activeCountry: 'DE',
        browseMode: null,
      },
      { offset: 60 },
    );
    expect(filter).toEqual({
      query: 'rock',
      tag: 'metal',
      countryCode: 'DE',
      offset: 60,
    });
    expect(hasAnyFilter).toBe(true);
  });

  it('combines news mode + country (regression: load-more lost both)', () => {
    const { filter, hasAnyFilter } = composeBrowseFilter(
      { query: '', activeTag: 'all', activeCountry: 'CH', browseMode: 'news' },
      { offset: 120 },
    );
    expect(filter).toEqual({
      query: undefined,
      tag: 'news',
      countryCode: 'CH',
      offset: 120,
    });
    expect(hasAnyFilter).toBe(true);
  });

  it('passes the offset through unchanged on each call', () => {
    const { filter: page0 } = composeBrowseFilter(NO_FILTER, { offset: 0 });
    const { filter: page1 } = composeBrowseFilter(NO_FILTER, { offset: 60 });
    const { filter: page2 } = composeBrowseFilter(NO_FILTER, { offset: 120 });
    expect(page0.offset).toBe(0);
    expect(page1.offset).toBe(60);
    expect(page2.offset).toBe(120);
  });

  it('whitespace-only query is treated as no query', () => {
    const { filter, hasAnyFilter } = composeBrowseFilter({
      ...NO_FILTER,
      query: '   ',
    });
    expect(filter.query).toBeUndefined();
    expect(hasAnyFilter).toBe(false);
  });
});
