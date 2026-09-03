import { describe, it, expect } from 'vitest';
import { renderDigest, renderMissingDigest, LIST_CAP } from './health-digest.mjs';

const NOW = '2026-09-10T06:00:00Z';

/**
 * Eight stations, one per interesting case:
 *   hot-hard   hot set, hard streak of 4 → newly failing (curated) + hot-set
 *   hot-soft   hot set, soft streak of 6 → newly failing (curated) + hot-set
 *   tail-hard  long tail, hard streak of 3 → newly failing (long tail)
 *   tail-short long tail, hard streak of 2 → below threshold, invisible
 *   old-bad    hard streak of 40 starting before the window → not "newly"
 *   back       ok streak of 3 after bad days in the window → recovered
 *   fresh      ok streak of 2, never bad → not recovered
 *   fine       ok, boring
 */
const catalog = [
  { id: 'hot-hard', name: 'Hot Hard', status: 'working' },
  { id: 'hot-soft', name: 'Hot Soft', status: 'icy-only' },
  { id: 'tail-hard', name: 'Tail Hard', status: 'stream-only' },
  { id: 'tail-short', name: 'Tail Short', status: 'stream-only' },
  { id: 'old-bad', name: 'Old Bad', status: 'stream-only' },
  { id: 'back', name: 'Back Again', status: 'stream-only' },
  { id: 'fresh', name: 'Fresh', status: 'stream-only' },
  { id: 'fine', name: 'Fine', status: 'working' },
];

const streaks = {
  'hot-hard': { stream: { o: 'bad', c: 'hard', n: 4, first: '2026-09-07', last: '2026-09-10' } },
  'hot-soft': { stream: { o: 'bad', c: 'soft', n: 6, first: '2026-09-05', last: '2026-09-10' } },
  'tail-hard': { stream: { o: 'bad', c: 'hard', n: 3, first: '2026-09-08', last: '2026-09-10' } },
  'tail-short': { stream: { o: 'bad', c: 'hard', n: 2, first: '2026-09-09', last: '2026-09-10' } },
  'old-bad': { stream: { o: 'bad', c: 'hard', n: 40, first: '2026-08-01', last: '2026-09-10' } },
  back: { stream: { o: 'ok', c: null, n: 3, first: '2026-09-08', last: '2026-09-10' } },
  fresh: { stream: { o: 'ok', c: null, n: 2, first: '2026-09-09', last: '2026-09-10' } },
  fine: { stream: { o: 'ok', c: null, n: 9, first: '2026-09-02', last: '2026-09-10' } },
};

const record = {
  version: 1,
  runs: {
    stream: { lastRun: NOW, tool: 'derive-health', scope: 'rolling', checked: 8, tally: {} },
    logo: { lastRun: '2026-09-03T06:00:00Z', tool: 'logo-status', scope: 'full', checked: 8, tally: {} },
  },
  stations: {
    'hot-hard': { stream: { v: 'bad', since: '2026-09-07', d: 'HTTP 404' } },
    'hot-soft': { stream: { v: 'bad', since: '2026-09-05', d: 'timeout' } },
    'tail-hard': { stream: { v: 'bad', since: '2026-09-08', d: 'HTTP 404' } },
    'tail-short': { stream: { v: 'bad', since: '2026-09-09', d: 'timeout' } },
    'old-bad': { stream: { v: 'bad', since: '2026-08-01', d: 'dns' } },
    back: { stream: { v: 'ok', since: '2026-09-08', d: 'audio/mpeg' } },
    fresh: { stream: { v: 'ok', since: '2026-09-09', d: 'audio/mpeg' } },
    fine: { stream: { v: 'ok', since: '2026-09-02', d: 'audio/mpeg' } },
  },
};

const plan = {
  hot: ['hot-hard', 'hot-soft', 'fine'],
  plays: { 'hot-hard': 40, 'hot-soft': 55, fine: 200 },
  tiers: { 'hot-hard': 'curated', 'hot-soft': 'curated', fine: 'curated' },
};

const metrics = { at: NOW, published: 8, observed7d: 8, freshness: 1, availability: 0.67 };
const history = [
  { at: '2026-08-27T06:00:00Z', availability: 0.9, freshness: 0.8 },
  { at: '2026-09-03T06:00:00Z', availability: 0.71, freshness: 0.9 },
  { at: '2026-09-09T06:00:00Z', availability: 0.68, freshness: 1 }, // too recent for the delta
];

const rows = [
  { id: 'back', at: '2026-09-06T05:00:00Z', f: 'stream', o: 'bad', c: 'soft' },
  { id: 'back', at: '2026-09-07T05:00:00Z', f: 'stream', o: 'bad', c: 'soft' },
  { id: 'back', at: '2026-09-08T05:00:00Z', f: 'stream', o: 'ok', c: null },
  { id: 'fresh', at: '2026-09-09T05:00:00Z', f: 'stream', o: 'ok', c: null },
];

const base = { record, streaks, metrics, history, plan, catalog, rows, days: 7, now: NOW };

/** The lines of one `### Heading` section. */
function section(md, heading) {
  const lines = md.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`### ${heading}`));
  expect(start, `section "${heading}" is missing`).toBeGreaterThan(-1);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith('### '));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

