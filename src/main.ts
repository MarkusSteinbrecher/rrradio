import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  BUILTIN_STATIONS,
  findFetcher,
  findScheduleFetcher,
  loadBuiltinStations,
} from './builtins';
import type { ScheduleDay } from './metadata';
import { lookupCover } from './coverArt';
import { lookupLyrics } from './lyrics';
import type { LyricsResult } from './lyrics';
import { MetadataPoller, icyFetcher } from './metadata';
import { AudioPlayer } from './player';
import { track } from './telemetry';
import { pseudoFrequency } from './radioBrowser';
import { composeBrowseFilter, PAGE_SIZE, fetchStations, searchStations } from './stations';
import {
  addCustom,
  getCustom,
  getFavorites,
  getRecents,
  getLastWakeTime,
  getString,
  getWakeTo,
  isFavorite,
  pushRecent,
  removeCustom,
  reorderFavorites,
  setLastWakeTime,
  setString,
  setWakeTo,
  toggleFavorite,
} from './storage';
import { STATS_WORKER_BASE } from './config';
import { emptyState, statusLine } from './empty';
import {
  installGlobalErrorHandlers,
  reportStreamError,
  reportWorkerError,
} from './errors';
import { fmtSharePct, normalizeForSearch } from './format';
import {
  displayStation as displayStationPure,
  isWakeBedActive as isWakeBedActivePure,
  SILENT_BED_ID,
} from './np-display';
import { npFormatText, npLiveText } from './np-labels';
import {
  type MiniRefs,
  renderMiniPlayer as renderMiniPlayerImpl,
} from './render-mini';
import { faviconClass, stationInitials } from './station-display';
import {
  ICON_EMPTY,
  ICON_FAV,
  ICON_GRIP,
  ICON_HEART_FILL,
  ICON_HEART_LINE_CLASSED,
  ICON_RECENT,
  STAR_SVG,
} from './icons';
import { bootstrapTheme, toggleTheme } from './theme';
import { safeUrl, urlDisplay } from './url';
import { classifyStoredWake, fadeVolume, formatCountdown, nextFireTime, WakeScheduler } from './wake';
import type { NowPlaying, Station, WakeTo } from './types';

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const SLEEP_CYCLE_MIN = [0, 15, 30, 60];

type Tab = 'browse' | 'fav' | 'recent' | 'playing';
type ListTab = Exclude<Tab, 'playing'>;

// ─────────────────────────────────────────────────────────────
// Element refs
// ─────────────────────────────────────────────────────────────

// Audit #76: install error handlers before any other module-level work
// so a thrown exception during catalog load or a stray promise rejection
// in builtins.ts surfaces as an `error/runtime` or `error/promise`
// GoatCounter event instead of dying silently in the console.
installGlobalErrorHandlers();

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
    resetLyrics();
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

  // Lyrics — only when both artist + track are present (filters out
  // station IDs and news segments where parsed.artist stays undefined).
  if (parsed.artist && parsed.track) {
    loadLyrics(parsed.artist, parsed.track);
  } else {
    resetLyrics();
  }

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
        player.setTrackTitle(display, {
          ...parsed,
          coverUrl: cover,
          programName: parsed.program?.name,
          programSubtitle: parsed.program?.subtitle,
        });
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
const $curatedToggle = document.getElementById('curated-toggle') as HTMLButtonElement;
const $filterRow = document.getElementById('filter-row') as HTMLElement;
const $tabStatus = document.getElementById('tab-status') as HTMLElement;
const $topbarLibSeg = document.getElementById('topbar-lib-seg') as HTMLElement;
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
const $npPaneLyrics = document.getElementById('np-pane-lyrics') as HTMLButtonElement;
const $npProgramPane = document.getElementById('np-program-pane') as HTMLElement;
const $npProgramList = document.getElementById('np-program-list') as HTMLElement;
const $npLyricsPane = document.getElementById('np-lyrics-pane') as HTMLElement;
const $npLyricsText = document.getElementById('np-lyrics-text') as HTMLElement;
const $npTrackRow = document.getElementById('np-track-row') as HTMLElement;
const $npTrackTitle = document.getElementById('np-track-title') as HTMLElement;
const $npTrackCover = document.getElementById('np-track-cover') as HTMLImageElement;
const $npTrackSpotify = document.getElementById('np-track-spotify') as HTMLAnchorElement;
const $npTrackAppleMusic = document.getElementById('np-track-apple-music') as HTMLAnchorElement;
const $npTrackOpenInWrap = document.getElementById('np-track-open-in-wrap') as HTMLElement;
const $npTrackOpenIn = document.getElementById('np-track-open-in') as HTMLButtonElement;
const $npTrackOpenInPopup = document.getElementById('np-track-open-in-popup') as HTMLElement;
const $npStream = document.getElementById('np-stream') as HTMLAnchorElement;
const $npStreamHost = document.getElementById('np-stream-host') as HTMLElement;
const $npHome = document.getElementById('np-home') as HTMLAnchorElement;
const $npHomeHost = document.getElementById('np-home-host') as HTMLElement;
const $npFav = document.getElementById('np-fav') as HTMLButtonElement;
const $npSleep = document.getElementById('np-sleep') as HTMLButtonElement;
const $npSleepChip = document.getElementById('np-sleep-chip') as HTMLElement;
const $npWake = document.getElementById('np-wake') as HTMLButtonElement;
const $npWakeChip = document.getElementById('np-wake-chip') as HTMLElement;
const $wakeSheet = document.getElementById('wake-sheet') as HTMLElement;
const $wakeClose = document.getElementById('wake-close') as HTMLButtonElement;
const $wakeTime = document.getElementById('wake-time') as HTMLInputElement;
const $wakeTargetStation = document.getElementById('wake-target-station') as HTMLElement;
const $wakeTargetCover = document.getElementById('wake-target-cover') as HTMLElement;
const $wakeTargetHint = document.getElementById('wake-target-hint') as HTMLElement;
const $wakeToggle = document.getElementById('wake-toggle') as HTMLButtonElement;
const $wakePill = document.getElementById('wake-pill') as HTMLButtonElement;
const $wakePillTime = document.getElementById('wake-pill-time') as HTMLElement;
const $wakePillName = document.getElementById('wake-pill-name') as HTMLElement;
const $wakePillCount = document.getElementById('wake-pill-count') as HTMLElement;
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
const $dashCountryHeading = document.getElementById('dash-country-heading') as HTMLElement;
const $dashCountryToggle = document.getElementById('dash-country-toggle') as HTMLElement;

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
  getString(LIBRARY_KEY) === 'recent' ? 'recent' : 'fav';
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
// Scope filter: when true, the home + filtered views drop everything
// that isn't in BUILTIN_STATIONS — no RB long-tail, no GoatCounter
// played-* backlog rows, no Worldwide Load more button. Orthogonal
// to browseMode (works alongside Played; News auto-deselects since
// news-tag is RB-only).
let curatedOnly = false;
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

// Home-view "Worldwide" pagination — separate from filtered-browse
// state because the home view shows the full curated catalog first
// (no RB calls), and we only fetch RB top stations on demand when
// the user clicks Load more. Persists across mode/filter switches
// so the user doesn't lose loaded stations by tabbing away.
let homeRbStations: Station[] = [];
let homeRbOffset = 0;
let homeRbHasMore = true;
let homeRbLoading = false;

// SVG icon constants live in ./icons (audit #77 — split large modules).

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

// stationInitials + faviconClass live in ./station-display.

function favIdSet(): Set<string> {
  return new Set(getFavorites().map((s) => s.id));
}

