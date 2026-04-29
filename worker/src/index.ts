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
/** Public top-stations endpoint refreshes hourly — stations don't change
 *  rank fast and we want one upstream GC fetch per hour at most, no
 *  matter how many visitors hit the site. */
const PUBLIC_CACHE_TTL_S = 3600;

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    if (req.method !== 'GET') {
      return jsonResponse({ error: 'method not allowed' }, 405, cors);
    }

    const url = new URL(req.url);
    const days = clampDays(url.searchParams.get('days'));

    // Public, unauthenticated endpoints. Allowed origin is wide-open
    // (echoes any origin) since the data is non-sensitive aggregate
    // play counts already exposed via the visitor counter pattern.
    if (url.pathname.startsWith('/api/public/')) {
      const publicCors = { ...cors, 'Access-Control-Allow-Origin': '*' };
      try {
        if (url.pathname === '/api/public/top-stations') {
          const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 5));
          const list = pickByPrefix(await fetchAllHits(days, env), 'play: ', limit, days);
          // Strip the inner `title` field — not needed publicly and
          // keeps the payload tight.
          const items = list.items.map((i) => ({ name: i.label, count: i.count }));
          return new Response(JSON.stringify({ items, range_days: days }), {
            status: 200,
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'Cache-Control': `public, max-age=${PUBLIC_CACHE_TTL_S}`,
              ...publicCors,
            },
          });
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
        // GoatCounter /stats/locations. Country granularity only; no
        // city/region. Aggregate, no PII. Items shape:
        //   { code: ISO3166-1 alpha-2, name: localized, count: int }
        if (url.pathname === '/api/public/locations') {
          const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 30));
          const params = new URLSearchParams({
            start: rangeStart(days),
            limit: String(limit),
          });
          const raw = await gcFetch<GcStatGroup>(`/stats/locations?${params}`, env);
          const items = (raw.stats ?? []).map((s) => ({
            code: s.id || '',
            name: s.name || s.id || '—',
            count: s.count,
          }));
          items.sort((a, b) => b.count - a.count);
          return new Response(
            JSON.stringify({ items, total: raw.total ?? 0, range_days: days }),
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

    const auth = req.headers.get('Authorization');
    if (!env.ADMIN_TOKEN || auth !== `Bearer ${env.ADMIN_TOKEN}`) {
      return jsonResponse({ error: 'unauthorized' }, 401, cors);
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
          const raw = await gcFetch<unknown>(`/stats/total?start=${start}`, env);
          data = { range_days: days, raw_totals: raw };
          break;
        }
        case '/api/everything': {
          // Fetch all dashboard data in one Worker request, sequentially
          // with ~300ms gaps to stay under GoatCounter's 4 req/s limit.
          // The single fetchAllHits call backs all five prefix-filtered
          // sections (stations, favorites, errors, tabs, genres).
          const hits = await fetchAllHits(days, env);
          await sleep(300);
          const tot = await totals(days, env);
          await sleep(300);
          const locations = await fetchStatGroup('locations', days, 20, env);
          await sleep(300);
          const browsers = await fetchStatGroup('browsers', days, 10, env);
          await sleep(300);
          const systems = await fetchStatGroup('systems', days, 10, env);
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
