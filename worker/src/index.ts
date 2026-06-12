/**
 * rrradio-stats Worker
 *
 * Proxies the GoatCounter API so the rrradio admin dashboard can fetch
 * aggregated stats without exposing the API token to the browser. The
 * dashboard authenticates with a separate ADMIN_TOKEN.
 *
 * Endpoints (all GET, all require Bearer ADMIN_TOKEN):
 *   /api/totals        — pageview / event / unique-visitor totals
 *   /api/top-stations  — most-played stations (filter: "play: ")
 *   /api/errors        — stations that errored, with reason in title
 *   /api/reports       — user-submitted broken-station reports
 *   /api/tabs          — tab usage (filter: "tab/")
 *   /api/genres        — genre filter selections (filter: "genre/")
 *   /api/favorites     — most-favorited stations (filter: "favorite: ")
 *
 * Public endpoints:
 *   POST /api/public/report-broken — anonymous structured station report;
 *                                    stored in D1, returns a receipt id
 *   GET  /api/public/report-status — per-receipt report status polling
 *                                    (?ids=a,b,c — see src/reports.ts)
 *   GET  /api/public/poll          — native-app interest poll tallies,
 *                                    all-time (filter: "vote: ")
 *   GET  /api/public/dashboard     — totals + top stations + locations
 *                                    + poll in one cache window, so the
 *                                    public stats sheet always shows a
 *                                    consistent snapshot. Plays/locations
 *                                    follow ?days=N; poll is all-time.
 *
 * Report triage (Bearer ADMIN_TOKEN, see src/reports.ts):
 *   GET  /api/broken-reports        — recent report rows from D1
 *   POST /api/admin/resolve-reports — mark reports resolved (called by
 *                                     the issue-close GitHub Action)
 *
 * Range: ?days=N (1–90, default 7). Response cached 5 min in the
 * Cloudflare edge cache to be a polite GC API consumer.
 */

import type { Env } from './env';
import { jsonResponse, noStoreJsonResponse } from './respond';
import {
  handleAdminReportsList,
  handleReportBroken,
  handleReportStatus,
  handleResolveReports,
} from './reports';

export type { Env } from './env';

/** Public endpoints cache 5 min at the edge. Short enough that the
 *  numbers visibly track what GoatCounter's own dashboard shows; long
 *  enough that we stay polite to GC's 4 req/s rate limit even under
 *  bursty traffic. */
const PUBLIC_CACHE_TTL_S = 300;

interface GcHit {
  path: string;
  title?: string;
  event?: boolean;
  count: number;
  count_unique?: number;
  // Per-day breakdown when /stats/hits is called with daily=true. Each
  // entry is one calendar day in the requested range; missing days are
  // omitted by GC. Ordering is oldest → newest.
  stats?: Array<{ day: string; daily: number; daily_unique?: number }>;
}

interface GcStatsHits {
  hits: GcHit[];
  total: number;
  more?: boolean;
}

interface GcTotals {
  // GoatCounter's /stats/total returns `total` (visits/pageviews) and
  // `total_events`. It does NOT return a unique-visitor field on this
  // account, so we don't read one. The dashboard derives a third
  // metric (stations played) from the hits buffer instead.
  total?: number;
  total_events?: number;
}

interface GcStat {
  id: string;
  name: string;
  count: number;
  count_unique?: number;
  ref_scheme?: string | null;
}
interface GcStatGroup {
  stats: GcStat[];
  total: number;
  more?: boolean;
}

interface ListResponse {
  items: Array<{
    label: string;
    count: number;
    unique?: number;
    title: string;
    // Per-day counts aligned to the response's `days` array — same
    // length, zeros for days with no events. Pulled through from
    // GoatCounter's daily=true /stats/hits response.
    series?: number[];
  }>;
  total: number;
  range_days: number;
  // ISO YYYY-MM-DD for every day in the requested window, oldest →
  // newest. Lets the dashboard label its sparkline x-axis without each
  // item carrying its own day-string array.
  days?: string[];
}

