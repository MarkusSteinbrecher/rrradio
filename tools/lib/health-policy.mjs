/**
 * Decide policy (ADR 002 — catalog quality loop, phase 2 "Decide").
 *
 * Turns streaks into an actions list. Pure: every input is already loaded
 * (streaks, tiers, YAML rows, edge answers), so the CLI
 * (`tools/decide-actions.mjs`) owns all I/O and the tests need no network.
 *
 * Rules, in order (the ADR's table — keep the numbering in sync):
 *   1 circuit breaker      too many bad / too many candidates → nothing is automatic
 *   2 hard streak ≥ 3      long tail: unpublish · curated: review
 *   3 soft streak ≥ 5      long tail: needs the edge to agree · curated: review
 *   4 fold canonical /     the long-tail row uses the curated column (a bot flip
 *     highlighted          would break check-catalog / check-highlights)
 *   5 ok streak ≥ 3 on a   republish, auto, whatever the tier
 *     bot-unpublished row
 *   6 RB swap              post-pass `applySwaps` — the CLI fetches RB + probes
 *   7 cap                  at most `caps.auto` auto actions, worst first
 *
 * Every string in `reason` is built from the stable probe vocabulary, so the
 * same evidence always yields the same text (it is written into the YAML).
 *
 * @typedef {{o: string, c: string|null, n: number, first: string, last: string}} Streak
 * @typedef {{url?: string, s: number|null, ct: string|null, o: string, c: string|null, d: string, ms?: number}} EdgeAnswer
 * @typedef {{id: string, status?: string, brokenBy?: string, brokenFrom?: string,
 *            stationuuid?: string, streamUrl?: string, featured?: boolean}} YamlRow
 * @typedef {{id: string, action: string, auto: boolean, tier: string, reason: string,
 *            streak: Streak & {d: string|null}, [k: string]: unknown}} Action
 */

import { dayOf } from './observations.mjs';
import { tierOf } from './probe-plan.mjs';

export const HARD_DAYS = 3;
export const SOFT_DAYS = 5;
export const OK_DAYS = 3;
/** Rule 1: share of `bad` among the latest stream verdicts. */
export const BAD_SHARE_LIMIT = 0.15;
/** Rule 1: unpublish candidates as a share of the published catalog. */
export const CANDIDATE_SHARE_LIMIT = 0.02;
export const DEFAULT_CAPS = Object.freeze({ auto: 200 });
/** The `brokenBy` marker that makes a YAML row bot-managed. */
export const BOT = 'station-probe';
/** Status restored by a republish when the row carries no `brokenFrom`. */
export const DEFAULT_RESTORE_STATUS = 'stream-only';

/** Map or plain-object lookup — plan.json gives objects, the CLI builds Maps. */
function get(coll, id) {
  if (!coll) return undefined;
  return coll instanceof Map ? coll.get(id) : coll[id];
}

/** @param {YamlRow|null|undefined} y */
export function isBotUnpublished(y) {
  return !!y && y.status === 'broken' && y.brokenBy === BOT;
}

/**
 * Tier for a published station. plan.json is authoritative; a station the
 * plan does not know (catalog grew since the plan) falls back to the same
 * rule the planner uses, so it can never be *less* protected than it would
 * be tomorrow.
 */
function tierFor(id, tiers, y, highlightIds) {
  const planned = get(tiers, id);
  if (planned === 'curated' || planned === 'long-tail') return planned;
  return tierOf({ id, status: y?.status, featured: y?.featured }, { highlightIds });
}

/** `HTTP 404 ×3 · 2026-09-04→2026-09-06` (+ edge verdict, + reroute note). */
export function reasonFor(streak, edge, notes = []) {
  const head = `${streak.d ?? streak.c ?? streak.o} ×${streak.n} · ${streak.first}→${streak.last}`;
  const parts = [head];
  if (edge) parts.push(edge.o === 'bad' ? 'edge agrees' : 'edge disagrees');
  parts.push(...notes);
  return parts.join(' · ');
}

/**
 * Ids that need an edge second opinion: published, soft streak past the
 * threshold. Curated rows are included because their review proposal
 * attaches the edge answer when there is one. Oldest streak first so a
 * `--max-edge` cut keeps the stations that have been failing longest.
 *
 * @param {Record<string, Record<string, Streak>>} streaks
 * @param {Record<string, string>} tiers unused for now — the signature is the ADR's
 * @param {Map<string, YamlRow>|Record<string, YamlRow>} yamlById
 * @param {Set<string>} publishedIds
 * @returns {string[]}
 */