function filterStations(stations: Station[], query: string): Station[] {
  const q = query.trim().toLowerCase();
  if (!q) return stations;
  const qNorm = normalizeForSearch(q);
  return stations.filter((s) => {
    if (s.name.toLowerCase().includes(q)) return true;
    if ((s.tags ?? []).some((t) => t.toLowerCase().includes(q))) return true;
    if (s.country && s.country.toLowerCase().includes(q)) return true;
    if (!qNorm) return false;
    if (normalizeForSearch(s.name).includes(qNorm)) return true;
    if ((s.tags ?? []).some((t) => normalizeForSearch(t).includes(qNorm))) return true;
    return false;
  });
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

/** ISO 3166-1 alpha-2 → flag emoji via regional indicator code points.
 *  Renders as a real flag on Apple / Linux; Windows shows the two-letter
 *  code (Windows ships no flag font for political reasons). Returns
 *  empty string for unknown / blank codes so the caller can no-op. */
function flagEmoji(country: string | undefined): string {
  if (!country || country.length !== 2) return '';
  const A = 0x1f1e6 - 'A'.charCodeAt(0);
  const cc = country.toUpperCase();
  return String.fromCodePoint(cc.charCodeAt(0) + A, cc.charCodeAt(1) + A);
}

// Capability stars — three small stars rendered inline before the tags
// text, one per dimension we provide for the station:
//   ★ stream  — we've vetted the URL plays (every published curated row)
//   ★ track   — broadcaster fetcher OR ICY metadata gives us "now playing"
//   ★ program — schedule fetcher gives us the on-air show + day grid
// Stars are conditionally appended, so a `stream-only` row shows ★, an
// `icy-only` row shows ★★, and a row backed by a full broadcaster API
// (FM4, BBC, BR, HR) shows ★★★.
function stationCapabilities(station: Station): { stream: boolean; track: boolean; program: boolean } {
  const stream = !!station.status;
  const track =
    stream && (!!station.metadata || station.status === 'icy-only' || station.status === 'working');
  const program = stream && !!findScheduleFetcher(station);
  return { stream, track, program };
}

function buildCapabilityStars(station: Station): HTMLSpanElement | null {
  const { stream, track, program } = stationCapabilities(station);
  if (!stream && !track && !program) return null;
  const wrap = document.createElement('span');
  wrap.className = 'row-stars';
  const titles: string[] = [];
  if (stream) titles.push('verified stream');
  if (track) titles.push('track info');
  if (program) titles.push('program info');
  wrap.title = titles.join(' · ');
  wrap.setAttribute('aria-label', titles.join(', '));
  let html = '';
  if (stream) html += `<span class="row-stars__star">${STAR_SVG}</span>`;
  if (track) html += `<span class="row-stars__star">${STAR_SVG}</span>`;
  if (program) html += `<span class="row-stars__star">${STAR_SVG}</span>`;
  wrap.innerHTML = html;
  return wrap;
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
  const flag = flagEmoji(station.country);
  if (flag) {
    const flagSpan = document.createElement('span');
    flagSpan.className = 'row-flag';
    flagSpan.textContent = flag;
    flagSpan.title = countryName(station.country!);
    name.append(' ', flagSpan);
  }
  const tags = document.createElement('div');
  tags.className = 'row-tags';
  const stars = buildCapabilityStars(station);
  if (stars) tags.append(stars);
  const tagsText = document.createElement('span');
  tagsText.className = 'row-tags__text';
  tagsText.textContent = (station.tags ?? []).slice(0, 3).join(' · ');
  tags.append(tagsText);
  info.append(name, tags);

  const right = document.createElement('div');
  right.className = 'row-right';
  const eq = buildEq(isPaused);
  const heart = buildHeart(isFav);
  heart.addEventListener('click', (e) => {
    e.stopPropagation();
    onToggleFav(station);
  });
  right.append(eq, heart);

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

// Pure NP/mini label helpers live in ./np-labels.

// ─────────────────────────────────────────────────────────────
// Render — Mini Player
// ─────────────────────────────────────────────────────────────

// displayStation + isWakeBedActive live in ./np-display (pure).
// setMiniArt + renderMiniPlayer live in ./render-mini (refs-based).
// The local wrappers below close over the production element refs
// + wakeScheduler so the rest of main.ts can call them with just (np).
const MINI_REFS: MiniRefs = {
  mini: $mini,
  miniFav: $miniFav,
  miniName: $miniName,
  miniMeta: $miniMeta,
};

function displayStation(np: NowPlaying): Station {
  return displayStationPure(np, wakeScheduler.current());
}

function isWakeBedActive(np: NowPlaying): boolean {
  return isWakeBedActivePure(np, wakeScheduler.current());
}

function renderMiniPlayer(np: NowPlaying): void {
  renderMiniPlayerImpl(MINI_REFS, np, wakeScheduler.current());
}

// ─────────────────────────────────────────────────────────────
// Render — Now Playing
// ─────────────────────────────────────────────────────────────

function renderNowPlaying(np: NowPlaying): void {
  const s = displayStation(np);
  const wakeBed = isWakeBedActive(np);
  $npName.textContent = s.name || '—';
  $npTags.textContent = (s.tags ?? []).join(' · ');
  // is-wake-bed dims the cover/logo + overlays a small mute icon so
  // it's visually obvious the audio is silent right now.
  $body.classList.toggle('is-wake-bed', wakeBed);

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

  // Streaming-service deep links. Both use the platform's search-by-
  // term URL: on mobile the universal-link handler intercepts and
  // opens the native app; on desktop they fall through to the web
  // player with the search pre-filled. We feed the full trackTitle
  // (often "Artist - Track") since we don't reliably get a clean
  // split from every metadata source — the search engines handle
  // that pattern well in practice.
  if (hasTrack) {
    const q = encodeURIComponent((np.trackTitle as string).trim());
    $npTrackSpotify.href = `https://open.spotify.com/search/${q}`;
    $npTrackAppleMusic.href = `https://music.apple.com/search?term=${q}`;
    $npTrackOpenInWrap.hidden = false;
  } else {
    $npTrackSpotify.removeAttribute('href');
    $npTrackAppleMusic.removeAttribute('href');
    $npTrackOpenInWrap.hidden = true;
    closeOpenInPopup();
  }

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
  $npPlay.setAttribute(
    'aria-label',
    np.state === 'playing' ? 'Pause' : np.state === 'loading' ? 'Cancel' : 'Play',
  );

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
  // tab-status used to repeat the section name + count under the
  // search bar on Library views, but the segmented control + the
  // section label below already say it. Always hidden now; kept in
  // the DOM in case a future tab wants the slot.
  $tabStatus.hidden = true;
  syncLibrarySegmented();
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


/** Two-pill segmented control rendered at the top of the Library tab.
 *  Lives in the sticky topbar so it stays visible regardless of how
 *  far the list has scrolled; populated/hidden via syncLibrarySegmented. */
function syncLibrarySegmented(): void {
  const visible = activeTab === 'fav' || activeTab === 'recent';
  $topbarLibSeg.hidden = !visible;
  if (!visible) return;
  if ($topbarLibSeg.childElementCount === 0) {
    const make = (key: LibrarySection, label: string) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'lib-seg__btn';
      btn.textContent = label;
      btn.addEventListener('click', () => {
        if (activeTab !== key) setTab(key);
      });
      return btn;
    };
    $topbarLibSeg.append(make('fav', 'Favorites'), make('recent', 'Recents'));
  }
  for (const btn of $topbarLibSeg.querySelectorAll<HTMLButtonElement>('.lib-seg__btn')) {
    const key = btn.textContent === 'Favorites' ? 'fav' : 'recent';
    const isActive = activeTab === key;
    btn.classList.toggle('is-active', isActive);
    btn.setAttribute('aria-pressed', String(isActive));
  }
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
const TOP_STATIONS_URL = `${STATS_WORKER_BASE}/api/public/top-stations?days=${STATS_DAYS}&limit=25`;
const PUBLIC_TOTALS_URL = `${STATS_WORKER_BASE}/api/public/totals?days=${STATS_DAYS}`;
const PUBLIC_LOCATIONS_URL = `${STATS_WORKER_BASE}/api/public/locations?days=${STATS_DAYS}&limit=50`;

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
    if (!res.ok) {
      reportWorkerError(new Error(`HTTP ${res.status}`), '/api/public/top-stations', res.status);
      return;
    }
    const data = (await res.json()) as { items?: Array<{ name?: string }> };
    const names = (data.items ?? [])
      .map((i) => i.name)
      .filter((n): n is string => typeof n === 'string' && n.length > 0);
    if (names.length === 0) return;
    topStationNames = names;
    if (activeTab === 'browse') renderContent();
  } catch (err) {
    reportWorkerError(err, '/api/public/top-stations');
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

/** Played stations, mapped to playable Station objects, then backfilled
 *  with the full BUILTIN_STATIONS list so the home view scrolls through
 *  every curated row. Built-ins win over backlog entries (we have logos +
 *  curated metadata for them). Backlog entries with broken/no-RB-match
 *  verdicts are skipped — we can't actually play them, so don't surface
 *  them. Returns the full list; callers slice if they want a cap. */
function playedStations(): Station[] {
  const builtinByName = new Map<string, Station>();
  for (const s of BUILTIN_STATIONS) builtinByName.set(s.name.toLowerCase(), s);
  const seen = new Set<string>();
  const ordered: Station[] = [];
  for (const name of topStationNames ?? []) {
    const lc = name.toLowerCase();
    if (seen.has(lc)) continue;
    const builtin = builtinByName.get(lc);
    if (builtin) {
      ordered.push(builtin);
      seen.add(lc);
      continue;
    }
    // Curated-only filter strips the GoatCounter-popular-but-not-curated
    // backlog rows ('played-<slug>' entries that come from station-backlog.json).
    if (curatedOnly) continue;
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
  // Backfill with every other curated station so the unfiltered home view
  // exposes the full catalog (sorted: top-played first, then YAML order).
  for (const s of BUILTIN_STATIONS) {
    if (!seen.has(s.name.toLowerCase())) {
      ordered.push(s);
      seen.add(s.name.toLowerCase());
    }
  }
  return ordered;
}

// Schedule (program guide) state for the currently-open Now Playing
// station. Fetched once when NP opens for stations whose broadcaster
// has a schedule API; null otherwise (the program panel stays hidden).
let npSchedule: ScheduleDay[] | null = null;
let npScheduleStationId: string | null = null;
let npScheduleAbort: AbortController | null = null;
let npSelectedDayIdx = 0;

// Lyrics state — fetched per track when artist+title are both available.
// Null means "we asked, neither LRCLIB nor Lyrics.ovh had it"; undefined
// means "haven't asked yet". Cache lives inside src/lyrics.ts.
let npLyrics: LyricsResult | null | undefined;
let npLyricsKey = ''; // `<artist>::<track>` lowercase
let npLyricsAbort: AbortController | undefined;

type NpView = 'now' | 'program' | 'lyrics';
let npView: NpView = 'now';

async function loadSchedule(station: Station): Promise<void> {
  // Cancel any in-flight load for a previous station, reset cached data.
  if (npScheduleAbort) npScheduleAbort.abort();
  npSchedule = null;
  npScheduleStationId = station.id;
  npView = 'now';
  npSelectedDayIdx = 0;
  syncNpTabs();

  const found = findScheduleFetcher(station);
  if (!found) {
    syncNpTabs();
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
    syncNpTabs();
  } catch {
    /* silent — program panel just stays hidden */
  }
}

/** Look up lyrics for the current track. Cached by key in lyrics.ts;
 *  this fn just gates the request on whether we already asked for the
 *  same key, and aborts in-flight fetches when the track changes. */
function loadLyrics(artist: string, track: string): void {
  const key = `${artist.toLowerCase().trim()}::${track.toLowerCase().trim()}`;
  if (key === npLyricsKey) return;
  npLyricsAbort?.abort();
  const ctrl = new AbortController();
  npLyricsAbort = ctrl;
  npLyricsKey = key;
  npLyrics = undefined;
  syncNpTabs();
  void lookupLyrics(artist, track, ctrl.signal)
    .then((result) => {
      if (ctrl.signal.aborted || key !== npLyricsKey) return;
      npLyrics = result;
      syncNpTabs();
      if (npView === 'lyrics') renderLyricsPane();
    })
    .catch(() => {
      /* abort or network — silently leave the tab hidden */
    });
}

/** Reset lyrics state (called on station change, or when the live
 *  metadata fetcher reports "no track currently playing"). */
function resetLyrics(): void {
  npLyricsAbort?.abort();
  npLyricsAbort = undefined;
  npLyrics = undefined;
  npLyricsKey = '';
  if (npView === 'lyrics') npView = 'now';
  syncNpTabs();
}

/** Synchronise the Now Playing tab pills + pane visibility with the
 *  three sources (track row, program guide, lyrics). The tab pill
 *  for a given source only shows when that source has content;
 *  if the user is currently viewing a source that disappears (e.g.
 *  on station change), drop them back to 'now'. */
function syncNpTabs(): void {
  const hasProgram = !!(npSchedule && npSchedule.length > 0);
  const hasLyrics = !!(npLyrics && (npLyrics.plain || npLyrics.synced));

  // Auto-switch back to 'now' if the active view's content is gone.
  if (npView === 'program' && !hasProgram) npView = 'now';
  if (npView === 'lyrics' && !hasLyrics) npView = 'now';

  // Show the tab strip whenever at least one secondary tab has content.
  $npPaneTabs.hidden = !hasProgram && !hasLyrics;
  $npPaneProgram.hidden = !hasProgram;
  $npPaneLyrics.hidden = !hasLyrics;

  $npPaneNow.classList.toggle('is-active', npView === 'now');
  $npPaneNow.setAttribute('aria-pressed', String(npView === 'now'));
  $npPaneProgram.classList.toggle('is-active', npView === 'program');
  $npPaneProgram.setAttribute('aria-pressed', String(npView === 'program'));
  $npPaneLyrics.classList.toggle('is-active', npView === 'lyrics');
  $npPaneLyrics.setAttribute('aria-pressed', String(npView === 'lyrics'));

  $npTrackRow.hidden = npView !== 'now';
  $npProgramPane.hidden = npView !== 'program';
  $npLyricsPane.hidden = npView !== 'lyrics';
}

function renderLyricsPane(): void {
  if (!npLyrics) {
    $npLyricsText.textContent = '';
    return;
  }
  // Plain text wins if both are present — synced is a UX nice-to-have
  // we can layer later (current-line highlight needs an estimate of
  // elapsed-since-track-started, which live radio doesn't give us).
  if (npLyrics.plain) {
    $npLyricsText.textContent = npLyrics.plain;
  } else if (npLyrics.synced) {
    $npLyricsText.textContent = npLyrics.synced.map((l) => l.text).join('\n');
  } else {
    $npLyricsText.textContent = '';
  }
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
  let liveRow: HTMLDivElement | null = null;
  let nextRow: HTMLDivElement | null = null;
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
    if (isLive && !liveRow) liveRow = row;
    else if (!isLive && !isPast && !nextRow) nextRow = row;
  }
  // Center the now-on-air row (or the next upcoming one if we hit a
  // gap between broadcasts). Deferred a frame so the pane's layout
  // is settled before scrollIntoView measures positions.
  const target = liveRow ?? nextRow;
  if (target) {
    requestAnimationFrame(() => {
      target.scrollIntoView({ block: 'center', behavior: 'instant' });
    });
  }
}

function setNpView(view: NpView): void {
  npView = view;
  syncNpTabs();
  if (npView === 'program') renderProgramPane();
  else if (npView === 'lyrics') renderLyricsPane();
}

$npPaneNow.addEventListener('click', () => setNpView('now'));
$npPaneProgram.addEventListener('click', () => setNpView('program'));
$npPaneLyrics.addEventListener('click', () => setNpView('lyrics'));

/** Available NP tabs in display order, filtered to those that have
 *  content right now. Always includes 'now'; program / lyrics appear
 *  only when their data sources have something to show. Used by
 *  swipe navigation to decide where each gesture lands. */
function availableNpViews(): NpView[] {
  const out: NpView[] = ['now'];
  if (npSchedule && npSchedule.length > 0) out.push('program');
  if (npLyrics && (npLyrics.plain || npLyrics.synced)) out.push('lyrics');
  return out;
}

/** Horizontal swipe on the Now Playing body navigates between the
 *  visible tabs. Threshold: at least 50px horizontal AND horizontal
 *  movement larger than vertical (so a finger that scrolls the lyrics
 *  pane vertically doesn't accidentally flip tabs). We listen passively
 *  via pointer events — no preventDefault, so vertical scroll inside
 *  panes keeps working. */
const SWIPE_THRESHOLD_PX = 50;
let swipeStartX = 0;
let swipeStartY = 0;
let swipeActivePointer: number | null = null;
const $npBody = document.querySelector('.np-body') as HTMLElement;

$npBody.addEventListener('pointerdown', (e) => {
  // Ignore right/middle clicks; touch + left mouse only.
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  swipeActivePointer = e.pointerId;
  swipeStartX = e.clientX;
  swipeStartY = e.clientY;
});

$npBody.addEventListener('pointerup', (e) => {
  if (swipeActivePointer !== e.pointerId) return;
  swipeActivePointer = null;
  const dx = e.clientX - swipeStartX;
  const dy = e.clientY - swipeStartY;
  if (Math.abs(dx) < SWIPE_THRESHOLD_PX) return;
  if (Math.abs(dx) <= Math.abs(dy)) return;
  const tabs = availableNpViews();
  const idx = tabs.indexOf(npView);
  if (idx < 0) return;
  // Swipe left (dx<0) advances forward through tabs; right (dx>0) goes back.
  const next = dx < 0 ? idx + 1 : idx - 1;
  const clamped = Math.max(0, Math.min(tabs.length - 1, next));
  if (clamped === idx) return;
  setNpView(tabs[clamped]);
});

$npBody.addEventListener('pointercancel', () => {
  swipeActivePointer = null;
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
      // Hold Cmd/Ctrl to zoom; plain scroll-wheel passes through to
      // page scroll. Without this, the map captures every wheel event
      // when the cursor is over it and listing-scroll appears to break.
      scrollWheelZoom: false,
      // Trackpad pinch (gesture-based zoom on touchpads) stays active.
      wheelPxPerZoomLevel: 80,
    });
    // Re-enable scroll-wheel zoom only while a modifier is held.
    mapEl.addEventListener('wheel', (e) => {
      if (e.ctrlKey || e.metaKey) {
        if (!map.scrollWheelZoom.enabled()) map.scrollWheelZoom.enable();
      } else if (map.scrollWheelZoom.enabled()) {
        map.scrollWheelZoom.disable();
      }
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


function renderRows(stations: Station[]): DocumentFragment {
  const frag = document.createDocumentFragment();
  const favs = favIdSet();
  for (const s of stations) frag.append(buildRow(s, currentNP.station.id, currentNP.state, favs));
  return frag;
}

/** Append a grip handle to each direct-child .row of `container` and
 *  wire pointer-event drag-to-reorder. On drop, persist via
 *  reorderFavorites and don't re-render — the DOM order already
 *  matches the new order. Designed for the favorites tab; the caller
 *  is responsible for only invoking it where reordering makes sense
 *  (no active search query, etc).
 *
 *  Drag mechanics:
 *    1. pointerdown snapshots all rows + their indices and the row
 *       height; the dragged row gets is-dragging (z-index lift).
 *    2. pointermove translates the dragged row by clientY-startY.
 *       The target index is computed as `originalIndex + round(dragY
 *       / rowHeight)`, and siblings between the original and target
 *       slots are translated +/- one row height to vacate the slot.
 *       No DOM mutation happens during drag — that avoids re-anchoring
 *       the pointer math after each swap.
 *    3. pointerup does a single atomic insertBefore to commit the
 *       new index, clears all transforms, and persists the order. */
function enableFavoriteReorder(container: HTMLElement): void {
  const rows = Array.from(container.querySelectorAll<HTMLElement>(':scope > .row'));
  if (rows.length < 2) return;

  for (const row of rows) {
    if (row.querySelector(':scope > .row-grip')) continue;
    const grip = document.createElement('button');
    grip.type = 'button';
    grip.className = 'row-grip';
    grip.setAttribute('aria-label', 'Drag to reorder');
    grip.innerHTML = ICON_GRIP;
    row.append(grip);
    attachGripDrag(grip, row, container);
  }
}

function attachGripDrag(
  grip: HTMLElement,
  row: HTMLElement,
  container: HTMLElement,
): void {
  let pointerId: number | null = null;
  let startY = 0;
  let originalIndex = -1;
  let targetIndex = -1;
  let allRows: HTMLElement[] = [];
  let rowHeight = 0;

  const clearShiftClasses = (): void => {
    for (const r of allRows) r.classList.remove('is-shifting-up', 'is-shifting-down');
  };

  const onPointerMove = (ev: PointerEvent): void => {
    if (ev.pointerId !== pointerId) return;
    // On iOS Safari an upward touch move is otherwise interpreted as
    // page scroll, fires pointercancel mid-gesture, and the drop
    // commit never runs — so the row "floats up then snaps back".
    // preventDefault here keeps the browser from claiming the gesture.
    ev.preventDefault();
    const dragY = ev.clientY - startY;
    row.style.setProperty('--drag-y', `${dragY}px`);

    // round() so half a row's drag advances the target by one slot —
    // symmetric for both directions.
    const offset = rowHeight > 0 ? Math.round(dragY / rowHeight) : 0;
    const newTarget = Math.max(0, Math.min(allRows.length - 1, originalIndex + offset));
    if (newTarget === targetIndex) return;
    targetIndex = newTarget;

    // Translate siblings between the original and target slots so
    // the user sees a visible "gap" sliding to where the row will
    // land. Rows below the dragged row shift up; rows above shift
    // down. The CSS classes carry the transition so the motion is
    // animated rather than snapping.
    for (let i = 0; i < allRows.length; i++) {
      const r = allRows[i];
      if (r === row) continue;
      r.classList.remove('is-shifting-up', 'is-shifting-down');
      if (i > originalIndex && i <= targetIndex) r.classList.add('is-shifting-up');
      else if (i < originalIndex && i >= targetIndex) r.classList.add('is-shifting-down');
    }
  };

  const onPointerUp = (ev: PointerEvent): void => {
    if (ev.pointerId !== pointerId) return;
    grip.removeEventListener('pointermove', onPointerMove);
    grip.removeEventListener('pointerup', onPointerUp);
    grip.removeEventListener('pointercancel', onPointerUp);
    if (pointerId !== null) {
      try { grip.releasePointerCapture(pointerId); } catch {/* ignore */}
    }
    pointerId = null;

    // Single atomic reorder: place the row at its target slot. Use
    // the snapshot's row at targetIndex as the anchor (it hasn't been
    // mutated during the drag — only its transform was animated).
    if (targetIndex !== originalIndex) {
      if (targetIndex < originalIndex) {
        const anchor = allRows[targetIndex];
        container.insertBefore(row, anchor);
      } else {
        const anchor = allRows[targetIndex];
        container.insertBefore(row, anchor.nextElementSibling);
      }
    }
    clearShiftClasses();
    for (const r of allRows) r.style.removeProperty('--row-h');
    row.classList.remove('is-dragging');
    row.style.removeProperty('--drag-y');

    const ids = Array.from(container.querySelectorAll<HTMLElement>(':scope > .row'))
      .map((r) => r.dataset.id ?? '')
      .filter(Boolean);
    reorderFavorites(ids);
  };

  grip.addEventListener('pointerdown', (ev) => {
    // Left mouse / primary touch only; ignore right-click, middle,
    // and secondary pointers.
    if (ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    pointerId = ev.pointerId;
    startY = ev.clientY;
    allRows = Array.from(container.querySelectorAll<HTMLElement>(':scope > .row'));
    originalIndex = allRows.indexOf(row);
    targetIndex = originalIndex;
    rowHeight = row.getBoundingClientRect().height;
    // Siblings need the row height to know how far to shift. Set on
    // each non-dragged row so the .is-shifting-up/down rules resolve.
    for (const r of allRows) {
      if (r !== row) r.style.setProperty('--row-h', `${rowHeight}px`);
    }
    row.classList.add('is-dragging');
    row.style.setProperty('--drag-y', '0px');
    grip.setPointerCapture(ev.pointerId);
    grip.addEventListener('pointermove', onPointerMove);
    grip.addEventListener('pointerup', onPointerUp);
    grip.addEventListener('pointercancel', onPointerUp);
  });
  // Click would otherwise bubble to the row's onRowPlay handler — a
  // tap on the grip should never start playback.
  grip.addEventListener('click', (ev) => ev.stopPropagation());
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
      if (curatedOnly) {
        // RB is off-limits — source locally and let News (and any
        // future tag-mode toggles) act as a sub-filter on the catalog.
        stations = playedStations();
        if (browseMode === 'news') {
          stations = stations.filter((s) =>
            (s.tags ?? []).some((t) => /news|talk/i.test(t)),
          );
          restLabel = 'News';
        } else {
          restLabel = 'Most played';
        }
      } else if (browseMode === 'played') {
        stations = playedStations();
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
        // Pagination — RB-sourced modes (null/news) paginate the
        // primary list; played mode appends a separate "Worldwide"
        // section on demand below the curated catalog.
        if ((browseMode === null || browseMode === 'news') && browseHasMore) {
          $content.append(loadMoreButton());
        }
        // Worldwide expansion only when we're not constrained to the
        // curated catalog (curatedOnly hides the section + button).
        if (browseMode === 'played' && !curatedOnly) {
          if (homeRbStations.length > 0) {
            $content.append(sectionLabel('Worldwide', homeRbStations.length));
            $content.append(renderRows(homeRbStations));
          }
          if (homeRbHasMore) $content.append(loadMoreHomeButton());
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
      // Reorder is only meaningful on the unfiltered list — a search
      // result's row order doesn't map back to the persisted order.
      if (!query) enableFavoriteReorder($content);
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

/** Snapshot the current Browse-tab inputs into a shape composeBrowseFilter
 *  can operate on. One read site, used by runQuery + loadMore so they
 *  cannot drift out of sync (the audit-#70 bug). */
function browseInputs(): {
  query: string;
  activeTag: string;
  activeCountry: string;
  browseMode: 'played' | 'news' | null;
} {
  return {
    query: $search.value,
    activeTag,
    activeCountry,
    browseMode,
  };
}

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
  const { filter, hasAnyFilter } = composeBrowseFilter(browseInputs(), { offset: 0 });
  // Skip Radio Browser fetch when:
  //  · curated-only is on (we never render RB results in that mode)
  //  · OR mode is 'played' AND no filter is set (local data only)
  // Mode='news' and mode=null both need an RB fetch (unless curated-only
  // is on, in which case we'd never use the result).
  const needsRb =
    !curatedOnly && (hasAnyFilter || browseMode === null || browseMode === 'news');
  if (!needsRb) {
    if (myToken !== queryToken) return;
    lastBrowseStations = [];
    renderContent();
    return;
  }
  $content.replaceChildren(statusLine('Tuning in…'));
  try {
    const stations = await searchStations(filter);
    if (myToken !== queryToken) return;
    lastBrowseStations = stations;
    // RB's searchStations dedupes by streamUrl, so a 60-result page
    // typically lands at ≤59 — `=== PAGE_SIZE` would false-negative
    // every time. Treat any non-empty page as "there's more"; an
    // empty response means we've actually exhausted the catalog or
    // the request errored.
    browseHasMore = stations.length > 0;
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
    const { filter, hasAnyFilter } = composeBrowseFilter(browseInputs(), {
      offset: nextOffset,
    });
    // Filtered pagination uses searchStations (carries query + tag +
    // country); unfiltered home-view uses fetchStations which returns
    // the worldwide top-by-votes feed.
    const more = hasAnyFilter
      ? await searchStations(filter)
      : await fetchStations(nextOffset);
    if (myToken !== queryToken) return;
    // Radio Browser sometimes returns duplicates across page boundaries
    // (when records shift between requests). De-dupe by id.
    const seen = new Set(lastBrowseStations.map((s) => s.id));
    const fresh = more.filter((s) => !seen.has(s.id));
    lastBrowseStations = lastBrowseStations.concat(fresh);
    browseOffset = nextOffset;
    // See the runQuery comment — `> 0` instead of `=== PAGE_SIZE`
    // because RB's per-page dedupe keeps trimming below the limit.
    browseHasMore = more.length > 0;
  } catch {
    browseHasMore = false;
  } finally {
    browseLoadingMore = false;
    renderContent();
  }
}

/** Normalised station-name key for dedupe across sources. RB's IDs
 *  (stationuuid) and our local IDs ('builtin-fm4', 'rb-bbc-...') don't
 *  overlap, and stream URLs differ across regional / protocol variants
 *  for the same logical station — so name is the most reliable signal
 *  that "BBC World Service" the curated entry and "BBC World Service"
 *  the RB record represent the same thing. */
function stationNameKey(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

/** Home-view Load more — fetches RB's top stations (sorted by
 *  clickcount globally) and appends them under a "Worldwide" section
 *  below the curated catalog. Each click pulls the next PAGE_SIZE.
 *  Anything sharing a name (case-insensitive) with a curated station
 *  or an already-loaded RB station is filtered out so the same row
 *  doesn't appear twice across the home view. */
async function loadMoreHome(): Promise<void> {
  if (homeRbLoading || !homeRbHasMore) return;
  homeRbLoading = true;
  renderContent();
  try {
    const more = await fetchStations(homeRbOffset);
    // Dedupe against the full home view list (curated + GoatCounter
    // backlog rows surfaced by playedStations()), not just BUILTIN.
    // Otherwise non-curated played rows (REYFM-class) reappear in
    // the Worldwide section.
    const homeNames = new Set(playedStations().map((s) => stationNameKey(s.name)));
    const seenNames = new Set(homeRbStations.map((s) => stationNameKey(s.name)));
    const fresh = more.filter((s) => {
      const key = stationNameKey(s.name);
      if (homeNames.has(key) || seenNames.has(key)) return false;
      seenNames.add(key); // dedupe within this batch too
      return true;
    });
    homeRbStations = homeRbStations.concat(fresh);
    homeRbOffset += PAGE_SIZE;
    // Empty response means we've actually exhausted RB's catalog
    // (or it errored). Anything else is fair game — RB applies its
    // own dedupe-by-streamUrl which makes the literal page size fall
    // below PAGE_SIZE on most calls, so we can't use that as a
    // "hasMore" signal.
    homeRbHasMore = more.length > 0;
  } catch {
    homeRbHasMore = false;
  } finally {
    homeRbLoading = false;
    renderContent();
  }
}

function loadMoreHomeButton(): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'load-more';
  btn.disabled = homeRbLoading;
  btn.textContent = homeRbLoading
    ? 'Loading…'
    : homeRbStations.length === 0
      ? 'Show worldwide stations'
      : 'Load more';
  btn.addEventListener('click', () => void loadMoreHome());
  return btn;
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
    // Wake-aware: a tap on the currently-playing row pauses, but if
    // a wake is armed we swap to the silent bed instead so the wake
    // doesn't get killed by the iOS lock-screen suspension.
    handlePlayToggle();
    return;
  }
  pushRecent(station);
  void player.play(station);
  track(`play: ${station.name}`);
  if (activeTab === 'recent') renderContent();
  // Open Now Playing on first play of this station
  openNp(true);
  // Reflect the active station in the URL so the user can copy it /
  // refresh / share. Only built-in stations get a pre-rendered
  // /station/<id>/ page; for custom + RB rows we leave the URL alone.
  syncUrlForStation(station);
}

function syncUrlForStation(station: Station): void {
  const isBuilt = BUILTIN_STATIONS.some((b) => b.id === station.id);
  if (!isBuilt) return;
  const next = `/station/${station.id}/`;
  if (window.location.pathname === next) return;
  window.history.pushState({ stationId: station.id }, '', next);
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
  // Restore the homepage URL when returning home — symmetric with
  // syncUrlForStation pushing /station/<id>/ on row click.
  if (window.location.pathname !== '/') {
    window.history.pushState({}, '', '/');
  }
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
    setString(LIBRARY_KEY, tab);
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

// Theme persistence + DOM application live in ./theme. Boot wiring
// applies the persisted choice before first paint, then keeps the
// `<meta name="theme-color">` tint in sync with the OS preference if
// the user hasn't picked an explicit theme.
bootstrapTheme();

function onToggleTheme(): void {
  const next = toggleTheme();
  track(`theme/${next}`);
}

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

type DashCountryView = 'listeners' | 'stations';

interface DashboardData {
  totalPlays: number;
  totalStations: number;
  /** Visitor-country counts (where listeners browse from). */
  byListenerCountry: Map<string, number>;
  /** Station-origin counts (where each played station is from), built
   *  from the top-stations payload joined against BUILTIN_STATIONS. */
  byStationCountry: Map<string, number>;
}

let dashView: DashCountryView = 'listeners';
let lastDashboardData: DashboardData | null = null;

async function fetchTopStationsWithCounts(): Promise<TopStationItem[]> {
  try {
    const res = await fetch(TOP_STATIONS_URL);
    if (!res.ok) {
      reportWorkerError(new Error(`HTTP ${res.status}`), '/api/public/top-stations', res.status);
      return [];
    }
    const data = (await res.json()) as { items?: TopStationItem[] };
    return (data.items ?? []).filter((i) => typeof i.name === 'string' && i.name.length > 0);
  } catch (err) {
    reportWorkerError(err, '/api/public/top-stations');
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
    if (!res.ok) {
      reportWorkerError(new Error(`HTTP ${res.status}`), '/api/public/totals', res.status);
      return null;
    }
    return (await res.json()) as PublicTotals;
  } catch (err) {
    reportWorkerError(err, '/api/public/totals');
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
    if (!res.ok) {
      reportWorkerError(new Error(`HTTP ${res.status}`), '/api/public/locations', res.status);
      return [];
    }
    const data = (await res.json()) as { items?: PublicLocationItem[] };
    return data.items ?? [];
  } catch (err) {
    reportWorkerError(err, '/api/public/locations');
    return [];
  }
}

function aggregateDashboard(
  items: TopStationItem[],
  locations: PublicLocationItem[],
): DashboardData {
  let totalPlays = 0;
  let totalStations = 0;
  const builtinByName = new Map<string, Station>();
  for (const s of BUILTIN_STATIONS) builtinByName.set(s.name.toLowerCase(), s);
  const byStationCountry = new Map<string, number>();
  for (const it of items) {
    totalStations++;
    totalPlays += it.count;
    const builtin = builtinByName.get(it.name.toLowerCase());
    const cc = builtin?.country?.toUpperCase();
    if (!cc) continue;
    byStationCountry.set(cc, (byStationCountry.get(cc) ?? 0) + it.count);
  }
  const byListenerCountry = new Map<string, number>();
  for (const loc of locations) {
    if (!loc.code) continue;
    const cc = loc.code.toUpperCase();
    byListenerCountry.set(cc, (byListenerCountry.get(cc) ?? 0) + loc.count);
  }
  return { totalPlays, totalStations, byListenerCountry, byStationCountry };
}

function activeCountryMap(d: DashboardData): Map<string, number> {
  return dashView === 'listeners' ? d.byListenerCountry : d.byStationCountry;
}

function renderDashKpis(d: DashboardData, totals: PublicTotals | null): void {
  $dashVisits.textContent = totals?.total != null ? totals.total.toLocaleString() : '—';
  // The "Countries" KPI follows whichever view is active so the
  // headline matches the table + map below.
  $dashCountries.textContent = String(activeCountryMap(d).size);
  $dashStations.textContent = String(d.totalStations);
}

function renderDashCountryTable(d: DashboardData): void {
  $dashCountryTable.replaceChildren();
  const sorted = [...activeCountryMap(d).entries()].sort((a, b) => b[1] - a[1]);
  const max = sorted[0]?.[1] ?? 1;
  const total = sorted.reduce((s, [, c]) => s + c, 0);
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
    const pct = document.createElement('td');
    pct.className = 'pct';
    pct.textContent = fmtSharePct(count, total);
    tr.append(rank, country, bar, num, pct);
    $dashCountryTable.append(tr);
  });
}

function renderDashStationTable(items: TopStationItem[]): void {
  $dashStationTable.replaceChildren();
  if (items.length === 0) return;
  const max = items[0]?.count ?? 1;
  const total = items.reduce((s, it) => s + it.count, 0);
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
    const pct = document.createElement('td');
    pct.className = 'pct';
    pct.textContent = fmtSharePct(it.count, total);
    tr.append(rank, name, bar, num, pct);
    $dashStationTable.append(tr);
  });
}

function getCountryCentroid(cc: string): [number, number] | null {
  if (COUNTRY_CENTROIDS[cc]) return COUNTRY_CENTROIDS[cc];
  // Fallback: any curated station from that country
  const s = BUILTIN_STATIONS.find((x) => x.country?.toUpperCase() === cc && x.geo);
  return s?.geo ?? null;
}

// The dashboard map mirrors the Browse globe view: real CARTO dark
// tiles via Leaflet, with one circle marker per country at the
// centroid. Web Mercator from Leaflet aligns markers correctly at
// every latitude, where the previous home-rolled equirectangular
// projection onto a non-equirectangular SVG misplaced them.
let dashLeafletMap: L.Map | null = null;

function teardownDashMap(): void {
  dashLeafletMap?.remove();
  dashLeafletMap = null;
  $dashMap.replaceChildren();
}

function renderDashMap(d: DashboardData): void {
  teardownDashMap();
  const data = activeCountryMap(d);

  if (data.size === 0) {
    const empty = document.createElement('div');
    empty.className = 'dash-map-empty';
    empty.textContent =
      dashView === 'listeners' ? 'No listener-location data yet' : 'No station-country data yet';
    $dashMap.append(empty);
    return;
  }

  const mapEl = document.createElement('div');
  mapEl.className = 'dash-map-leaflet';
  $dashMap.append(mapEl);

  // Leaflet measures its container at init; the wrap has to be in
  // the DOM and laid out first. queueMicrotask defers to the next
  // tick after the synchronous append above.
  queueMicrotask(() => {
    if (!mapEl.isConnected) return;
    const lmap = L.map(mapEl, {
      worldCopyJump: true,
      zoomControl: false,
      attributionControl: true,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
    });
    dashLeafletMap = lmap;

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      subdomains: 'abcd',
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> ' +
        '&copy; <a href="https://carto.com/attributions">CARTO</a>',
    }).addTo(lmap);

    // Show the inhabited band only — fitWorld zooms out enough to
    // include Antarctica, leaving lots of empty space at the bottom.
    lmap.fitBounds([
      [-55, -170],
      [70, 170],
    ]);

    // Resolve the theme accent at render time so the markers track
    // theme switches (Warm/Cool/Yellow × light/dark).
    const accent =
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ffff00';

    const max = Math.max(...data.values());
    const unit = dashView === 'listeners' ? 'visitors' : 'plays';
    for (const [cc, count] of data) {
      const centroid = getCountryCentroid(cc);
      if (!centroid) continue;
      // sqrt(share) → area-proportional. Pixel radius is constant
      // at every zoom level (circleMarker, not circle), so the dot
      // sizes stay readable as the user pans/zooms.
      const share = count / max;
      const r = 4 + Math.sqrt(share) * 12;

      const marker = L.circleMarker(centroid, {
        radius: r,
        color: accent,
        weight: 1,
        opacity: 0.85,
        fillColor: accent,
        fillOpacity: 0.45,
      }).addTo(lmap);
      marker.bindTooltip(`${countryName(cc)} · ${count} ${unit}`, {
        direction: 'top',
        offset: [0, -r],
        opacity: 0.95,
      });
    }
  });
}

function syncDashToggle(): void {
  $dashCountryHeading.textContent =
    dashView === 'listeners' ? 'Where listeners are' : 'Where stations are from';
  for (const btn of $dashCountryToggle.querySelectorAll<HTMLButtonElement>('.lib-seg__btn')) {
    const isActive = btn.dataset.view === dashView;
    btn.classList.toggle('is-active', isActive);
    btn.setAttribute('aria-pressed', String(isActive));
  }
}

function applyDashView(): void {
  if (!lastDashboardData) return;
  syncDashToggle();
  $dashCountries.textContent = String(activeCountryMap(lastDashboardData).size);
  renderDashCountryTable(lastDashboardData);
  void renderDashMap(lastDashboardData);
}

$dashCountryToggle.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.lib-seg__btn');
  if (!btn) return;
  const view = btn.dataset.view as DashCountryView | undefined;
  if (!view || view === dashView) return;
  dashView = view;
  applyDashView();
});

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
  lastDashboardData = data;
  syncDashToggle();
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
  if (!safeUrl(streamUrl)) {
    showAddError('Stream URL must be a valid http:// or https:// URL.');
    return;
  }
  // The page is served over https, so an http:// stream is blocked by
  // mixed-content. Reject up-front rather than letting the user save a
  // station that will silently fail to play. Audit #71.
  if (streamUrl.startsWith('http://')) {
    showAddError('Stream URL must use https://. Mixed-content browsers block http:// audio.');
    return;
  }
  if (homepage && !safeUrl(homepage)) {
    showAddError('Homepage must be a valid http:// or https:// URL.');
    return;
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

// ─────────────────────────────────────────────────────────────
// Wake-to-radio
// ─────────────────────────────────────────────────────────────
//
// One armed wake-to setting at a time. The scheduler in wake.ts
// handles the timing logic; everything below is glue:
//   · syncWakePill() / syncWakeChip() reflect armed state in the UI
//   · openWakeSheet() populates the sheet from current state
//   · armWakeFromSheet() persists, arms the scheduler
//   · onWakeFire() switches station + fades up + notifies
const wakeScheduler = new WakeScheduler();
let pillTickTimer: number | undefined;

function openWakeSheet(open: boolean): void {
  $wakeSheet.classList.toggle('open', open);
  $wakeSheet.setAttribute('aria-hidden', String(!open));
  if (!open) return;

  const armed = wakeScheduler.current();
  // The wake station is whatever's currently tuned in — clock-radio
  // metaphor. If an alarm is already armed, surface the station it's
  // tied to instead, since we don't want a sheet-reopen to silently
  // swap targets.
  const station = armed?.station ?? (currentNP.station.id ? currentNP.station : null);
  // Default to: armed time → user's last-used wake time → 07:00.
  // Persisting the last-used time means the user doesn't re-pick
  // 23:00 every night just because they disarmed in the morning.
  $wakeTime.value = armed?.time ?? getLastWakeTime() ?? '07:00';
  $wakeTargetStation.textContent = station?.name ?? '—';
  $wakeTargetCover.replaceChildren();
  if (station) $wakeTargetCover.append(buildFavicon(station, 56));
  const noStation = !station;
  $wakeTargetHint.hidden = !noStation;

  // Single toggle button: "Disarm" while armed, "Arm" otherwise. The
  // is-armed class flips it from the primary accent fill to a softer
  // outlined treatment so it doesn't shout "tap me" once already
  // armed.
  if (armed) {
    $wakeToggle.textContent = 'Disarm';
    $wakeToggle.classList.add('is-armed');
    $wakeToggle.disabled = false;
  } else {
    $wakeToggle.textContent = 'Arm';
    $wakeToggle.classList.remove('is-armed');
    $wakeToggle.disabled = noStation;
  }
}

function setMuted(muted: boolean): void {
  if (player.isMuted() !== muted) player.toggleMute();
  $body.classList.toggle('is-muted', muted);
  $npMute.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
}

// Stub "station" for the silent audio bed. /silence.m4a is a tiny
// AAC clip (4KB) that loops via audio.loop = true. Playing it keeps
// the iOS audio session alive on locked screen — iOS treats a tab
// producing silent samples the same as a tab producing audible
// audio for tab-suspension purposes. Then at fire time we swap the
// audio element's source to the wake station; because the session
// has been continuously active, the swap doesn't need a fresh user
// gesture and bypasses the autoplay block.
const SILENT_BED: Station = {
  id: SILENT_BED_ID,
  name: 'Silent bed',
  streamUrl: '/silence.m4a',
};

function armWakeFromSheet(): void {
  const time = $wakeTime.value.trim();
  const armed = wakeScheduler.current();
  // Prefer the already-armed station so a re-open of the sheet to
  // change time alone doesn't accidentally reset the target. Falls
  // back to whatever's currently playing for a fresh arm.
  const station = armed?.station ?? (currentNP.station.id ? currentNP.station : null);
  if (!time || !station) return;
  const wake: WakeTo = {
    time,
    stationId: station.id,
    station,
    armedAt: Date.now(),
  };
  setWakeTo(wake);
  setLastWakeTime(time);
  wakeScheduler.arm(wake, onWakeFire);
  syncWakeUi();
  startPillTick();
  ensureNotificationPermission();
  track('wake/arm', time);
  openWakeSheet(false);

  // Critical: start the silent bed right now while the user gesture
  // from the Arm tap is still in scope. The bed is a 1-second
  // silent AAC clip looped via audio.loop = true. From here the
  // audio element keeps producing samples through the night, the
  // tab stays alive on lock, and the fire-time station swap stays
  // within the same active media-playback session — no fresh
  // gesture needed.
  void player.play(SILENT_BED, { loop: true }).then(() => {
    // Lock-screen Now Playing widget should explain what's going on.
    // Without this it'd show "Silent bed" which is confusing if the
    // user wakes mid-night and checks their phone. Override the title
    // to surface the wake target + time.
    player.setTrackTitle(`Wake to ${wake.station.name} at ${wake.time}`, {
      track: `Wake to ${wake.station.name} at ${wake.time}`,
      artist: 'rrradio',
    });
  });
}

function disarmWake(persist = true): void {
  // Capture the armed station before clearing the scheduler — we use
  // it below to swap audio off the silent bed.
  const armed = wakeScheduler.current();
  wakeScheduler.disarm();
  if (persist) setWakeTo(null);
  stopPillTick();
  syncWakeUi();
  track('wake/disarm');

  // If we're still playing the silent bed (i.e. the user disarmed
  // before fire and hasn't manually switched stations), swap back
  // to the originally-armed station — that's what they were
  // listening to before they armed, so it's the least surprising
  // resumption. Without this, Now Playing keeps reading "Silent bed".
  if (currentNP.station.id === SILENT_BED.id && armed?.station) {
    void player.play(armed.station);
  }
}

function onWakeFire(wake: WakeTo): void {
  // Swap from the silent bed to the wake station. Audio session has
  // been active since arm time (silent bed looping), so the play()
  // call is treated as continuation, not a fresh autoplay attempt.
  setWakeTo(null);
  // Visible "Wake fired" pulse so a user grabbing the phone at 7am
  // sees a clear acknowledgement instead of the pill silently
  // vanishing. Stays for 60s, then the regular pill cleanup runs.
  showWakeFiredPulse(wake);
  stopPillTick();
  track('wake/fire', wake.station.name);
  // Force-unmute defensively in case the user manually muted before
  // sleeping. setMuted(true) wasn't called at arm in v2, but the
  // mute button is still on the UI and the user might have hit it.
  setMuted(false);
  player.setVolume(0);
  void player.play(wake.station);
  // Linear fade from 0 → full over 30 seconds. RAF-driven so it
  // tracks the wall clock, not setTimeout drift. Audible only on
  // Android/desktop; iOS Safari forces audio.volume to 1 regardless,
  // so iOS users wake at the phone's hardware volume immediately.
  fadeVolume((v) => player.setVolume(v), 0, 1, 30_000);
  // Notification: best-effort. Browsers limit when this works (must be
  // visible OR have a service worker). We try and ignore failures.
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(`Wake to ${wake.station.name}`, {
        body: `It's ${wake.time} — playing now.`,
        silent: false,
      });
    }
  } catch {
    // ignore — audio is the alarm regardless
  }
}

