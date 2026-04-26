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
 *   /api/tabs          — tab usage (filter: "tab/")
 *   /api/genres        — genre filter selections (filter: "genre/")
 *   /api/favorites     — most-favorited stations (filter: "favorite: ")
 *
 * Range: ?days=N (1–90, default 7). Response cached 5 min in the
 * Cloudflare edge cache to be a polite GC API consumer.
 */

export interface Env {
  GOATCOUNTER_SITE: string;
  GOATCOUNTER_TOKEN: string;
  ADMIN_TOKEN: string;
  ALLOWED_ORIGIN: string;
}

const CACHE_TTL_S = 300;

interface GcHit {
  path: string;
  title?: string;
  event?: boolean;
  count: number;
  count_unique?: number;
}

interface GcStatsHits {
  hits: GcHit[];
  total: number;
  more?: boolean;
}

interface GcTotals {
  total?: number;
  total_events?: number;
  total_unique?: number;
}

interface ListResponse {
  items: Array<{ label: string; count: number; unique?: number; title: string }>;
  total: number;
  range_days: number;
}

function corsHeaders(origin: string, allowed: string): Record<string, string> {
  // Echo the requesting origin only when it matches the allow-listed one,
  // otherwise the configured allowed origin. Same shape either way.
  const out = origin === allowed ? origin : allowed;
  return {
    'Access-Control-Allow-Origin': out,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function jsonResponse(body: unknown, status: number, headers: Record<string, string>): Response {
  // Cache only successful responses; errors should be retryable
  // immediately, not pinned at the edge for 5 minutes.
  const cacheControl = status >= 200 && status < 400 ? `public, max-age=${CACHE_TTL_S}` : 'no-store';
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cacheControl,
      ...headers,
    },
  });
}

async function gcFetch<T>(path: string, env: Env): Promise<T> {
  const url = `https://${env.GOATCOUNTER_SITE}/api/v0${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.GOATCOUNTER_TOKEN}`,
      Accept: 'application/json',
    },
  });
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

function rangeStart(daysBack: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysBack);
  return d.toISOString().slice(0, 10);
}

function clampDays(raw: string | null): number {
  const n = Number(raw) || 7;
  return Math.min(90, Math.max(1, Math.round(n)));
}

// We fetch a large slice of /stats/hits once and filter client-side
// across all topByPrefix calls. GoatCounter's /stats/hits doesn't
// accept a `filter` query param (we got 400 trying), and its results
// are already aggregated per-path with counts ordered desc.
async function fetchAllHits(daysBack: number, env: Env): Promise<GcHit[]> {
  const params = new URLSearchParams({
    start: rangeStart(daysBack),
    limit: '500',
    daily: 'false',
  });
  const data = await gcFetch<GcStatsHits>(`/stats/hits?${params}`, env);
  return data.hits ?? [];
}

function pickByPrefix(
  hits: GcHit[],
  prefix: string,
  limit: number,
  daysBack: number,
): ListResponse {
  const matched = hits
    .filter((h) => h.path.startsWith(prefix))
    .map((h) => ({
      label: h.path.slice(prefix.length).trim(),
      count: h.count,
      unique: h.count_unique,
      title: h.title ?? '',
    }));
  matched.sort((a, b) => b.count - a.count);
  const total = matched.reduce((s, i) => s + i.count, 0);
  return { items: matched.slice(0, limit), total, range_days: daysBack };
}

async function totals(daysBack: number, env: Env): Promise<GcTotals & { range_days: number }> {
  const start = rangeStart(daysBack);
  const data = await gcFetch<GcTotals>(`/stats/total?start=${start}`, env);
  return { ...data, range_days: daysBack };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get('Origin') ?? '';
    const cors = corsHeaders(origin, env.ALLOWED_ORIGIN);

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    if (req.method !== 'GET') {
      return jsonResponse({ error: 'method not allowed' }, 405, cors);
    }

    const auth = req.headers.get('Authorization');
    if (!env.ADMIN_TOKEN || auth !== `Bearer ${env.ADMIN_TOKEN}`) {
      return jsonResponse({ error: 'unauthorized' }, 401, cors);
    }

    const url = new URL(req.url);
    const days = clampDays(url.searchParams.get('days'));

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
        case '/api/tabs':
          data = pickByPrefix(await fetchAllHits(days, env), 'tab/', 10, days);
          break;
        case '/api/genres':
          data = pickByPrefix(await fetchAllHits(days, env), 'genre/', 10, days);
          break;
        case '/api/favorites':
          data = pickByPrefix(await fetchAllHits(days, env), 'favorite: ', 20, days);
          break;
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
