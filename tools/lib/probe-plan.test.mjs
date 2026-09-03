import { describe, it, expect } from 'vitest';
import {
  fnv1a32,
  daysSinceEpoch,
  rotationSlot,
  inRotation,
  tierOf,
  resolveHotSet,
  shardTargets,
  buildPlan,
} from './probe-plan.mjs';

const NOW = '2026-09-04T04:00:00.000Z';

/** A published-catalog stand-in: n long-tail stations plus the named ones. */
function tail(n, prefix = 'tail') {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-${i}`,
    name: `Tail ${i}`,
    status: 'stream-only',
  }));
}

describe('fnv1a32', () => {
  it('matches the published FNV-1a 32-bit vectors', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(fnv1a32('a')).toBe(0xe40c292c);
    expect(fnv1a32('foobar')).toBe(0xbf9cf968);
  });

  it('is stable and unsigned for real station ids', () => {
    expect(fnv1a32('builtin-grrif')).toBe(fnv1a32('builtin-grrif'));
    expect(fnv1a32('de-dlf')).toBeGreaterThanOrEqual(0);
  });
});

describe('rotationSlot', () => {
  it('counts UTC days since the epoch', () => {
    expect(daysSinceEpoch('1970-01-01')).toBe(0);
    expect(daysSinceEpoch('1970-01-08')).toBe(7);
    expect(rotationSlot('1970-01-01')).toBe(0);
    expect(rotationSlot('1970-01-05')).toBe(4);
  });

  it('advances by one per day and wraps at 7', () => {
    const slots = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07']
      .map(rotationSlot);
    expect(new Set(slots).size).toBe(7);
    expect(rotationSlot('2026-09-08')).toBe(rotationSlot('2026-09-01'));
  });

  it('rejects a malformed day', () => {
    expect(() => rotationSlot('4 Sep 2026')).toThrow(/YYYY-MM-DD/);
  });
});

describe('inRotation', () => {
  it('covers every id exactly once across 7 consecutive days', () => {
    const ids = tail(400).map((s) => s.id);
    const days = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07'];
    const hits = new Map(ids.map((id) => [id, 0]));
    for (const day of days) {
      for (const id of ids) if (inRotation(id, day)) hits.set(id, hits.get(id) + 1);
    }
    expect([...new Set(hits.values())]).toEqual([1]);
  });

  it('picks roughly a seventh of the catalog per day', () => {
    const ids = tail(7000).map((s) => s.id);
    const n = ids.filter((id) => inRotation(id, '2026-09-04')).length;
    expect(n).toBeGreaterThan(700);
    expect(n).toBeLessThan(1300);
  });
});

describe('tierOf', () => {
  const highlightIds = new Set(['high-1']);

  it('treats working and icy-only as curated', () => {
    expect(tierOf({ id: 'a', status: 'working' })).toBe('curated');
    expect(tierOf({ id: 'a', status: 'icy-only' })).toBe('curated');
  });

  it('treats featured and highlighted stations as curated', () => {
    expect(tierOf({ id: 'a', status: 'stream-only', featured: true })).toBe('curated');
    expect(tierOf({ id: 'high-1', status: 'stream-only' }, { highlightIds })).toBe('curated');
  });

  it('leaves plain stream-only imports in the long tail', () => {
    expect(tierOf({ id: 'a', status: 'stream-only' }, { highlightIds })).toBe('long-tail');
  });
});

describe('resolveHotSet', () => {
  const stations = [
    { id: 'a', name: 'Grrif', status: 'working' },
    { id: 'b', name: ' fip ', status: 'stream-only' },
    { id: 'c', name: 'FIP', status: 'stream-only' },
    { id: 'd', name: 'Quiet', status: 'stream-only' },
  ];

  it('unions the curated tier with name matches from the play stats', () => {
    const { hot, plays } = resolveHotSet({ stations, topStations: [{ name: 'fip', count: 12 }] });
    expect(hot).toEqual(['a', 'b', 'c']);
    expect(plays).toEqual({ b: 12, c: 12 });
  });

  it('matches names case-insensitively and trimmed', () => {
    const { hot } = resolveHotSet({ stations, topStations: [{ name: '  QUIET  ', count: 3 }] });
    expect(hot).toContain('d');
  });

  it('ignores play labels with no catalog match', () => {
    const { hot, plays } = resolveHotSet({ stations, topStations: [{ name: 'Nowhere FM', count: 99 }] });
    expect(hot).toEqual(['a']);
    expect(plays).toEqual({});
  });

  it('includes highlighted stations even with no plays', () => {
    const { hot } = resolveHotSet({ stations, highlightIds: new Set(['d']) });
    expect(hot).toEqual(['a', 'd']);
  });
});

describe('shardTargets', () => {
  it('splits round-robin so shard sizes differ by at most one', () => {
    const shards = shardTargets(Array.from({ length: 101 }, (_, i) => `s${i}`), 6);
    const sizes = shards.map((s) => s.length);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(101);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });

  it('falls back to a single shard', () => {
    expect(shardTargets(['a', 'b'], 0)).toEqual([['a', 'b']]);
  });
});

describe('buildPlan', () => {
  const stations = [
    { id: 'builtin-grrif', name: 'Grrif', status: 'working', featured: true },
    { id: 'high-1', name: 'Highlighted', status: 'stream-only' },
    ...tail(200),
  ];
  const input = {
    stations,
    topStations: [{ name: 'Tail 3', count: 7 }],
    highlightIds: new Set(['high-1']),
    day: '2026-09-04',
    shards: 6,
    now: NOW,
  };

  it('has the ADR shape', () => {
    const plan = buildPlan(input);
    expect(Object.keys(plan)).toEqual([
      'day',
      'generatedAt',
      'shards',
      'hot',
      'plays',
      'rotation',
      'tiers',
      'targets',
    ]);
    expect(plan.day).toBe('2026-09-04');
    expect(plan.generatedAt).toBe(NOW);
    expect(plan.rotation).toEqual({ slot: rotationSlot('2026-09-04'), of: 7, count: plan.rotation.count });
    expect(plan.targets).toHaveLength(6);
    expect(plan.tiers['builtin-grrif']).toBe('curated');
    expect(plan.tiers['high-1']).toBe('curated');
    expect(plan.tiers['tail-0']).toBe('long-tail');
    expect(plan.plays).toEqual({ 'tail-3': 7 });
  });

  it('targets exactly the hot set ∪ the day rotation, deduplicated and sorted', () => {
    const plan = buildPlan(input);
    const flat = plan.targets.flat();
    const expected = new Set([
      ...plan.hot,
      ...stations.map((s) => s.id).filter((id) => inRotation(id, '2026-09-04')),
    ]);
    expect(new Set(flat)).toEqual(expected);
    expect(flat.length).toBe(expected.size);
    // Round-robin over a sorted list: each shard is itself sorted.
    for (const shard of plan.targets) expect(shard).toEqual([...shard].sort());
  });

  it('--full targets every published station', () => {
    const plan = buildPlan({ ...input, full: true });
    expect(plan.targets.flat().sort()).toEqual(stations.map((s) => s.id).sort());
  });

  it('is deterministic apart from generatedAt', () => {
    const a = buildPlan({ ...input, now: NOW });
    const b = buildPlan({ ...input, now: '2027-01-01T00:00:00.000Z' });
    expect({ ...a, generatedAt: null }).toEqual({ ...b, generatedAt: null });
  });

  it('changes the rotation slice from one day to the next', () => {
    const a = buildPlan({ ...input, day: '2026-09-04' });
    const b = buildPlan({ ...input, day: '2026-09-05' });
    expect(a.rotation.slot).not.toBe(b.rotation.slot);
    expect(a.targets.flat()).not.toEqual(b.targets.flat());
    // The hot set is probed on both days.
    for (const id of a.hot) expect(b.targets.flat()).toContain(id);
  });
});
