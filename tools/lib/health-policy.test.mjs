import { describe, it, expect } from 'vitest';
import {
  decide,
  applySwaps,
  candidateEdgeIds,
  candidateSwapIds,
  circuitBreakerReason,
  reasonFor,
  DEFAULT_CAPS,
} from './health-policy.mjs';

const NOW = '2026-09-06T06:00:00Z';

const bad = (c, n, first = '2026-09-04', last = '2026-09-06') => ({ stream: { o: 'bad', c, n, first, last } });
const ok = (n, first = '2026-09-04', last = '2026-09-06') => ({ stream: { o: 'ok', c: null, n, first, last } });

const EDGE_BAD = { url: 'https://x', s: 404, ct: null, o: 'bad', c: 'hard', d: 'HTTP 404', ms: 100 };
const EDGE_OK = { url: 'https://x', s: 200, ct: 'audio/mpeg', o: 'ok', c: null, d: 'audio/mpeg', ms: 100 };
const EDGE_WARN = { url: 'https://x', s: 200, ct: 'text/html', o: 'warn', c: null, d: 'content-type "text/html"', ms: 100 };

/** Healthy metrics: nothing trips the breaker unless a test wants it to. */
const METRICS = { published: 1000, stream: { ok: 900, warn: 20, bad: 80, hard: 40, soft: 40 } };

/**
 * Build a decide() input from a compact spec:
 *   { id: { streak, tier?, status?, yaml?, detail?, edge? } }
 * Every station is published unless `published: false`. The published set
 * is padded with `pad` healthy ids so a handful of candidates stays under
 * the 2 % circuit-breaker trigger; the breaker tests pass `pad: 0`.
 */
function scenario(spec, { pad = 1000, ...extra } = {}) {
  const streaks = {};
  const tiers = {};
  const yamlById = new Map();
  const publishedIds = new Set();
  const latestDetail = new Map();
  const edge = new Map();
  for (const [id, s] of Object.entries(spec)) {
    streaks[id] = s.streak;
    if (s.tier) tiers[id] = s.tier;
    yamlById.set(id, { id, status: s.status ?? 'stream-only', ...(s.yaml ?? {}) });
    if (s.published !== false) publishedIds.add(id);
    if (s.detail) latestDetail.set(id, s.detail);
    if ('edge' in s) edge.set(id, s.edge);
  }
  for (let i = 0; i < pad; i += 1) publishedIds.add(`pad-${i}`);
  return { streaks, latestDetail, tiers, yamlById, publishedIds, edge, metrics: METRICS, now: NOW, ...extra };
}

const byId = (result, id) => result.actions.find((a) => a.id === id);
const skippedWhy = (result, id) => result.skipped.find((s) => s.id === id)?.why;

