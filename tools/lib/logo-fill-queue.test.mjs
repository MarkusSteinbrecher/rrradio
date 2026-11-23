import { describe, expect, it } from 'vitest';
import { CANDIDATE_TTL_DAYS, closeQueue, mergeVerdicts, pendingCandidates, settleQueue } from './logo-fill-queue.mjs';

const cand = (n, day = '2026-11-20') => ({ url: `https://${n}.example/icon.png`, sourceUrl: `https://${n}.example/`, kind: 'apple-touch-icon', site: `${n}.example`, hash: `${n}`.padEnd(16, '0'), size: '180x180', day });
const verdict = (n, v, extra = {}) => ({ url: `https://${n}.example/icon.png`, verdict: v, why: 'because', day: '2026-11-22', ...extra });

const candidates = { a: cand('a'), b: cand('b'), c: cand('c'), d: cand('d', '2026-11-21'), old: cand('old', '2026-10-01'), moved: cand('moved') };
const verdicts = {
  a: verdict('a', 'yes'),
  b: verdict('b', 'no', { generic: true }),
  c: verdict('c', 'unsure'),
  moved: { ...verdict('moved', 'yes'), url: 'https://moved.example/other.png' }, // judged another picture
  ghost: verdict('ghost', 'yes'), // no candidate
};

describe('settleQueue', () => {
  const s = settleQueue({ candidates, verdicts, day: '2026-11-23' });
  it('turns a yes into a fill and a no / unsure into a remembered outcome', () => {
    expect([...s.fills]).toEqual([['a', { newFavicon: 'https://a.example/icon.png', sourceUrl: 'https://a.example/', kind: 'apple-touch-icon', judge: { verdict: 'yes', why: 'because' } }]]);
    expect([...s.outcomes]).toEqual([['b', { o: 'judge-no', d: 'because' }], ['c', { o: 'judge-unsure', d: 'because' }]]);
  });
  it('learns a platform default from a generic no', () => {
    expect(s.generic).toEqual(['b000000000000000']);
  });
  it('ignores a verdict given for another URL and expires what nobody judged', () => {
    expect(s.pending).toBe(2); // d, moved
    expect(s.expired).toEqual(['old']);
    expect(Date.parse('2026-11-23') - Date.parse('2026-10-01')).toBeGreaterThan(CANDIDATE_TTL_DAYS * 86_400_000);
  });
  it('lists what the session still has to look at, oldest first', () => {
    expect(pendingCandidates(candidates, verdicts).map((c) => c.id)).toEqual(['old', 'moved', 'd']);
  });
});

describe('closeQueue', () => {
  const settled = settleQueue({ candidates, verdicts, day: '2026-11-23' });
  const added = { fresh: cand('fresh', '2026-11-23') };

  it('removes judged candidates once acted on, keeps the unjudged and the new', () => {
    const q = closeQueue({ candidates, verdicts, settled, added, result: { actions: [{ id: 'a', action: 'fill-logo' }], skipped: [] } });
    expect(Object.keys(q.candidates)).toEqual(['d', 'fresh', 'moved']);
    expect(q.verdicts).toEqual({});
    expect(q.proposed).toEqual(['a']);
  });

  it('counts a review proposal as acted on', () => {
    const q = closeQueue({ candidates, verdicts, settled, result: { actions: [{ id: 'a', action: 'review', proposed: 'fill-logo' }], skipped: [] } });
    expect(q.proposed).toEqual(['a']);
    expect(q.candidates.a).toBeUndefined();
  });

  it('keeps a yes the cap or the breaker held back, verdict included', () => {
    for (const why of ['cap', 'circuit-breaker']) {
      const q = closeQueue({ candidates, verdicts, settled, result: { actions: [], skipped: [{ id: 'a', why }] } });
      expect(q.held).toEqual(['a']);
      expect(q.candidates.a).toEqual(candidates.a);
      expect(q.verdicts).toEqual({ a: verdicts.a });
    }
  });

  it('drops a yes the policy passed over for good (the station changed)', () => {
    const q = closeQueue({ candidates, verdicts, settled, result: { actions: [], skipped: [] } });
    expect(q.candidates.a).toBeUndefined();
    expect(q.proposed).toEqual([]);
  });
});

describe('mergeVerdicts', () => {
  const batch = [{ id: 'a', url: 'https://a.example/icon.png' }, { id: 'b', url: 'https://b.example/icon.png' }, { id: 'c', url: 'https://c.example/icon.png' }];
  it('binds each answer to the URL that was shown', () => {
    const r = mergeVerdicts({ batch, answers: [{ id: 'a', verdict: 'yes', why: ' name  in mark ' }, { id: 'b', verdict: 'no', why: 'Vite default', generic: true }], existing: { z: verdict('z', 'no') }, day: '2026-11-23' });
    expect(r.verdicts.a).toEqual({ url: 'https://a.example/icon.png', verdict: 'yes', why: 'name in mark', day: '2026-11-23' });
    expect(r.verdicts.b.generic).toBe(true);
    expect(Object.keys(r.verdicts)).toEqual(['a', 'b', 'z']);
    expect(r.accepted).toBe(2);
    expect(r.missing).toEqual(['c']);
    expect(r.errors).toEqual([]);
  });
  it('reports what it cannot accept instead of guessing', () => {
    const r = mergeVerdicts({ batch, answers: [{ id: 'nope', verdict: 'yes' }, { id: 'a', verdict: 'maybe' }, { id: 'b', verdict: 'yes' }, { id: 'b', verdict: 'no' }, { id: 'c', verdict: 'yes', generic: true }], day: '2026-11-23' });
    expect(r.errors).toHaveLength(3);
    expect(r.verdicts.b.verdict).toBe('yes');
    expect(r.verdicts.c.generic).toBeUndefined(); // only a "no" can be generic
  });
});