function ensureNotificationPermission(): void {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    void Notification.requestPermission();
  }
}

function startPillTick(): void {
  stopPillTick();
  syncWakeUi();
  // Update once per minute. The pill only displays minute-resolution
  // ("in 4h 12m"), so a faster cadence would be wasteful.
  pillTickTimer = window.setInterval(syncWakeUi, 60_000);
}

function stopPillTick(): void {
  if (pillTickTimer !== undefined) {
    window.clearInterval(pillTickTimer);
    pillTickTimer = undefined;
  }
}

function syncWakeUi(): void {
  // Don't clobber the post-fire pulse mid-display.
  if ($wakePill.dataset.fired === 'true') return;
  const wake = wakeScheduler.current();
  if (!wake) {
    $wakePill.hidden = true;
    $npWakeChip.hidden = true;
    $npWakeChip.textContent = '';
    $npWake.classList.remove('is-fav');
    $npWake.setAttribute('aria-label', 'Wake to radio');
    return;
  }
  const remain = nextFireTime(wake) - Date.now();
  $wakePill.hidden = false;
  $wakePillTime.textContent = wake.time;
  $wakePillName.textContent = wake.station.name;
  $wakePillCount.textContent = formatCountdown(remain);
  $npWakeChip.hidden = false;
  $npWakeChip.textContent = wake.time;
  $npWake.classList.add('is-fav');
  $npWake.setAttribute('aria-label', `Wake to ${wake.station.name} at ${wake.time}`);
}

