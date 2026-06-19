import { describe, expect, it } from 'vitest';
import { facetTally } from './data';
import type { FacetEntry, StationRow } from './data';

/** Minimal row carrying only the facets a tally cares about. */
function row(facets: Record<string, Pick<FacetEntry, 'v'>>): StationRow {
  return {
    facets: facets as Record<string, FacetEntry | undefined>,
  } as StationRow;
}

describe('facetTally', () => {
  it('counts verdicts per facet from the per-station rows', () => {
    const rows = [
      row({ stream: { v: 'ok' }, logo: { v: 'bad' } }),
      row({ stream: { v: 'bad' }, logo: { v: 'warn' } }),
      row({ stream: { v: 'ok' }, logo: { v: 'bad' } }),
    ];
    const t = facetTally(rows);
    expect(t.stream).toEqual({ ok: 2, warn: 0, bad: 1, na: 0 });
    expect(t.logo).toEqual({ ok: 0, warn: 1, bad: 2, na: 0 });
  });

  it('does not read the runs header — a partial last run cannot understate it', () => {
    // 100 stations bad on stream; a runs header claiming "1 checked, 0 bad"
    // is irrelevant here — facetTally only sees the rows.
    const rows = Array.from({ length: 100 }, () => row({ stream: { v: 'bad' } }));
    expect(facetTally(rows).stream.bad).toBe(100);
  });

  it('zeroes every facet and ignores absent facets', () => {
    const t = facetTally([row({ stream: { v: 'ok' } })]);
    expect(t.homepage).toEqual({ ok: 0, warn: 0, bad: 0, na: 0 });
    expect(t.stream.na).toBe(0);
  });
});
