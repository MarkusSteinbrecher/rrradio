import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  BUILTIN_STATIONS,
  findFetcher,
  findScheduleFetcher,
  isBuiltin,
  loadBuiltinStations,
} from './builtins';
import type { ScheduleDay } from './metadata';
import { lookupCover } from './coverArt';
import { MetadataPoller, icyFetcher } from './metadata';
import { AudioPlayer, stateLabel } from './player';
import { track } from './telemetry';
import { pseudoFrequency } from './radioBrowser';
import { PAGE_SIZE, fetchStations, searchStations } from './stations';
import {
  addCustom,
  getCustom,
  getFavorites,
  getRecents,
  isFavorite,
  pushRecent,
  removeCustom,
  toggleFavorite,
} from './storage';
import type { NowPlaying, Station } from './types';

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const SLEEP_CYCLE_MIN = [0, 15, 30, 60];

type Tab = 'browse' | 'fav' | 'recent' | 'playing';
type ListTab = Exclude<Tab, 'playing'>;

// ─────────────────────────────────────────────────────────────
// Element refs
// ─────────────────────────────────────────────────────────────

const player = new AudioPlayer();

let coverEnrichToken = 0;
let coverEnrichController: AbortController | undefined;

/** Patterns of station-supplied cover URLs known to publish only small
 *  thumbnails. When one of these is the only cover available, we still
 *  run iTunes as an upgrade and prefer the higher-res result. */
