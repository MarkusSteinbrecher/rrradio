import { titleCase } from './format';
import type { ParsedTitle } from './icyMetadata';

/** Pure request/parse helpers for the Swiss commercial groups (#631), kept
 *  out of src/builtins.ts so they unit-test without its fetch glue. */

// ── CH Media ────────────────────────────────────────────────────────────
// Each station site serves an Apollo persisted query "AudioLiveData" at
// <origin>/api/pub/gql/<skin>/AudioLiveData/<hash>?variables={streamName}.
// CORS reflects the request Origin. metadataUrl is "<skin>" (streamName
// defaults to "<skin>.main") or "<skin>#<streamName>" — the skin is the
// page's skinConfig.skin, the streamName the channel id from its player
// (e.g. "virginrock#virgin.rock"). If CH Media rotates the hash, update it.

export const CH_MEDIA_HASH = 'f17ccec05a8805563325a43a632e960a37892c72';

export function chMediaUrl(metadataUrl: string | undefined, homepage: string | undefined): string | null {
  const [skin, override] = (metadataUrl ?? '').trim().split('#');
  if (!skin || !/^[a-z0-9-]+$/i.test(skin)) return null;
  let origin = `https://www.${skin}.ch`;
  try {
    if (homepage) origin = new URL(homepage).origin.replace(/^http:/, 'https:');
  } catch {
    /* keep the skin-derived default */
  }
  const vars = encodeURIComponent(JSON.stringify({ streamName: override || `${skin}.main` }));
  return `${origin}/api/pub/gql/${skin}/AudioLiveData/${CH_MEDIA_HASH}?ttl=10&variables=${vars}`;
}

export interface ChMediaResponse {
  data?: {
    audioPlayer?: {
      stream?: { live?: { title?: string; interpret?: string; image?: { imageUrl?: string } } | null } | null;
      shows?: { current?: { title?: string; moderator?: { name?: string } } | null } | null;
    };
  };
}

/** Track text arrives ALL CAPS on most channels → titleCase. The current
 *  show (with moderator as subtitle) rides along, and alone between songs. */
export function parseChMedia(data: ChMediaResponse): ParsedTitle | null {
  const live = data.data?.audioPlayer?.stream?.live;
  const show = data.data?.audioPlayer?.shows?.current;
  const program = show?.title?.trim()
    ? { name: show.title.trim(), subtitle: show.moderator?.name?.trim() || undefined }
    : undefined;
  const track = live?.title?.trim();
  if (!track) return program ? { track: undefined, raw: '', program } : null;
  const artist = live?.interpret?.trim() || undefined;
  const cover = live?.image?.imageUrl;
  return {
    artist: artist ? titleCase(artist) : undefined,
    track: titleCase(track),
    raw: artist ? `${artist} - ${track}` : track,
    coverUrl: cover && /^https:\/\//i.test(cover) ? cover : undefined,
    program,
  };
}

// ── BNJ (RTN / RFJ / RJB) ───────────────────────────────────────────────
// bnj.blob.core.windows.net/mobile/ws/Live/Live<CODE>.json, CORS *.

export function bnjUrl(metadataUrl: string | undefined): string | null {
  const v = metadataUrl?.trim();
  if (!v || !/^[a-z]{2,5}$/i.test(v)) return null;
  return `https://bnj.blob.core.windows.net/mobile/ws/Live/Live${v.toUpperCase()}.json`;
}

export interface BnjLive {
  Title?: string;
  Artist?: string;
  Cover?: string;
  Programm?: string;
}

export function parseBnj(d: BnjLive): ParsedTitle | null {
  const track = d.Title?.trim();
  if (!track) return null;
  const artist = d.Artist?.trim() || undefined;
  const programName = d.Programm?.trim();
  return {
    artist: artist ? titleCase(artist) : undefined,
    track: titleCase(track),
    raw: artist ? `${artist} - ${track}` : track,
    coverUrl: d.Cover && /^https:\/\//i.test(d.Cover) ? d.Cover : undefined,
    program: programName ? { name: programName } : undefined,
  };
}

// ── Energy (Bern / Basel / Zürich) ──────────────────────────────────────
// energy.ch/api/channels/<slug>/playouts — newest first, no CORS, so it
// goes through the worker proxy. The list only grows on music, so an old
// head entry means talk/ads: treat anything past ENERGY_STALE_MS as stale.

export const ENERGY_STALE_MS = 12 * 60_000;

export function energyUrl(metadataUrl: string | undefined): string | null {
  const v = metadataUrl?.trim();
  if (!v || !/^[a-z0-9-]+$/i.test(v)) return null;
  return `https://energy.ch/api/channels/${v.toLowerCase()}/playouts`;
}

export interface EnergyPlayout {
  playFrom?: string;
  title?: string;
  artist?: string;
  imageUrl?: string;
}

export function parseEnergy(list: EnergyPlayout[] | unknown, now = Date.now()): ParsedTitle | null {
  if (!Array.isArray(list)) return null;
  const cur = list[0] as EnergyPlayout | undefined;
  const track = cur?.title?.trim();
  // "+0200" (no colon) isn't ISO 8601 extended; Safari's Date.parse rejects it.
  const started = cur?.playFrom ? Date.parse(cur.playFrom.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')) : NaN;
  if (!cur || !track || !Number.isFinite(started) || now - started > ENERGY_STALE_MS) return null;
  const artist = cur.artist?.trim() || undefined;
  return {
    artist,
    track,
    raw: artist ? `${artist} - ${track}` : track,
    coverUrl: cur.imageUrl && /^https:\/\//i.test(cur.imageUrl) ? cur.imageUrl : undefined,
  };
}