describe('rule table', () => {
  it('2 · hard ≥ 3, long tail → unpublish, auto', () => {
    const r = decide(scenario({ a: { streak: bad('hard', 3), tier: 'long-tail', detail: 'HTTP 404' } }));
    expect(r.circuitBreaker).toBe(false);
    expect(byId(r, 'a')).toMatchObject({
      action: 'unpublish',
      auto: true,
      tier: 'long-tail',
      from: 'stream-only',
      streak: { o: 'bad', c: 'hard', n: 3, first: '2026-09-04', last: '2026-09-06', d: 'HTTP 404' },
      edge: null,
      reason: 'HTTP 404 ×3 · 2026-09-04→2026-09-06',
    });
    expect(r.skipped).toEqual([]);
  });

  it('2 · hard ≥ 3, curated → review (proposed unpublish), never auto', () => {
    const r = decide(scenario({ c: { streak: bad('hard', 9), tier: 'curated', status: 'working', detail: 'dns' } }));
    expect(byId(r, 'c')).toMatchObject({ action: 'review', auto: false, tier: 'curated', proposed: 'unpublish', from: 'working' });
    expect(r.actions.some((a) => a.auto)).toBe(false);
  });

  it('2 · hard streak below 3 is not a candidate', () => {
    const r = decide(scenario({ a: { streak: bad('hard', 2), tier: 'long-tail' } }));
    expect(r.actions).toEqual([]);
    expect(r.skipped).toEqual([]);
  });

  it('3 · soft ≥ 5, long tail, edge bad → unpublish auto with the edge attached', () => {
    const r = decide(scenario({ a: { streak: bad('soft', 5), tier: 'long-tail', detail: 'timeout', edge: EDGE_BAD } }));
    expect(byId(r, 'a')).toMatchObject({ action: 'unpublish', auto: true, edge: EDGE_BAD });
    expect(byId(r, 'a').reason).toBe('timeout ×5 · 2026-09-04→2026-09-06 · edge agrees');
  });

  it('3 · soft ≥ 5, long tail, edge ok or warn → skipped edge-disagrees', () => {
    const r = decide(
      scenario({
        a: { streak: bad('soft', 5), tier: 'long-tail', edge: EDGE_OK },
        b: { streak: bad('soft', 7), tier: 'long-tail', edge: EDGE_WARN },
      }),
    );
    expect(r.actions).toEqual([]);
    expect(skippedWhy(r, 'a')).toBe('edge-disagrees');
    expect(skippedWhy(r, 'b')).toBe('edge-disagrees');
  });

  it('3 · soft ≥ 5, long tail, no edge answer (null or absent) → skipped no-edge-opinion', () => {
    const r = decide(
      scenario({
        a: { streak: bad('soft', 5), tier: 'long-tail', edge: null },
        b: { streak: bad('soft', 5), tier: 'long-tail' },
      }),
    );
    expect(r.actions).toEqual([]);
    expect(skippedWhy(r, 'a')).toBe('no-edge-opinion');
    expect(skippedWhy(r, 'b')).toBe('no-edge-opinion');
  });

  it('3 · soft streak of 4 is not a candidate even with a bad edge answer', () => {
    const r = decide(scenario({ a: { streak: bad('soft', 4), tier: 'long-tail', edge: EDGE_BAD } }));
    expect(r.actions).toEqual([]);
    expect(r.skipped).toEqual([]);
  });

  it('3 · soft ≥ 5, curated → review with the edge answer attached when available', () => {
    const r = decide(
      scenario({
        c1: { streak: bad('soft', 5), tier: 'curated', status: 'icy-only', detail: 'HTTP 403', edge: EDGE_OK },
        c2: { streak: bad('soft', 5), tier: 'curated', status: 'working', detail: 'HTTP 403' },
      }),
    );
    expect(byId(r, 'c1')).toMatchObject({ action: 'review', proposed: 'unpublish', edge: EDGE_OK });
    expect(byId(r, 'c1').reason).toBe('HTTP 403 ×5 · 2026-09-04→2026-09-06 · edge disagrees');
    expect(byId(r, 'c2')).toMatchObject({ action: 'review', edge: null });
    expect(r.skipped).toEqual([]);
  });

  it('4 · a long-tail fold canonical is rerouted to review', () => {
    const r = decide(
      scenario({ a: { streak: bad('hard', 3), tier: 'long-tail', detail: 'HTTP 410' } }, { foldCanonicals: new Set(['a']) }),
    );
    expect(byId(r, 'a')).toMatchObject({ action: 'review', auto: false, tier: 'long-tail', proposed: 'unpublish' });
    expect(byId(r, 'a').reason).toBe('HTTP 410 ×3 · 2026-09-04→2026-09-06 · fold canonical');
  });

  it('4 · a highlighted long-tail row is rerouted to review, soft included', () => {
    const r = decide(
      scenario({ h: { streak: bad('soft', 6), tier: 'long-tail', detail: 'timeout', edge: EDGE_BAD } }, { highlightIds: new Set(['h']) }),
    );
    expect(byId(r, 'h')).toMatchObject({ action: 'review', proposed: 'unpublish', edge: EDGE_BAD });
    expect(byId(r, 'h').reason).toContain('· edge agrees · highlighted');
  });

  it('5 · bot-unpublished row with ok ≥ 3 → republish, auto, to brokenFrom', () => {
    const r = decide(
      scenario({
        u: { streak: ok(3), published: false, status: 'broken', yaml: { brokenBy: 'station-probe', brokenFrom: 'icy-only' }, detail: 'audio/mpeg' },
      }),
    );
    expect(byId(r, 'u')).toMatchObject({ action: 'republish', auto: true, tier: 'unpublished', to: 'icy-only' });
    expect(byId(r, 'u').reason).toBe('audio/mpeg ×3 · 2026-09-04→2026-09-06');
  });

  it('5 · republish needs three ok days and defaults the restored status to stream-only', () => {
    const r = decide(
      scenario({
        two: { streak: ok(2), published: false, status: 'broken', yaml: { brokenBy: 'station-probe' } },
        three: { streak: ok(3), published: false, status: 'broken', yaml: { brokenBy: 'station-probe' } },
      }),
    );
    expect(byId(r, 'two')).toBeUndefined();
    expect(byId(r, 'three')).toMatchObject({ action: 'republish', to: 'stream-only' });
  });

  it('5 · a curator-set broken row is never republished, nor is a bot row that is still failing', () => {
    const r = decide(
      scenario({
        curator: { streak: ok(30), published: false, status: 'broken' },
        curatorNamed: { streak: ok(30), published: false, status: 'broken', yaml: { brokenBy: 'markus' } },
        stillBad: { streak: bad('hard', 30), published: false, status: 'broken', yaml: { brokenBy: 'station-probe' } },
      }),
    );
    expect(r.actions).toEqual([]);
    expect(r.skipped).toEqual([]);
  });

  it('unpublished (not in stations.json) rows without the bot marker are ignored', () => {
    const r = decide(scenario({ gone: { streak: bad('hard', 12), tier: 'long-tail', published: false, status: 'investigate' } }));
    expect(r.actions).toEqual([]);
    expect(r.skipped).toEqual([]);
  });
});