// Wake-aware stop. Pausing the audio element on iOS makes the tab
// suspendable on lock, which would silently kill an armed wake. So
// when wake is armed, "stop" means "swap to the silent bed" — audio
// element keeps producing samples, tab stays alive, and the
// fire-time swap to the wake station still works. Without an armed
// wake we just pause normally.
//
// Used by the sleep-timer fire and by the user's own play/pause tap
// while listening to a real station.
function pausePreservingWake(): void {
  if (wakeScheduler.current() && currentNP.station.id !== SILENT_BED.id) {
    void player.play(SILENT_BED, { loop: true }).then(() => {
      const armed = wakeScheduler.current();
      if (!armed) return;
      player.setTrackTitle(`Wake to ${armed.station.name} at ${armed.time}`, {
        track: `Wake to ${armed.station.name} at ${armed.time}`,
        artist: 'rrradio',
      });
    });
  } else {
    player.pause();
  }
}

// Play/pause click router. On the silent bed with a wake armed, the
// "play" tap means "let me actually listen now" — swap to the wake
// station. On a real station with a wake armed, the "pause" tap
// swaps to the silent bed. Outside of wake-armed context, behave
// like player.toggle().
function handlePlayToggle(): void {
  const armed = wakeScheduler.current();
  if (armed && currentNP.station.id === SILENT_BED.id) {
    void player.play(armed.station);
    return;
  }
  // Tap during loading = cancel the connection. Without this the
  // user is stuck waiting on a slow / dead stream with no obvious
  // way out short of opening another station. pausePreservingWake
  // halts the load (and swaps to the silent bed if a wake is
  // armed, so the wake survives).
  if (currentNP.state === 'playing' || currentNP.state === 'loading') {
    pausePreservingWake();
    return;
  }
  player.toggle();
}