function isLowResCoverUrl(url: string): boolean {
  // Grrif: /Medias/Covers/m/...  → 246×246 JPEGs only
  if (/\/Medias\/Covers\/m\//.test(url)) return true;
  return false;
}

const meta = new MetadataPoller((parsed) => {
  if (!parsed) {
    player.setTrackTitle(undefined);
    return;
  }
  const display = parsed.track
    ? parsed.artist
      ? `${parsed.artist} — ${parsed.track}`
      : parsed.track
    : undefined;
  player.setTrackTitle(display, {
    ...parsed,
    programName: parsed.program?.name,
    programSubtitle: parsed.program?.subtitle,
  });

  // Cover-art enrichment via iTunes Search. Runs when:
  //   (a) the station's metadata feed has no cover at all, OR
  //   (b) the cover it supplied is from a known low-res source.
  // Grrif only publishes 246×246 JPEGs at /Medias/Covers/m/ — visibly
  // upscaled on retina inside our ~260 CSS-px frame. iTunes serves
  // 600×600 for the same track, so we prefer it when the lookup hits.
  // If iTunes misses, we keep the station's URL — still better than
  // falling all the way back to the station favicon.
  const lowRes = parsed.coverUrl ? isLowResCoverUrl(parsed.coverUrl) : false;
  if (parsed.track && (!parsed.coverUrl || lowRes)) {
    const myToken = ++coverEnrichToken;
    coverEnrichController?.abort();
    coverEnrichController = new AbortController();
    void lookupCover(parsed.artist, parsed.track, coverEnrichController.signal).then(
      (cover) => {
        if (myToken !== coverEnrichToken || !cover) return;
        player.setTrackTitle(display, { ...parsed, coverUrl: cover });
      },
    );
  }
});
const $body = document.body;

const $wordmark = document.getElementById('wordmark') as HTMLButtonElement;
const $search = document.getElementById('search') as HTMLInputElement;
const $searchClear = document.getElementById('search-clear') as HTMLButtonElement;
const $genre = document.getElementById('genre') as HTMLSelectElement;
const $country = document.getElementById('country') as HTMLSelectElement;
const $modePlayed = document.getElementById('mode-played') as HTMLButtonElement;
const $mapToggle = document.getElementById('map-toggle') as HTMLButtonElement;
const $newsToggle = document.getElementById('news-toggle') as HTMLButtonElement;
const $filterRow = document.getElementById('filter-row') as HTMLElement;
const $tabStatus = document.getElementById('tab-status') as HTMLElement;
const $content = document.getElementById('content') as HTMLElement;
const $tabbar = document.getElementById('tabbar') as HTMLElement;

const $mini = document.getElementById('mini') as HTMLButtonElement;
const $miniFav = document.getElementById('mini-fav') as HTMLElement;
const $miniName = document.getElementById('mini-name') as HTMLElement;
const $miniMeta = document.getElementById('mini-meta') as HTMLElement;
const $miniToggle = document.getElementById('mini-toggle') as HTMLElement;

const $np = document.getElementById('np') as HTMLElement;
const $npName = document.getElementById('np-name') as HTMLElement;
const $npStationLogo = document.getElementById('np-station-logo') as HTMLImageElement;
const $npProgramName = document.getElementById('np-program-name') as HTMLElement;
const $npProgramPre = document.getElementById('np-program-pre') as HTMLElement;
const $npTags = document.getElementById('np-tags') as HTMLElement;
const $npBitrate = document.getElementById('np-bitrate') as HTMLElement;
const $npOrigin = document.getElementById('np-origin') as HTMLElement;
const $npListeners = document.getElementById('np-listeners') as HTMLElement;
const $npPaneTabs = document.getElementById('np-pane-tabs') as HTMLElement;
const $npPaneNow = document.getElementById('np-pane-now') as HTMLButtonElement;
const $npPaneProgram = document.getElementById('np-pane-program') as HTMLButtonElement;
const $npProgramPane = document.getElementById('np-program-pane') as HTMLElement;
const $npProgramList = document.getElementById('np-program-list') as HTMLElement;
const $npTrackRow = document.getElementById('np-track-row') as HTMLElement;
const $npTrackTitle = document.getElementById('np-track-title') as HTMLElement;
const $npTrackCover = document.getElementById('np-track-cover') as HTMLImageElement;
const $npStream = document.getElementById('np-stream') as HTMLAnchorElement;
const $npStreamHost = document.getElementById('np-stream-host') as HTMLElement;
const $npHome = document.getElementById('np-home') as HTMLAnchorElement;
const $npHomeHost = document.getElementById('np-home-host') as HTMLElement;
const $npFav = document.getElementById('np-fav') as HTMLButtonElement;
const $npSleep = document.getElementById('np-sleep') as HTMLButtonElement;
const $npSleepChip = document.getElementById('np-sleep-chip') as HTMLElement;
const $npPlay = document.getElementById('np-play') as HTMLButtonElement;
const $npLiveText = document.getElementById('np-live-text') as HTMLElement;
const $npFormat = document.getElementById('np-format') as HTMLElement;
const $npMute = document.getElementById('np-mute') as HTMLButtonElement;
const $npDetails = document.getElementById('np-details') as HTMLElement;
const $npDetailsToggle = document.getElementById('np-details-toggle') as HTMLButtonElement;

const $addBtn = document.getElementById('add-btn') as HTMLButtonElement;
const $addSheet = document.getElementById('add-sheet') as HTMLElement;
const $addCancel = document.getElementById('add-cancel') as HTMLButtonElement;
const $addForm = document.getElementById('add-form') as HTMLFormElement;
const $addError = document.getElementById('add-error') as HTMLElement;
const $customList = document.getElementById('custom-list') as HTMLElement;

const $themeBtn = document.getElementById('theme-btn') as HTMLButtonElement;
const $aboutBtn = document.getElementById('about-btn') as HTMLButtonElement;
const $aboutSheet = document.getElementById('about-sheet') as HTMLElement;
const $aboutClose = document.getElementById('about-close') as HTMLButtonElement;

const $dashboardBtn = document.getElementById('dashboard-btn') as HTMLButtonElement;
const $dashboardSheet = document.getElementById('dashboard-sheet') as HTMLElement;
const $dashboardClose = document.getElementById('dashboard-close') as HTMLButtonElement;
const $dashVisits = document.getElementById('dash-visits') as HTMLElement;
const $dashCountries = document.getElementById('dash-countries') as HTMLElement;
const $dashStations = document.getElementById('dash-stations') as HTMLElement;
const $dashMap = document.getElementById('dash-map') as HTMLElement;
const $dashCountryTable = document.querySelector('#dash-country-table tbody') as HTMLTableSectionElement;
const $dashStationTable = document.querySelector('#dash-station-table tbody') as HTMLTableSectionElement;

// ─────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────

let activeTab: Tab = 'browse';
/** Last list tab we were on, so closing Now Playing returns there. */
let lastListTab: ListTab = 'browse';
/** Which section the unified Library tab is showing. Persisted so the
 *  user's last choice is remembered across reloads. */
type LibrarySection = 'fav' | 'recent';
const LIBRARY_KEY = 'rrradio.library-section';
let librarySection: LibrarySection =
  localStorage.getItem(LIBRARY_KEY) === 'recent' ? 'recent' : 'fav';
let activeTag = 'all';
// ISO 3166-1 alpha-2 country code (uppercase) or 'all'. Filters both
// curated matches and Radio Browser results (the API takes the same
// 2-letter code via its `countrycode` param).
let activeCountry = 'all';
// Browse home view's source mode. Mutually-exclusive across the
// played + news icon buttons. Tapping the active button deselects to
// null, which falls back to RB top 50.
//   'played'  → top 20 played (default)
//   'news'    → RB top 50 with tag=news
//   null      → RB top 50, no filter
type BrowseMode = 'played' | 'news' | null;
let browseMode: BrowseMode = 'played';
// When true, the unfiltered home view replaces the list section
// with a Leaflet map. Default false (list view); orthogonal to
// curatedOnly — the map can show either station set.
let mapView = false;

// 2-letter ISO code → display name. Only the codes we'd plausibly
// see in BUILTIN_STATIONS or RB results, so the dropdown stays tight.
const COUNTRY_NAMES: Record<string, string> = {
  AT: 'Austria',
  AU: 'Australia',
  BE: 'Belgium',
  BR: 'Brazil',
  CA: 'Canada',
  CH: 'Switzerland',
  CZ: 'Czechia',
  DE: 'Germany',
  DK: 'Denmark',
  ES: 'Spain',
  FI: 'Finland',
  FR: 'France',
  GB: 'United Kingdom',
  GR: 'Greece',
  IE: 'Ireland',
  IT: 'Italy',
  JP: 'Japan',
  NL: 'Netherlands',
  NO: 'Norway',
  PL: 'Poland',
  PT: 'Portugal',
  RU: 'Russia',
  SE: 'Sweden',
  TR: 'Turkey',
  UA: 'Ukraine',
  UK: 'United Kingdom',
  US: 'United States',
};

/** ISO 3166-1 alpha-2 → display name. Tries the curated table first
 *  (matches the values used in the country dropdown), falls back to
 *  Intl.DisplayNames for less-common codes returned by Radio Browser
 *  (e.g. "JM"), and finally to the raw code. */
function countryName(code: string): string {
  const c = code.toUpperCase();
  if (COUNTRY_NAMES[c]) return COUNTRY_NAMES[c];
  try {
    const name = new Intl.DisplayNames(undefined, { type: 'region' }).of(c);
    if (name && name !== c) return name;
  } catch {
    /* unsupported locale → fall through */
  }
  return c;
}

/** Populate the country dropdown from distinct codes in the curated
 *  catalog. Run after stations.json loads (BUILTIN_STATIONS is empty
 *  before that). Idempotent — skips if already populated. */
function syncCountryOptions(): void {
  if ($country.options.length > 1) return; // already done
  const codes = new Set<string>();
  for (const s of BUILTIN_STATIONS) {
    if (s.country && s.country.length >= 2) codes.add(s.country.toUpperCase());
  }
  const sorted = [...codes].sort((a, b) => countryName(a).localeCompare(countryName(b)));
  for (const code of sorted) {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = countryName(code);
    $country.append(opt);
  }
}
let queryToken = 0;
let sleepIndex = 0;
let sleepTimer: number | undefined;
let currentNP: NowPlaying = {
  station: { id: '', name: '', streamUrl: '' },
  state: 'idle',
};
let lastBrowseStations: Station[] = [];
// Browse pagination state — Radio Browser pages 60 stations at a
// time. We refetch from offset 0 whenever the query/tag filter
// changes; "Load more" appends the next page.
let browseOffset = 0;
let browseHasMore = false;
let browseLoadingMore = false;

// ─────────────────────────────────────────────────────────────
// SVG factories — a small set of inline icons
// ─────────────────────────────────────────────────────────────

function svg(d: string, opts: { fill?: boolean; viewBox?: string } = {}): string {
  const vb = opts.viewBox ?? '0 0 24 24';
  if (opts.fill) {
    return `<svg viewBox="${vb}" fill="currentColor" aria-hidden="true">${d}</svg>`;
  }
  return `<svg viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}

const ICON_HEART_FILL = `<svg class="heart--fill" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/></svg>`;
const ICON_HEART_LINE_CLASSED = `<svg class="heart--line" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/></svg>`;
const ICON_FAV = svg('<path d="M12 17.5 6 21l1.5-6.5L2.5 10l6.7-.6L12 3l2.8 6.4 6.7.6-5 4.5L18 21z"/>');
const ICON_RECENT = svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>');
const ICON_EMPTY = svg('<path d="M3 7v10a4 4 0 0 0 4 4h10a4 4 0 0 0 4-4V7"/><path d="M3 7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4"/><path d="M3 7h18"/>');

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function stationInitials(name: string): string {
  const parts = name
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const letters = parts.slice(0, 2).map((w) => w[0]).join('').toUpperCase().slice(0, 2);
  return letters || '··';
}

function faviconClass(id: string): string {
  if (!id) return 'fav';
  const sum = id.charCodeAt(0) + id.charCodeAt(id.length - 1);
  return ['fav', 'fav fav-bbc', 'fav fav-soma', 'fav fav-fip'][sum % 4];
}

function favIdSet(): Set<string> {
  return new Set(getFavorites().map((s) => s.id));
}

function filterStations(stations: Station[], query: string): Station[] {
  const q = query.trim().toLowerCase();
  if (!q) return stations;
  return stations.filter((s) => {
    if (s.name.toLowerCase().includes(q)) return true;
    if ((s.tags ?? []).some((t) => t.toLowerCase().includes(q))) return true;
    if (s.country && s.country.toLowerCase().includes(q)) return true;
    return false;
  });
}

function urlDisplay(url: string | undefined): { host: string; href: string } | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.host.replace(/^www\./, '');
    const path = u.pathname && u.pathname !== '/' ? u.pathname : '';
    return { host: path ? `${host}${path}` : host, href: u.toString() };
  } catch {
    return { host: url, href: url };
  }
}

function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
  let t: number | undefined;
  return (...args: A) => {
    if (t !== undefined) window.clearTimeout(t);
    t = window.setTimeout(() => fn(...args), ms);
  };
}

function buildFavicon(station: Station, size = 38): HTMLElement {
  const fav = document.createElement('div');
  fav.className = faviconClass(station.id);
  fav.style.width = `${size}px`;
  fav.style.height = `${size}px`;
  if (station.bitrate) fav.title = `${station.bitrate} kbps`;

  const drawInitials = (): void => {
    fav.replaceChildren();
    const span = document.createElement('span');
    span.textContent = stationInitials(station.name);
    fav.append(span);
    if (station.frequency) {
      const freq = document.createElement('span');
      freq.className = 'freq-mini';
      freq.textContent = station.frequency;
      fav.append(freq);
    }
  };

  if (station.favicon) {
    const img = document.createElement('img');
    img.src = station.favicon;
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', drawInitials, { once: true });
    fav.append(img);
  } else {
    drawInitials();
  }
  return fav;
}

function buildEq(paused: boolean): HTMLElement {
  const eq = document.createElement('div');
  eq.className = 'eq' + (paused ? ' paused' : '');
  eq.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 4; i++) eq.append(document.createElement('span'));
  return eq;
}

function buildHeart(isFav: boolean): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'heart' + (isFav ? ' is-fav' : '');
  btn.setAttribute('aria-label', isFav ? 'Remove favorite' : 'Add favorite');
  btn.innerHTML = ICON_HEART_LINE_CLASSED + ICON_HEART_FILL;
  return btn;
}

// Small "curated" star, shown to the left of the heart on rows for
// stations that live in our YAML catalog. Static indicator (not a
// button) — its only job is to tell users "this one we vouch for."
function buildCuratedBadge(): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'curated-badge';
  span.title = 'Curated by rrradio';
  span.setAttribute('aria-label', 'Curated');
  span.innerHTML =
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 3.5 2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 17.2l-5.4 2.8 1.2-6L3.3 9.8l6.1-.7L12 3.5z"/></svg>';
  return span;
}

function buildRow(station: Station, currentId: string, state: NowPlaying['state'], favs: Set<string>): HTMLDivElement {
  const isCurrent = !!currentId && station.id === currentId;
  const isPaused = isCurrent && state !== 'playing';
  const isFav = favs.has(station.id);

  const row = document.createElement('div');
  row.className = 'row' + (isCurrent ? ' is-playing' : '');
  row.setAttribute('role', 'button');
  row.tabIndex = 0;
  row.dataset.id = station.id;

  const fav = buildFavicon(station, 38);

  const info = document.createElement('div');
  info.className = 'row-info';
  const name = document.createElement('div');
  name.className = 'row-name';
  name.textContent = station.name;
  const tags = document.createElement('div');
  tags.className = 'row-tags';
  tags.textContent = (station.tags ?? []).slice(0, 3).join(' · ');
  info.append(name, tags);

  const right = document.createElement('div');
  right.className = 'row-right';
  const eq = buildEq(isPaused);
  const heart = buildHeart(isFav);
  heart.addEventListener('click', (e) => {
    e.stopPropagation();
    onToggleFav(station);
  });
  right.append(eq);
  if (isBuiltin(station.id)) right.append(buildCuratedBadge());
  right.append(heart);

  row.append(fav, info, right);

  row.addEventListener('click', () => onRowPlay(station));
  row.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onRowPlay(station);
    }
  });

  return row;
}

// ─────────────────────────────────────────────────────────────
// Status text helpers
// ─────────────────────────────────────────────────────────────

function miniMetaText(np: NowPlaying): string {
  switch (np.state) {
    case 'loading':
      return 'TUNING…';
    case 'playing':
      return np.station.bitrate ? `${np.station.bitrate} KBPS · LIVE` : 'LIVE';
    case 'paused':
      return 'PAUSED';
    case 'error':
      return np.errorMessage ? np.errorMessage.toUpperCase() : 'ERROR';
    default:
      return stateLabel(np.state).toUpperCase();
  }
}

function npLiveText(np: NowPlaying): string {
  switch (np.state) {
    case 'loading':
      return 'Tuning';
    case 'playing':
      return 'Live · Streaming';
    case 'paused':
      return 'Paused';
    case 'error':
      return np.errorMessage ?? 'Error';
    default:
      return 'Standby';
  }
}

function npFormatText(s: Station): string {
  const parts: string[] = [];
  if (s.bitrate) parts.push(`${s.bitrate} kbps`);
  if (s.codec) parts.push(s.codec);
  return parts.length > 0 ? parts.join(' · ') : '—';
}

// ─────────────────────────────────────────────────────────────
// Render — Mini Player
// ─────────────────────────────────────────────────────────────

function setMiniArt(station: Station): void {
  $miniFav.replaceChildren();
  $miniFav.className = faviconClass(station.id);

  const drawInitials = (): void => {
    const span = document.createElement('span');
    span.textContent = stationInitials(station.name);
    $miniFav.append(span);
    if (station.frequency) {
      const freq = document.createElement('span');
      freq.className = 'freq-mini';
      freq.textContent = station.frequency;
      $miniFav.append(freq);
    }
  };

  if (station.favicon) {
    const img = document.createElement('img');
    img.src = station.favicon;
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener(
      'error',
      () => {
        img.remove();
        drawInitials();
      },
      { once: true },
    );
    $miniFav.append(img);
  } else {
    drawInitials();
  }
}

function renderMiniPlayer(np: NowPlaying): void {
  if (!np.station.id) {
    $mini.hidden = true;
    return;
  }
  $mini.hidden = false;
  $miniName.textContent = np.station.name;
  $miniMeta.textContent = miniMetaText(np);
  setMiniArt(np.station);
}

// ─────────────────────────────────────────────────────────────
// Render — Now Playing
// ─────────────────────────────────────────────────────────────

function renderNowPlaying(np: NowPlaying): void {
  const s = np.station;
  $npName.textContent = s.name || '—';
  $npTags.textContent = (s.tags ?? []).join(' · ');

  if (np.programName) {
    $npProgramName.textContent = np.programName;
    $npProgramPre.hidden = false;
    if (np.programSubtitle) {
      $npPaneProgram.title = np.programSubtitle;
    } else {
      $npPaneProgram.title = 'Program';
    }
  } else {
    $npProgramName.textContent = 'Program';
    $npProgramPre.hidden = true;
    $npPaneProgram.title = 'Program';
  }

  if (s.favicon) {
    if ($npStationLogo.getAttribute('src') !== s.favicon) {
      $npStationLogo.src = s.favicon;
    }
    $npStationLogo.hidden = false;
    $npStationLogo.onerror = () => {
      $npStationLogo.hidden = true;
      $npStationLogo.removeAttribute('src');
    };
  } else {
    $npStationLogo.hidden = true;
    $npStationLogo.removeAttribute('src');
  }
  // Format: codec · bitrate, e.g. "MP3 · 192 kbps". Falls back to whichever
  // half is known, em-dash when neither.
  const fmtParts = [s.codec, s.bitrate ? `${s.bitrate} kbps` : ''].filter(Boolean);
  $npBitrate.textContent = fmtParts.length > 0 ? fmtParts.join(' · ') : '—';
  // Country: resolve ISO 3166-1 code to localized name via Intl, with the
  // raw code as a fallback if the runtime can't.
  $npOrigin.textContent = s.country ? countryName(s.country) : '—';
  $npListeners.textContent = s.listeners ? s.listeners.toLocaleString() : '—';
  $npLiveText.textContent = npLiveText(np);
  $npFormat.textContent = npFormatText(s);

  // On-air block — always rendered when a station is loaded. Title is
  // the current track when known, otherwise an em-dash. Cover prefers
  // track art, then station favicon, then a 2-letter fallback mark.
  $npTrackRow.hidden = !s.id;
  const hasTrack = !!np.trackTitle && np.trackTitle.trim().length > 0;
  $npTrackTitle.textContent = hasTrack ? (np.trackTitle as string) : '—';

  const fallback = document.getElementById('np-track-cover-fallback');
  if (fallback) fallback.textContent = stationInitials(s.name || '');

  const coverSrc = np.coverUrl || s.favicon || '';
  if (coverSrc) {
    if ($npTrackCover.getAttribute('src') !== coverSrc) {
      $npTrackCover.src = coverSrc;
    }
    $npTrackCover.hidden = false;
    $npTrackCover.onerror = () => {
      $npTrackCover.hidden = true;
      $npTrackCover.removeAttribute('src');
    };
  } else {
    $npTrackCover.hidden = true;
    $npTrackCover.removeAttribute('src');
  }

  $npFav.classList.toggle('is-fav', !!s.id && isFavorite(s.id));
  $npFav.setAttribute('aria-label', isFavorite(s.id) ? 'Remove favorite' : 'Add favorite');

  $npPlay.classList.toggle('is-loading', np.state === 'loading');
  $npPlay.setAttribute('aria-label', np.state === 'playing' ? 'Pause' : 'Play');

  const stream = urlDisplay(s.streamUrl);
  if (stream) {
    $npStream.hidden = false;
    $npStream.href = stream.href;
    $npStream.title = stream.href;
    $npStreamHost.textContent = stream.host;
  } else {
    $npStream.hidden = true;
  }

  const home = urlDisplay(s.homepage);
  if (home) {
    $npHome.hidden = false;
    $npHome.href = home.href;
    $npHome.title = home.href;
    $npHomeHost.textContent = home.host;
  } else {
    $npHome.hidden = true;
  }
}

// ─────────────────────────────────────────────────────────────
// Render — Top bar (search/tags/status visibility)
// ─────────────────────────────────────────────────────────────

function renderTopBar(): void {
  // Search is available on the list tabs. Genre filter is Browse-only.
  // The Playing tab keeps the topbar quiet (no search/genre input —
  // they don't apply to a single-station view).
  const isPlaying = activeTab === 'playing';
  $filterRow.hidden = isPlaying || activeTab !== 'browse';
  $search.placeholder =
    activeTab === 'fav'
      ? 'Search your favorites…'
      : activeTab === 'recent'
        ? 'Search recently played…'
        : 'Search stations, genres, places…';
  if (activeTab === 'fav') {
    const n = getFavorites().length;
    $tabStatus.textContent = `Your stations · ${String(n).padStart(2, '0')} saved`;
    $tabStatus.hidden = false;
  } else if (activeTab === 'recent') {
    const n = getRecents().length;
    $tabStatus.textContent = `Listening history · last ${String(n).padStart(2, '0')}`;
    $tabStatus.hidden = false;
  } else {
    $tabStatus.hidden = true;
  }
}

function syncGenre(): void {
  if ($genre.value !== activeTag) $genre.value = activeTag;
  // Collapse the wrap to icon-only when no filter is active.
  $genre.parentElement?.classList.toggle('is-default', activeTag === 'all');
}

function syncCountry(): void {
  if ($country.value !== activeCountry) $country.value = activeCountry;
  $country.parentElement?.classList.toggle('is-default', activeCountry === 'all');
}

function renderTabBar(): void {
  $tabbar.querySelectorAll<HTMLButtonElement>('.tab-btn').forEach((btn) => {
    const t = btn.dataset.tab;
    // Library is the UI label for either fav or recent — it stays
    // active across both sub-sections so the bottom nav doesn't blink.
    const isActive =
      t === activeTab || (t === 'library' && (activeTab === 'fav' || activeTab === 'recent'));
    btn.classList.toggle('active', isActive);
  });
}

// ─────────────────────────────────────────────────────────────
// Render — Content
// ─────────────────────────────────────────────────────────────

function sectionLabel(label: string, count: number): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 'section-label';
  const left = document.createElement('span');
  left.textContent = label;
  const right = document.createElement('span');
  right.className = 'count';
  right.textContent = String(count).padStart(2, '0');
  wrap.append(left, right);
  return wrap;
}

function emptyState(iconHtml: string, title: string, sub: string): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 'empty';
  wrap.innerHTML = `${iconHtml}<div class="t">${title}</div><div class="s">${sub}</div>`;
  return wrap;
}

/** Two-pill segmented control rendered at the top of the Library tab.
 *  Switches between favorites and recents in place. */
function librarySegmented(): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 'lib-seg';
  const make = (key: LibrarySection, label: string) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'lib-seg__btn';
    btn.textContent = label;
    btn.setAttribute('aria-pressed', String(activeTab === key));
    if (activeTab === key) btn.classList.add('is-active');
    btn.addEventListener('click', () => {
      if (activeTab !== key) setTab(key);
    });
    return btn;
  };
  wrap.append(make('fav', 'Favorites'), make('recent', 'Recents'));
  return wrap;
}

// Played-stations data sources. Two fetches feed the Browse home view:
//
//   /api/public/top-stations  — names + play counts from GoatCounter
//                               (edge-cached 1h, always current)
//   public/station-backlog.json — names → Radio Browser-resolved stream
//                                 URLs + favicons (regenerated weekly
//                                 by catalog-watch). Lets us play a
//                                 popular non-curated station without
//                                 hitting Radio Browser at render time.
//
// The unfiltered Browse view shows the top 10 played, with built-in
// matches preferred (real logos + curated metadata) and Radio
// Browser-resolved stubs for the rest.
// Default to a 7-day window to match the admin dashboard's headline
// numbers. The Browse home view ("Most played") just wants top-N, the
// dashboard wants the same window across all metrics.
const STATS_DAYS = 7;
const STATS_BASE = 'https://rrradio-stats.markussteinbrecher.workers.dev';
const TOP_STATIONS_URL = `${STATS_BASE}/api/public/top-stations?days=${STATS_DAYS}&limit=25`;
const PUBLIC_TOTALS_URL = `${STATS_BASE}/api/public/totals?days=${STATS_DAYS}`;
const PUBLIC_LOCATIONS_URL = `${STATS_BASE}/api/public/locations?days=${STATS_DAYS}&limit=50`;
const PLAYED_TOTAL_LIMIT = 20;

interface BacklogEntry {
  name: string;
  plays: number;
  alreadyCurated: boolean;
  streamUrl?: string;
  verdict: string;
  favicon?: string;
  broadcasterGuess?: string;
}

let topStationNames: string[] | undefined;
let topStationsFetched = false;
async function loadTopStations(): Promise<void> {
  if (topStationsFetched) return;
  topStationsFetched = true;
  try {
    const res = await fetch(TOP_STATIONS_URL);
    if (!res.ok) return;
    const data = (await res.json()) as { items?: Array<{ name?: string }> };
    const names = (data.items ?? [])
      .map((i) => i.name)
      .filter((n): n is string => typeof n === 'string' && n.length > 0);
    if (names.length === 0) return;
    topStationNames = names;
    if (activeTab === 'browse') renderContent();
  } catch {
    /* silent: home view falls back to YAML order */
  }
}

let backlogByName: Map<string, BacklogEntry> = new Map();
let backlogFetched = false;
async function loadBacklog(): Promise<void> {
  if (backlogFetched) return;
  backlogFetched = true;
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}station-backlog.json`, {
      cache: 'no-store',
    });
    if (!res.ok) return;
    const data = (await res.json()) as { items?: BacklogEntry[] };
    const map = new Map<string, BacklogEntry>();
    for (const item of data.items ?? []) {
      if (item?.name) map.set(item.name.toLowerCase(), item);
    }
    backlogByName = map;
    if (activeTab === 'browse') renderContent();
  } catch {
    /* silent: non-curated played stations just won't appear */
  }
}