describe('rule 1 — circuit breaker', () => {
  it('trips on a bad share above 15 % and skips every candidate, republish included', () => {
    const r = decide(
      scenario(
        {
          a: { streak: bad('hard', 3), tier: 'long-tail' },
          c: { streak: bad('hard', 3), tier: 'curated', status: 'working' },
          u: { streak: ok(3), published: false, status: 'broken', yaml: { brokenBy: 'station-probe' } },
        },
        { metrics: { published: 1000, stream: { ok: 800, warn: 0, bad: 200, hard: 100, soft: 100 } } },
      ),
    );
    expect(r.circuitBreaker).toBe(true);
    expect(r.circuitBreakerReason).toMatch(/bad share 20\.0% > 15%/);
    expect(r.actions).toEqual([]);
    expect(r.skipped).toEqual([
      { id: 'a', why: 'circuit-breaker' },
      { id: 'c', why: 'circuit-breaker' },
      { id: 'u', why: 'circuit-breaker' },
    ]);
  });

  it('trips when candidates exceed 2 % of the published catalog', () => {
    const spec = {};
    for (let i = 0; i < 3; i += 1) spec[`s${i}`] = { streak: bad('hard', 3), tier: 'long-tail' };
    for (let i = 0; i < 97; i += 1) spec[`fine${i}`] = { streak: ok(5), tier: 'long-tail' };
    const r = decide(scenario(spec, { pad: 0 })); // 3 of 100 published = 3 %
    expect(r.circuitBreaker).toBe(true);
    expect(r.circuitBreakerReason).toBe('3 candidates > 2% of 100 published');
    expect(r.skipped.map((s) => s.id).sort()).toEqual(['s0', 's1', 's2']);
  });

  it('does not trip on exactly 2 % nor without metrics', () => {
    const spec = {};
    for (let i = 0; i < 2; i += 1) spec[`s${i}`] = { streak: bad('hard', 3), tier: 'long-tail' };
    for (let i = 0; i < 98; i += 1) spec[`fine${i}`] = { streak: ok(5), tier: 'long-tail' };
    const r = decide(scenario(spec, { metrics: null, pad: 0 }));
    expect(r.circuitBreaker).toBe(false);
    expect(r.actions).toHaveLength(2);
  });

  it('circuitBreakerReason ignores a zero denominator', () => {
    expect(circuitBreakerReason({ stream: { ok: 0, warn: 0, bad: 0 } }, 0, 0)).toBeNull();
    expect(circuitBreakerReason(null, 5, 0)).toBeNull();
  });
});