let firedPulseTimer: number | undefined;
function showWakeFiredPulse(wake: WakeTo): void {
  $wakePill.dataset.fired = 'true';
  $wakePill.hidden = false;
  $wakePillTime.textContent = wake.time;
  $wakePillName.textContent = wake.station.name;
  $wakePillCount.textContent = 'fired';
  if (firedPulseTimer !== undefined) window.clearTimeout(firedPulseTimer);
  firedPulseTimer = window.setTimeout(() => {
    delete $wakePill.dataset.fired;
    syncWakeUi();
    firedPulseTimer = undefined;
  }, 60_000);
}

// Restore any previously-armed wake on app load. If the stored fire
// time has already passed (browser was closed across the wake window),
// classifyStoredWake decides whether we still fire (within a 60s grace)
// or silently clear — see src/wake.ts for the rule.
function restoreWakeOnBoot(): void {
  const stored = getWakeTo();
  if (!stored) return;
  const verdict = classifyStoredWake(stored);
  if (verdict !== 'fire') {
    setWakeTo(null);
    syncWakeUi();
    return;
  }
  wakeScheduler.arm(stored, onWakeFire);
  syncWakeUi();
  startPillTick();
}

wakeScheduler.onTick(syncWakeUi);

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
    // pausePreservingWake() instead of bare pause() so the sleep
    // timer doesn't silently break an armed wake — iOS suspends a
    // paused tab on lock, which kills the fire callback.
    pausePreservingWake();
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