describe('renderDigest', () => {
  const md = renderDigest(base);

  it('leads with the three metrics and week-over-week deltas', () => {
    expect(md).toContain('| Availability (play-weighted) | 67.0% | −4.0pp |');
    expect(md).toContain('| Freshness (observed 7d ÷ published) | 100.0% | +10.0pp |');
    expect(md).toContain('| Hot-set logo coverage | n/a | — |'); // no logo verdicts yet
  });

  it('reports hot-set logo coverage once the record carries logo verdicts', () => {
    const withLogos = {
      ...record,
      stations: {
        ...record.stations,
        'hot-hard': { ...record.stations['hot-hard'], logo: { v: 'ok', since: '2026-09-01' } },
        'hot-soft': { ...record.stations['hot-soft'], logo: { v: 'bad', since: '2026-09-01' } },
        fine: { ...record.stations.fine, logo: { v: 'ok', since: '2026-09-01' } },
      },
    };
    expect(renderDigest({ ...base, record: withLogos })).toContain('| Hot-set logo coverage | 66.7% | — |');
  });

  it('renders "—" when no history row is a week old', () => {
    const md2 = renderDigest({ ...base, history: [{ at: '2026-09-09T06:00:00Z', availability: 0.1 }] });
    expect(md2).toContain('| Availability (play-weighted) | 67.0% | — |');
  });

  it('lists newly failing stations past the hysteresis thresholds, grouped by tier', () => {
    const s = section(md, 'Newly failing');
    expect(s).toContain('`hot-soft` · Hot Soft · timeout · 6 days');
    expect(s).toContain('`hot-hard` · Hot Hard · HTTP 404 · 4 days');
    expect(s).toContain('`tail-hard` · Tail Hard · HTTP 404 · 3 days');
    // below threshold, and a streak that started before the window
    expect(s).not.toContain('tail-short');
    expect(s).not.toContain('old-bad');
    // curated first, long tail after
    expect(s.indexOf('hot-soft')).toBeLessThan(s.indexOf('tail-hard'));
    expect(md).toContain('### Newly failing (3)');
  });

  it('reports a station as recovered only when it was bad earlier in the window', () => {
    const s = section(md, 'Recovered');
    expect(s).toContain('`back` · Back Again · ok for 3 days');
    expect(s).not.toContain('fresh');
  });

  it('lists hot-set stations failing right now with their plays, ignoring the thresholds', () => {
    const s = section(md, 'Hot-set stations failing now');
    expect(s).toContain('`hot-soft` · Hot Soft · timeout · 55 plays · 6 days');
    expect(s).toContain('`hot-hard` · Hot Hard · HTTP 404 · 40 plays · 4 days');
    expect(s.indexOf('hot-soft')).toBeLessThan(s.indexOf('hot-hard')); // by plays
    expect(s).not.toContain('fine');
  });

  it('tallies failure details across every current bad streak', () => {
    const s = section(md, 'Top failure details');
    expect(s).toContain('- 2 × HTTP 404');
    expect(s).toContain('- 1 × dns');
    expect(s).toContain('- 2 × timeout'); // hot-soft and tail-short — the tally is not thresholded
  });

  it('reports per-facet freshness from the record runs', () => {
    const s = section(md, 'Facet freshness');
    expect(s).toContain('`stream` — 8 checked, last run today');
    expect(s).toContain('`logo` — 8 checked, last run 7 days ago');
  });
});

describe('renderDigest edge cases', () => {
  it('renders every section as "none" when nothing happened', () => {
    const md = renderDigest({
      record: { version: 1, runs: {}, stations: {} },
      streaks: {},
      metrics: { at: NOW, availability: null, freshness: 1 },
      history: [],
      plan: null,
      catalog,
      rows: [],
      now: NOW,
    });
    expect(md).toContain('### Newly failing (0)');
    expect(md).toContain('### Recovered (0)');
    expect(md).toContain('### Hot-set stations failing now (0)');
    expect(md).toContain('| Availability (play-weighted) | n/a | — |');
    expect(md.match(/^none$/gm)?.length).toBe(6); // 2 tier groups + 3 sections + freshness
  });

  it('survives a missing plan and a missing history', () => {
    const md = renderDigest({ ...base, plan: null, history: null });
    // tier falls back to the catalog status: working / icy-only are curated
    const s = section(md, 'Newly failing');
    expect(s.indexOf('hot-hard')).toBeLessThan(s.indexOf('tail-hard'));
    expect(md).toContain('### Hot-set stations failing now (0)');
    expect(md).toContain('| Availability (play-weighted) | 67.0% | — |');
  });

  it('caps each group and says how many were left out', () => {
    const many = { ...streaks };
    const bigCatalog = [...catalog];
    for (let i = 0; i < LIST_CAP + 5; i += 1) {
      const id = `bulk-${String(i).padStart(3, '0')}`;
      many[id] = { stream: { o: 'bad', c: 'hard', n: 3, first: '2026-09-08', last: '2026-09-10' } };
      bigCatalog.push({ id, name: `Bulk ${i}`, status: 'stream-only' });
    }
    const md = renderDigest({ ...base, streaks: many, catalog: bigCatalog });
    expect(md).toContain('- …and 6 more'); // 45 bulk + tail-hard = 46 long-tail lines
    expect(md.split('\n').filter((l) => l.includes('bulk-')).length).toBe(LIST_CAP);
  });
});

describe('renderMissingDigest', () => {
  it('names the inputs it could not read and blames the tooling', () => {
    const md = renderMissingDigest(['streaks.json', 'metrics.json'], NOW);
    expect(md).toContain('## Catalog quality — 2026-09-10');
    expect(md).toContain('- missing or unreadable: `streaks.json`');
    expect(md).toContain('tooling problem, not a catalog problem');
  });
});