function slugForId(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Top-N played, mapped to playable Station objects. Built-ins win
 *  over backlog entries (we have logos + curated metadata for them).
 *  Backlog entries with broken/no-RB-match verdicts are skipped — we
 *  can't actually play them, so don't surface them. */
function playedStations(): Station[] {
  if (!topStationNames || topStationNames.length === 0) {
    return BUILTIN_STATIONS.slice(0, PLAYED_TOTAL_LIMIT);
  }
  const builtinByName = new Map<string, Station>();
  for (const s of BUILTIN_STATIONS) builtinByName.set(s.name.toLowerCase(), s);
  const seen = new Set<string>();
  const ordered: Station[] = [];
  for (const name of topStationNames) {
    if (ordered.length >= PLAYED_TOTAL_LIMIT) break;
    const lc = name.toLowerCase();
    if (seen.has(lc)) continue;
    const builtin = builtinByName.get(lc);
    if (builtin) {
      ordered.push(builtin);
      seen.add(lc);
      continue;
    }
    const backlog = backlogByName.get(lc);
    if (backlog?.streamUrl && backlog.verdict !== 'stream-broken' && backlog.verdict !== 'no-rb-match') {
      ordered.push({
        id: `played-${slugForId(name)}`,
        name,
        streamUrl: backlog.streamUrl,
        favicon: backlog.favicon,
      });
      seen.add(lc);
    }
  }
  // Backfill from BUILTIN_STATIONS so the home view is always full
  // even when GC has fewer than PLAYED_TOTAL_LIMIT plays.
  for (const s of BUILTIN_STATIONS) {
    if (ordered.length >= PLAYED_TOTAL_LIMIT) break;
    if (!seen.has(s.name.toLowerCase())) {
      ordered.push(s);
      seen.add(s.name.toLowerCase());
    }
  }
  return ordered.slice(0, PLAYED_TOTAL_LIMIT);
}

// Schedule (program guide) state for the currently-open Now Playing
// station. Fetched once when NP opens for stations whose broadcaster
// has a schedule API; null otherwise (the program panel stays hidden).
let npSchedule: ScheduleDay[] | null = null;
let npScheduleStationId: string | null = null;
let npScheduleAbort: AbortController | null = null;
let npProgramView = false; // false = "now" pane, true = "program" pane
let npSelectedDayIdx = 0;

async function loadSchedule(station: Station): Promise<void> {
  // Cancel any in-flight load for a previous station, reset cached data.
  if (npScheduleAbort) npScheduleAbort.abort();
  npSchedule = null;
  npScheduleStationId = station.id;
  npProgramView = false;
  npSelectedDayIdx = 0;
  $npPaneTabs.hidden = true;
  $npProgramPane.hidden = true;

  const found = findScheduleFetcher(station);
  if (!found) {
    syncProgramTabs();
    return;
  }
  const ctrl = new AbortController();
  npScheduleAbort = ctrl;
  try {
    const days = await found.fetcher(found.station, ctrl.signal);
    if (ctrl.signal.aborted || npScheduleStationId !== station.id) return;
    npSchedule = days;
    if (days && days.length > 0) {
      // Default to whichever day contains "now" — usually today.
      const now = Date.now();
      const idx = days.findIndex((d) => d.broadcasts.some((b) => b.start <= now && now < b.end));
      npSelectedDayIdx = Math.max(0, idx);
    }
    syncProgramTabs();
  } catch {
    /* silent — program panel just stays hidden */
  }
}

function syncProgramTabs(): void {
  const has = !!(npSchedule && npSchedule.length > 0);
  $npPaneTabs.hidden = !has;
  if (!has) {
    npProgramView = false;
    $npProgramPane.hidden = true;
    $npTrackRow.hidden = false;
    return;
  }
  $npPaneNow.classList.toggle('is-active', !npProgramView);
  $npPaneNow.setAttribute('aria-pressed', String(!npProgramView));
  $npPaneProgram.classList.toggle('is-active', npProgramView);
  $npPaneProgram.setAttribute('aria-pressed', String(npProgramView));
  $npProgramPane.hidden = !npProgramView;
  $npTrackRow.hidden = npProgramView;
}

function renderProgramPane(): void {
  if (!npSchedule || npSchedule.length === 0) {
    $npProgramPane.hidden = true;
    return;
  }
  // Today's broadcasts only — broadcaster APIs we hit only return
  // today + past, so a multi-day picker is dead weight.
  $npProgramList.replaceChildren();
  const day = npSchedule[npSelectedDayIdx];
  const now = Date.now();
  for (const b of day.broadcasts) {
    const isLive = b.start <= now && now < b.end;
    const isPast = b.end <= now;
    const row = document.createElement('div');
    row.className =
      'np-program-row' +
      (isLive ? ' is-live' : '') +
      (isPast ? ' is-past' : '');
    const time = document.createElement('div');
    time.className = 'np-program-row__time';
    time.textContent = new Date(b.start).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
    const text = document.createElement('div');
    text.className = 'np-program-row__text';
    const title = document.createElement('div');
    title.className = 'np-program-row__title';
    title.textContent = b.title;
    text.append(title);
    if (b.subtitle) {
      const sub = document.createElement('div');
      sub.className = 'np-program-row__sub';
      sub.textContent = b.subtitle;
      text.append(sub);
    }
    row.append(time, text);
    $npProgramList.append(row);
  }
}

$npPaneNow.addEventListener('click', () => {
  npProgramView = false;
  syncProgramTabs();
});
$npPaneProgram.addEventListener('click', () => {
  npProgramView = true;
  syncProgramTabs();
  renderProgramPane();
});

let selectedClusterKey: string | null = null;

// Persists across re-renders (cluster selection, mode switches) so the
// user keeps their pan/zoom while interacting. Cleared in toggleMapView.
let mapPosition: { center: L.LatLngExpression; zoom: number } | null = null;
let currentMap: L.Map | null = null;

/**
 * Default frame: skip Antarctica, leave a little margin. Used on first
 * paint and when the map is reset.
 */
const DEFAULT_BOUNDS: L.LatLngBoundsLiteral = [
  [-55, -170],
  [75, 175],
];

/**
 * Tear down the live Leaflet map. Called when the map view is toggled
 * off (so renderGlobe won't run to do it itself) and at the start of
 * each renderGlobe call (since the prior container has been detached).
 */
function teardownMap(): void {
  currentMap?.remove();
  currentMap = null;
}

/**
 * Memoized favicon preflight. SVG <image> with a broken href shows a
 * broken-image glyph in some browsers; cheaper to probe via a regular
 * Image() and only attach the SVG <image> on success. Every favicon is
 * validated once per session, then the result is cached so re-renders
 * (mode switches, cluster selection) don't repeat the work.
 */
const validatedFavicons = new Map<string, boolean | Promise<boolean>>();
function preflightFavicon(url: string): Promise<boolean> {
  const cached = validatedFavicons.get(url);
  if (cached === true || cached === false) return Promise.resolve(cached);
  if (cached) return cached;
  const p = new Promise<boolean>((resolve) => {
    const img = new Image();
    img.onload = () => {
      validatedFavicons.set(url, true);
      resolve(true);
    };
    img.onerror = () => {
      validatedFavicons.set(url, false);
      resolve(false);
    };
    img.src = url;
  });
  validatedFavicons.set(url, p);
  return p;
}

function renderGlobe(stations: Station[]): HTMLElement {
  const wrap = document.createElement('section');
  wrap.className = 'globe-wrap';

  const mapEl = document.createElement('div');
  mapEl.className = 'globe-map';
  wrap.append(mapEl);

  // Cluster stations by 0.1° (~11 km) so multiple regional channels at
  // the same broadcaster don't pile a tower of identical pins.
  const clusters = new Map<string, Station[]>();
  for (const s of stations) {
    if (!s.geo) continue;
    const key = `${Math.round(s.geo[0] * 10)},${Math.round(s.geo[1] * 10)}`;
    const arr = clusters.get(key) ?? [];
    arr.push(s);
    clusters.set(key, arr);
  }

  // Replace any prior Leaflet instance — its container has been
  // detached by the previous renderContent() call.
  teardownMap();

  // Leaflet measures its container size at init time, so the wrap has
  // to be in the DOM first. renderContent appends synchronously, so
  // by the next microtask the container is laid out and sized.
  queueMicrotask(() => {
    const map = L.map(mapEl, {
      worldCopyJump: true,
      zoomControl: true,
      attributionControl: true,
      // Smaller scrollwheel zoom step than the default — feels closer
      // to native trackpad pinch.
      wheelPxPerZoomLevel: 80,
    });
    currentMap = map;

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      subdomains: 'abcd',
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> ' +
        '&copy; <a href="https://carto.com/attributions">CARTO</a>',
    }).addTo(map);

    if (mapPosition) {
      map.setView(mapPosition.center, mapPosition.zoom);
    } else {
      map.fitBounds(DEFAULT_BOUNDS);
    }
    map.on('moveend zoomend', () => {
      mapPosition = { center: map.getCenter(), zoom: map.getZoom() };
    });

    for (const [key, group] of clusters) {
      const first = group[0];
      if (!first.geo) continue;
      const isCluster = group.length > 1;

      // divIcon lets us render markers as plain HTML — much easier to
      // style and to swap in a station favicon than Leaflet's image
      // markers. anchor=center so the lat/lon sits dead-center on the
      // pin.
      const html = isCluster
        ? `<div class="map-pin map-pin--cluster">${group.length}</div>`
        : `<div class="map-pin map-pin--single"><div class="map-pin__dot"></div></div>`;
      const icon = L.divIcon({
        html,
        className: 'map-pin-wrap',
        iconSize: [36, 36],
        iconAnchor: [18, 18],
      });

      const marker = L.marker(first.geo, { icon, riseOnHover: true }).addTo(map);
      marker.bindTooltip(isCluster ? `${group.length} stations` : first.name, {
        direction: 'top',
        offset: [0, -10],
        opacity: 0.95,
      });

      marker.on('click', () => {
        if (isCluster) {
          selectedClusterKey = selectedClusterKey === key ? null : key;
          renderContent();
        } else {
          onRowPlay(first);
        }
      });

      // Single-station: try to swap the dot for the station favicon.
      if (!isCluster && first.favicon) {
        const favicon = first.favicon;
        preflightFavicon(favicon).then((ok) => {
          if (!ok) return;
          const el = marker.getElement();
          if (!el) return;
          const dot = el.querySelector('.map-pin__dot') as HTMLDivElement | null;
          if (!dot) return;
          dot.classList.add('is-image');
          dot.style.backgroundImage = `url(${JSON.stringify(favicon)})`;
        });
      }
    }

    // Belt-and-suspenders: re-measure once the surrounding layout has
    // had its first paint, in case the wrap animated in.
    setTimeout(() => map.invalidateSize(), 0);
  });

  // Below-map panel: shown when a multi-station cluster is selected.
  const selected = selectedClusterKey ? clusters.get(selectedClusterKey) : undefined;
  if (selected && selected.length > 1) {
    const panel = document.createElement('div');
    panel.className = 'globe-cluster-panel';
    const label = document.createElement('div');
    label.className = 'globe-cluster-panel__label';
    label.textContent = `${selected.length} stations here`;
    panel.append(label);
    panel.append(renderRows(selected));
    wrap.append(panel);
  }

  return wrap;
}

