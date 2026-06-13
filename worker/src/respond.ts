export const CACHE_TTL_S = 300;

export function jsonResponse(body: unknown, status: number, headers: Record<string, string>): Response {
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

export function noStoreJsonResponse(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}