function corsHeaders(origin: string, allowed: string): Record<string, string> {
  // Echo the requesting origin only when it matches the allow-listed one,
  // otherwise the configured allowed origin. Same shape either way.
  const out = origin === allowed ? origin : allowed;
  return {
    'Access-Control-Allow-Origin': out,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

// 8s per upstream call. GoatCounter is normally <1s; anything slower is
// almost certainly stuck and we'd rather fail this card than hold the
// whole dashboard while siblings finish.
const GC_FETCH_TIMEOUT_MS = 8_000;
// One retry on transient GC errors (5xx, network hiccup). Backoff is
// short on purpose — the dashboard waits inline and there's already a
// 300ms gap between sibling calls.
const GC_RETRY_BACKOFF_MS = 400;

async function gcFetch<T>(path: string, env: Env): Promise<T> {
  const url = `https://${env.GOATCOUNTER_SITE}/api/v0${path}`;
  const headers = {
    Authorization: `Bearer ${env.GOATCOUNTER_TOKEN}`,
    Accept: 'application/json',
  };

  const attempt = async (): Promise<Response> => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), GC_FETCH_TIMEOUT_MS);
    try {
      return await fetch(url, { headers, signal: ctl.signal });
    } finally {
      clearTimeout(timer);
    }
  };

  let res: Response;
  try {
    res = await attempt();
    // Retry once on 5xx — GoatCounter occasionally hiccups under load.
    if (res.status >= 500 && res.status < 600) {
      await sleep(GC_RETRY_BACKOFF_MS);
      res = await attempt();
    }
  } catch (err) {
    // Network error or our own timeout. Retry once before giving up.
    await sleep(GC_RETRY_BACKOFF_MS);
    res = await attempt();
  }

  if (!res.ok) {
    // Surface the upstream body (truncated) so the dashboard / wrangler-tail
    // shows what GoatCounter actually said, instead of an opaque 502.
    let detail = '';
    try {
      detail = (await res.text()).slice(0, 240);
    } catch {
      /* ignore */
    }
    throw new Error(`gc ${path}: ${res.status} ${res.statusText} ${detail}`);
  }
  return (await res.json()) as T;
}

// The stats window is the trailing `daysBack` days INCLUDING today, the
// same way GoatCounter's own dashboard defaults. We used to snap end
// to yesterday-EOD-UTC for cache stability, but that produced a window
// that never matched what GC's UI showed, which made every check
// against GC look "off". The 5-minute edge cache is short enough that
// intra-day movement isn't a problem.
function rangeStart(daysBack: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - (daysBack - 1));
  return d.toISOString().slice(0, 10);
}

function rangeEnd(): string {
  return new Date().toISOString().slice(0, 10);
}

function clampDays(raw: string | null): number {
  const n = Number(raw) || 7;
  return Math.min(90, Math.max(1, Math.round(n)));
}

// We fetch a large slice of /stats/hits once and filter client-side
// across all topByPrefix calls. GoatCounter's /stats/hits doesn't
// accept a `filter` query param (we got 400 trying), and its results
// are already aggregated per-path with counts ordered desc.
//
// `daily=true` so each hit also carries a per-day breakdown — the
// public dashboard renders sparklines per station/country from it.
// GC's `daily` param is documented as deprecated in favor of
// `group=day`, but the two are equivalent and the deprecated form is
// what's wired up here.
async function fetchHitsRange(
  start: string,
  end: string,
  env: Env,
  opts: { daily?: boolean; limit?: number } = {},
): Promise<GcHit[]> {
  const params = new URLSearchParams({
    start,
    end,
    limit: String(opts.limit ?? 500),
    daily: opts.daily === false ? 'false' : 'true',
  });
  const data = await gcFetch<GcStatsHits>(`/stats/hits?${params}`, env);
  return data.hits ?? [];
}

async function fetchAllHits(daysBack: number, env: Env): Promise<GcHit[]> {
  return fetchHitsRange(rangeStart(daysBack), rangeEnd(), env);
}

// Poll counts span the lifetime of the project — votes don't expire
// like listening behaviour does. This is the earliest plausible start
// (well before the poll banner shipped) so a single GC call covers
// every recorded vote. Bump if the project's GC history ever predates
// this date; otherwise the literal is fine.
const POLL_RANGE_START = '2024-01-01';

