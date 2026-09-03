/**
 * Edge second opinion for the catalog quality loop (ADR 002, phase 2).
 *
 * GET /api/admin/probe?url=<stream-url>  (Bearer ADMIN_TOKEN)
 *
 * The daily probe runs from a GitHub Actions runner — one ASN, one
 * geography. Before the policy unpublishes a station whose failures are
 * "soft" (timeouts, 403s, 5xx — the classes geo-blocks and flaky hosts
 * produce), it asks this endpoint for a second look from Cloudflare's
 * network. The answer uses the same vocabulary as tools/lib/probe-classify.mjs
 * so it can be appended to the observation log as a `v: "edge"` row.
 *
 * The answer is the signal: a fetch that fails is a *bad* verdict with a
 * reason, never a thrown error or a 5xx from this handler.
 */

const TIMEOUT_MS = 8000;
const HARD_STATUSES = new Set([404, 410]);

export type Outcome = 'ok' | 'warn' | 'bad';
export type FailureClass = 'hard' | 'soft' | null;

export interface Verdict {
  o: Outcome;
  c: FailureClass;
  d: string;
}

export interface ProbeAnswer extends Verdict {
  url: string;
  /** HTTP status, or null when the fetch itself failed. */
  s: number | null;
  /** Lower-cased content-type, or null. */
  ct: string | null;
  ms: number;
}

/** Same rule as the runner probe: audio, HLS manifests, or opaque bytes. */
export function isAudioLike(contentType: string): boolean {
  return (
    contentType.startsWith('audio/') ||
    contentType.includes('mpegurl') ||
    contentType.includes('octet-stream')
  );
}

/** Map a fetch failure onto the probe's stable error tokens. */
export function errorToken(err: unknown): string {
  const name = err instanceof Error ? err.name : '';
  const msg = String(err instanceof Error ? err.message : err).toLowerCase();
  if (name === 'TimeoutError' || name === 'AbortError' || msg.includes('timeout') || msg.includes('timed out')) {
    return 'timeout';
  }
  if (msg.includes('enotfound') || msg.includes('getaddrinfo') || msg.includes('dns')) return 'dns';
  if (msg.includes('econnrefused') || msg.includes('refused')) return 'refused';
  if (msg.includes('econnreset') || msg.includes('reset')) return 'reset';
  if (msg.includes('certificate') || msg.includes('tls') || msg.includes('ssl')) return 'tls';
  return 'network';
}

/**
 * Pure classification, mirrored from tools/lib/probe-classify.mjs.
 * Hard = the host told us the stream is gone; soft = it might be us.
 */
export function classifyProbe(input: {
  status: number | null;
  contentType: string | null;
  error?: unknown;
}): Verdict {
  if (input.status === null) {
    const d = errorToken(input.error);
    return { o: 'bad', c: d === 'dns' || d === 'refused' ? 'hard' : 'soft', d };
  }
  if (input.status >= 400) {
    return { o: 'bad', c: HARD_STATUSES.has(input.status) ? 'hard' : 'soft', d: `HTTP ${input.status}` };
  }
  const ct = input.contentType ?? '';
  if (!isAudioLike(ct)) return { o: 'warn', c: null, d: `content-type "${ct || '?'}"` };
  return { o: 'ok', c: null, d: ct };
}

/** Fetch the stream head from the edge and classify it. Never throws. */
export async function probeUrl(target: string, fetchImpl: typeof fetch = fetch): Promise<ProbeAnswer> {
  const started = Date.now();
  let status: number | null = null;
  let contentType: string | null = null;
  let error: unknown;
  try {
    const res = await fetchImpl(target, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'User-Agent': 'rrradio-stats/1.0 (+https://rrradio.org)',
        'Icy-MetaData': '1',
      },
    });
    status = res.status;
    contentType = (res.headers.get('content-type') ?? '').toLowerCase() || null;
    // One chunk proves the stream actually sends bytes; then hang up —
    // this is a probe, not a listener.
    const reader = res.body?.getReader();
    if (reader) {
      try {
        await reader.read();
      } finally {
        try {
          await reader.cancel();
        } catch {
          /* already closed */
        }
      }
    }
  } catch (err) {
    error = err;
    status = null;
  }
  const verdict = classifyProbe({ status, contentType, error });
  return { url: target, s: status, ct: contentType, ...verdict, ms: Date.now() - started };
}

/** Route handler. `respond` is the Worker's JSON helper so headers stay consistent. */
export async function handleAdminProbe(
  url: URL,
  respond: (body: unknown, status: number) => Response,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const target = url.searchParams.get('url') ?? '';
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return respond({ error: 'bad url' }, 400);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return respond({ error: 'bad url' }, 400);
  }
  return respond(await probeUrl(parsed.toString(), fetchImpl), 200);
}
