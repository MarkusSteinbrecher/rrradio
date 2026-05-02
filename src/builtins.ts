/// <reference types="vite/client" />
import { icyFetcher } from './metadata';
import type { MetadataFetcher, ScheduleBroadcast, ScheduleDay, ScheduleFetcher } from './metadata';
import type { Station } from './types';

const BASE = import.meta.env.BASE_URL;

/** Generic worker proxy for broadcaster APIs that lack CORS (BR, HR).
 *  The worker holds an allowlist; see worker/src/index.ts:/api/public/proxy. */
const PROXY = 'https://rrradio-stats.markussteinbrecher.workers.dev/api/public/proxy';

// ============================================================
// Helpers
// ============================================================

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|[\s'’\-/])([a-zà-ÿ])/g, (_, p: string, c: string) => p + c.toUpperCase());
}

/** Strip leading non-JSON noise (comments, BOM) so JSON.parse can swallow
 *  responses like BR's radioplayer.json which starts with `//@formatter:off`. */
function parseLooseJSON(text: string): unknown {
  const idx = text.search(/[\[{]/);
  return JSON.parse(idx > 0 ? text.slice(idx) : text);
}

// ============================================================
// Per-station metadata fetchers
// ============================================================

interface GrrifTrack {
  Title?: string;
  Artist?: string;
  URLCover?: string;
  Hours?: string;
}

const fetchGrrifMetadata: MetadataFetcher = async (_station, signal) => {
  try {
    const res = await fetch(`https://www.grrif.ch/live/covers.json?_=${Date.now()}`, {
      signal,
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const arr = (await res.json()) as GrrifTrack[];
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const latest = arr[arr.length - 1];
    if (!latest?.Title) return null;
    const cover =
      latest.URLCover && !/\/default\.jpg$/i.test(latest.URLCover) ? latest.URLCover : undefined;
    return {
      artist: latest.Artist ? titleCase(latest.Artist) : undefined,
      track: titleCase(latest.Title),
      raw: `${latest.Artist ?? ''} - ${latest.Title ?? ''}`.trim(),
      coverUrl: cover,
    };
  } catch {
    return null;
  }
};

interface OrfImage {
  versions?: Array<{ path: string; width: number }>;
}
interface OrfBroadcast {
  start: number;
  end: number;
  href: string;
  title?: string;
  subtitle?: string;
  program?: string;
  programKey?: string;
}
interface OrfItem {
  type?: string;
  start?: number;
  duration?: number;
  title?: string;
  interpreter?: string;
  images?: OrfImage[];
}

function bestImage(images: OrfImage[] | undefined): string | undefined {
  if (!images || images.length === 0) return undefined;
  const versions = images[0].versions ?? [];
  let best: { path: string; width: number } | undefined;
  for (const v of versions) {
    if (!best || v.width > best.width) best = v;
  }
  return best?.path;
}

/** ORF audioapi: takes /<station>/api/json/4.0/live, finds the current
 *  broadcast (now ∈ [start,end]), drills into its detail, then finds the
 *  current item. Music items (type "M") get artist+title+cover. */
const fetchOrfMetadata: MetadataFetcher = async (station, signal) => {
  const liveUrl = station.metadataUrl;
  if (!liveUrl) return null;
  try {
    const liveRes = await fetch(liveUrl, { signal, cache: 'no-store' });
    if (!liveRes.ok) return null;
    const live = (await liveRes.json()) as OrfBroadcast[];
    const now = Date.now();
    const current = live.find((b) => b.start <= now && now < b.end);
    if (!current) return null;

    const bcRes = await fetch(current.href, { signal, cache: 'no-store' });
    if (!bcRes.ok) return null;
    const bc = (await bcRes.json()) as { items?: OrfItem[] };
    const items = bc.items ?? [];
    const item = items.find((it) => {
      const start = it.start ?? 0;
      const dur = it.duration ?? 0;
      return start <= now && now < start + dur;
    });

    const program = current.title
      ? { name: current.title.trim(), subtitle: stripHtml(current.subtitle) }
      : undefined;

    // Music item — full track + program. For news/talk (type !== "M")
    // we still surface the program info so the user knows which show
    // is on, even when there's no track to display.
    if (!item || item.type !== 'M' || !item.title) {
      return program ? { track: undefined, raw: '', program } : null;
    }

    return {
      artist: item.interpreter,
      track: item.title,
      raw: `${item.interpreter ?? ''} - ${item.title}`.trim(),
      coverUrl: bestImage(item.images),
      program,
    };
  } catch {
    return null;
  }
};

/** Strip HTML tags + collapse whitespace. ORF's broadcast subtitles
 *  arrive as fragments like "<p>Some description.</p>"; we just want
 *  the visible text. */
function stripHtml(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const text = input.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return text || undefined;
}

interface BrTrack {
  interpret?: string;
  title?: string;
  startTime?: string;
  endTime?: string;
}
interface BrBroadcast {
  headline?: string;
  subTitle?: string;
  startTime?: string;
  endTime?: string;
  broadcastSeriesName?: string;
}
interface BrPlayer {
  tracks?: BrTrack[];
  broadcasts?: BrBroadcast[];
}

/** BR radioplayer.json: Bavarian-radio "now playing" feed used by br.de.
 *  Returns a `tracks[]` list with ISO-format start/end timestamps. We pick
 *  whichever entry currently brackets `Date.now()`; if none do (between
 *  songs / news segment), return null. Routed through the worker proxy
 *  because br.de itself returns no Access-Control-Allow-Origin headers
 *  (worker allowlist covers `^https://www\.br\.de/`). The body starts
 *  with `//@formatter:off` so JSON.parse needs the loose helper. */
const fetchBrMetadata: MetadataFetcher = async (station, signal) => {
  const url = station.metadataUrl;
  if (!url) return null;
  try {
    const proxied = `${PROXY}?url=${encodeURIComponent(`${url}?_=${Date.now()}`)}`;
    const res = await fetch(proxied, { signal, cache: 'no-store' });
    if (!res.ok) return null;
    const text = await res.text();
    const data = parseLooseJSON(text) as BrPlayer;
    const tracks = data.tracks ?? [];
    const broadcasts = data.broadcasts ?? [];
    const now = Date.now();
    const currentTrack = tracks.find((t) => {
      const start = t.startTime ? Date.parse(t.startTime) : 0;
      const end = t.endTime ? Date.parse(t.endTime) : 0;
      return start <= now && now < end;
    });
    const pick = currentTrack ?? tracks[0];

    const currentBc = broadcasts.find((b) => {
      const start = b.startTime ? Date.parse(b.startTime) : 0;
      const end = b.endTime ? Date.parse(b.endTime) : 0;
      return start <= now && now < end;
    });
    const program = currentBc?.headline
      ? { name: currentBc.headline.trim(), subtitle: currentBc.subTitle?.trim() || undefined }
      : undefined;

    if (!pick?.title) return program ? { track: undefined, raw: '', program } : null;
    return {
      artist: pick.interpret ? titleCase(pick.interpret) : undefined,
      track: titleCase(pick.title),
      raw: `${pick.interpret ?? ''} - ${pick.title}`.trim(),
      program,
    };
  } catch {
    return null;
  }
};

// ============================================================
// Schedule fetchers — return multi-day program data
// ============================================================

interface OrfScheduleDay {
  date?: number;
  broadcasts?: OrfBroadcast[];
}

/** Strip an ORF subtitle's HTML wrapper (`<p>...</p>`) to plain text. */
function plainSubtitle(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const text = s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return text || undefined;
}

/** ORF: derive the channel slug from the live URL so the schedule
 *  endpoint stays in sync. live URL e.g. `audioapi.orf.at/fm4/api/...`
 *  → schedule URL `audioapi.orf.at/fm4/api/json/4.0/broadcasts`. */
function orfScheduleUrl(station: Station): string | null {
  const meta = station.metadataUrl;
  if (!meta) return null;
  const m = meta.match(/^(https?:\/\/audioapi\.orf\.at\/[^/]+\/api\/json\/4\.0)\//i);
  if (!m) return null;
  return `${m[1]}/broadcasts`;
}

const fetchOrfSchedule: ScheduleFetcher = async (station, signal) => {
  const url = orfScheduleUrl(station);
  if (!url) return null;
  try {
    const res = await fetch(url, { signal, cache: 'no-store' });
    if (!res.ok) return null;
    const days = (await res.json()) as OrfScheduleDay[];
    if (!Array.isArray(days)) return null;
    const out: ScheduleDay[] = [];
    for (const day of days) {
      if (!day.broadcasts || !day.date) continue;
      const bcs = day.broadcasts.map((b) => ({
        start: b.start,
        end: b.end,
        title: (b.title ?? '').trim() || 'Untitled',
        subtitle: plainSubtitle(b.subtitle),
      }));
      if (bcs.length > 0) out.push({ date: day.date, broadcasts: bcs });
    }
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
};

/** BR: the existing radioplayer.json carries a `broadcasts[]` slice for
 *  the current day. Single-day schedule, no archive. Same worker-proxy
 *  routing as fetchBrMetadata — direct fetches are blocked by missing
 *  Access-Control-Allow-Origin on br.de. */
const fetchBrSchedule: ScheduleFetcher = async (station, signal) => {
  const url = station.metadataUrl;
  if (!url) return null;
  try {
    const proxied = `${PROXY}?url=${encodeURIComponent(`${url}?_=${Date.now()}`)}`;
    const res = await fetch(proxied, { signal, cache: 'no-store' });
    if (!res.ok) return null;
    const text = await res.text();
    const data = parseLooseJSON(text) as BrPlayer;
    const broadcasts = data.broadcasts ?? [];
    if (broadcasts.length === 0) return null;
    const bcs: ScheduleBroadcast[] = broadcasts
      .filter((b) => b.startTime && b.endTime && b.headline)
      .map((b) => ({
        start: Date.parse(b.startTime!),
        end: Date.parse(b.endTime!),
        title: (b.headline ?? '').trim(),
        subtitle: b.subTitle?.trim() || undefined,
      }))
      .sort((a, b) => a.start - b.start);
    if (bcs.length === 0) return null;
    // BR's broadcasts are mostly today; group anything else under its
    // own day boundary at midnight UTC for display purposes.
    const dayBoundary = (ts: number): number => {
      const d = new Date(ts);
      d.setUTCHours(0, 0, 0, 0);
      return d.getTime();
    };
    const byDay = new Map<number, ScheduleBroadcast[]>();
    for (const b of bcs) {
      const k = dayBoundary(b.start);
      const arr = byDay.get(k) ?? [];
      arr.push(b);
      byDay.set(k, arr);
    }
    const out: ScheduleDay[] = [...byDay.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([date, broadcasts]) => ({ date, broadcasts }));
    return out;
  } catch {
    return null;
  }
};

// ============================================================
// HR fetchers (via the worker generic proxy — HR pages return
// useful radioplayer.json but lack CORS). metadataUrl on each HR
// station is the full URL of its radioplayer.json.
// ============================================================

interface HrBroadcast {
  startTS?: number;
  endTS?: number;
  title?: string;
  hosts?: { name?: string };
  currentBroadcast?: boolean;
}

async function fetchHrJson(url: string, signal: AbortSignal): Promise<HrBroadcast[] | null> {
  try {
    const proxied = `${PROXY}?url=${encodeURIComponent(url)}`;
    const res = await fetch(proxied, { signal, cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as HrBroadcast[];
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

const fetchHrMetadata: MetadataFetcher = async (station, signal) => {
  const url = station.metadataUrl;
  if (!url) return null;
  // Run HR program fetch + ICY in parallel; HR's radioplayer.json
  // doesn't carry track titles, so we keep ICY for that and use HR
  // only for the program (current show + host).
  const [hrData, icyResult] = await Promise.all([
    fetchHrJson(url, signal),
    icyFetcher(station, signal).catch(() => null),
  ]);
  let program: { name: string; subtitle?: string } | undefined;
  if (hrData) {
    const now = Date.now();
    const current =
      hrData.find((b) => b.currentBroadcast) ??
      hrData.find((b) => (b.startTS ?? 0) <= now && now < (b.endTS ?? 0));
    if (current?.title) {
      program = {
        name: current.title.trim(),
        subtitle: current.hosts?.name?.trim() || undefined,
      };
    }
  }
  if (icyResult) return { ...icyResult, program };
  return program ? { track: undefined, raw: '', program } : null;
};

const fetchHrSchedule: ScheduleFetcher = async (station, signal) => {
  const url = station.metadataUrl;
  if (!url) return null;
  const data = await fetchHrJson(url, signal);
  if (!data || data.length === 0) return null;
  const broadcasts: ScheduleBroadcast[] = data
    .filter((b) => b.startTS && b.endTS && b.title)
    .map((b) => ({
      start: b.startTS!,
      end: b.endTS!,
      title: b.title!.trim(),
      subtitle: b.hosts?.name?.trim() || undefined,
    }))
    .sort((a, b) => a.start - b.start);
  if (broadcasts.length === 0) return null;
  // HR returns a single rolling day's worth of broadcasts. Group by
  // local-midnight boundary (handles broadcasts that cross days).
  const dayBoundary = (ts: number): number => {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const byDay = new Map<number, ScheduleBroadcast[]>();
  for (const b of broadcasts) {
    const k = dayBoundary(b.start);
    const arr = byDay.get(k) ?? [];
    arr.push(b);
    byDay.set(k, arr);
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([date, broadcasts]) => ({ date, broadcasts }));
};

// ============================================================
// ČRo (Český rozhlas) — api.rozhlas.cz/data/v2/, CORS=*, no auth.
// metadataUrl on each station = the /playlist/now/<slug>.json URL;
// the schedule URL is derived from it.
// ============================================================

interface CroNowEnvelope {
  data?: {
    status?: string; // "playing" | "quiet"
    interpret?: string;
    track?: string;
    since?: string;
    files?: Array<{ asset?: string }>;
  };
}
interface CroScheduleItem {
  title?: string;
  description?: string;
  since?: string;
  till?: string;
  persons?: Array<{ name?: string }>;
}

function croScheduleUrl(now: string): string {
  return now.replace('/playlist/now/', '/schedule/day/');
}

const fetchCroMetadata: MetadataFetcher = async (station, signal) => {
  const url = station.metadataUrl;
  if (!url) return null;
  try {
    const cb = `?_=${Date.now()}`;
    const [nowRes, schRes] = await Promise.all([
      fetch(`${url}${cb}`, { signal, cache: 'no-store' }).catch(() => null),
      fetch(`${croScheduleUrl(url)}${cb}`, { signal, cache: 'no-store' }).catch(() => null),
    ]);

    // /now/.data.status is the canonical "is a track playing right
    // now" signal. We deliberately do NOT fall back to /day/'s last
    // item — for talk-heavy channels (Radiožurnál, Plus) showing a
    // music interlude from 20 min ago as "now playing" is misleading.
    let artist: string | undefined;
    let track: string | undefined;
    let cover: string | undefined;
    if (nowRes?.ok) {
      const d = (await nowRes.json()) as CroNowEnvelope;
      const data = d.data;
      if (data?.status === 'playing' && data.track) {
        artist = data.interpret ? titleCase(data.interpret) : undefined;
        track = titleCase(data.track);
        cover = data.files?.[0]?.asset;
      }
    }

    let program: { name: string; subtitle?: string } | undefined;
    if (schRes?.ok) {
      const d = (await schRes.json()) as { data?: CroScheduleItem[] };
      const items = d.data ?? [];
      const now = Date.now();
      const current = items.find((i) => {
        const since = i.since ? Date.parse(i.since) : 0;
        const till = i.till ? Date.parse(i.till) : 0;
        return since <= now && now < till;
      });
      if (current?.title) {
        program = {
          name: current.title.trim(),
          subtitle: current.persons?.[0]?.name?.trim() || undefined,
        };
      }
    }

    if (track) {
      return {
        artist,
        track,
        raw: `${artist ?? ''} - ${track}`.trim(),
        coverUrl: cover,
        program,
      };
    }
    return program ? { track: undefined, raw: '', program } : null;
  } catch {
    return null;
  }
};

const fetchCroSchedule: ScheduleFetcher = async (station, signal) => {
  const now = station.metadataUrl;
  if (!now) return null;
  try {
    const res = await fetch(croScheduleUrl(now), { signal, cache: 'no-store' });
    if (!res.ok) return null;
    const d = (await res.json()) as { data?: CroScheduleItem[] };
    const items = d.data ?? [];
    const broadcasts: ScheduleBroadcast[] = items
      .filter((i) => i.since && i.till && i.title)
      .map((i) => ({
        start: Date.parse(i.since!),
        end: Date.parse(i.till!),
        title: i.title!.trim(),
        subtitle: i.persons?.[0]?.name?.trim() || undefined,
      }))
      .sort((a, b) => a.start - b.start);
    if (broadcasts.length === 0) return null;
    const dayBoundary = (ts: number): number => {
      const d = new Date(ts);
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    };
    const byDay = new Map<number, ScheduleBroadcast[]>();
    for (const b of broadcasts) {
      const k = dayBoundary(b.start);
      const arr = byDay.get(k) ?? [];
      arr.push(b);
      byDay.set(k, arr);
    }
    return [...byDay.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([date, broadcasts]) => ({ date, broadcasts }));
  } catch {
    return null;
  }
};

// ============================================================
// MR (Magyar Rádió) — mediaklikk.hu, XML, CORS=*, no auth.
// metadataUrl = /iface/radio_now/now_<id>.xml. Only Dankó (id=9)
// has track-level data; the others 404 on /now/ and rely on the
// schedule for program info. Schedule URL is derived from id.
// ============================================================

function mrIdFromMetadataUrl(url: string): string | null {
  const m = url.match(/\/now_(\d+)\.xml/);
  return m ? m[1] : null;
}

/** Last Sunday of `month` (0-indexed) at 00:00 UTC. */
function lastSundayUtc(year: number, month: number): number {
  const last = new Date(Date.UTC(year, month + 1, 0));
  return Date.UTC(year, month, last.getUTCDate() - last.getUTCDay());
}

/** Parse "YYYY-MM-DD HH:MM:SS" as Europe/Budapest local time → UTC ms.
 *  Hungary follows EU CET/CEST (last Sun of Mar/Oct at 01:00 UTC). */
function parseHuLocal(s: string): number {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return NaN;
  const [, y, mo, d, h, mn, sec] = m;
  const yi = +y;
  const dstStart = lastSundayUtc(yi, 2) + 3600 * 1000;  // last Sun March 01:00Z
  const dstEnd = lastSundayUtc(yi, 9) + 3600 * 1000;    // last Sun Oct 01:00Z
  const naive = Date.UTC(+y, +mo - 1, +d, +h, +mn, +sec);
  const inDst = naive - 2 * 3600 * 1000 >= dstStart && naive - 2 * 3600 * 1000 < dstEnd;
  return naive - (inDst ? 2 : 1) * 3600 * 1000;
}

function mrBroadcastUrl(id: string, date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `https://mediaklikk.hu/iface/broadcast/${y}-${m}-${d}/broadcast_${id}.xml`;
}

function parseMrBroadcastXml(xml: string): ScheduleBroadcast[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const items = Array.from(doc.querySelectorAll('Item'));
  const out: ScheduleBroadcast[] = [];
  for (const it of items) {
    const begin = it.querySelector('BeginDate')?.textContent;
    const end = it.querySelector('EndDate')?.textContent;
    const title = it.querySelector('Title')?.textContent?.trim();
    const series = it.querySelector('SeriesTitle')?.textContent?.trim();
    if (!begin || !end || !title) continue;
    const start = parseHuLocal(begin);
    const stop = parseHuLocal(end);
    if (!Number.isFinite(start) || !Number.isFinite(stop)) continue;
    out.push({
      start,
      end: stop,
      title,
      subtitle: series && series !== title ? series : undefined,
    });
  }
  return out.sort((a, b) => a.start - b.start);
}

const fetchMrMetadata: MetadataFetcher = async (station, signal) => {
  const url = station.metadataUrl;
  if (!url) return null;
  const id = mrIdFromMetadataUrl(url);
  if (!id) return null;
  try {
    const cb = `?_=${Date.now()}`;
    const schUrl = mrBroadcastUrl(id, new Date());
    const [nowRes, schRes] = await Promise.all([
      fetch(`${url}${cb}`, { signal, cache: 'no-store' }).catch(() => null),
      fetch(schUrl, { signal, cache: 'no-store' }).catch(() => null),
    ]);

    let artist: string | undefined;
    let track: string | undefined;
    if (nowRes?.ok) {
      const xml = await nowRes.text();
      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      const name = doc.querySelector('Item Name')?.textContent?.trim();
      if (name) {
        const parts = name.split(' - ');
        if (parts.length >= 2) {
          artist = titleCase(parts[0]);
          track = titleCase(parts.slice(1).join(' - '));
        } else {
          track = titleCase(name);
        }
      }
    }

    let program: { name: string; subtitle?: string } | undefined;
    if (schRes?.ok) {
      const xml = await schRes.text();
      const items = parseMrBroadcastXml(xml);
      const now = Date.now();
      const current = items.find((b) => b.start <= now && now < b.end);
      if (current) {
        program = { name: current.title, subtitle: current.subtitle };
      }
    }

    if (track) {
      return { artist, track, raw: `${artist ?? ''} - ${track}`.trim(), program };
    }
    return program ? { track: undefined, raw: '', program } : null;
  } catch {
    return null;
  }
};

const fetchMrSchedule: ScheduleFetcher = async (station, signal) => {
  const url = station.metadataUrl;
  if (!url) return null;
  const id = mrIdFromMetadataUrl(url);
  if (!id) return null;
  try {
    const today = new Date();
    const days: Date[] = [];
    for (let i = 0; i < 2; i++) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
      days.push(d);
    }
    const responses = await Promise.all(
      days.map((d) => fetch(mrBroadcastUrl(id, d), { signal, cache: 'no-store' }).catch(() => null)),
    );
    const out: ScheduleDay[] = [];
    for (let i = 0; i < days.length; i++) {
      const res = responses[i];
      if (!res?.ok) continue;
      const xml = await res.text();
      const broadcasts = parseMrBroadcastXml(xml);
      if (broadcasts.length === 0) continue;
      const midnight = new Date(days[i]);
      midnight.setHours(0, 0, 0, 0);
      out.push({ date: midnight.getTime(), broadcasts });
    }
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
};

// ============================================================
// SRR (Radio România) — single endpoint, all stations keyed by id.
// metadataUrl = "<live.php URL>#<id>". Program-only — no track field.
// ============================================================

interface SrrLiveResponse {
  stations?: Record<string, { title?: string; schedule?: string }>;
}

const fetchSrrMetadata: MetadataFetcher = async (station, signal) => {
  const meta = station.metadataUrl;
  if (!meta) return null;
  const [base, id] = meta.split('#');
  if (!id) return null;
  try {
    const res = await fetch(`${base}?_=${Date.now()}`, { signal, cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as SrrLiveResponse;
    const slot = data.stations?.[id];
    if (!slot?.title) return null;
    return {
      track: undefined,
      raw: '',
      program: {
        name: slot.title.trim(),
        subtitle: slot.schedule?.trim() || undefined,
      },
    };
  } catch {
    return null;
  }
};

// ============================================================
// SRG SSR fetchers (Swiss public broadcaster)
// SRF (German) — per-channel JSON lastPlayedList, all-caps text.
// RSI (Italian) — one shared nowAndNext endpoint covers all 3 channels;
//   programme-level only (no per-track titles in this feed).
// RTS (French) is intentionally not here — its endpoint is HTML and
//   blocks CORS, so it goes through the worker proxy in a separate fetcher.
// ============================================================

interface SrfLastPlayedItem {
  title?: string;
  description?: string;
  type?: string;
  timestamp?: string;
}
interface SrfLastPlayedResponse {
  lastPlayedList?: SrfLastPlayedItem[];
}

const fetchSrfMetadata: MetadataFetcher = async (station, signal) => {
  const url = station.metadataUrl;
  if (!url) return null;
  try {
    const res = await fetch(url, { signal, cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as SrfLastPlayedResponse;
    const first = data.lastPlayedList?.[0];
    if (!first || first.type !== 'song' || !first.title) return null;
    // SRF stores artist in `description`, track in `title`. Both arrive
    // mostly upper-cased; strip the trailing "(CH)" country tag and
    // titleCase so it sits naturally with the rest of the UI.
    const artistRaw = (first.description ?? '').replace(/\s*\([A-Z]{2}\)\s*$/i, '').trim();
    const titleRaw = first.title.trim();
    return {
      artist: artistRaw ? titleCase(artistRaw) : undefined,
      track: titleCase(titleRaw),
      raw: `${artistRaw} - ${titleRaw}`.trim(),
    };
  } catch {
    return null;
  }
};

interface RsiProgrammeContent {
  title?: string;
  shortDescription?: string;
}
interface RsiProgramme {
  content?: RsiProgrammeContent;
}
interface RsiNowAndNextChannel {
  program?: RsiProgramme[];
}
type RsiNowAndNext = Record<string, RsiNowAndNextChannel | undefined>;

interface AzuracastSong {
  artist?: string;
  title?: string;
  text?: string;
  art?: string;
}
interface AzuracastNowPlaying {
  song?: AzuracastSong;
}
interface AzuracastResponse {
  now_playing?: AzuracastNowPlaying;
  is_online?: boolean;
}

/** AzuraCast — open-source radio automation used by many small / community
 *  stations. Endpoint shape: `<host>/api/nowplaying/<shortcode>` returns a
 *  JSON envelope with `now_playing.song.{artist,title,art}`. CORS is open
 *  on properly-configured deployments. The "Station Offline" sentinel
 *  (text=Station Offline, empty artist) means the station is off-air —
 *  return null so the UI doesn't display it as a track title. */
const fetchAzuracastMetadata: MetadataFetcher = async (station, signal) => {
  const url = station.metadataUrl;
  if (!url) return null;
  try {
    const res = await fetch(url, { signal, cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as AzuracastResponse;
    if (data.is_online === false) return null;
    const song = data.now_playing?.song;
    const artist = song?.artist?.trim();
    const title = song?.title?.trim();
    if (!title || /^station offline$/i.test(title)) return null;
    return {
      artist: artist || undefined,
      track: title,
      raw: `${artist ?? ''} - ${title}`.trim(),
      coverUrl: song?.art && !/generic_song/i.test(song.art) ? song.art : undefined,
    };
  } catch {
    return null;
  }
};

interface SrgssrIlSong {
  isPlayingNow?: boolean;
  date?: string;
  title?: string;
  artist?: { name?: string };
}
interface SrgssrIlSongList {
  songList?: SrgssrIlSong[];
}

/** SRG SSR Integration Layer — track-level now-playing for any radio
 *  channel in the network. Stations declare metadataUrl as the
 *  channel-specific URL (without the from/to query); we append a window
 *  around `now` so the response includes 1–3 entries with one tagged
 *  isPlayingNow=true. CORS-callable directly (no proxy). Currently
 *  used for RTR; SRF/RSI/RTS could be migrated here too — a single
 *  fetcher for the whole SRG SSR network. */
const fetchSrgssrIlMetadata: MetadataFetcher = async (station, signal) => {
  const baseUrl = station.metadataUrl;
  if (!baseUrl) return null;
  try {
    const now = Date.now();
    const from = new Date(now - 3 * 60 * 60 * 1000).toISOString();
    const to = new Date(now + 60 * 60 * 1000).toISOString();
    const sep = baseUrl.includes('?') ? '&' : '?';
    const url = `${baseUrl}${sep}from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&pageSize=3`;
    const res = await fetch(url, { signal, cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as SrgssrIlSongList;
    const songs = data.songList ?? [];
    const playing = songs.find((s) => s.isPlayingNow) ?? songs[0];
    if (!playing?.title) return null;
    const artistRaw = (playing.artist?.name ?? '').replace(/\s*\([A-Z]{2}\)\s*$/i, '').trim();
    const titleRaw = playing.title.trim();
    return {
      artist: artistRaw ? titleCase(artistRaw) : undefined,
      track: titleCase(titleRaw),
      raw: `${artistRaw} - ${titleRaw}`.trim(),
    };
  } catch {
    return null;
  }
};

interface RadioSwissPlayingMeta {
  artist?: string;
  title?: string;
  album?: string;
  coverId?: string;
  swiss?: string;
}
interface RadioSwissPlaying {
  metadata?: RadioSwissPlayingMeta;
}
interface RadioSwissChannel {
  playingnow?: { current?: RadioSwissPlaying };
}
interface RadioSwissResponse {
  channel?: RadioSwissChannel;
}

/** Radio Swiss Pop / Jazz / Classic — sister brand of SRG SSR running
 *  on api.radioswiss{pop,jazz,classic}.ch. Endpoint shape:
 *    /api/v1/<short>/<locale>/playlist_small  (small = current + a few)
 *  No CORS, so we proxy through the worker (allowlist in worker/src/index.ts).
 *  Cover-art URLs are coverId on a fixed Azure Edge CDN; only /50/ size
 *  responds 200, larger sizes 404. */
const fetchRadioSwissMetadata: MetadataFetcher = async (station, signal) => {
  const url = station.metadataUrl;
  if (!url) return null;
  try {
    const proxied = `${PROXY}?url=${encodeURIComponent(url)}`;
    const res = await fetch(proxied, { signal, cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as RadioSwissResponse;
    const meta = data.channel?.playingnow?.current?.metadata;
    if (!meta?.title) return null;
    const cover = meta.coverId
      ? `https://cdne-satr-prd-rsp-covers.azureedge.net/50/${meta.coverId}.jpg`
      : undefined;
    const artist = meta.artist?.trim();
    const title = meta.title.trim();
    return {
      artist: artist || undefined,
      track: title,
      raw: `${artist ?? ''} - ${title}`.trim(),
      coverUrl: cover,
    };
  } catch {
    return null;
  }
};

/** RTS: hummingbird.rts.ch returns an HTML fragment per channel slug
 *  (LA_1ERE, ESPACE_2, COULEUR_3, OPTION_MUSIQUE). The interesting bit
 *  is one attribute — `data-item-title="<station> - <show>"`. CORS is
 *  not exposed for our origin, so we route through the worker proxy
 *  (allowlist covers the hummingbird channel-update path). Programme-
 *  level only, like RSI. */
const fetchRtsMetadata: MetadataFetcher = async (station, signal) => {
  const url = station.metadataUrl;
  if (!url) return null;
  try {
    const proxied = `${PROXY}?url=${encodeURIComponent(url)}`;
    const res = await fetch(proxied, { signal, cache: 'no-store' });
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/data-item-title="([^"]+)"/);
    if (!m) return null;
    const decoded = m[1]
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
    // Format: "<station name> - <show name>". Take everything after the
    // first " - " separator as the show.
    const dash = decoded.indexOf(' - ');
    const show = (dash > 0 ? decoded.slice(dash + 3) : decoded).trim();
    if (!show) return null;
    return {
      track: undefined,
      raw: '',
      program: { name: show },
    };
  } catch {
    return null;
  }
};

/** RSI: shared `nowAndNext` endpoint returns every channel in one call.
 *  metadataUrl encodes the channel as a URL fragment (`#reteuno`); same
 *  pattern as fetchSrrMetadata. Talk- and music-format radio mixed —
 *  this feed surfaces the current programme/show, not individual tracks. */
const fetchRsiMetadata: MetadataFetcher = async (station, signal) => {
  const meta = station.metadataUrl;
  if (!meta) return null;
  const [base, channel] = meta.split('#');
  if (!channel) return null;
  try {
    const res = await fetch(base, { signal, cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as RsiNowAndNext;
    const progs = data[channel.toLowerCase()]?.program ?? [];
    const cur = progs[0];
    const title = cur?.content?.title?.trim();
    if (!title) return null;
    return {
      track: undefined,
      raw: '',
      program: {
        name: title,
        subtitle: cur.content?.shortDescription?.trim() || undefined,
      },
    };
  } catch {
    return null;
  }
};

// ============================================================
// BBC fetchers (via our worker — rms.api.bbc.co.uk requires
// Origin: https://www.bbc.co.uk and 403s otherwise)
// ============================================================

const BBC_PROXY = 'https://rrradio-stats.markussteinbrecher.workers.dev/api/public/bbc';

interface BbcModule {
  id?: string;
  title?: string;
  data?: BbcBroadcast[];
}
interface BbcBroadcast {
  start?: string;
  end?: string;
  titles?: { primary?: string; secondary?: string; tertiary?: string };
}
interface BbcEnvelope {
  data?: BbcModule[];
}

/** Service slug from station.metadataUrl. We store the slug there
 *  (e.g. "bbc_world_service") rather than a full URL — wire-metadata
 *  derives it once. */
function bbcService(station: Station): string | null {
  const url = station.metadataUrl;
  if (!url) return null;
  // Accept either a bare slug or a full proxy URL.
  const m = url.match(/([a-z0-9_]+)$/i);
  return m ? m[1] : null;
}

const fetchBbcMetadata: MetadataFetcher = async (station, signal) => {
  const service = bbcService(station);
  if (!service) return null;
  try {
    const res = await fetch(`${BBC_PROXY}/play/${service}`, { signal, cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as BbcEnvelope;
    const live = data.data?.find((m) => m.id === 'live_play_area');
    const item = live?.data?.[0];
    if (!item) return null;
    const program = item.titles?.primary
      ? { name: item.titles.primary.trim(), subtitle: item.titles.secondary?.trim() || undefined }
      : undefined;
    // BBC services here are news/talk. No track field — surface the
    // program so the user sees something on Now Playing.
    return program ? { track: undefined, raw: '', program } : null;
  } catch {
    return null;
  }
};

const fetchBbcSchedule: ScheduleFetcher = async (station, signal) => {
  const service = bbcService(station);
  if (!service) return null;
  try {
    const res = await fetch(`${BBC_PROXY}/schedule/${service}`, { signal, cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as BbcEnvelope;
    const modules = data.data ?? [];
    const out: ScheduleDay[] = [];
    for (const mod of modules) {
      const items = mod.data ?? [];
      if (items.length === 0) continue;
      const broadcasts: ScheduleBroadcast[] = items
        .filter((b) => b.start && b.end && b.titles?.primary)
        .map((b) => ({
          start: Date.parse(b.start!),
          end: Date.parse(b.end!),
          title: b.titles!.primary!.trim(),
          subtitle: b.titles?.secondary?.trim() || undefined,
        }));
      if (broadcasts.length === 0) continue;
      // BBC modules title is the day in YYYY-MM-DD; convert to local
      // midnight ms for the dayLabel logic.
      const date = (() => {
        if (mod.title && /^\d{4}-\d{2}-\d{2}$/.test(mod.title)) {
          return new Date(`${mod.title}T00:00:00`).getTime();
        }
        const first = new Date(broadcasts[0].start);
        first.setHours(0, 0, 0, 0);
        return first.getTime();
      })();
      out.push({ date, broadcasts });
    }
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
};

// ============================================================
// German broadcaster fetchers (ARD members + DLF + commercial)
// All five below are CORS-open (directly callable, no proxy). The
// remaining ARD members (WDR / NDR / DLF main+Kultur) have no public
// JSON endpoint — they fall back to ICY-over-fetch.
// ============================================================

interface SwrPlaylistItem {
  artist?: string;
  title?: string;
  starttime?: number;
  duration?: number;
  cover?: string;
}
interface SwrPresenter {
  displayname?: string;
}
interface SwrShowData {
  title?: string;
  starttime?: number;
  endtime?: number;
  presenter?: SwrPresenter[];
}
interface SwrResponse {
  playlist?: { data?: SwrPlaylistItem[] };
  show?: { data?: SwrShowData };
}

/** SWR — playerbar JSON at `swr.de/~webradio/.../<channel>-playerbar-100~playerbarContainer.json`.
 *  Richest of the German public-broadcaster APIs: per-track artist + title +
 *  cover, plus the current show with presenter. CORS open, callable directly. */
const fetchSwrMetadata: MetadataFetcher = async (station, signal) => {
  const url = station.metadataUrl;
  if (!url) return null;
  try {
    const res = await fetch(url, { signal, cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as SwrResponse;
    const items = data.playlist?.data ?? [];
    const current = items[0];
    const show = data.show?.data;
    const presenter = show?.presenter?.[0]?.displayname?.trim();
    const program = show?.title
      ? {
          name: show.title.trim(),
          subtitle: presenter || undefined,
        }
      : undefined;
    if (!current?.title) return program ? { track: undefined, raw: '', program } : null;
    const artist = current.artist?.trim();
    const track = current.title.trim();
    return {
      artist: artist ? titleCase(artist) : undefined,
      track: titleCase(track),
      raw: `${artist ?? ''} - ${track}`.trim(),
      coverUrl: current.cover || undefined,
      program,
    };
  } catch {
    return null;
  }
};

interface StreamabcExtdata {
  album?: string;
  dirigent?: string;
  ensemble?: string;
  solist?: string;
}
interface StreamabcResponse {
  artist?: string;
  song?: string;
  cover?: string;
  album?: string;
  extdata?: StreamabcExtdata;
}

/** Streamabc — `api.streamabc.net/metadata/channel/<channelkey>.json`. Used
 *  by Klassik Radio (channelkey "klassikr-live") and other broadcasters on
 *  the same metadata-as-a-service platform. The classical channels expose
 *  conductor / ensemble / soloist via extdata; we fold those into the
 *  program subtitle so they surface without needing new ParsedTitle fields. */
const fetchStreamabcMetadata: MetadataFetcher = async (station, signal) => {
  const url = station.metadataUrl;
  if (!url) return null;
  try {
    const res = await fetch(url, { signal, cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as StreamabcResponse;
    if (!data.song) return null;
    const artist = data.artist?.trim();
    const track = data.song.trim();
    const ext = data.extdata ?? {};
    const ensembleParts = [ext.ensemble, ext.dirigent, ext.solist]
      .map((p) => p?.trim())
      .filter((p): p is string => !!p);
    const program = ensembleParts.length > 0
      ? { name: ext.album?.trim() || data.album?.trim() || track, subtitle: ensembleParts.join(' · ') }
      : undefined;
    return {
      artist: artist ? titleCase(artist) : undefined,
      track: titleCase(track),
      raw: `${artist ?? ''} - ${track}`.trim(),
      coverUrl: data.cover || undefined,
      program,
    };
  } catch {
    return null;
  }
};

interface FfhStation {
  isStatic?: boolean;
  title?: string;
  artist?: string;
  claim?: boolean;
}
type FfhResponse = Array<Record<string, FfhStation>>;

/** FFH family — single endpoint returns an array of single-key objects,
 *  one per channel (ffh, ffhplus80er, ffhplus90er, harmony.fm, planet
 *  radio, ...). Station picks its mountpoint via the `metadata` field
 *  in YAML; we look up that key. `claim: true` rows are station IDs
 *  (artist field carries the brand name) — skip them. */
const FFH_ENDPOINT =
  'https://www.ffh.de/update-onair-info?tx_ffhonair_pi2%5Baction%5D=getallsonginfo&tx_ffhonair_pi2%5Bcontroller%5D=Webradio&type=210&cHash=5a6b6b599e87ffbb02509dc06c14cbf7';

const fetchFfhMetadata: MetadataFetcher = async (station, signal) => {
  // metadataUrl carries the mountpoint key, not a URL — keeps the YAML
  // small. Falls back to "ffh" for the main brand.
  const mount = station.metadataUrl?.trim() || 'ffh';
  try {
    const res = await fetch(FFH_ENDPOINT, { signal, cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as FfhResponse;
    const entry = data.find((row) => mount in row)?.[mount];
    if (!entry || entry.claim) return null;
    const artist = entry.artist?.trim();
    const track = entry.title?.trim();
    if (!track) return null;
    return {
      artist: artist ? titleCase(artist) : undefined,
      track: titleCase(track),
      raw: `${artist ?? ''} - ${track}`.trim(),
    };
  } catch {
    return null;
  }
};

/** RBB Radio Eins — HTML fragment `<p class="artist">...</p><p class="songtitle">...</p>`
 *  served from `radioeins.de/include/rad/nowonair/now_on_air.html`. CORS open. */
const RADIO_EINS_RE = /<p\s+class="artist">([^<]*)<\/p>\s*<p\s+class="songtitle">([^<]*)<\/p>/i;
const fetchRadioEinsMetadata: MetadataFetcher = async (_station, signal) => {
  const url = `https://www.radioeins.de/include/rad/nowonair/now_on_air.html?_=${Date.now()}`;
  try {
    const res = await fetch(url, { signal, cache: 'no-store' });
    if (!res.ok) return null;
    const text = await res.text();
    const m = RADIO_EINS_RE.exec(text);
    if (!m) return null;
    const artist = m[1].trim();
    const track = m[2].trim();
    if (!track) return null;
    return {
      artist: artist || undefined,
      track,
      raw: `${artist} - ${track}`.trim(),
    };
  } catch {
    return null;
  }
};

// ============================================================
// Fetcher registry
// ============================================================

/** Code-side registry: station.metadata field → fetcher implementation. */
const FETCHERS_BY_KEY: Record<string, MetadataFetcher> = {
  grrif: fetchGrrifMetadata,
  orf: fetchOrfMetadata,
  'br-radioplayer': fetchBrMetadata,
  bbc: fetchBbcMetadata,
  hr: fetchHrMetadata,
  cro: fetchCroMetadata,
  mr: fetchMrMetadata,
  srr: fetchSrrMetadata,
  srf: fetchSrfMetadata,
  rsi: fetchRsiMetadata,
  rts: fetchRtsMetadata,
  'srgssr-il': fetchSrgssrIlMetadata,
  'swiss-radio': fetchRadioSwissMetadata,
  azuracast: fetchAzuracastMetadata,
  swr: fetchSwrMetadata,
  streamabc: fetchStreamabcMetadata,
  ffh: fetchFfhMetadata,
  'rbb-radioeins': fetchRadioEinsMetadata,
};

/** Schedule fetchers — keyed the same as MetadataFetchers. Optional —
 *  not every broadcaster has a queryable schedule API. */
const SCHEDULE_FETCHERS_BY_KEY: Record<string, ScheduleFetcher> = {
  orf: fetchOrfSchedule,
  'br-radioplayer': fetchBrSchedule,
  bbc: fetchBbcSchedule,
  hr: fetchHrSchedule,
  cro: fetchCroSchedule,
  mr: fetchMrSchedule,
};

/** URL-pattern fallback rules. Used when a Station object doesn't
 *  declare a `metadata` key but its stream URL matches a known pattern
 *  (e.g. random RB entries that happen to point at FM4 or BR). */
interface UrlPatternRule {
  match: (s: Station) => boolean;
  fetcher: MetadataFetcher;
  /** What to put in `station.metadataUrl` when wiring this fetcher
   *  for a station that didn't declare one (so the code fetcher knows
   *  where to call). */
  metadataUrl: string;
}
const URL_PATTERN_RULES: UrlPatternRule[] = [
  {
    match: (s) => /orf-live\.ors-shoutcast\.at\/fm4-/i.test(s.streamUrl),
    fetcher: fetchOrfMetadata,
    metadataUrl: 'https://audioapi.orf.at/fm4/api/json/4.0/live',
  },
];

export function findFetcher(
  station: Station,
): { fetcher: MetadataFetcher; station: Station } | undefined {
  if (station.metadata) {
    const f = FETCHERS_BY_KEY[station.metadata];
    if (f) return { fetcher: f, station };
  }
  for (const rule of URL_PATTERN_RULES) {
    if (rule.match(station)) {
      return { fetcher: rule.fetcher, station: { ...station, metadataUrl: rule.metadataUrl } };
    }
  }
  return undefined;
}

/** Schedule lookup — same key resolution as findFetcher. URL-pattern
 *  fallback applies too (so a non-curated FM4 entry still gets a
 *  schedule). Returns undefined when the station has no schedule API. */
export function findScheduleFetcher(
  station: Station,
): { fetcher: ScheduleFetcher; station: Station } | undefined {
  const key = station.metadata;
  if (key) {
    const f = SCHEDULE_FETCHERS_BY_KEY[key];
    if (f) return { fetcher: f, station };
  }
  for (const rule of URL_PATTERN_RULES) {
    if (rule.match(station)) {
      const ruleKey =
        rule.fetcher === fetchOrfMetadata ? 'orf' :
        rule.fetcher === fetchBrMetadata ? 'br-radioplayer' :
        null;
      const sf = ruleKey ? SCHEDULE_FETCHERS_BY_KEY[ruleKey] : null;
      if (sf) return { fetcher: sf, station: { ...station, metadataUrl: rule.metadataUrl } };
    }
  }
  return undefined;
}

// ============================================================
// JSON-driven station catalog
// ============================================================

/** Mutable export — populated by loadBuiltinStations on app boot.
 *  Other modules import this by reference and read its current value. */
export const BUILTIN_STATIONS: Station[] = [];

let loadPromise: Promise<Station[]> | null = null;

function resolveFavicon(path: string | undefined): string | undefined {
  if (!path) return undefined;
  if (/^https?:\/\//i.test(path)) return path;
  return BASE + path.replace(/^\/+/, '');
}

function normaliseStation(raw: unknown): Station | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<Station>;
  if (typeof r.id !== 'string' || typeof r.name !== 'string' || typeof r.streamUrl !== 'string') {
    return null;
  }
  return {
    id: r.id,
    name: r.name,
    streamUrl: r.streamUrl,
    homepage: r.homepage,
    country: r.country,
    tags: Array.isArray(r.tags) ? r.tags : undefined,
    favicon: resolveFavicon(r.favicon),
    bitrate: typeof r.bitrate === 'number' ? r.bitrate : undefined,
    codec: r.codec,
    listeners: typeof r.listeners === 'number' ? r.listeners : undefined,
    metadata: r.metadata,
    metadataUrl: r.metadataUrl,
    geo: Array.isArray(r.geo) && r.geo.length === 2 && r.geo.every((n) => typeof n === 'number')
      ? (r.geo as [number, number])
      : undefined,
    status: r.status === 'working' || r.status === 'icy-only' || r.status === 'stream-only'
      ? r.status
      : undefined,
  };
}

export function loadBuiltinStations(): Promise<Station[]> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const res = await fetch(`${BASE}stations.json`, { cache: 'no-store' });
      if (!res.ok) return [];
      const data = (await res.json()) as { stations?: unknown };
      const list = Array.isArray(data.stations)
        ? data.stations.map(normaliseStation).filter((s): s is Station => s !== null)
        : [];
      BUILTIN_STATIONS.length = 0;
      BUILTIN_STATIONS.push(...list);
      return list;
    } catch {
      return [];
    }
  })();
  return loadPromise;
}

const BUILTIN_IDS = new Set<string>();
loadBuiltinStations().then((list) => {
  for (const s of list) BUILTIN_IDS.add(s.id);
});

export function isBuiltin(id: string): boolean {
  return BUILTIN_IDS.has(id);
}