export function candidateEdgeIds(streaks, tiers, yamlById, publishedIds) {
  const out = [];
  for (const id of Object.keys(streaks ?? {})) {
    const s = streaks[id]?.stream;
    if (!s || s.o !== 'bad' || s.c !== 'soft' || s.n < SOFT_DAYS) continue;
    if (!publishedIds.has(id) || isBotUnpublished(get(yamlById, id))) continue;
    out.push({ id, first: s.first });
  }
  return out.sort((a, b) => a.first.localeCompare(b.first) || a.id.localeCompare(b.id)).map((c) => c.id);
}

/** Ids whose action rule 6 may turn into a URL swap (order preserved). */
export function candidateSwapIds(actions) {
  return actions
    .filter((a) => a.action === 'unpublish' || (a.action === 'review' && a.proposed === 'unpublish'))
    .map((a) => a.id);
}

/**
 * Rule 1. Either trigger means "the runner, not the internet, is probably
 * broken": act on nothing, but say why.
 * @returns {string|null} a reason when tripped
 */
export function circuitBreakerReason(metrics, candidateCount, published) {
  const s = metrics?.stream;
  const total = (s?.ok ?? 0) + (s?.warn ?? 0) + (s?.bad ?? 0);
  if (s && total > 0 && s.bad / total > BAD_SHARE_LIMIT) {
    return `bad share ${(100 * s.bad / total).toFixed(1)}% > ${BAD_SHARE_LIMIT * 100}%`;
  }
  if (published > 0 && candidateCount / published > CANDIDATE_SHARE_LIMIT) {
    return `${candidateCount} candidates > ${CANDIDATE_SHARE_LIMIT * 100}% of ${published} published`;
  }
  return null;
}

/** Worst first: hard, then soft, then republish; older streaks first; id last. */
function rank(a) {
  const cls = a.action === 'republish' ? 2 : a.streak.c === 'hard' ? 0 : 1;
  return [cls, a.streak.first, a.id];
}
function byRank(a, b) {
  const [ca, fa, ia] = rank(a);
  const [cb, fb, ib] = rank(b);
  return ca - cb || fa.localeCompare(fb) || ia.localeCompare(ib);
}

/**
 * @param {{streaks: Record<string, Record<string, Streak>>,
 *          latestDetail?: Map<string, string|null>|Record<string, string|null>,
 *          tiers?: Record<string, string>,
 *          yamlById?: Map<string, YamlRow>|Record<string, YamlRow>,
 *          publishedIds: Set<string>, foldCanonicals?: Set<string>, highlightIds?: Set<string>,
 *          edge?: Map<string, EdgeAnswer|null>, metrics?: object|null, now: string,
 *          caps?: {auto?: number}}} input
 * @returns {{generatedAt: string, day: string, circuitBreaker: boolean,
 *            circuitBreakerReason: string|null, actions: Action[],
 *            skipped: Array<{id: string, why: string}>}}
 */
