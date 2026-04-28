/**
 * Build-side Radio Browser client. Used by build-catalog.mjs and
 * check-drift.mjs to read the authoritative station records keyed
 * by stationuuid.
 *
 * Separate from src/radioBrowser.ts (which is the runtime search
 * client shipped to browsers). Build-time can be picky about which
 * mirror it uses, can persist a chosen mirror across runs, and can
 * fall back to a disk cache when offline.
 *
 * Public surface:
 *   pickServer({ force?: boolean })           → string
 *   fetchByUuid(uuids: string[], opts?)       → RBStation[]
 *
 *   opts = {
 *     cacheFile?: string,    // path; default .cache/rb-byuuid.json
 *     offline?: boolean,     // never hit the network; cache-only
 *     maxAgeMs?: number,     // cache freshness; default 7d
 *   }
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CACHE_DIR = join(ROOT, '.cache');
const SERVER_FILE = join(CACHE_DIR, 'rb-server');
const DEFAULT_CACHE = join(CACHE_DIR, 'rb-byuuid.json');
const USER_AGENT = 'rrradio-build/1.0 (+https://rrradio.org)';
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
const CHUNK_SIZE = 50; // keep URLs well under 2KB

function ensureCacheDir() {
  mkdirSync(CACHE_DIR, { recursive: true });
}

async function discoverServers() {
  // Returns the list of currently-healthy mirrors. The "all" endpoint
  // is itself round-robined, so any one of them can answer.
  const res = await fetch('https://all.api.radio-browser.info/json/servers', {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new Error(`rb-client: server discovery failed (${res.status})`);
  const list = await res.json();
  return list.map((s) => `https://${s.name}`).filter(Boolean);
}

/**
 * Pick a Radio Browser mirror. Reuses the previously-chosen one when
 * still valid (within 24h) so successive runs hit the same server and
 * we don't hammer the discovery endpoint. Pass `{ force: true }` to
 * force re-selection.
 */
export async function pickServer({ force = false } = {}) {
  ensureCacheDir();
  if (!force && existsSync(SERVER_FILE)) {
    const age = Date.now() - statSync(SERVER_FILE).mtimeMs;
    if (age < 24 * 60 * 60 * 1000) {
      return readFileSync(SERVER_FILE, 'utf8').trim();
    }
  }
  const servers = await discoverServers();
  if (servers.length === 0) throw new Error('rb-client: no mirrors returned');
  // Pick a random one; don't always hit the same mirror.
  const chosen = servers[Math.floor(Math.random() * servers.length)];
  writeFileSync(SERVER_FILE, chosen);
  return chosen;
}

function loadCache(path) {
  if (!existsSync(path)) return { entries: {}, fetchedAt: 0 };
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return { entries: {}, fetchedAt: 0 };
  }
}

function saveCache(path, cache) {
  ensureCacheDir();
  writeFileSync(path, JSON.stringify(cache, null, 2) + '\n');
}

async function fetchChunk(server, uuids) {
  // GET /json/stations/byuuid?uuids=<comma-separated>
  // Documented behaviour: returns matching stations in any order;
  // missing uuids are simply omitted from the response.
  const url = `${server}/json/stations/byuuid?uuids=${uuids.join(',')}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`rb-client: byuuid ${res.status} on ${server}`);
  const list = await res.json();
  if (!Array.isArray(list)) throw new Error('rb-client: byuuid did not return an array');
  return list;
}

/**
 * Fetch RB records for the given uuids. Returns an array in the same
 * order as the input; uuids RB doesn't recognise are dropped (logged
 * by the caller).
 *
 * Cache strategy:
 *   - Reads .cache/rb-byuuid.json if present.
 *   - When offline: returns cached entries only (errors if any uuid
 *     is missing from cache).
 *   - When online and cache is fresh enough (default 7d): use cache.
 *   - When online and stale: re-fetches everything in one pass,
 *     overwrites the cache.
 */
export async function fetchByUuid(uuids, opts = {}) {
  const cacheFile = opts.cacheFile ?? DEFAULT_CACHE;
  const offline = opts.offline === true;
  const maxAgeMs = opts.maxAgeMs ?? SEVEN_DAYS;

  if (uuids.length === 0) return [];
  const unique = [...new Set(uuids)];

  const cache = loadCache(cacheFile);
  const fresh = cache.fetchedAt > 0 && Date.now() - cache.fetchedAt < maxAgeMs;

  if (offline || fresh) {
    const out = [];
    const missing = [];
    for (const uuid of unique) {
      const hit = cache.entries[uuid];
      if (hit) out.push(hit);
      else missing.push(uuid);
    }
    if (missing.length === 0) return reorder(unique, out);
    if (offline) {
      throw new Error(
        `rb-client: offline and ${missing.length} uuid(s) missing from cache: ${missing
          .slice(0, 3)
          .join(', ')}${missing.length > 3 ? ', …' : ''}`,
      );
    }
    // Online + cache fresh but missing some uuids → fall through to refetch.
  }

  const server = await pickServer();
  const collected = [];
  for (let i = 0; i < unique.length; i += CHUNK_SIZE) {
    const chunk = unique.slice(i, i + CHUNK_SIZE);
    const list = await fetchChunk(server, chunk);
    collected.push(...list);
  }

  // Rebuild cache from the fresh response. Old uuids that no longer
  // resolve are silently dropped from cache; the caller decides what
  // to do about them via the returned array's missing entries.
  const next = { fetchedAt: Date.now(), server, entries: {} };
  for (const s of collected) {
    if (s?.stationuuid) next.entries[s.stationuuid] = s;
  }
  saveCache(cacheFile, next);

  return reorder(unique, collected);
}

function reorder(uuids, list) {
  const byId = new Map();
  for (const s of list) {
    if (s?.stationuuid) byId.set(s.stationuuid, s);
  }
  const out = [];
  for (const uuid of uuids) {
    const hit = byId.get(uuid);
    if (hit) out.push(hit);
  }
  return out;
}

/** Stable hash of a uuid set — handy for callers wanting a cache key. */
export function hashUuids(uuids) {
  const h = createHash('sha1');
  h.update([...uuids].sort().join(','));
  return h.digest('hex').slice(0, 12);
}