// Site visit counter (footer of Browse). Pulled from GoatCounter's
// public counter endpoint — no auth, edge-cached 30 min by GC. We
// fetch once per page load and remember the value for re-renders.
let siteVisitCount: string | undefined;
let siteVisitFetched = false;
async function loadSiteVisits(): Promise<void> {
  if (siteVisitFetched) return;
  siteVisitFetched = true;
  try {
    const res = await fetch('https://markussteinbrecher.goatcounter.com/counter/TOTAL.json');
    if (!res.ok) return;
    const data = (await res.json()) as { count?: string };
    if (typeof data.count === 'string') {
      siteVisitCount = data.count;
      // Re-render Browse so any visible counter picks up the count.
      if (activeTab === 'browse') renderContent();
    }
  } catch {
    /* silent: optional decoration */
  }
}

function siteCounter(): HTMLDivElement | null {
  if (!siteVisitCount) return null;
  const wrap = document.createElement('div');
  wrap.className = 'site-counter';
  const num = document.createElement('span');
  num.className = 'site-counter__num';
  num.textContent = siteVisitCount;
  const label = document.createElement('span');
  label.className = 'site-counter__label';
  label.textContent = 'visits served';
  wrap.append(num, label);
  return wrap;
}

function statusLine(message: string): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 'empty';
  wrap.style.padding = '40px 32px';
  wrap.innerHTML = `<div class="s">${message}</div>`;
  return wrap;
}

