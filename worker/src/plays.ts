/**
 * Anonymous play ping for the native apps (rrradio-ios#166).
 *
 *   POST /api/public/play — body { stationName, stationId?, platform? }
 *
 * Forwarded to GoatCounter as the same `play: <name>` event the web app
 * sends, so /api/public/top-stations, the probe plan and the dashboards
 * count native plays with no other change. A play from a known native
 * platform is recorded a second time as `play-<platform>: <name>`, which
 * is what lets the stats sheet show web and iOS apart (platforms.ts).
 * Each ping is its own GoatCounter session, so every ping counts as one
 * play (see recordGoatCounterEvents in reports.ts, #856).
 * Nothing is stored here beyond the daily-salted rate-limit hash shared
 * with reports.
 */

import type { Env } from './env';
import { noStoreJsonResponse } from './respond';
import { PLAY_PREFIX, isNativePlatform, platformPlayPrefix } from './platforms';
import { cleanField, cleanToken, isRateLimited, recordGoatCounterEvents } from './reports';

/** A person tapping stations all day stays far below this; a script
 *  inflating one station's count does not. */
const PLAY_RATE_LIMIT_PER_DAY = 300;

export async function handlePlay(
  req: Request,
  env: Env,
  headers: Record<string, string>,
): Promise<Response> {
  const raw = await req.text();
  if (raw.length > 1024) {
    return noStoreJsonResponse({ error: 'payload too large' }, 413, headers);
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return noStoreJsonResponse({ error: 'invalid json' }, 400, headers);
  }
  const data = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  // Same 90-char cap as report station names; strip control characters
  // so the GC path stays a plain label.
  const stationName = cleanField(data.stationName, 90).replace(/[\u0000-\u001f\u007f]/g, '');
  if (!stationName) {
    return noStoreJsonResponse({ error: 'stationName required' }, 400, headers);
  }

  if (await isRateLimited(req, env, PLAY_RATE_LIMIT_PER_DAY, 'play:')) {
    return noStoreJsonResponse({ error: 'rate limited' }, 429, headers);
  }

  const stationId = cleanToken(data.stationId, '');
  const platform = cleanToken(data.platform, 'unknown', 24);
  const title = [stationId ? `station=${stationId}` : '', `platform=${platform}`]
    .filter(Boolean)
    .join(' · ');
  // One request for both events, so they share a session and a
  // native play can never land in one count without the other.
  const events = [{ path: `${PLAY_PREFIX}${stationName}`, title }];
  if (isNativePlatform(platform)) {
    events.push({ path: `${platformPlayPrefix(platform)}${stationName}`, title });
  }
  try {
    await recordGoatCounterEvents(events, env);
  } catch (err) {
    console.error('[play-gc]', err instanceof Error ? err.message : String(err));
    return noStoreJsonResponse({ error: 'store failed' }, 502, headers);
  }
  return noStoreJsonResponse({ ok: true }, 202, headers);
}