function syncCuratedToggle(): void {
  $curatedToggle.classList.toggle('is-active', curatedOnly);
  $curatedToggle.setAttribute('aria-pressed', String(curatedOnly));
}

function setCuratedOnly(target: boolean): void {
  if (curatedOnly === target) return;
  curatedOnly = target;
  syncCuratedToggle();
  selectedClusterKey = null;
  track(`curated/${curatedOnly ? 'on' : 'off'}`);
  void runQuery();
}

$modePlayed.addEventListener('click', () => setBrowseMode('played'));
$newsToggle.addEventListener('click', () => setBrowseMode('news'));
$curatedToggle.addEventListener('click', () => setCuratedOnly(!curatedOnly));

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

$themeBtn.addEventListener('click', onToggleTheme);
$aboutBtn.addEventListener('click', () => openAboutSheet(true));
$aboutClose.addEventListener('click', () => openAboutSheet(false));
$dashboardBtn.addEventListener('click', () => void openDashboardSheet(true));
$dashboardClose.addEventListener('click', () => void openDashboardSheet(false));

$npWake.addEventListener('click', () => openWakeSheet(true));
$wakeClose.addEventListener('click', () => openWakeSheet(false));
$wakePill.addEventListener('click', () => openWakeSheet(true));
// Single toggle button — disarms when already armed, arms otherwise.
$wakeToggle.addEventListener('click', () => {
  if (wakeScheduler.current()) {
    disarmWake();
    openWakeSheet(false);
  } else {
    armWakeFromSheet();
  }
});

