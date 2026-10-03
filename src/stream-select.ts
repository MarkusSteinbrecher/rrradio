/**
 * Stream-variant selection (ADR 001, #623). Pure functions — no DOM, no
 * storage — ported from the iOS `streamPlaybackPlan` so web, iOS and
 * Android agree on which variant a station starts on and in what order
 * the player falls back when it fails.
 *
 * Contract: docs/spec/contracts/playback-state-machine.md
 * ("Stream-quality selection").
 */

import type { Station, StreamVariant } from './types';

/** Global listener preference: `best` (default) or `data` (data-saver). */
export type QualityPref = 'best' | 'data';

export function isQualityPref(v: unknown): v is QualityPref {
  return v === 'best' || v === 'data';
}

/** One entry in a station's playback plan. `variant` is the catalog
 *  variant the URL came from — absent for a single-stream station (and
 *  for the defensive `streamUrl` tail entry). */
export interface PlanEntry {
  url: string;
  variant?: StreamVariant;
}

/** Index of the variant `pref` starts on. `tier` is advisory: without it
 *  we fall back to ordinal position (`streams` is best→worst). */
function startIndex(variants: StreamVariant[], pref: QualityPref): number {
  if (pref === 'best') {
    const i = variants.findIndex((v) => v.tier === 'best');
    return i >= 0 ? i : 0;
  }
  for (let i = variants.length - 1; i >= 0; i--) {
    if (variants[i].tier === 'data') return i;
  }
  return variants.length - 1;
}

/** Ordered list of stream URLs to try for `station` under `pref`: the
 *  preferred variant first, then the remaining variants best→worst
 *  (so a failing data-saver feed falls back toward the reliable best).
 *  URLs are de-duplicated, and `streamUrl` is appended if the payload
 *  violates `streams[0].url === streamUrl`, so the canonical stream is
 *  always reachable. A single-stream station yields `[streamUrl]`. */
export function playbackPlan(station: Station, pref: QualityPref): PlanEntry[] {
  const variants = (station.streams ?? []).filter((v) => typeof v?.url === 'string' && v.url);
  if (variants.length === 0) return [{ url: station.streamUrl }];

  const start = startIndex(variants, pref);
  const order = [start, ...variants.map((_, i) => i).filter((i) => i !== start)];
  const seen = new Set<string>();
  const plan: PlanEntry[] = [];
  for (const i of order) {
    const v = variants[i];
    if (seen.has(v.url)) continue;
    seen.add(v.url);
    plan.push({ url: v.url, variant: v });
  }
  if (!seen.has(station.streamUrl)) plan.push({ url: station.streamUrl });
  return plan;
}

/** The variant `pref` starts on: its URL and index within
 *  `station.streams` (0 for a single-stream station). */
export function selectVariant(
  station: Station,
  pref: QualityPref,
): { url: string; index: number; variant?: StreamVariant } {
  const first = playbackPlan(station, pref)[0];
  const index = first.variant ? (station.streams ?? []).indexOf(first.variant) : 0;
  return { url: first.url, index: Math.max(0, index), variant: first.variant };
}

/** True when the station publishes more than one rendition — the gate
 *  for showing the Best / Data toggle. */
export function hasStreamVariants(station: Pick<Station, 'streams'>): boolean {
  return (station.streams?.length ?? 0) > 1;
}

/** Automatic-retry budget per variant (Stream-retry policy). */
export const MAX_RETRY_ATTEMPTS = 3;

/** Backoff before retry attempt `n` (1-based), in ms:
 *  `min(30, 2^(min(n−1, 5)))` seconds → 1s, 2s, 4s, … capped at 30s. */
export function retryDelayMs(attempt: number): number {
  const n = Math.max(1, attempt);
  return Math.min(30, 2 ** Math.min(n - 1, 5)) * 1000;
}