function renderRows(stations: Station[]): DocumentFragment {
  const frag = document.createDocumentFragment();
  const favs = favIdSet();
  for (const s of stations) frag.append(buildRow(s, currentNP.station.id, currentNP.state, favs));
  return frag;
}

function renderContent(): void {
  $content.replaceChildren();

  if (activeTab === 'browse') {
    const query = $search.value.trim();
    const genreTag = activeTag === 'all' ? undefined : activeTag;
    const countryFilter = activeCountry === 'all' ? undefined : activeCountry.toUpperCase();
    const noFilter = !query && !genreTag && !countryFilter;
    const tagFilter = browseMode === 'news' ? 'news' : genreTag;
    // Map view only renders inside the home view (no genre/country/search);
    // disable the toggle visually when it'd be a no-op.
    $mapToggle.disabled = !noFilter;

    // Unfiltered home view. The list is sourced based on browseMode.
    if (noFilter) {
      // Source set per mode:
      //   played   → playedStations() — local, no RB
      //   news     → lastBrowseStations (RB top news, fetched in runQuery)
      //   null     → lastBrowseStations (RB top 50, fetched in runQuery)
      let stations: Station[];
      let restLabel: string;
      if (browseMode === 'played') {
        stations = playedStations().slice(0, PLAYED_TOTAL_LIMIT);
        restLabel = 'Most played';
      } else if (browseMode === 'news') {
        stations = lastBrowseStations;
        restLabel = 'News';
      } else {
        stations = lastBrowseStations;
        restLabel = 'Top stations';
      }

      if (mapView) {
        $content.append(renderGlobe(stations));
      } else if (stations.length > 0) {
        $content.append(sectionLabel(restLabel, stations.length));
        $content.append(renderRows(stations));
        // Pagination only applies when the source is RB (mode=null/news).
        if ((browseMode === null || browseMode === 'news') && browseHasMore) {
          $content.append(loadMoreButton());
        }
      }

      const counter = siteCounter();
      if (counter) $content.append(counter);
      return;
    }

    // Filtered view (search / genre / country): built-ins + custom
    // matches first ("My stations"), then Radio Browser long-tail.
    const tagMatch = (s: Station): boolean =>
      !tagFilter || (s.tags ?? []).some((t) => t.toLowerCase().includes(tagFilter));
    const countryMatch = (s: Station): boolean =>
      !countryFilter || (s.country ?? '').toUpperCase() === countryFilter;
    const mySource = [...BUILTIN_STATIONS, ...getCustom()];
    const myFiltered = filterStations(mySource, query).filter(tagMatch).filter(countryMatch);

    if (myFiltered.length > 0) {
      $content.append(sectionLabel('My stations', myFiltered.length));
      $content.append(renderRows(myFiltered));
    }
    if (lastBrowseStations.length > 0) {
      const label = query ? 'Results' : tagFilter ?? 'Results';
      $content.append(sectionLabel(label, lastBrowseStations.length));
      $content.append(renderRows(lastBrowseStations));
      if (browseHasMore) $content.append(loadMoreButton());
    } else if (myFiltered.length === 0) {
      $content.append(emptyState(ICON_EMPTY, 'No stations match', 'Try a different search or genre'));
    }
    const counter = siteCounter();
    if (counter) $content.append(counter);
    return;
  }

  const query = $search.value.trim();

  if (activeTab === 'fav' || activeTab === 'recent') {
    $content.append(librarySegmented());
  }

  if (activeTab === 'fav') {
    const all = getFavorites();
    const list = filterStations(all, query);
    const label = query ? 'Results' : 'Favorites';
    $content.append(sectionLabel(label, list.length));
    if (all.length === 0) {
      $content.append(
        emptyState(ICON_FAV, 'No favorites yet', 'Tap the heart on any station to save it here'),
      );
    } else if (list.length === 0) {
      $content.append(
        emptyState(ICON_EMPTY, 'No matches', 'Nothing in your favorites matches that search'),
      );
    } else {
      $content.append(renderRows(list));
    }
    return;
  }

  if (activeTab === 'recent') {
    const all = getRecents();
    const list = filterStations(all, query);
    const label = query ? 'Results' : 'Recently played';
    $content.append(sectionLabel(label, list.length));
    if (all.length === 0) {
      $content.append(
        emptyState(ICON_RECENT, 'No history yet', 'Stations you play will show up here'),
      );
    } else if (list.length === 0) {
      $content.append(
        emptyState(ICON_EMPTY, 'No matches', 'Nothing in your history matches that search'),
      );
    } else {
      $content.append(renderRows(list));
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────

async function runQuery(): Promise<void> {
  if (activeTab !== 'browse') {
    renderContent();
    return;
  }
  const myToken = ++queryToken;
  // Filter changed → page resets.
  browseOffset = 0;
  browseHasMore = false;
  browseLoadingMore = false;
  const query = $search.value.trim();
  const genreTag = activeTag === 'all' ? undefined : activeTag;
  const countryFilter = activeCountry === 'all' ? undefined : activeCountry;
  const noFilter = !query && !genreTag && !countryFilter;
  // News mode applies its tag to the RB call when we fetch.
  const tagFilter = browseMode === 'news' ? 'news' : genreTag;
  // Skip Radio Browser fetch only when mode is 'played' AND no filter
  // is set — that mode uses local data. Mode='news' and mode=null both
  // need an RB fetch (top 50 stations, optionally with tag=news).
  const needsRb = !noFilter || browseMode === null || browseMode === 'news';
  if (!needsRb) {
    if (myToken !== queryToken) return;
    lastBrowseStations = [];
    renderContent();
    return;
  }
  $content.replaceChildren(statusLine('Tuning in…'));
  try {
    const stations = await searchStations({
      query: query || undefined,
      tag: tagFilter,
      countryCode: countryFilter,
      offset: 0,
    });
    if (myToken !== queryToken) return;
    lastBrowseStations = stations;
    browseHasMore = stations.length === PAGE_SIZE;
    renderContent();
  } catch (err) {
    if (myToken !== queryToken) return;
    lastBrowseStations = [];
    $content.replaceChildren(
      statusLine(`Off air · ${err instanceof Error ? err.message : String(err)}`),
    );
  }
}

async function loadMore(): Promise<void> {
  if (browseLoadingMore || !browseHasMore || activeTab !== 'browse') return;
  browseLoadingMore = true;
  renderContent(); // flips the button into a "Loading…" state
  const myToken = queryToken;
  const nextOffset = browseOffset + PAGE_SIZE;
  try {
    const query = $search.value.trim();
    const tagFilter = activeTag === 'all' ? undefined : activeTag;
    const more = query || tagFilter
      ? await searchStations({ query: query || undefined, tag: tagFilter, offset: nextOffset })
      : await fetchStations(nextOffset);
    if (myToken !== queryToken) return;
    // Radio Browser sometimes returns duplicates across page boundaries
    // (when records shift between requests). De-dupe by id.
    const seen = new Set(lastBrowseStations.map((s) => s.id));
    const fresh = more.filter((s) => !seen.has(s.id));
    lastBrowseStations = lastBrowseStations.concat(fresh);
    browseOffset = nextOffset;
    browseHasMore = more.length === PAGE_SIZE;
  } catch {
    browseHasMore = false;
  } finally {
    browseLoadingMore = false;
    renderContent();
  }
}

function loadMoreButton(): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'load-more';
  btn.disabled = browseLoadingMore;
  btn.textContent = browseLoadingMore ? 'Loading…' : 'Load more';
  btn.addEventListener('click', () => void loadMore());
  return btn;
}

// ─────────────────────────────────────────────────────────────
// Actions
// ─────────────────────────────────────────────────────────────

function onRowPlay(station: Station): void {
  // If already current and playing → pause; else play & record recent
  if (currentNP.station.id === station.id) {
    player.toggle();
    return;
  }
  pushRecent(station);
  void player.play(station);
  track(`play: ${station.name}`);
  if (activeTab === 'recent') renderContent();
  // Open Now Playing on first play of this station
  openNp(true);
}

function onToggleFav(station: Station): void {
  const added = toggleFavorite(station);
  track(`${added ? 'favorite' : 'unfavorite'}: ${station.name}`);
  // Refresh affected UI bits
  if (activeTab === 'fav' || activeTab === 'browse') {
    if (activeTab === 'fav') renderContent();
    else syncRowHearts();
  }
  renderTopBar();
  // Update NP fav state if it's this station
  if (currentNP.station.id === station.id) {
    $npFav.classList.toggle('is-fav', isFavorite(station.id));
  }
}

function syncRowHearts(): void {
  const favs = favIdSet();
  $content.querySelectorAll<HTMLButtonElement>('.heart').forEach((heart) => {
    const row = heart.closest<HTMLElement>('.row');
    const id = row?.dataset.id;
    if (!id) return;
    heart.classList.toggle('is-fav', favs.has(id));
  });
}

function syncRowPlayingState(): void {
  const id = currentNP.station.id;
  const isPaused = currentNP.state !== 'playing';
  $content.querySelectorAll<HTMLElement>('.row').forEach((row) => {
    const isCurrent = !!id && row.dataset.id === id;
    row.classList.toggle('is-playing', isCurrent);
    const eq = row.querySelector<HTMLElement>('.eq');
    if (eq) eq.classList.toggle('paused', isCurrent && isPaused);
  });
}

function syncSearchClear(): void {
  $searchClear.hidden = $search.value === '';
}

function clearSearch(refocus: boolean): void {
  if ($search.value !== '') {
    $search.value = '';
    syncSearchClear();
  }
  if (refocus) $search.focus();
}

function goHome(): void {
  // Close Now Playing if open, then reset Browse to its initial state
  if ($np.classList.contains('open')) openNp(false);
  const wasBrowseDefault =
    activeTab === 'browse' &&
    activeTag === 'all' &&
    activeCountry === 'all' &&
    browseMode === 'played' &&
    $search.value === '';
  clearSearch(false);
  activeTag = 'all';
  activeCountry = 'all';
  // Reset to default played mode + clear visual state on the others.
  browseMode = 'played';
  $modePlayed.classList.add('is-active');
  $modePlayed.setAttribute('aria-pressed', 'true');
  $newsToggle.classList.remove('is-active');
  $newsToggle.setAttribute('aria-pressed', 'false');
  syncGenre();
  syncCountry();
  if (activeTab !== 'browse') {
    setTab('browse'); // setTab also runs the query
  } else if (!wasBrowseDefault) {
    void runQuery();
  }
  $content.scrollTo({ top: 0, behavior: 'smooth' });
}

function setTab(tab: Tab): void {
  // No-op when already there. Playing-tab tap with no station also no-ops.
  if (activeTab === tab) return;
  if (tab === 'playing' && !currentNP.station.id) return;

  // Track the last list tab so closing Now Playing returns there.
  if (tab !== 'playing' && (tab === 'browse' || tab === 'fav' || tab === 'recent')) {
    lastListTab = tab;
  }
  // Library section follows whichever sub-tab is active.
  if (tab === 'fav' || tab === 'recent') {
    librarySection = tab;
    localStorage.setItem(LIBRARY_KEY, tab);
  }

  activeTab = tab;
  $body.classList.toggle('tab-playing', tab === 'playing');
  $np.classList.toggle('open', tab === 'playing');
  $np.setAttribute('aria-hidden', String(tab !== 'playing'));

  renderTabBar();
  renderTopBar();
  if (tab === 'browse') void runQuery();
  else if (tab !== 'playing') renderContent();

  track(`tab/${tab}`);
}

function openNp(open: boolean): void {
  if (open) setTab('playing');
  else if (activeTab === 'playing') setTab(lastListTab);
}

// ─────────────────────────────────────────────────────────────
// Theme
// ─────────────────────────────────────────────────────────────

const THEME_KEY = 'rrradio.theme';
type Theme = 'light' | 'dark';

function readStoredTheme(): Theme | null {
  const v = localStorage.getItem(THEME_KEY);
  return v === 'light' || v === 'dark' ? v : null;
}

function effectiveTheme(): Theme {
  const stored = readStoredTheme();
  if (stored) return stored;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function applyTheme(theme: Theme | null): void {
  if (theme === null) {
    document.documentElement.removeAttribute('data-theme');
    localStorage.removeItem(THEME_KEY);
  } else {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
  }
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = effectiveTheme() === 'light' ? '#fafaf8' : '#0a0a0a';
}

function toggleTheme(): void {
  applyTheme(effectiveTheme() === 'dark' ? 'light' : 'dark');
  track(`theme/${effectiveTheme()}`);
}

// Apply persisted theme before render so the first paint has the right palette.
applyTheme(readStoredTheme());

// React to system theme changes when the user hasn't picked one explicitly.
window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
  if (readStoredTheme() === null) applyTheme(null); // re-syncs theme-color meta
});

function openAboutSheet(open: boolean): void {
  $aboutSheet.classList.toggle('open', open);
  $aboutSheet.setAttribute('aria-hidden', String(!open));
}

// ─────────────────────────────────────────────────────────────
// Dashboard sheet
// ─────────────────────────────────────────────────────────────

/** Rough country centroids — enough to place a circle on the map.
 *  Sourced from public-domain country-centroid data (truncated to the
 *  ~50 we'd plausibly have stations from). For a country we don't list
 *  here, we fall back to the geo of one of its curated stations. */
const COUNTRY_CENTROIDS: Record<string, [number, number]> = {
  AT: [47.5162, 14.5501], AU: [-25.2744, 133.7751], BE: [50.5039, 4.4699],
  BR: [-14.235, -51.9253], CA: [56.1304, -106.3468], CH: [46.8182, 8.2275],
  CN: [35.8617, 104.1954], CZ: [49.8175, 15.473], DE: [51.1657, 10.4515],
  DK: [56.2639, 9.5018], ES: [40.4637, -3.7492], FI: [61.9241, 25.7482],
  FR: [46.2276, 2.2137], GB: [55.3781, -3.436], GR: [39.0742, 21.8243],
  HU: [47.1625, 19.5033], IE: [53.4129, -8.2439], IL: [31.0461, 34.8516],
  IN: [20.5937, 78.9629], IT: [41.8719, 12.5674], JP: [36.2048, 138.2529],
  KR: [35.9078, 127.7669], MX: [23.6345, -102.5528], NL: [52.1326, 5.2913],
  NO: [60.472, 8.4689], NZ: [-40.9006, 174.886], PH: [12.8797, 121.774],
  PL: [51.9194, 19.1451], PT: [39.3999, -8.2245], RO: [45.9432, 24.9668],
  RU: [61.524, 105.3188], SE: [60.1282, 18.6435], TR: [38.9637, 35.2433],
  UA: [48.3794, 31.1656], UK: [55.3781, -3.436], US: [37.0902, -95.7129],
  ZA: [-30.5595, 22.9375], AR: [-38.4161, -63.6167], CO: [4.5709, -74.2973],
  CL: [-35.6751, -71.543], PE: [-9.19, -75.0152], EC: [-1.8312, -78.1834],
  AE: [23.4241, 53.8478], SK: [48.669, 19.699], BG: [42.7339, 25.4858],
  HR: [45.1, 15.2], RS: [44.0165, 21.0059], BA: [43.9159, 17.6791],
  ID: [-0.7893, 113.9213], TW: [23.6978, 120.9605], UY: [-32.5228, -55.7658],
  VE: [6.4238, -66.5897], UG: [1.3733, 32.2903],
};

interface TopStationItem {
  name: string;
  count: number;
}

interface DashboardData {
  totalPlays: number;
  totalStations: number;
  /** Visitor-country counts (where listeners are browsing from), not
   *  station-origin counts. Country code → visitor count. */
  byCountry: Map<string, number>;
}

async function fetchTopStationsWithCounts(): Promise<TopStationItem[]> {
  try {
    const res = await fetch(TOP_STATIONS_URL);
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: TopStationItem[] };
    return (data.items ?? []).filter((i) => typeof i.name === 'string' && i.name.length > 0);
  } catch {
    return [];
  }
}