$mini.addEventListener('click', () => openNp(true));

const $npBack = document.getElementById('np-back') as HTMLButtonElement;
$npBack.addEventListener('click', () => openNp(false));
$miniToggle.addEventListener('click', (e) => {
  e.stopPropagation();
  handlePlayToggle();
});

$npPlay.addEventListener('click', () => handlePlayToggle());

// Open-in popup — arrow trigger reveals a small panel with the
// official "Listen on" badges. Click outside / Esc / pick a badge
// closes it. The wrapper carries the open-state for hover styling.
//
// The popup must escape `.np-body { overflow: hidden }` AND `.np`'s
// transform (a transformed ancestor turns `position: fixed` into a
// containing block, re-clipping us). Moving the popup to body lifts
// it out of both, so the fixed positioning is true viewport-relative.
document.body.appendChild($npTrackOpenInPopup);

function positionOpenInPopup() {
  const r = $npTrackOpenIn.getBoundingClientRect();
  $npTrackOpenInPopup.style.top = `${Math.round(r.bottom + 8)}px`;
  $npTrackOpenInPopup.style.right = `${Math.round(window.innerWidth - r.right - 4)}px`;
}
function openOpenInPopup() {
  positionOpenInPopup();
  $npTrackOpenInPopup.hidden = false;
  $npTrackOpenInWrap.dataset.open = 'true';
  $npTrackOpenIn.setAttribute('aria-expanded', 'true');
  track('open-in/show', currentNP.trackTitle ?? '');
}
function closeOpenInPopup() {
  $npTrackOpenInPopup.hidden = true;
  delete $npTrackOpenInWrap.dataset.open;
  $npTrackOpenIn.setAttribute('aria-expanded', 'false');
}
$npTrackOpenIn.addEventListener('click', (e) => {
  e.stopPropagation();
  if ($npTrackOpenInPopup.hidden) openOpenInPopup();
  else closeOpenInPopup();
});
document.addEventListener('click', (e) => {
  if ($npTrackOpenInPopup.hidden) return;
  const t = e.target as Node;
  if ($npTrackOpenInWrap.contains(t)) return;
  if ($npTrackOpenInPopup.contains(t)) return;
  closeOpenInPopup();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$npTrackOpenInPopup.hidden) closeOpenInPopup();
});
window.addEventListener('resize', () => {
  if (!$npTrackOpenInPopup.hidden) positionOpenInPopup();
});