describe('rule 7 — cap', () => {
  it('keeps hard before soft, older streaks first, and skips the overflow as cap', () => {
    const r = decide(
      scenario(
        {
          softOld: { streak: bad('soft', 6, '2026-09-01'), tier: 'long-tail', edge: EDGE_BAD },
          hardNew: { streak: bad('hard', 3, '2026-09-04'), tier: 'long-tail' },
          hardOld: { streak: bad('hard', 5, '2026-09-02'), tier: 'long-tail' },
          softNew: { streak: bad('soft', 5, '2026-09-02'), tier: 'long-tail', edge: EDGE_BAD },
          rev: { streak: bad('hard', 3, '2026-08-01'), tier: 'curated', status: 'working' },
        },
        { caps: { auto: 2 } },
      ),
    );
    const autoIds = r.actions.filter((a) => a.auto).map((a) => a.id);
    expect(autoIds).toEqual(['hardOld', 'hardNew']);
    expect(r.skipped).toEqual([
      { id: 'softNew', why: 'cap' },
      { id: 'softOld', why: 'cap' },
    ]);
    // review proposals are not capped and come after the auto block
    expect(r.actions.at(-1)).toMatchObject({ id: 'rev', action: 'review' });
  });

  it('defaults to 200 automatic actions', () => {
    expect(DEFAULT_CAPS.auto).toBe(200);
    const spec = {};
    for (let i = 0; i < 210; i += 1) spec[`s${String(i).padStart(3, '0')}`] = { streak: bad('hard', 3), tier: 'long-tail' };
    for (let i = 0; i < 20000; i += 1) spec[`ok${i}`] = { streak: ok(2), tier: 'long-tail' };
    const r = decide(scenario(spec));
    expect(r.circuitBreaker).toBe(false);
    expect(r.actions.filter((a) => a.auto)).toHaveLength(200);
    expect(r.skipped.filter((s) => s.why === 'cap')).toHaveLength(10);
  });

  it('republish ranks after unpublish for the cap', () => {
    const r = decide(
      scenario(
        {
          u: { streak: ok(3), published: false, status: 'broken', yaml: { brokenBy: 'station-probe' } },
          a: { streak: bad('hard', 3), tier: 'long-tail' },
        },
        { caps: { auto: 1 } },
      ),
    );
    expect(r.actions.map((a) => a.id)).toEqual(['a']);
    expect(r.skipped).toEqual([{ id: 'u', why: 'cap' }]);
  });
});

describe('tier fallback', () => {
  it('uses plan.json tiers, and the planner rule when the plan does not know the station', () => {
    const r = decide(
      scenario({
        planned: { streak: bad('hard', 3), tier: 'long-tail', status: 'working' }, // plan wins
        unplanned: { streak: bad('hard', 3), status: 'working' }, // working → curated
        featured: { streak: bad('hard', 3), yaml: { featured: true } },
        tail: { streak: bad('hard', 3) },
      }),
    );
    expect(byId(r, 'planned').action).toBe('unpublish');
    expect(byId(r, 'unplanned')).toMatchObject({ action: 'review', tier: 'curated' });
    expect(byId(r, 'featured')).toMatchObject({ action: 'review', tier: 'curated' });
    expect(byId(r, 'tail')).toMatchObject({ action: 'unpublish', tier: 'long-tail' });
  });
});

