import type { Station } from './types';

/**
 * Radio Browser is hosted across several mirror servers. Browsers can't do
 * the recommended DNS-based discovery, so we bootstrap by hitting
 * `/json/servers` on a known seed host. If the bootstrap fails on every
 * seed, we fall back to using the seed list itself as the rotation pool.
 */
const SEED_HOSTS = [
  'de1.api.radio-browser.info',
  'at1.api.radio-browser.info',
  'nl1.api.radio-browser.info',
];

const CACHE_TTL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 5000;

interface RBServer {
  name: string;
}

interface RBStation {
  stationuuid: string;
  name: string;
  url: string;
  url_resolved: string;
  homepage: string;
  favicon: string;
  tags: string;
  countrycode: string;
  bitrate: number;
  codec: string;
  hls: number;
  lastcheckok: number;
  clickcount: number;
}

/** Deterministic pseudo-frequency in [87.5, 108.0] MHz keyed off the
 *  station id, so the tuner dial always has a target even when the
 *  Radio Browser record has no real broadcast frequency. */
export function pseudoFrequency(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  }
  const steps = 206; // (108.0 - 87.5) / 0.1 + 1
  const stepIndex = Math.abs(hash) % steps;
  const tenths = 875 + stepIndex;
  return (tenths / 10).toFixed(1);
}

export interface SearchParams {
  name?: string;
  tag?: string;
  countrycode?: string;
  limit?: number;
  offset?: number;
  order?: 'votes' | 'clickcount' | 'name' | 'lastcheckok';
  reverse?: boolean;
  hidebroken?: boolean;
}

type CacheEntry = { data: Station[]; expiry: number };

function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Radio Browser is community-submitted, so the same station can appear
 * multiple times under distinct UUIDs (someone re-adds it to attach a
 * better logo, fix the country, etc.). Collapse entries that share the
 * same playable URL, keeping whichever record looks the most curated:
 * a real logo PNG beats a generic /favicon.ico, populated tags beat
 * empty, and clickcount is the final tiebreaker.
 */
function dedupeByStreamUrl(stations: RBStation[]): RBStation[] {
  const score = (s: RBStation) => {
    const fav = (s.favicon ?? '').toLowerCase();
    const hasRealLogo = fav && !fav.endsWith('/favicon.ico') ? 1 : 0;
    const hasTags = s.tags?.trim() ? 1 : 0;
    return hasRealLogo * 1000 + hasTags * 100 + (s.clickcount || 0);
  };
  const winners = new Map<string, RBStation>();
  for (const s of stations) {
    const key = (s.url_resolved || s.url).trim();
    const incumbent = winners.get(key);
    if (!incumbent || score(s) > score(incumbent)) winners.set(key, s);
  }
  return [...winners.values()];
}

function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => {
    window.clearTimeout(timer);
  });
}

class RadioBrowserClient {
  private servers: string[] | null = null;
  private serversPromise: Promise<string[]> | null = null;
  private currentIndex = 0;
  private cache = new Map<string, CacheEntry>();

  private async loadServers(): Promise<string[]> {
    if (this.servers) return this.servers;
    if (this.serversPromise) return this.serversPromise;

    this.serversPromise = (async () => {
      for (const host of shuffle(SEED_HOSTS)) {
        try {
          const res = await fetchWithTimeout(
            `https://${host}/json/servers`,
            { headers: { Accept: 'application/json' } },
            REQUEST_TIMEOUT_MS,
          );
          if (!res.ok) continue;
          const list = (await res.json()) as RBServer[];
          const hosts = list.map((s) => s.name).filter((n): n is string => !!n);
          if (hosts.length > 0) {
            this.servers = shuffle(hosts);
            return this.servers;
          }
        } catch {
          // try next seed
        }
      }
      this.servers = shuffle(SEED_HOSTS);
      return this.servers;
    })();

    return this.serversPromise;
  }

  private async request<T>(
    path: string,
    query: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    const servers = await this.loadServers();
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') search.set(k, String(v));
    }
    const qs = search.toString();
    const suffix = qs ? `?${qs}` : '';

    let lastError: unknown = new Error('No Radio Browser servers available');
    for (let i = 0; i < servers.length; i++) {
      const idx = (this.currentIndex + i) % servers.length;
      const host = servers[idx];
      try {
        const res = await fetchWithTimeout(
          `https://${host}${path}${suffix}`,
          { headers: { Accept: 'application/json' } },
          REQUEST_TIMEOUT_MS,
        );
        if (!res.ok) {
          lastError = new Error(`HTTP ${res.status} from ${host}`);
          continue;
        }
        this.currentIndex = idx;
        return (await res.json()) as T;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private toStation(raw: RBStation): Station {
    const tags = raw.tags
      ? raw.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : [];
    return {
      id: raw.stationuuid,
      name: raw.name.trim() || 'Unknown',
      streamUrl: raw.url_resolved || raw.url,
      homepage: raw.homepage || undefined,
      country: raw.countrycode || undefined,
      tags,
      favicon: raw.favicon || undefined,
      bitrate: raw.bitrate > 0 ? raw.bitrate : undefined,
      codec: raw.codec ? raw.codec.toUpperCase() : undefined,
      listeners: raw.clickcount > 0 ? raw.clickcount : undefined,
      frequency: pseudoFrequency(raw.stationuuid),
    };
  }

  async searchStations(params: SearchParams = {}): Promise<Station[]> {
    const merged: SearchParams = {
      limit: 60,
      order: 'votes',
      reverse: true,
      hidebroken: true,
      ...params,
    };
    const cacheKey = JSON.stringify(merged);
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiry > Date.now()) return cached.data;

    const raw = await this.request<RBStation[]>(
      '/json/stations/search',
      merged as Record<string, string | number | boolean | undefined>,
    );
    const stations = dedupeByStreamUrl(raw.filter((s) => s.url_resolved || s.url)).map((s) =>
      this.toStation(s),
    );
    this.cache.set(cacheKey, { data: stations, expiry: Date.now() + CACHE_TTL_MS });
    return stations;
  }

  async topStations(limit = 60): Promise<Station[]> {
    return this.searchStations({ limit, order: 'votes', reverse: true });
  }
}

export const radioBrowser = new RadioBrowserClient();