// Streaming-service deep links — count taps so we can see if anyone
// uses them. Title carries the track string for the dashboard.
$npTrackSpotify.addEventListener('click', () => {
  track('open-spotify', currentNP.trackTitle ?? '');
  closeOpenInPopup();
});
$npTrackAppleMusic.addEventListener('click', () => {
  track('open-apple-music', currentNP.trackTitle ?? '');
  closeOpenInPopup();
});
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
  if (stationChanged) {
    void loadSchedule(np.station);
    resetLyrics();
  }
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
      // Keep the existing per-station error event (the dashboard reads
      // `error: <station>` for the broken-station list), AND emit a
      // structured `error/stream` event so the same regression shows up
      // in the global error feed alongside catalog/worker/runtime
      // errors. Audit #76.
      track(`error: ${np.station.name || 'unknown'}`, reason);
      reportStreamError(reason, np.station.id);
    }
  } else if (np.state !== 'error') {
    lastErrorMessage = '';
  }
  prevState = np.state;
  prevStationId = np.station.id;

  // Drive the metadata poller off the loaded station, not the
  // playback state — the user wants to see what's on air before
  // they tap play, and on a paused/loading station the broadcast
  // is still happening, so the current title is meaningful even
  // when audio isn't actively playing. Per-station overrides win
  // (e.g. Grrif uses /live/covers.json); falls back to
  // ICY-over-fetch. Stops automatically when the station is
  // unloaded (state goes back to idle, station.id becomes ''),
  // and we deliberately skip the silent-bed station id since it
  // points at a static file with no ICY metadata.
  const key = np.station.id && np.station.id !== SILENT_BED.id ? np.station.id : '';
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
  autoLoadStationFromUrl();
});
// Sitelinks search box (Google / Bing) and any inbound link with
// `?q=...` lands on '/' with a query — prefill the search input so
// the visitor sees results without an extra step. Declared in the
// WebSite SearchAction JSON-LD in index.html.
{
  const q = new URLSearchParams(window.location.search).get('q');
  if (q && q.trim()) {
    $search.value = q.trim();
    syncSearchClear();
  }
}
void runQuery();
void loadSiteVisits();
void loadTopStations();
void loadBacklog();
restoreWakeOnBoot();

// Lock-screen / Bluetooth / AirPods / CarPlay skip controls. Cycles
// through the user's favorites — they're curated, stable, and small
// enough to flip through like radio dial presets. If the currently-
// playing station isn't in the favorites list, skip jumps to the
// first (next) or last (prev) entry. No-op when the user has no
// favorites yet.
function skipFavorite(direction: 1 | -1): void {
  const favs = getFavorites();
  if (favs.length === 0) return;
  const currentId = currentNP.station.id;
  const currentIdx = favs.findIndex((s) => s.id === currentId);
  const nextIdx =
    currentIdx === -1
      ? direction === 1
        ? 0
        : favs.length - 1
      : (currentIdx + direction + favs.length) % favs.length;
  const next = favs[nextIdx];
  if (!next) return;
  void player.play(next);
  pushRecent(next);
  track(direction === 1 ? 'lock-skip-next' : 'lock-skip-prev', next.name);
}
player.setSkipHandlers(
  () => skipFavorite(1),
  () => skipFavorite(-1),
);

/** Pre-rendered /station/<id>/ landing pages set window.__STATION_ID__
 *  so the SPA can auto-play the station the visitor landed on. We also
 *  parse the URL path as a fallback (in case the injection was stripped
 *  or the user shared a link to a non-prerendered station id). The
 *  match is deferred until BUILTIN_STATIONS has hydrated. */
function autoLoadStationFromUrl(): void {
  const declared = (window as unknown as { __STATION_ID__?: unknown }).__STATION_ID__;
  const fromGlobal = typeof declared === 'string' ? declared : undefined;
  const fromPath = window.location.pathname.match(/\/station\/([^/]+)\/?$/)?.[1];
  const id = fromGlobal ?? fromPath;
  if (!id) return;
  const station = BUILTIN_STATIONS.find((s) => s.id === id);
  if (!station) return;
  onRowPlay(station);
}

/** Push a shareable URL when a station is selected, so the user can
 *  copy the address bar / hit refresh and land back on the same
 *  station. popstate restores the URL → no reload, audio keeps
 *  playing during in-app navigation. */
window.addEventListener('popstate', () => {
  // Don't auto-stop or auto-play on back/forward — radio sessions
  // are long-running and a page navigation shouldn't interrupt
  // playback. If the user wants to switch they can click another
  // row. We just keep the URL state coherent.
});