export function decide({
  streaks = {},
  latestDetail,
  tiers = {},
  yamlById,
  publishedIds = new Set(),
  foldCanonicals = new Set(),
  highlightIds = new Set(),
  edge,
  metrics = null,
  now,
  caps,
}) {
  const autoCap = Math.max(0, Math.floor(caps?.auto ?? DEFAULT_CAPS.auto));
  const generatedAt = new Date(now).toISOString();
  const day = dayOf(now);

  // ─── candidates (rules 2, 3, 5 — thresholds only) ─────────────────
  const unpublishCandidates = [];
  const republishCandidates = [];
  for (const id of Object.keys(streaks).sort()) {
    const s = streaks[id]?.stream;
    if (!s) continue;
    const y = get(yamlById, id) ?? null;
    const streak = { o: s.o, c: s.c ?? null, n: s.n, first: s.first, last: s.last, d: get(latestDetail, id) ?? null };

    if (isBotUnpublished(y)) {
      // Rule 5. Only rows the bot itself demoted; a curator's `broken` is
      // never touched, however healthy the stream looks.
      if (s.o === 'ok' && s.n >= OK_DAYS) republishCandidates.push({ id, y, streak });
      continue;
    }
    if (!publishedIds.has(id) || s.o !== 'bad') continue;
    const past = (s.c === 'hard' && s.n >= HARD_DAYS) || (s.c === 'soft' && s.n >= SOFT_DAYS);
    if (!past) continue;
    unpublishCandidates.push({ id, y, streak, tier: tierFor(id, tiers, y, highlightIds) });
  }

  // ─── rule 1 ───────────────────────────────────────────────────────
  const published = publishedIds.size || metrics?.published || 0;
  const breaker = circuitBreakerReason(metrics, unpublishCandidates.length, published);
  if (breaker) {
    const skipped = [...unpublishCandidates, ...republishCandidates]
      .map(({ id }) => ({ id, why: 'circuit-breaker' }))
      .sort((a, b) => a.id.localeCompare(b.id));
    return { generatedAt, day, circuitBreaker: true, circuitBreakerReason: breaker, actions: [], skipped };
  }

  // ─── rules 2–4 ────────────────────────────────────────────────────
  /** @type {Action[]} */
  const auto = [];
  /** @type {Action[]} */
  const review = [];
  /** @type {Array<{id: string, why: string}>} */
  const skipped = [];

  for (const { id, y, streak, tier } of unpublishCandidates) {
    const edgeAnswer = get(edge, id) ?? null;
    // Rule 4: a long-tail row that other files depend on is decided like a
    // curated one — a human resolves the fold / highlight along with it.
    const notes = [];
    if (foldCanonicals.has(id)) notes.push('fold canonical');
    if (highlightIds.has(id)) notes.push('highlighted');
    const reviewOnly = tier === 'curated' || notes.length > 0;
    const base = { id, tier, from: y?.status ?? null, streak, edge: edgeAnswer };

    if (reviewOnly) {
      review.push({ ...base, action: 'review', auto: false, proposed: 'unpublish', reason: reasonFor(streak, edgeAnswer, notes) });
      continue;
    }
    if (streak.c === 'hard') {
      auto.push({ ...base, action: 'unpublish', auto: true, reason: reasonFor(streak, edgeAnswer) });
      continue;
    }
    // Rule 3: soft failures are what geo-blocks and flaky hosts look like
    // from one ASN; a second vantage has to agree before anything is automatic.
    if (!edgeAnswer) skipped.push({ id, why: 'no-edge-opinion' });
    else if (edgeAnswer.o !== 'bad') skipped.push({ id, why: 'edge-disagrees' });
    else auto.push({ ...base, action: 'unpublish', auto: true, reason: reasonFor(streak, edgeAnswer) });
  }

  // ─── rule 5 ───────────────────────────────────────────────────────
  for (const { id, y, streak } of republishCandidates) {
    auto.push({
      id,
      action: 'republish',
      auto: true,
      tier: 'unpublished',
      to: y.brokenFrom ?? DEFAULT_RESTORE_STATUS,
      streak,
      reason: reasonFor(streak, null),
    });
  }

  // ─── rule 7 ───────────────────────────────────────────────────────
  auto.sort(byRank);
  review.sort(byRank);
  const kept = auto.slice(0, autoCap);
  for (const a of auto.slice(autoCap)) skipped.push({ id: a.id, why: 'cap' });
  skipped.sort((a, b) => a.id.localeCompare(b.id) || a.why.localeCompare(b.why));

  return {
    generatedAt,
    day,
    circuitBreaker: false,
    circuitBreakerReason: null,
    actions: orderKeys([...kept, ...review]),
    skipped,
  };
}

/**
 * Rule 6 post-pass. `swaps` holds the RB URLs the CLI already verified
 * (https, different from the current URL, `lenientProbe` ok). An automatic
 * unpublish becomes an automatic swap; a review proposal keeps its review
 * status and proposes the swap instead. Returns a new array.
 *
 * @param {Action[]} actions
 * @param {Map<string, {newUrl: string, newCodec?: string|null}>} swaps
 * @returns {Action[]}
 */
export function applySwaps(actions, swaps) {
  return orderKeys(
    actions.map((a) => {
      const swap = swaps?.get(a.id);
      if (!swap) return a;
      const note = 'RB url_resolved probes ok';
      const patch = { newUrl: swap.newUrl, newCodec: swap.newCodec ?? null, reason: `${a.reason} · ${note}` };
      if (a.action === 'unpublish') return { ...a, ...patch, action: 'swap-url' };
      if (a.action === 'review' && a.proposed === 'unpublish') return { ...a, ...patch, proposed: 'swap-url' };
      return a;
    }),
  );
}

/** Fixed key order so the audit file diffs stay readable. */
function orderKeys(actions) {
  const ORDER = ['id', 'action', 'auto', 'tier', 'proposed', 'from', 'to', 'newUrl', 'newCodec', 'streak', 'edge', 'reason'];
  return actions.map((a) => {
    const out = {};
    for (const k of ORDER) if (k in a) out[k] = a[k];
    for (const k of Object.keys(a)) if (!(k in out)) out[k] = a[k];
    return out;
  });
}