interface PublicTotals {
  total?: number;
  total_events?: number;
  range_days?: number;
}

async function fetchPublicTotals(): Promise<PublicTotals | null> {
  try {
    const res = await fetch(PUBLIC_TOTALS_URL);
    if (!res.ok) return null;
    return (await res.json()) as PublicTotals;
  } catch {
    return null;
  }
}

interface PublicLocationItem {
  code: string;
  name: string;
  count: number;
}

async function fetchPublicLocations(): Promise<PublicLocationItem[]> {
  try {
    const res = await fetch(PUBLIC_LOCATIONS_URL);
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: PublicLocationItem[] };
    return data.items ?? [];
  } catch {
    return [];
  }
}

function aggregateDashboard(
  items: TopStationItem[],
  locations: PublicLocationItem[],
): DashboardData {
  let totalPlays = 0;
  let totalStations = 0;
  for (const it of items) {
    totalStations++;
    totalPlays += it.count;
  }
  const byCountry = new Map<string, number>();
  for (const loc of locations) {
    if (!loc.code) continue;
    byCountry.set(loc.code.toUpperCase(), (byCountry.get(loc.code.toUpperCase()) ?? 0) + loc.count);
  }
  return { totalPlays, totalStations, byCountry };
}

function renderDashKpis(d: DashboardData, totals: PublicTotals | null): void {
  $dashVisits.textContent = totals?.total != null ? totals.total.toLocaleString() : '—';
  $dashCountries.textContent = String(d.byCountry.size);
  $dashStations.textContent = String(d.totalStations);
}