// Canonical [oldest..today] list of YYYY-MM-DD day strings for a
// `daysBack`-window, matching the window fetchAllHits passes to GC. The
// last entry is today (UTC); the first is `daysBack - 1` days earlier.
// Used as the per-item series index so every item's series array has
// the same length and lines up with the same days, even when GC omits
// days where the item had zero events.
function rangeDays(daysBack: number): string[] {
  const days: string[] = [];
  const today = new Date();
  for (let i = daysBack - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

function pickByPrefix(
  hits: GcHit[],
  prefix: string,
  limit: number,
  daysBack: number,
): ListResponse {
  const days = rangeDays(daysBack);
  const dayIndex = new Map(days.map((d, i) => [d, i]));
  const matched = hits
    .filter((h) => h.path.startsWith(prefix))
    .map((h) => {
      // Zero-fill so the series is always the same length as `days`.
      // GC omits days with zero events; the dashboard wants an even
      // grid for the sparkline.
      const series = new Array<number>(days.length).fill(0);
      for (const s of h.stats ?? []) {
        const idx = dayIndex.get(s.day);
        if (idx !== undefined) series[idx] = s.daily;
      }
      return {
        label: h.path.slice(prefix.length).trim(),
        count: h.count,
        unique: h.count_unique,
        title: h.title ?? '',
        series,
      };
    });
  matched.sort((a, b) => b.count - a.count);
  const total = matched.reduce((s, i) => s + i.count, 0);
  return { items: matched.slice(0, limit), total, range_days: daysBack, days };
}

async function totals(daysBack: number, env: Env): Promise<GcTotals & { range_days: number }> {
  const start = rangeStart(daysBack);
  const end = rangeEnd();
  const data = await gcFetch<GcTotals>(`/stats/total?start=${start}&end=${end}`, env);
  return { ...data, range_days: daysBack };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Run an upstream-fetching task and fall back to a default value if it
 *  throws. Used by /api/everything to keep one bad GC call from
 *  blanking the whole dashboard. The error is logged so wrangler-tail
 *  still surfaces what failed. */
async function tolerate<T>(task: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await task();
  } catch (err) {
    console.error('[gc-tolerate]', err instanceof Error ? err.message : String(err));
    return fallback;
  }
}

function emptyList(days: number): ListResponse {
  return { items: [], total: 0, range_days: days };
}

/** Generic /stats/<group> reader. Used for browsers, systems, sizes,
 *  locations (country), toprefs, etc. */
async function fetchStatGroup(
  group: string,
  daysBack: number,
  limit: number,
  env: Env,
): Promise<ListResponse> {
  const params = new URLSearchParams({
    start: rangeStart(daysBack),
    end: rangeEnd(),
    limit: String(limit),
  });
  const data = await gcFetch<GcStatGroup>(`/stats/${group}?${params}`, env);
  const items = (data.stats ?? []).map((s) => ({
    label: s.name || s.id || '—',
    count: s.count,
    unique: s.count_unique,
    title: s.id && s.id !== s.name ? s.id : '',
  }));
  items.sort((a, b) => b.count - a.count);
  return { items, total: data.total ?? 0, range_days: daysBack };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get('Origin') ?? '';
    const cors = corsHeaders(origin, env.ALLOWED_ORIGIN);
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') {
      const headers = url.pathname.startsWith('/api/public/')
        ? { ...cors, 'Access-Control-Allow-Origin': '*' }
        : cors;
      return new Response(null, { status: 204, headers });
    }
    const days = clampDays(url.searchParams.get('days'));

    // Public, unauthenticated endpoints. Allowed origin is wide-open
    // (echoes any origin) since the data is non-sensitive aggregate
    // play counts already exposed via the visitor counter pattern.
    if (url.pathname.startsWith('/api/public/')) {
      const publicCors = { ...cors, 'Access-Control-Allow-Origin': '*' };
      try {
        if (url.pathname === '/api/public/report-broken') {
          if (req.method !== 'POST') {
            return noStoreJsonResponse({ error: 'method not allowed' }, 405, publicCors);
          }
          return await handleReportBroken(req, env, publicCors);
        }

        if (req.method !== 'GET') {
          return jsonResponse({ error: 'method not allowed' }, 405, publicCors);
        }

        if (url.pathname === '/api/public/report-status') {
          return await handleReportStatus(url, env, publicCors);
        }

        if (url.pathname === '/api/public/top-stations') {
          const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 5));
          const list = pickByPrefix(await fetchAllHits(days, env), 'play: ', limit, days);
          // Strip the inner `title` field — not needed publicly and
          // keeps the payload tight. `total` is the sum across ALL
          // matched `play:` events in the window (not just the top
          // `limit` items), so the dashboard can show an honest
          // total-plays headline even when more than `limit` distinct
          // stations were played. `series` is the per-day plays array,
          // aligned to the response's `days` list — the dashboard rolls
          // these up per country for the sparkline column.
          const items = list.items.map((i) => ({
            name: i.label,
            count: i.count,
            series: i.series,
          }));
          return new Response(
            JSON.stringify({ items, total: list.total, range_days: days, days: list.days }),
            {
              status: 200,
              headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': `public, max-age=${PUBLIC_CACHE_TTL_S}`,
                ...publicCors,
              },
            },
          );
        }

        // Public region — visitor's country code from Cloudflare's
        // CF-IPCountry header. Used by the apps to decide whether to
        // dim a geo-restricted station's row ("Switzerland only" badge,
        // etc.). Country code only — no city, no IP, no coordinates —
        // so this is intentionally less identifying than the
        // /api/public/locations stats endpoint we already ship.
        //
        // Not edge-cached (Vary on the country header would shard the
        // cache and the response is tiny anyway). The frontend caches
        // the value in localStorage for a session.
        if (url.pathname === '/api/public/region') {
          const country = (req.headers.get('CF-IPCountry') || '').toUpperCase();
          // CF returns "XX" for unrecognized and "T1" for Tor exits;
          // surface both as "unknown" rather than a fake country code
          // so the frontend doesn't try to badge with garbage.
          const known =
            country.length === 2 && country !== 'XX' && country !== 'T1' ? country : null;
          return noStoreJsonResponse(
            { country: known },
            200,
            publicCors,
          );
        }

        // Public totals — same shape as /api/totals (admin) but with no
        // PII to redact in the first place. GoatCounter `/stats/total`
        // returns aggregate visit + event counts only. Used by the
        // public stats sheet so it matches the admin dashboard's headline
        // numbers (which default to 7-day windows).
        if (url.pathname === '/api/public/totals') {
          const t = await totals(days, env);
          return new Response(JSON.stringify(t), {
            status: 200,
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'Cache-Control': `public, max-age=${PUBLIC_CACHE_TTL_S}`,
              ...publicCors,
            },
          });
        }

        // Public visitor locations — visitor-country counts from
        // GoatCounter /stats/locations for the window. One GC call, raw
        // pass-through. Country granularity only; no city/region. No
        // PII. Mirrors what GC's own location view shows.
        //   items: { code, name, count }
        if (url.pathname === '/api/public/locations') {
          const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 30));
          const start = rangeStart(days);
          const end = rangeEnd();
          const data = await gcFetch<GcStatGroup>(
            `/stats/locations?${new URLSearchParams({ start, end, limit: String(limit) })}`,
            env,
          );
          const items = (data.stats ?? [])
            .map((s) => ({
              code: (s.id ?? '').toUpperCase(),
              name: s.name ?? (s.id ?? '').toUpperCase(),
              count: s.count,
            }))
            .filter((i) => i.code);
          items.sort((a, b) => b.count - a.count);
          const total = items.reduce((s, i) => s + i.count, 0);
          return new Response(
            JSON.stringify({ items, total, range_days: days }),
            {
              status: 200,
              headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': `public, max-age=${PUBLIC_CACHE_TTL_S}`,
                ...publicCors,
              },
            },
          );
        }

        // Public native-app interest poll counts. Picks `vote: <choice>`
        // events from the GC hits buffer and returns per-choice tallies
        // for the three published options. Edge-cached for an hour like
        // the other public endpoints.
        //
        // ALL-TIME window — vote sentiment doesn't decay, so capping
        // the poll to a `?days=N` window dropped legitimate votes off
        // the back of the buffer. We fetch from POLL_RANGE_START to
        // yesterday EOD and ignore the request's `days` parameter for
        // counting purposes. (We still echo it in the response so
        // existing clients that read it don't choke.)
        if (url.pathname === '/api/public/poll') {
          const hits = await fetchHitsRange(POLL_RANGE_START, rangeEnd(), env, {
            daily: false,
          });
          const counts: Record<'ios' | 'android' | 'dont-care', number> = {
            ios: 0,
            android: 0,
            'dont-care': 0,
          };
          let total = 0;
          for (const h of hits) {
            if (!h.path.startsWith('vote: ')) continue;
            const label = h.path.slice('vote: '.length).trim();
            if (label === 'ios' || label === 'android' || label === 'dont-care') {
              counts[label] = h.count;
              total += h.count;
            }
          }
          return new Response(
            JSON.stringify({ counts, total, range_days: days, all_time: true }),
            {
              status: 200,
              headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': `public, max-age=${PUBLIC_CACHE_TTL_S}`,
                ...publicCors,
              },
            },
          );
        }

        // Unified dashboard endpoint. Mirrors what GoatCounter's own
        // dashboard shows for the same window, plus rrradio-specific
        // extras (top `play:` events, all-time poll). One Worker call,
        // one cache key, so every device opening the sheet sees the
        // same snapshot.
        //
        // - listening window (top stations, totals, locations) uses
        //   the request's `?days=N` like the standalone endpoints.
        // - poll counts are ALL-TIME (see /api/public/poll comment).
        if (url.pathname === '/api/public/dashboard') {
          const start = rangeStart(days);
          const end = rangeEnd();
          const trendDays = rangeDays(days);

          // Four concurrent GC calls. Each tolerate() makes one slow or
          // flaky upstream degrade just its card instead of blanking the
          // whole sheet.
          const [hits, voteHits, tot, locationsData] = await Promise.all([
            tolerate(() => fetchHitsRange(start, end, env), [] as GcHit[]),
            tolerate(
              () => fetchHitsRange(POLL_RANGE_START, end, env, { daily: false }),
              [] as GcHit[],
            ),
            tolerate(
              () => gcFetch<GcTotals>(`/stats/total?start=${start}&end=${end}`, env),
              {} as GcTotals,
            ),
            tolerate(
              () =>
                gcFetch<GcStatGroup>(
                  `/stats/locations?${new URLSearchParams({ start, end, limit: '50' })}`,
                  env,
                ),
              { stats: [], total: 0 } as GcStatGroup,
            ),
          ]);

          // Top stations from windowed hits.
          const stationsList = pickByPrefix(hits, 'play: ', 25, days);
          const stationItems = stationsList.items.map((i) => ({
            name: i.label,
            count: i.count,
            series: i.series,
          }));
          // Honest "distinct stations played" — the worker has the full
          // matched-prefix list (capped at 500) before slicing to the
          // top 25, so we surface the true cardinality rather than the
          // display cap.
          const distinctStations = hits.filter((h) => h.path.startsWith('play: ')).length;

          // Listener locations: pass through what GC returned for the
          // window. One country per stat, count = visits, no daily
          // series (GC's /stats/locations doesn't break out per-day and
          // the dashboard no longer asks for it).
          const locationItems = (locationsData.stats ?? [])
            .map((s) => ({
              code: (s.id ?? '').toUpperCase(),
              name: s.name ?? (s.id ?? '').toUpperCase(),
              count: s.count,
            }))
            .filter((i) => i.code);
          locationItems.sort((a, b) => b.count - a.count);
          const locationsTotal = locationItems.reduce((s, i) => s + i.count, 0);

          // Poll counts from the all-time vote hits.
          const voteCounts: Record<'ios' | 'android' | 'dont-care', number> = {
            ios: 0,
            android: 0,
            'dont-care': 0,
          };
          let voteTotal = 0;
          for (const h of voteHits) {
            if (!h.path.startsWith('vote: ')) continue;
            const label = h.path.slice('vote: '.length).trim();
            if (label === 'ios' || label === 'android' || label === 'dont-care') {
              voteCounts[label] = h.count;
              voteTotal += h.count;
            }
          }

          return new Response(
            JSON.stringify({
              generated_at: new Date().toISOString(),
              range_days: days,
              days: trendDays,
              totals: {
                total: tot.total ?? 0,
                total_events: tot.total_events ?? 0,
              },
              top_stations: {
                items: stationItems,
                total: stationsList.total,
                distinct_stations: distinctStations,
              },
              locations: {
                items: locationItems,
                total: locationsTotal,
              },
              poll: {
                counts: voteCounts,
                total: voteTotal,
                all_time: true,
              },
            }),
            {
              status: 200,
              headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': `public, max-age=${PUBLIC_CACHE_TTL_S}`,
                ...publicCors,
              },
            },
          );
        }

        // Generic proxy with host allowlist. For broadcaster APIs that
        // return useful JSON but lack CORS (HR + BR + future ARD
        // family members). The allowlist prevents this from becoming
        // an open proxy. Caller passes the full URL as ?url=<encoded>.
        if (url.pathname === '/api/public/proxy') {
          const target = url.searchParams.get('url');
          const ALLOW = [
            /^https:\/\/www\.hr[1-4]\.de\//i,
            /^https:\/\/www\.br\.de\//i,
            /^https:\/\/api\.radioswiss(?:pop|jazz|classic)\.ch\/api\/v1\/[a-z]+\/[a-z]{2}\/playlist_(?:small|large)$/i,
            /^https:\/\/www\.antenne\.de\/api\/metadata\/now$/i,
            /^https:\/\/www\.rockantenne\.de\/api\/metadata\/now$/i,
            /^https:\/\/www\.bremen(?:eins|zwei|vier|next)\.de\/.+~ajax_ajaxType-epg\.json$/i,
            /^https:\/\/www\.sr\.de\/sr\/epg\/nowPlaying\.jsp\?welle=[a-z0-9]+$/i,
          ];
          if (!target || !ALLOW.some((re) => re.test(target))) {
            return jsonResponse({ error: 'host not allowed' }, 403, publicCors);
          }
          const r = await fetch(target, {
            headers: {
              'User-Agent': 'rrradio-stats/1.0 (+https://rrradio.org)',
              Accept: 'application/json',
            },
          });
          if (!r.ok) return jsonResponse({ error: 'upstream', status: r.status }, 502, publicCors);
          const body = await r.text();
          return new Response(body, {
            status: 200,
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'Cache-Control': `public, max-age=60`,
              ...publicCors,
            },
          });
        }

        // BBC proxy. rms.api.bbc.co.uk gates by Origin: a non-bbc.co.uk
        // origin gets 403 even though the preflight allows it. Proxy
        // here with the right origin so the browser can read the data.
        // Service slug is the path tail (e.g. "bbc_world_service").
        const bbcMatch = url.pathname.match(
          /^\/api\/public\/bbc\/(schedule|play)\/([a-z0-9_]+)$/,
        );
        if (bbcMatch) {
          const [, kind, service] = bbcMatch;
          const upstream =
            kind === 'schedule'
              ? `https://rms.api.bbc.co.uk/v2/experience/inline/schedules/${service}`
              : `https://rms.api.bbc.co.uk/v2/experience/inline/play/${service}`;
          const upstreamRes = await fetch(upstream, {
            headers: {
              Origin: 'https://www.bbc.co.uk',
              Referer: 'https://www.bbc.co.uk/sounds/',
              'User-Agent': 'rrradio-stats/1.0 (+https://rrradio.org)',
              Accept: 'application/json',
            },
          });
          if (!upstreamRes.ok) {
            return jsonResponse(
              { error: 'upstream', status: upstreamRes.status },
              502,
              publicCors,
            );
          }
          const body = await upstreamRes.text();
          // Schedule changes hourly at most; a 5-minute edge cache is
          // a good polite default for both kinds.
          return new Response(body, {
            status: 200,
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'Cache-Control': `public, max-age=${kind === 'schedule' ? 600 : 60}`,
              ...publicCors,
            },
          });
        }

        return jsonResponse({ error: 'not found' }, 404, publicCors);
      } catch (err) {
        return jsonResponse(
          { error: 'fetch failed', message: err instanceof Error ? err.message : String(err) },
          502,
          publicCors,
        );
      }
    }

    // The one POST admin route. Token-guarded like the GET routes; the
    // caller is the issue-close GitHub Action (or a human with curl),
    // not the browser dashboard, so it sits outside the GET-only gate.
    if (url.pathname === '/api/admin/resolve-reports') {
      if (req.method !== 'POST') {
        return noStoreJsonResponse({ error: 'method not allowed' }, 405, cors);
      }
      const bearer = req.headers.get('Authorization');
      if (!env.ADMIN_TOKEN || bearer !== `Bearer ${env.ADMIN_TOKEN}`) {
        return noStoreJsonResponse({ error: 'unauthorized' }, 401, cors);
      }
      try {
        return await handleResolveReports(req, env, cors);
      } catch (err) {
        return noStoreJsonResponse(
          { error: 'fetch failed', message: err instanceof Error ? err.message : String(err) },
          502,
          cors,
        );
      }
    }

    if (req.method !== 'GET') {
      return jsonResponse({ error: 'method not allowed' }, 405, cors);
    }

    const auth = req.headers.get('Authorization');
    if (!env.ADMIN_TOKEN || auth !== `Bearer ${env.ADMIN_TOKEN}`) {
      return jsonResponse({ error: 'unauthorized' }, 401, cors);
    }

    // Report triage reads come from D1, not GoatCounter, and want live
    // state — handled outside the cached GC switch below.
    if (url.pathname === '/api/broken-reports') {
      try {
        return await handleAdminReportsList(url, env, cors);
      } catch (err) {
        return noStoreJsonResponse(
          { error: 'fetch failed', message: err instanceof Error ? err.message : String(err) },
          502,
          cors,
        );
      }
    }

    try {
      let data: unknown;
      switch (url.pathname) {
        case '/api/totals':
          data = await totals(days, env);
          break;
        case '/api/top-stations':
          data = pickByPrefix(await fetchAllHits(days, env), 'play: ', 20, days);
          break;
        case '/api/errors':
          data = pickByPrefix(await fetchAllHits(days, env), 'error: ', 20, days);
          break;
        case '/api/reports':
          data = pickByPrefix(await fetchAllHits(days, env), 'report-broken: ', 20, days);
          break;
        case '/api/tabs':
          data = pickByPrefix(await fetchAllHits(days, env), 'tab/', 10, days);
          break;
        case '/api/genres':
          data = pickByPrefix(await fetchAllHits(days, env), 'genre/', 10, days);
          break;
        case '/api/favorites':
          data = pickByPrefix(await fetchAllHits(days, env), 'favorite: ', 20, days);
          break;
        case '/api/locations':
          data = await fetchStatGroup('locations', days, 20, env);
          break;
        case '/api/browsers':
          data = await fetchStatGroup('browsers', days, 10, env);
          break;
        case '/api/systems':
          data = await fetchStatGroup('systems', days, 10, env);
          break;
        case '/api/debug': {
          // Returns the raw GoatCounter /stats/total response so we can
          // see exactly which field names this account/version exposes.
          const start = rangeStart(days);
          const end = rangeEnd();
          const raw = await gcFetch<unknown>(`/stats/total?start=${start}&end=${end}`, env);
          data = { range_days: days, raw_totals: raw };
          break;
        }
        case '/api/everything': {
          // Fetch all dashboard data in one Worker request, sequentially
          // with ~300ms gaps to stay under GoatCounter's 4 req/s limit.
          // The single fetchAllHits call backs all five prefix-filtered
          // sections (stations, favorites, errors, tabs, genres).
          //
          // Each upstream call is wrapped in tolerate() so one slow or
          // flaky GC response degrades just its card instead of blanking
          // the whole dashboard. The per-card error string surfaces to
          // the frontend in the empty list, where it can be rendered
          // alongside the working cards.
          const hits = await tolerate(() => fetchAllHits(days, env), [] as GcHit[]);
          await sleep(300);
          const tot = await tolerate(
            () => totals(days, env),
            { range_days: days, total_pageviews: 0, total_unique_visitors: 0 } as GcTotals & {
              range_days: number;
            },
          );
          await sleep(300);
          const locations = await tolerate(
            () => fetchStatGroup('locations', days, 20, env),
            emptyList(days),
          );
          await sleep(300);
          const browsers = await tolerate(
            () => fetchStatGroup('browsers', days, 10, env),
            emptyList(days),
          );
          await sleep(300);
          const systems = await tolerate(
            () => fetchStatGroup('systems', days, 10, env),
            emptyList(days),
          );
          // Compute event total from the hits buffer — /stats/total
          // doesn't break this out reliably across GC versions.
          const eventCount = hits
            .filter((h) => h.event === true)
            .reduce((s, h) => s + h.count, 0);
          data = {
            range_days: days,
            totals: {
              ...tot,
              total_events: eventCount,
            },
            stations: pickByPrefix(hits, 'play: ', 20, days),
            favorites: pickByPrefix(hits, 'favorite: ', 20, days),
            errors: pickByPrefix(hits, 'error: ', 20, days),
            reports: pickByPrefix(hits, 'report-broken: ', 20, days),
            tabs: pickByPrefix(hits, 'tab/', 10, days),
            genres: pickByPrefix(hits, 'genre/', 10, days),
            locations,
            browsers,
            systems,
          };
          break;
        }
        default:
          return jsonResponse({ error: 'not found' }, 404, cors);
      }
      return jsonResponse(data, 200, cors);
    } catch (err) {
      return jsonResponse(
        { error: 'fetch failed', message: err instanceof Error ? err.message : String(err) },
        502,
        cors,
      );
    }
  },
};