describe('rule 6 — applySwaps post-pass', () => {
  const r = decide(
    scenario({
      a: { streak: bad('hard', 3), tier: 'long-tail', detail: 'HTTP 404' },
      c: { streak: bad('hard', 3), tier: 'curated', status: 'working', detail: 'HTTP 404' },
      u: { streak: ok(3), published: false, status: 'broken', yaml: { brokenBy: 'station-probe' } },
    }),
  );

  it('candidateSwapIds lists unpublish actions and unpublish proposals only', () => {
    expect(candidateSwapIds(r.actions)).toEqual(['a', 'c']);
  });

  it('turns an auto unpublish into an auto swap-url and a review into a swap proposal', () => {
    const swaps = new Map([
      ['a', { newUrl: 'https://new.example/a.mp3', newCodec: 'MP3' }],
      ['c', { newUrl: 'https://new.example/c.aac', newCodec: 'AAC' }],
      ['u', { newUrl: 'https://ignored', newCodec: null }],
    ]);
    const out = applySwaps(r.actions, swaps);
    expect(out.find((x) => x.id === 'a')).toMatchObject({
      action: 'swap-url',
      auto: true,
      tier: 'long-tail',
      newUrl: 'https://new.example/a.mp3',
      newCodec: 'MP3',
      reason: 'HTTP 404 ×3 · 2026-09-04→2026-09-06 · RB url_resolved probes ok',
    });
    expect(out.find((x) => x.id === 'c')).toMatchObject({ action: 'review', auto: false, proposed: 'swap-url', newUrl: 'https://new.example/c.aac' });
    expect(out.find((x) => x.id === 'u')).toMatchObject({ action: 'republish' });
    expect(out.find((x) => x.id === 'u').newUrl).toBeUndefined();
    // pure: the input is untouched
    expect(r.actions.find((x) => x.id === 'a').action).toBe('unpublish');
  });

  it('is a no-op for an empty swap map', () => {
    expect(applySwaps(r.actions, new Map())).toEqual(r.actions);
  });
});

describe('candidateEdgeIds', () => {
  it('selects published soft streaks ≥ 5 of either tier, oldest first', () => {
    const s = scenario({
      newSoft: { streak: bad('soft', 5, '2026-09-02'), tier: 'long-tail' },
      oldSoft: { streak: bad('soft', 9, '2026-08-29'), tier: 'curated', status: 'working' },
      hard: { streak: bad('hard', 9), tier: 'long-tail' },
      shortSoft: { streak: bad('soft', 4), tier: 'long-tail' },
      unpublished: { streak: bad('soft', 9), published: false },
      bot: { streak: bad('soft', 9), published: false, status: 'broken', yaml: { brokenBy: 'station-probe' } },
    });
    expect(candidateEdgeIds(s.streaks, s.tiers, s.yamlById, s.publishedIds)).toEqual(['oldSoft', 'newSoft']);
  });
});

describe('output shape and determinism', () => {
  it('stamps generatedAt / day from now and orders keys stably', () => {
    const r = decide(scenario({ a: { streak: bad('hard', 3), tier: 'long-tail', detail: 'HTTP 404' } }));
    expect(r.generatedAt).toBe('2026-09-06T06:00:00.000Z');
    expect(r.day).toBe('2026-09-06');
    expect(Object.keys(r.actions[0])).toEqual(['id', 'action', 'auto', 'tier', 'from', 'streak', 'edge', 'reason']);
  });

  it('is deterministic for the same input and independent of streak key order', () => {
    const spec = {
      z: { streak: bad('hard', 3), tier: 'long-tail' },
      m: { streak: bad('soft', 5), tier: 'long-tail', edge: EDGE_OK },
      a: { streak: bad('hard', 4, '2026-09-03'), tier: 'long-tail' },
      c: { streak: bad('soft', 6), tier: 'curated', status: 'working' },
    };
    const one = decide(scenario(spec));
    const two = decide(scenario(Object.fromEntries(Object.entries(spec).reverse())));
    expect(JSON.stringify(one)).toBe(JSON.stringify(two));
    expect(one.actions.map((x) => x.id)).toEqual(['a', 'z', 'c']);
  });

  it('reasonFor falls back to the class when no detail is known', () => {
    expect(reasonFor({ o: 'bad', c: 'soft', n: 5, first: '2026-09-02', last: '2026-09-06', d: null }, null)).toBe(
      'soft ×5 · 2026-09-02→2026-09-06',
    );
  });
});