function renderDashCountryTable(d: DashboardData): void {
  $dashCountryTable.replaceChildren();
  const sorted = [...d.byCountry.entries()].sort((a, b) => b[1] - a[1]);
  const max = sorted[0]?.[1] ?? 1;
  sorted.forEach(([cc, count], i) => {
    const tr = document.createElement('tr');
    const rank = document.createElement('td');
    rank.className = 'rank';
    rank.textContent = String(i + 1).padStart(2, '0');
    const country = document.createElement('td');
    country.className = 'country';
    country.textContent = countryName(cc);
    const bar = document.createElement('td');
    bar.className = 'bar';
    bar.innerHTML = `<div class="bar__track"><div class="bar__fill" style="width:${(count / max) * 100}%"></div></div>`;
    const num = document.createElement('td');
    num.className = 'count';
    num.textContent = String(count);
    tr.append(rank, country, bar, num);
    $dashCountryTable.append(tr);
  });
}

function renderDashStationTable(items: TopStationItem[]): void {
  $dashStationTable.replaceChildren();
  if (items.length === 0) return;
  const max = items[0]?.count ?? 1;
  items.forEach((it, i) => {
    const tr = document.createElement('tr');
    const rank = document.createElement('td');
    rank.className = 'rank';
    rank.textContent = String(i + 1).padStart(2, '0');
    const name = document.createElement('td');
    name.className = 'country'; // reuse existing column class for the auto-width name slot
    name.textContent = it.name;
    const bar = document.createElement('td');
    bar.className = 'bar';
    bar.innerHTML = `<div class="bar__track"><div class="bar__fill" style="width:${(it.count / max) * 100}%"></div></div>`;
    const num = document.createElement('td');
    num.className = 'count';
    num.textContent = String(it.count);
    tr.append(rank, name, bar, num);
    $dashStationTable.append(tr);
  });
}

function getCountryCentroid(cc: string): [number, number] | null {
  if (COUNTRY_CENTROIDS[cc]) return COUNTRY_CENTROIDS[cc];
  // Fallback: any curated station from that country
  const s = BUILTIN_STATIONS.find((x) => x.country?.toUpperCase() === cc && x.geo);
  return s?.geo ?? null;
}

/** Equirectangular projection onto the world-map.svg viewBox.
 *  Source viewBox is 950×620 — close enough to true equirectangular
 *  at this scale that pins land within a few pixels of the city. */
function projectLatLon(lat: number, lon: number): { x: number; y: number } {
  return {
    x: ((lon + 180) / 360) * 950,
    y: ((90 - lat) / 180) * 620,
  };
}

let worldSvgText: string | null = null;
async function ensureWorldSvg(): Promise<string | null> {
  if (worldSvgText) return worldSvgText;
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}world-map.svg`, { cache: 'force-cache' });
    if (!res.ok) return null;
    worldSvgText = await res.text();
    return worldSvgText;
  } catch {
    return null;
  }
}

function teardownDashMap(): void {
  $dashMap.replaceChildren();
}

async function renderDashMap(d: DashboardData): Promise<void> {
  teardownDashMap();
  if (d.byCountry.size === 0) return;
  const svgSource = await ensureWorldSvg();
  if (!svgSource) return;

  // Inline the SVG so we can append <circle> elements directly.
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgSource, 'image/svg+xml');
  const svg = doc.documentElement as unknown as SVGSVGElement;
  svg.classList.add('dash-world-map');
  svg.removeAttribute('width');
  svg.removeAttribute('height');

  const max = Math.max(...d.byCountry.values());
  const NS = 'http://www.w3.org/2000/svg';
  for (const [cc, count] of d.byCountry) {
    const centroid = getCountryCentroid(cc);
    if (!centroid) continue;
    const { x, y } = projectLatLon(centroid[0], centroid[1]);
    // sqrt(share) → area-proportional. Range tuned for the 950×620
    // viewBox; absolute play volume doesn't change the picture, only
    // the relative distribution does.
    const share = count / max;
    const r = 3 + Math.sqrt(share) * 9;

    const circle = document.createElementNS(NS, 'circle');
    circle.setAttribute('class', 'dash-circle');
    circle.setAttribute('cx', String(x));
    circle.setAttribute('cy', String(y));
    circle.setAttribute('r', String(r));

    const title = document.createElementNS(NS, 'title');
    title.textContent = `${countryName(cc)} · ${count} plays`;
    circle.append(title);

    svg.append(circle);
  }
  $dashMap.append(svg);
}

async function openDashboardSheet(open: boolean): Promise<void> {
  $dashboardSheet.classList.toggle('open', open);
  $dashboardSheet.setAttribute('aria-hidden', String(!open));
  if (!open) {
    teardownDashMap();
    return;
  }
  // Initial render — show "…" placeholders, fetch fresh data.
  $dashVisits.textContent = '…';
  $dashCountries.textContent = '…';
  $dashStations.textContent = '…';
  const [items, totals, locations] = await Promise.all([
    fetchTopStationsWithCounts(),
    fetchPublicTotals(),
    fetchPublicLocations(),
  ]);
  const data = aggregateDashboard(items, locations);
  renderDashKpis(data, totals);
  renderDashCountryTable(data);
  renderDashStationTable(items);
  void renderDashMap(data);
}

function openAddSheet(open: boolean): void {
  $addSheet.classList.toggle('open', open);
  $addSheet.setAttribute('aria-hidden', String(!open));
  if (open) {
    renderCustomList();
    $addError.hidden = true;
    // Focus the first field when opening
    window.setTimeout(() => {
      const first = $addForm.querySelector<HTMLInputElement>('input[name="name"]');
      first?.focus();
    }, 280);
  }
}

function buildId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `custom-${crypto.randomUUID()}`;
  }
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function parseTags(raw: string): string[] {
  return raw
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

function showAddError(msg: string): void {
  $addError.textContent = msg;
  $addError.hidden = false;
}

function handleAddSubmit(e: SubmitEvent): void {
  e.preventDefault();
  const data = new FormData($addForm);
  const name = String(data.get('name') ?? '').trim();
  const streamUrl = String(data.get('streamUrl') ?? '').trim();
  const homepage = String(data.get('homepage') ?? '').trim();
  const country = String(data.get('country') ?? '').trim().toUpperCase();
  const tagsRaw = String(data.get('tags') ?? '').trim();

  if (!name) {
    showAddError('Name is required.');
    return;
  }
  if (!streamUrl) {
    showAddError('Stream URL is required.');
    return;
  }
  try {
    const u = new URL(streamUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      showAddError('Stream URL must start with http:// or https://');
      return;
    }
  } catch {
    showAddError('Stream URL is not a valid URL.');
    return;
  }
  if (homepage) {
    try {
      const u = new URL(homepage);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        showAddError('Homepage must start with http:// or https://');
        return;
      }
    } catch {
      showAddError('Homepage is not a valid URL.');
      return;
    }
  }
  if (country && !/^[A-Z]{2}$/.test(country)) {
    showAddError('Country must be a 2-letter code (e.g. CH).');
    return;
  }

  const id = buildId();
  const station: Station = {
    id,
    name,
    streamUrl,
    homepage: homepage || undefined,
    country: country || undefined,
    tags: parseTags(tagsRaw),
    frequency: pseudoFrequency(id),
  };

  addCustom(station);
  track('add-custom-station');
  $addForm.reset();
  $addError.hidden = true;
  openAddSheet(false);

  // Refresh whatever list is visible, then play
  if (activeTab === 'browse') void runQuery();
  else renderContent();
  pushRecent(station);
  void player.play(station);
  openNp(true);
}

function renderCustomList(): void {
  const all = getCustom();
  $customList.replaceChildren();
  if (all.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'custom-empty';
    empty.textContent = 'No custom stations yet.';
    $customList.append(empty);
    return;
  }
  for (const s of all) {
    const li = document.createElement('li');
    li.className = 'custom-row';

    const main = document.createElement('div');
    main.className = 'custom-row__main';

    const name = document.createElement('div');
    name.className = 'custom-row__name';
    name.textContent = s.name;

    const url = document.createElement('div');
    url.className = 'custom-row__url';
    const display = urlDisplay(s.streamUrl);
    url.textContent = display ? display.host : s.streamUrl;

    main.append(name, url);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'custom-row__delete';
    del.setAttribute('aria-label', `Delete ${s.name}`);
    del.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>';
    del.addEventListener('click', () => {
      removeCustom(s.id);
      renderCustomList();
      if (activeTab === 'browse') void runQuery();
      else renderContent();
    });

    li.append(main, del);
    $customList.append(li);
  }
}

function setSleep(minutes: number): void {
  if (sleepTimer !== undefined) {
    window.clearTimeout(sleepTimer);
    sleepTimer = undefined;
  }
  if (minutes === 0) {
    $npSleep.classList.remove('is-fav');
    $npSleepChip.hidden = true;
    $npSleepChip.textContent = '';
    $npSleep.setAttribute('aria-label', 'Sleep timer');
    return;
  }
  $npSleep.classList.add('is-fav');
  $npSleepChip.hidden = false;
  $npSleepChip.textContent = `${minutes}m`;
  $npSleep.setAttribute('aria-label', `Sleep timer · ${minutes}m`);
  sleepTimer = window.setTimeout(() => {
    player.pause();
    sleepIndex = 0;
    setSleep(0);
  }, minutes * 60 * 1000);
}

// ─────────────────────────────────────────────────────────────
// Event wiring
// ─────────────────────────────────────────────────────────────

$tabbar.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const btn = target.closest<HTMLButtonElement>('.tab-btn');
  if (!btn) return;
  const raw = btn.dataset.tab;
  // The "library" button is a UI grouping over the fav + recent tabs;
  // it routes to whichever section the user picked last.
  if (raw === 'library') {
    setTab(librarySection);
    return;
  }
  if (raw) setTab(raw as Tab);
});

$search.addEventListener('input', () => syncSearchClear());
$search.addEventListener(
  'input',
  debounce(() => {
    void runQuery();
    if ($search.value.trim()) track('search');
  }, 300),
);

$genre.addEventListener('change', () => {
  activeTag = $genre.value || 'all';
  syncGenre();
  // Picking a genre clears news mode (single tag in effect at a time).
  if (activeTag !== 'all' && browseMode === 'news') {
    setBrowseMode(null);
    return; // setBrowseMode triggers runQuery
  }
  selectedClusterKey = null;
  void runQuery();
  track(`genre/${activeTag}`);
});

$country.addEventListener('change', () => {
  activeCountry = $country.value || 'all';
  syncCountry();
  selectedClusterKey = null;
  void runQuery();
  track(`country/${activeCountry}`);
});

function setBrowseMode(target: BrowseMode): void {
  // Toggle off when the user taps the active button.
  const next = browseMode === target ? null : target;
  if (next === browseMode) return;
  browseMode = next;
  $modePlayed.classList.toggle('is-active', browseMode === 'played');
  $modePlayed.setAttribute('aria-pressed', String(browseMode === 'played'));
  $newsToggle.classList.toggle('is-active', browseMode === 'news');
  $newsToggle.setAttribute('aria-pressed', String(browseMode === 'news'));
  // News mode and the genre dropdown both encode a single tag filter,
  // so they're mutually exclusive — picking news clears the genre.
  if (browseMode === 'news' && activeTag !== 'all') {
    activeTag = 'all';
    syncGenre();
  }
  selectedClusterKey = null;
  track(`mode/${browseMode ?? 'none'}`);
  void runQuery();
}

$modePlayed.addEventListener('click', () => setBrowseMode('played'));
$newsToggle.addEventListener('click', () => setBrowseMode('news'));

$mapToggle.addEventListener('click', () => {
  if ($mapToggle.disabled) return;
  mapView = !mapView;
  $mapToggle.classList.toggle('is-active', mapView);
  $mapToggle.setAttribute('aria-pressed', String(mapView));
  if (!mapView) {
    selectedClusterKey = null;
    // renderContent() won't run renderGlobe(), so nothing else will
    // dispose the live Leaflet instance — do it here.
    teardownMap();
  }
  track(`map-view/${mapView ? 'on' : 'off'}`);
  renderContent();
});

$searchClear.addEventListener('click', () => {
  clearSearch(true);
  void runQuery();
});

$wordmark.addEventListener('click', goHome);

$addBtn.addEventListener('click', () => openAddSheet(true));
$addCancel.addEventListener('click', () => openAddSheet(false));
$addForm.addEventListener('submit', handleAddSubmit);

$themeBtn.addEventListener('click', toggleTheme);
$aboutBtn.addEventListener('click', () => openAboutSheet(true));
$aboutClose.addEventListener('click', () => openAboutSheet(false));
$dashboardBtn.addEventListener('click', () => void openDashboardSheet(true));
$dashboardClose.addEventListener('click', () => void openDashboardSheet(false));

$mini.addEventListener('click', () => openNp(true));
$miniToggle.addEventListener('click', (e) => {
  e.stopPropagation();
  player.toggle();
});

$npPlay.addEventListener('click', () => player.toggle());
$npMute.addEventListener('click', () => {
  const muted = player.toggleMute();
  $body.classList.toggle('is-muted', muted);
  $npMute.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
});

$npDetailsToggle.addEventListener('click', () => {
  const open = $npDetails.dataset.open !== 'true';
  $npDetails.dataset.open = String(open);
  $npDetailsToggle.setAttribute('aria-expanded', String(open));
  track(open ? 'np-details/open' : 'np-details/close');
});

$npFav.addEventListener('click', () => {
  const s = currentNP.station;
  if (!s.id) return;
  onToggleFav(s);
});

$npSleep.addEventListener('click', () => {
  sleepIndex = (sleepIndex + 1) % SLEEP_CYCLE_MIN.length;
  setSleep(SLEEP_CYCLE_MIN[sleepIndex]);
});

// ─────────────────────────────────────────────────────────────
// Player subscription
// ─────────────────────────────────────────────────────────────

let lastIcyKey = '';
let prevState: typeof currentNP.state = 'idle';
let prevStationId = '';
let lastErrorMessage = '';

player.subscribe((np) => {
  const stationLost = !np.station.id && currentNP.station.id && activeTab === 'playing';
  const stationChanged = np.station.id && np.station.id !== currentNP.station.id;
  currentNP = np;
  // Refresh schedule when the user starts a new station — schedules
  // are per-station, fetched once on station change.
  if (stationChanged) void loadSchedule(np.station);
  $body.classList.toggle('is-playing', np.state === 'playing');
  $body.classList.toggle('has-station', !!np.station.id);
  // If the station was unloaded while the Playing tab was active,
  // bounce back to the last list tab so the user isn't stranded.
  if (stationLost) setTab(lastListTab);
  renderMiniPlayer(np);
  renderNowPlaying(np);
  syncRowPlayingState();

  // Telemetry: state transitions on the same station. Initial play is
  // already tracked by onRowPlay; here we capture pause/resume cycles
  // and stream errors. Station changes are skipped (the play event from
  // the row click already covers them).
  if (np.station.id && np.station.id === prevStationId) {
    if (prevState === 'playing' && np.state === 'paused') {
      track(`pause: ${np.station.name}`);
    } else if (prevState === 'paused' && np.state === 'loading') {
      track(`resume: ${np.station.name}`);
    }
  }
  if (np.state === 'error' && prevState !== 'error') {
    const reason = np.errorMessage ?? 'unknown';
    if (reason !== lastErrorMessage) {
      lastErrorMessage = reason;
      track(`error: ${np.station.name || 'unknown'}`, reason);
    }
  } else if (np.state !== 'error') {
    lastErrorMessage = '';
  }
  prevState = np.state;
  prevStationId = np.station.id;

  // Drive the metadata poller off player state. Per-station overrides win
  // (e.g. Grrif uses /live/covers.json); falls back to ICY-over-fetch.
  const key = np.state === 'playing' ? np.station.id : '';
  if (key !== lastIcyKey) {
    lastIcyKey = key;
    if (key) {
      const matched = findFetcher(np.station);
      if (matched) {
        meta.start(matched.station, matched.fetcher, 30_000);
      } else {
        meta.start(np.station, icyFetcher, 30_000);
      }
    } else {
      meta.stop();
    }
  }
});

// ─────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────

renderTabBar();
renderTopBar();
syncGenre();
syncCountry();
syncSearchClear();
// Stations.json defines the built-in catalog (Featured strip + per-station
// metadata fetcher overrides). Render once it lands so the first paint
// already has the Featured tiles.
void loadBuiltinStations().then(() => {
  syncCountryOptions();
  if (activeTab === 'browse') renderContent();
});
void runQuery();
void loadSiteVisits();
void loadTopStations();
void loadBacklog();
