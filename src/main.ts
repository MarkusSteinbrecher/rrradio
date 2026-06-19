import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  BUILTIN_STATIONS,
  findFetcher,
  findScheduleFetcher,
  loadBuiltinStations,
} from './builtins';
import type { ScheduleDay } from './metadata';
import { searchITunes } from './coverArt';
import { lookupLyrics } from './lyrics';
import type { LyricsResult } from './lyrics';
import { MetadataPoller, icyFetcher } from './metadata';
import { AudioPlayer } from './player';
import { track } from './telemetry';
import { pseudoFrequency } from './radioBrowser';
import { composeBrowseFilter, PAGE_SIZE, fetchStations, searchStations } from './stations';
import { GENRES, findGenre, stationMatchesGenre } from './genre-taxonomy';
import { stationQualityBucket, type QualityBucket } from './quality';
import { type BrowseSort, cycleSort, sortStations, orderFeaturedFirst } from './sort';
import {
  discoveryCounts,
  genreChips,
  countryChips,
  abbreviateCount,
  DISCOVERY_HIGHLIGHT_LIMIT,
  type DiscoveryCounts,
} from './discovery';
import {
  loadHighlights,
  resolveHighlights,
  todayISO,
  type Highlight,
  type ResolvedHighlight,
} from './highlights';
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
  setCustom,
  setFavorites,
  setLastWakeTime,
  setRecents,
  setString,
  setWakeTo,
  toggleFavorite,
} from './storage';
import type { BackupSettings } from './backup';
import {
  BackupParseError,
  backupFilename,
  mergeSnapshot,
  parseBackup,
  serializeBackup,
  summaryMessage,
} from './backup';
import {
  type StationList,
  addToList,
  createList,
  deleteList,
  getList,
  getLists,
  listContains,
  renameList,
  setLists,
  toggleInList,
} from './lists';
import { STATS_WORKER_BASE } from './config';
import { countryName } from './country';
import {
  fetchUserRegion,
  geoRestrictionLabel,
  isAvailableInUserRegion,
} from './region';
import {
  aggregateDashboard,
  type DashboardData,
  type PublicLocationItem,
  type PublicTotals,
  type TopStationItem,
} from './dashboard';
import { emptyState, statusLine } from './empty';
import {
  installGlobalErrorHandlers,
  reportStreamError,
  reportWorkerError,
  truncateErrorMessage,
} from './errors';
import { reportBrokenStation } from './reportBroken';
import { fmtSharePct, normalizeForSearch } from './format';
import { SILENT_BED_ID } from './np-display';
import {
  type MiniRefs,
  renderMiniPlayer as renderMiniPlayerImpl,
} from './render-mini';
import {
  type NowPlayingRefs,
  renderNowPlaying as renderNowPlayingImpl,
} from './render-np';
import { faviconClass, stationInitials } from './station-display';
import {
  ICON_BACK,
  ICON_CHECK,
  ICON_CHEVRON_RIGHT,
  ICON_EMPTY,
  ICON_FAV,
  ICON_GRIP,
  ICON_HEART_FILL,
  ICON_HEART_LINE_CLASSED,
  ICON_LIST,
  ICON_LIST_ADD,
  ICON_PENCIL,
  ICON_RECENT,
  ICON_TRASH,
  STAR_SVG,
} from './icons';
import { bootstrapTheme, applyTheme, readStoredTheme } from './theme';
import { safeUrl, urlDisplay } from './url';
import { classifyStoredWake, fadeVolume, formatCountdown, nextFireTime, WakeScheduler } from './wake';
import type { NowPlaying, Station, WakeTo } from './types';

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const SLEEP_CYCLE_MIN = [0, 15, 30, 60];

type Tab = 'browse' | 'fav' | 'library' | 'recent' | 'playing';
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

  // iTunes Search serves two purposes:
  //
  //   1. Cover-art upgrade — when the station's metadata feed has no
  //      cover or supplies a known low-res one (Grrif's 246×246 JPEGs
  //      at /Medias/Covers/m/, visibly upscaled on retina inside our
  //      ~260 CSS-px frame), we prefer iTunes' 600×600.
  //   2. Track verification — `resultCount > 0` confirms the ICY title
  //      resolves to a real song. News/talk channels emit show names
  //      and station IDs ("BR24 Aktuell", "Nachrichten 12:00") that
  //      iTunes won't match; render-np gates the Spotify / Apple Music
  //      / YT Music search links on this signal so we don't ship users
  //      off to garbage search results.
  //
  // Both signals come from one request, so we issue the search on every
  // track change (not just when cover is missing/low-res) and let the
  // module-level cache short-circuit repeats. The cover-upgrade step
  // still gates on `!coverUrl || lowRes` so we don't downgrade good
  // station-supplied covers when the station's cover wins anyway.
  if (parsed.track) {
    const myToken = ++coverEnrichToken;
    coverEnrichController?.abort();
    coverEnrichController = new AbortController();
    const lowRes = parsed.coverUrl ? isLowResCoverUrl(parsed.coverUrl) : false;
    const wantsCoverUpgrade = !parsed.coverUrl || lowRes;
    void searchITunes(parsed.artist, parsed.track, coverEnrichController.signal).then(
      (result) => {
        if (myToken !== coverEnrichToken) return;
        const nextCover = wantsCoverUpgrade && result.cover ? result.cover : parsed.coverUrl;
        player.setTrackTitle(display, {
          ...parsed,
          coverUrl: nextCover,
          trackVerified: result.hit,
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
// Populate genre dropdown from the taxonomy. Boot-time so it's
// available before the first render. The "All genres" option is
// already in the static markup as the default; we just append the
// canonical chip list after it.
for (const g of GENRES) {
  const opt = document.createElement('option');
  opt.value = g.id;
  opt.textContent = g.label;
  $genre.appendChild(opt);
}
const $country = document.getElementById('country') as HTMLSelectElement;
const $quality = document.getElementById('quality') as HTMLSelectElement;
const $sortBtn = document.getElementById('sort-btn') as HTMLButtonElement;
// The filter cells wrapping the sort + quality controls — hidden on the
// discovery landing (they only apply to a result list, matching iOS).
const $sortCell = $sortBtn.closest('.filter-cell') as HTMLElement;
const $modePlayed = document.getElementById('mode-played') as HTMLButtonElement;
const $mapToggle = document.getElementById('map-toggle') as HTMLButtonElement;
const $newsToggle = document.getElementById('news-toggle') as HTMLButtonElement;
const $curatedToggle = document.getElementById('curated-toggle') as HTMLButtonElement;
const $filterRow = document.getElementById('filter-row') as HTMLElement;
const $tabStatus = document.getElementById('tab-status') as HTMLElement;
const $content = document.getElementById('content') as HTMLElement;
const $tabbar = document.getElementById('tabbar') as HTMLElement;
const $sidebar = document.querySelector('.sidebar') as HTMLElement;
const $sidebarCollapse = document.getElementById('sidebar-collapse') as HTMLButtonElement;

const $mini = document.getElementById('mini') as HTMLButtonElement;
const $miniFav = document.getElementById('mini-fav') as HTMLElement;
const $miniName = document.getElementById('mini-name') as HTMLElement;
const $miniTrack = document.getElementById('mini-track') as HTMLElement;
const $miniMeta = document.getElementById('mini-meta') as HTMLElement;
const $miniToggle = document.getElementById('mini-toggle') as HTMLElement;
const $miniSkip = document.getElementById('mini-skip') as HTMLElement;

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
const $npProgramEmpty = document.getElementById('np-program-empty') as HTMLElement;
const $npLyricsPane = document.getElementById('np-lyrics-pane') as HTMLElement;
const $npLyricsText = document.getElementById('np-lyrics-text') as HTMLElement;
const $npLyricsEmpty = document.getElementById('np-lyrics-empty') as HTMLElement;
const $npSecondaryEmpty = document.getElementById('np-secondary-empty') as HTMLElement;
const $npCollapseBrowse = document.getElementById('np-collapse-browse') as HTMLButtonElement;
const $npClose = document.getElementById('np-close') as HTMLButtonElement;
const $npTrackRow = document.getElementById('np-track-row') as HTMLElement;
const $npTrackTitle = document.getElementById('np-track-title') as HTMLElement;
const $npTrackCover = document.getElementById('np-track-cover') as HTMLImageElement;
const $npTrackSpotify = document.getElementById('np-track-spotify') as HTMLAnchorElement;
const $npTrackAppleMusic = document.getElementById('np-track-apple-music') as HTMLAnchorElement;
const $npTrackYoutubeMusic = document.getElementById('np-track-youtube-music') as HTMLAnchorElement;
const $npTrackOpenInWrap = document.getElementById('np-track-open-in-wrap') as HTMLElement;
const $npTrackOpenIn = document.getElementById('np-track-open-in') as HTMLButtonElement;
const $npTrackOpenInPopup = document.getElementById('np-track-open-in-popup') as HTMLElement;
const $npStream = document.getElementById('np-stream') as HTMLAnchorElement;
const $npStreamHost = document.getElementById('np-stream-host') as HTMLElement;
const $npHome = document.getElementById('np-home') as HTMLAnchorElement;
const $npHomeHost = document.getElementById('np-home-host') as HTMLElement;
const $npReportBroken = document.getElementById('np-report-broken') as HTMLButtonElement;
const $npReportBrokenLabel = document.getElementById('np-report-broken-label') as HTMLElement;
const $npFav = document.getElementById('np-fav') as HTMLButtonElement;
const $npSleep = document.getElementById('np-sleep') as HTMLButtonElement;
const $npSleepChip = document.getElementById('np-sleep-chip') as HTMLElement;
const $npWake = document.getElementById('np-wake') as HTMLButtonElement;
const $npWakeChip = document.getElementById('np-wake-chip') as HTMLElement;
const $wakeTime = document.getElementById('wake-time') as HTMLInputElement;
const $wakeArmBtn = document.getElementById('wake-arm-btn') as HTMLButtonElement;
const $wakeArmLabel = document.getElementById('wake-arm-label') as HTMLElement;
const $wakeArmMeta = document.getElementById('wake-arm-meta') as HTMLElement;
const $wakePane = document.getElementById('np-wake-pane') as HTMLElement;
const $npPlay = document.getElementById('np-play') as HTMLButtonElement;
const $npLiveText = document.getElementById('np-live-text') as HTMLElement;
const $npFormat = document.getElementById('np-format') as HTMLElement;
const $npMute = document.getElementById('np-mute') as HTMLButtonElement;
const $npDetails = document.getElementById('np-details') as HTMLElement;
const $npDetailsToggle = document.getElementById('np-details-toggle') as HTMLButtonElement;

const $addForm = document.getElementById('add-form') as HTMLFormElement;
const $addError = document.getElementById('add-error') as HTMLElement;
const $customList = document.getElementById('custom-list') as HTMLElement;

const $listSheet = document.getElementById('list-sheet') as HTMLElement;
const $listCancel = document.getElementById('list-cancel') as HTMLButtonElement;
const $listSheetTitle = document.getElementById('list-sheet-title') as HTMLElement;
const $listPicker = document.getElementById('list-picker') as HTMLElement;
const $listNewBtn = document.getElementById('list-new-btn') as HTMLButtonElement;

const $dashboardSheet = document.getElementById('dashboard-sheet') as HTMLElement;

// iOS-style top toolbar: filter funnel + settings gear, each opening a
// slide-up sheet. The inline filter controls are relocated into
// #filter-sheet at boot (see below).
const $filterBtn = document.getElementById('filter-btn') as HTMLButtonElement;
const $filterDot = document.getElementById('filter-dot') as HTMLElement;
const $filterSheet = document.getElementById('filter-sheet') as HTMLElement;
const $filterSheetBody = document.getElementById('filter-sheet-body') as HTMLElement;
const $filterClose = document.getElementById('filter-close') as HTMLButtonElement;
const $settingsBtn = document.getElementById('settings-btn') as HTMLButtonElement;
const $settingsSheet = document.getElementById('settings-sheet') as HTMLElement;
const $settingsClose = document.getElementById('settings-close') as HTMLButtonElement;
const $themeSeg = document.getElementById('theme-seg') as HTMLElement;
const $landingSeg = document.getElementById('landing-seg') as HTMLElement;
const $msApple = document.getElementById('ms-apple') as HTMLButtonElement;
const $msSpotify = document.getElementById('ms-spotify') as HTMLButtonElement;
const $msYoutube = document.getElementById('ms-youtube') as HTMLButtonElement;
const $settingsBackup = document.getElementById('settings-backup') as HTMLButtonElement;
const $settingsRestore = document.getElementById('settings-restore') as HTMLButtonElement;
const $settingsStats = document.getElementById('settings-stats') as HTMLButtonElement;
const $settingsTabs = document.getElementById('settings-tabs') as HTMLElement;
const $settingsHistoryList = document.getElementById('settings-history-list') as HTMLElement;
const $dashboardClose = document.getElementById('dashboard-close') as HTMLButtonElement;
const $dashPlays = document.getElementById('dash-plays') as HTMLElement;
const $dashVisits = document.getElementById('dash-visits') as HTMLElement;
const $dashMap = document.getElementById('dash-map') as HTMLElement;
const $dashCountryTable = document.querySelector('#dash-country-table tbody') as HTMLTableSectionElement;
const $dashStationTable = document.querySelector('#dash-station-table tbody') as HTMLTableSectionElement;

// ─────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────

let activeTab: Tab = 'browse';
/** Last list tab we were on, so closing Now Playing returns there. */
let lastListTab: ListTab = 'browse';
// Which list is open in the Library detail view (null = the Library home).
let openListId: string | null = null;
// Station the "Add to list" sheet currently targets.
let addToListStation: Station | null = null;
// Transient in-app list-management UI state (replaces native prompt/confirm).
// All cleared on navigation so a half-typed create/rename never lingers.
let listCreateOpen = false; // inline "name your list" row in the lists index
let listRenameOpen = false; // inline rename input in the list-detail header
let listDeleteConfirmId: string | null = null; // inline "Delete list?" confirm
let sheetCreateOpen = false; // inline create row inside the add-to-list sheet
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
// Default null → the Browse tab opens on its discovery landing (genre /
// country chips + Featured rail). 'played' / 'news' are reached by the
// filter-row toggles and drop into the flat result list.
let browseMode: BrowseMode = null;
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
// Alphabet sort for the un-queried catalog (off → A–Z → Z–A). Suppressed
// while a text query is active (relevance order wins).
let activeSort: BrowseSort = null;
// Stream-quality buckets to keep (empty = no quality filter). Applied
// locally to every Browse result list; never forwarded to Radio Browser.
const activeQuality = new Set<QualityBucket>();
// True once the user taps "Browse all" on the discovery landing — drops
// into the flat catalog list. Cleared by back-to-discovery / goHome.
let browseAll = false;
// Raw editorial highlights feed (loaded once at boot); resolved against
// the catalog at render time for the discovery Featured rail.
let highlightsRaw: Highlight[] = [];
// Memoised discovery counts, recomputed when the catalog size changes.
let discoveryCountsCache: DiscoveryCounts | null = null;
let discoveryCountsForLen = -1;

// countryName lives in ./country.

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

// Local-catalog pagination — once the curated YAML grew past ~2k
// stations, rendering the whole list on every renderContent() call
// (tab switch, filter change) added ~1s of DOM-build time. Cap the
// initial render and add a "Show more" button. The cap resets when
// the active view changes (different tab / mode / filter / search);
// it persists across "Show more" clicks within the same view.
const HOME_VIEW_PAGE_SIZE = 100;
let homeViewLimit = HOME_VIEW_PAGE_SIZE;
let lastViewSig = '';

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

function buildAddListBtn(): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'row-addlist';
  btn.setAttribute('aria-label', 'Add to list');
  btn.title = 'Add to a list';
  btn.innerHTML = ICON_LIST_ADD;
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
  // `availableIn` is a curated list of countries where the stream is
  // known to be reachable. When the visitor's country (from the
  // worker's CF-IPCountry lookup) is outside that list, dim the row
  // and append a "Switzerland only" / "Only in CH, FR" badge so the
  // user knows up front rather than discovering it on a tap.
  const geoRestricted = !isAvailableInUserRegion(station);
  const geoLabel = geoRestricted ? geoRestrictionLabel(station, countryName) : null;

  const row = document.createElement('div');
  row.className =
    'row' + (isCurrent ? ' is-playing' : '') + (geoRestricted ? ' is-geo-restricted' : '');
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
  if (geoLabel) {
    const geo = document.createElement('span');
    geo.className = 'row-geo';
    geo.textContent = geoLabel;
    // Hover/long-press tooltip — same copy the player error path
    // falls back to when AVPlayer or the browser fails on the 401.
    geo.title = `${geoLabel} — likely a music-licensing geo-block from the broadcaster.`;
    tags.append(geo);
  }
  const tagsText = document.createElement('span');
  tagsText.className = 'row-tags__text';
  tagsText.textContent = (station.tags ?? []).slice(0, 3).join(' · ');
  tags.append(tagsText);
  info.append(name, tags);

  const right = document.createElement('div');
  right.className = 'row-right';
  const eq = buildEq(isPaused);
  const addList = buildAddListBtn();
  addList.addEventListener('click', (e) => {
    e.stopPropagation();
    openListSheet(station);
  });
  const heart = buildHeart(isFav);
  heart.addEventListener('click', (e) => {
    e.stopPropagation();
    onToggleFav(station);
  });
  right.append(eq, addList, heart);

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
const MINI_REFS: MiniRefs = {
  mini: $mini,
  miniFav: $miniFav,
  miniName: $miniName,
  miniTrack: $miniTrack,
  miniMeta: $miniMeta,
};

function renderMiniPlayer(np: NowPlaying): void {
  renderMiniPlayerImpl(MINI_REFS, np, wakeScheduler.current());
}

// ─────────────────────────────────────────────────────────────
// Render — Now Playing
// ─────────────────────────────────────────────────────────────

// renderNowPlaying lives in ./render-np (refs-based). The local
// wrapper closes over the production refs, the wake scheduler, and
// the popup-cleanup callback so the rest of main.ts can call it
// with just (np).
const NP_REFS: NowPlayingRefs = {
  body: $body,
  npName: $npName,
  npStationLogo: $npStationLogo,
  npProgramName: $npProgramName,
  npProgramPre: $npProgramPre,
  npPaneProgram: $npPaneProgram,
  npTags: $npTags,
  npBitrate: $npBitrate,
  npOrigin: $npOrigin,
  npListeners: $npListeners,
  npLiveText: $npLiveText,
  npFormat: $npFormat,
  npTrackRow: $npTrackRow,
  npTrackTitle: $npTrackTitle,
  npTrackCover: $npTrackCover,
  npTrackCoverFallback: document.getElementById(
    'np-track-cover-fallback',
  ) as HTMLElement,
  npTrackSpotify: $npTrackSpotify,
  npTrackAppleMusic: $npTrackAppleMusic,
  npTrackYoutubeMusic: $npTrackYoutubeMusic,
  npTrackOpenInWrap: $npTrackOpenInWrap,
  npStream: $npStream,
  npStreamHost: $npStreamHost,
  npHome: $npHome,
  npHomeHost: $npHomeHost,
  npReportBroken: $npReportBroken,
  npFav: $npFav,
  npPlay: $npPlay,
};

function renderNowPlaying(np: NowPlaying): void {
  renderNowPlayingImpl(NP_REFS, np, {
    armedWake: wakeScheduler.current(),
    isFavorite,
    onClearOpenIn: closeOpenInPopup,
  });
  // Keep the wide-layout body classes (np-twocol/np-threecol) in sync as
  // the station loads/changes/stops — has-station has just been toggled
  // upstream, so the mode is current here.
  syncNpTabs();
}

// ─────────────────────────────────────────────────────────────
// Render — Top bar (search/tags/status visibility)
// ─────────────────────────────────────────────────────────────

function renderTopBar(): void {
  // Search is available on the list tabs. Genre filter is Browse-only.
  // The Playing tab keeps the topbar quiet (no search/genre input —
  // they don't apply to a single-station view).
  const isPlaying = activeTab === 'playing';
  // Filters apply to Browse only; the funnel hides elsewhere. Settings
  // gear stays. (The filter controls live in #filter-sheet.)
  $filterBtn.hidden = isPlaying || activeTab !== 'browse';
  $search.placeholder =
    activeTab === 'fav'
      ? 'Search your favorites…'
      : activeTab === 'recent'
        ? 'Search recently played…'
        : activeTab === 'library'
          ? 'Search lists…'
          : 'Search stations, genres, places…';
  // tab-status used to repeat the section name + count under the search
  // bar on Library views; the section label below already says it. Always
  // hidden now; kept in the DOM in case a future tab wants the slot.
  $tabStatus.hidden = true;
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
  // Active-state spans both the bottom tab bar (mobile) and the sidebar
  // nav (desktop) so they never disagree.
  document
    .querySelectorAll<HTMLButtonElement>('.tabbar .tab-btn, .sidebar-nav .tab-btn')
    .forEach((btn) => {
    const t = btn.dataset.tab;
    // The Library nav button stays active across the Library home and its
    // sub-views (Recents, a list detail) so the nav doesn't blink.
    const isActive = t === activeTab || (t === 'library' && isLibraryTab(activeTab));
    btn.classList.toggle('active', isActive);
  });
}

// ─────────────────────────────────────────────────────────────
// Render — Content
// ─────────────────────────────────────────────────────────────

function sectionLabel(
  label: string,
  count: number,
  actions?: HTMLElement[],
): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 'section-label';
  if (actions?.length) wrap.classList.add('section-label--with-actions');

  const title = document.createElement('div');
  title.className = 'section-label__title';
  const left = document.createElement('span');
  left.textContent = label;
  const right = document.createElement('span');
  right.className = 'count';
  right.textContent = String(count).padStart(2, '0');
  title.append(left, right);
  wrap.append(title);

  if (actions?.length) {
    const slot = document.createElement('div');
    slot.className = 'section-label__actions';
    slot.append(...actions);
    wrap.append(slot);
  }
  return wrap;
}


/** Tabs that live under the Library nav button: the Library home and its
 *  Recents sub-view. (Favorites is its own top-level tab, not grouped here.) */
function isLibraryTab(tab: Tab): boolean {
  return tab === 'library' || tab === 'recent';
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
// Public stats sheet uses a single batched endpoint so totals + top
// stations + locations all come from the same in-Worker snapshot.
// Splitting them across four endpoints with independent edge-cache
// windows (and four browser HTTP cache entries) was the cause of
// "huge differences between devices" — each device could be reading
// any combination of four different points in time.
const DASHBOARD_URL = `${STATS_WORKER_BASE}/api/public/dashboard?days=${STATS_DAYS}`;

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
    // Populate the schedule column's empty-state (wide 4-col layout).
    renderProgramPane();
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
    // Render eagerly so the schedule column is populated in the wide
    // 4-column layout without the user tapping the program tab.
    renderProgramPane();
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
      // Render eagerly (not only when the lyrics tab is active) so the
      // lyrics column populates in the wide 4-column layout.
      renderLyricsPane();
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
  // Clear text + show the empty-state (wide 4-col lyrics column).
  renderLyricsPane();
}

/** Now Playing wide-desktop layout mode. 'narrow' is the docked tabbed
 *  view (mobile + 1024–1400px desktop). At ≥1400px while a station is
 *  docked it's 'twocol' (Album + a switchable Schedule/Lyrics column,
 *  browse list still visible) or 'threecol' (browse collapsed → Album │
 *  Schedule │ Lyrics, all visible). */
const wideNpMq = matchMedia('(min-width: 1400px)');
type NpLayout = 'narrow' | 'twocol' | 'threecol';
function npLayoutMode(): NpLayout {
  if (!wideNpMq.matches || !currentNP.station.id) return 'narrow';
  return $body.classList.contains('browse-collapsed') ? 'threecol' : 'twocol';
}

/** Synchronise the Now Playing tab pills + pane visibility with the
 *  three sources (track row, program guide, lyrics) and the layout mode.
 *  The tab pill for a given source only shows when that source has
 *  content; in the 2-column wide layout the strip doubles as the
 *  Schedule/Lyrics switcher (the 'now'/album pill is dropped — album is
 *  always its own column there). */
function syncNpTabs(): void {
  const hasProgram = !!(npSchedule && npSchedule.length > 0);
  const hasLyrics = !!(npLyrics && (npLyrics.plain || npLyrics.synced));
  const mode = npLayoutMode();

  // Layout body classes drive the wide grid (CSS); both cleared on narrow.
  $body.classList.toggle('np-twocol', mode === 'twocol');
  $body.classList.toggle('np-threecol', mode === 'threecol');

  if (mode === 'twocol') {
    // Album owns column 1; the second column is Schedule OR Lyrics, so
    // npView is restricted to those. Fall back to whichever exists; if
    // neither, 'now' (→ the secondary empty-state shows).
    if (
      npView === 'now' ||
      (npView === 'program' && !hasProgram) ||
      (npView === 'lyrics' && !hasLyrics)
    ) {
      npView = hasProgram ? 'program' : hasLyrics ? 'lyrics' : 'now';
    }
  } else {
    // narrow + threecol: drop to 'now' if the active secondary is gone.
    if (npView === 'program' && !hasProgram) npView = 'now';
    if (npView === 'lyrics' && !hasLyrics) npView = 'now';
  }

  // Show the tab strip whenever at least one secondary source has content.
  // The 'now' pill is redundant in the 2-column layout (album is always
  // shown), so hide it there.
  $npPaneTabs.hidden = !hasProgram && !hasLyrics;
  $npPaneNow.hidden = mode === 'twocol';
  $npPaneProgram.hidden = !hasProgram;
  $npPaneLyrics.hidden = !hasLyrics;

  $npPaneNow.classList.toggle('is-active', npView === 'now');
  $npPaneNow.setAttribute('aria-pressed', String(npView === 'now'));
  $npPaneProgram.classList.toggle('is-active', npView === 'program');
  $npPaneProgram.setAttribute('aria-pressed', String(npView === 'program'));
  $npPaneLyrics.classList.toggle('is-active', npView === 'lyrics');
  $npPaneLyrics.setAttribute('aria-pressed', String(npView === 'lyrics'));

  // Pane [hidden] flags. The narrow docked view obeys them directly; the
  // wide grids override via CSS (3-col force-shows all panes; 2-col always
  // shows album and shows whichever secondary matches npView). render-np
  // writes content into npTrackRow but never touches its `hidden`. Track
  // also stays hidden with no station so we don't show an em-dashed shell.
  $npTrackRow.hidden = npView !== 'now' || !currentNP.station.id;
  $npProgramPane.hidden = npView !== 'program';
  $npLyricsPane.hidden = npView !== 'lyrics';

  // 2-column with neither schedule nor lyrics → the second column shows a
  // small empty state (the only layout where it can surface).
  $npSecondaryEmpty.hidden = !(mode === 'twocol' && !hasProgram && !hasLyrics);
}

// Recompute the wide layout when the 1400px boundary is crossed.
wideNpMq.addEventListener('change', syncNpTabs);

function renderLyricsPane(): void {
  // Plain text wins if both are present — synced is a UX nice-to-have
  // we can layer later (current-line highlight needs an estimate of
  // elapsed-since-track-started, which live radio doesn't give us).
  const text = npLyrics?.plain || npLyrics?.synced?.map((l) => l.text).join('\n') || '';
  $npLyricsText.textContent = text;
  // Empty-state line — only ever visible in the wide 4-column layout,
  // where the lyrics column is shown even with nothing to display; in
  // the narrow docked view the whole pane is hidden when there's no
  // lyrics (the tab doesn't appear).
  $npLyricsEmpty.hidden = text !== '';
}

function renderProgramPane(): void {
  if (!npSchedule || npSchedule.length === 0) {
    // Don't touch hidden — that's syncNpTabs's job (which drops the
    // user back to 'now' when hasProgram becomes false). Touching it
    // here used to fight the tab-state and cause the same cover-bleed
    // bug we hit on the lyrics pane (gh #84).
    $npProgramList.replaceChildren();
    // Empty-state line — only ever visible in the wide 4-column layout
    // (the narrow docked view hides the whole pane when there's no
    // schedule, since the program tab doesn't appear).
    $npProgramEmpty.hidden = false;
    return;
  }
  $npProgramEmpty.hidden = true;
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
  // Center the now-on-air row (or the next upcoming one if we hit a gap
  // between broadcasts) WITHIN the program pane only. We must not use
  // Element.scrollIntoView here: it scrolls every scrollable ancestor,
  // including the .app shell (overflow:hidden, but still scrollable
  // programmatically), which on desktop pushes the whole layout — and the
  // top nav / search bar — off the top of the viewport. Setting the pane's
  // own scrollTop keeps the scroll contained. Deferred a frame so layout
  // is settled before we measure.
  const target = liveRow ?? nextRow;
  if (target) {
    requestAnimationFrame(() => {
      const pane = $npProgramPane;
      const delta =
        target.getBoundingClientRect().top -
        pane.getBoundingClientRect().top -
        (pane.clientHeight - target.offsetHeight) / 2;
      pane.scrollTop += delta;
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

/** Browse/Discovery row groups get wrapped in a `.rows` container so the
 *  desktop breakpoint can lay them out as a responsive card grid. A bare
 *  `<div>` on mobile (rows stack exactly as before). Favorites/Recents
 *  intentionally do NOT use this — their drag-reorder assumes a single
 *  vertical column of direct `.row` children. */
function rowsGrid(stations: Station[]): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 'rows';
  wrap.append(renderRows(stations));
  return wrap;
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

// ─────────────────────────────────────────────────────────────
// Browse discovery landing + refinements (sort / quality / featured)
// ─────────────────────────────────────────────────────────────

/** Is the Browse tab showing its discovery landing? True only when
 *  nothing narrows the catalog: no query, genre, country, mode,
 *  curated-only, map, or Browse-all. */
function inDiscovery(): boolean {
  return (
    activeTab === 'browse' &&
    !$search.value.trim() &&
    activeTag === 'all' &&
    activeCountry === 'all' &&
    browseMode === null &&
    !curatedOnly &&
    !mapView &&
    !browseAll
  );
}

/** Per-genre / per-country counts over the curated catalog, memoised
 *  until the catalog size changes. */
function getDiscoveryCounts(): DiscoveryCounts {
  if (!discoveryCountsCache || discoveryCountsForLen !== BUILTIN_STATIONS.length) {
    discoveryCountsCache = discoveryCounts(BUILTIN_STATIONS);
    discoveryCountsForLen = BUILTIN_STATIONS.length;
  }
  return discoveryCountsCache;
}

function stationById(id: string): Station | undefined {
  return BUILTIN_STATIONS.find((s) => s.id === id);
}

/** Apply the local quality filter, then ordering. Quality always
 *  applies; ordering is skipped while a text query is active (relevance
 *  wins). Otherwise the alphabet sort wins, else featured-first for the
 *  un-queried catalog. */
function refine(
  list: Station[],
  opts: { textQuery: string; featuredFirst: boolean },
): Station[] {
  let out = list;
  if (activeQuality.size > 0) {
    out = out.filter((s) => activeQuality.has(stationQualityBucket(s)));
  }
  if (!opts.textQuery) {
    if (activeSort) out = sortStations(out, activeSort);
    else if (opts.featuredFirst) out = orderFeaturedFirst(out);
  }
  return out;
}

function syncBrowseModeButtons(): void {
  $modePlayed.classList.toggle('is-active', browseMode === 'played');
  $modePlayed.setAttribute('aria-pressed', String(browseMode === 'played'));
  $newsToggle.classList.toggle('is-active', browseMode === 'news');
  $newsToggle.setAttribute('aria-pressed', String(browseMode === 'news'));
}

function syncSort(): void {
  const queryActive = $search.value.trim().length > 0;
  $sortBtn.disabled = queryActive;
  $sortBtn.classList.toggle('is-active', activeSort !== null && !queryActive);
  $sortBtn.setAttribute(
    'aria-label',
    activeSort === 'az' ? 'Sort Z to A' : activeSort === 'za' ? 'Clear sort' : 'Sort A to Z',
  );
  $sortBtn.dataset.sort = activeSort ?? 'off';
}

function syncQuality(): void {
  let v = 'all';
  if (activeQuality.size === 1 && activeQuality.has('high')) v = 'high';
  else if (activeQuality.size > 0) v = 'med';
  if ($quality.value !== v) $quality.value = v;
  $quality.parentElement?.classList.toggle('is-default', activeQuality.size === 0);
}

// ─── Discovery render ───

function discoverySection(title: string): HTMLDivElement {
  const h = document.createElement('div');
  h.className = 'disc-section-label';
  h.textContent = title;
  return h;
}

function discoveryChip(label: string, count: number, onPick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'disc-chip';
  const name = document.createElement('span');
  name.className = 'disc-chip__name';
  name.textContent = label;
  const c = document.createElement('span');
  c.className = 'disc-chip__count';
  c.textContent = abbreviateCount(count);
  btn.append(name, c);
  btn.setAttribute('aria-label', `${label}, ${count} stations`);
  btn.addEventListener('click', onPick);
  return btn;
}

function featuredCard(item: ResolvedHighlight): HTMLButtonElement {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'feat-card';
  card.dataset.id = item.station.id;
  const art = buildFavicon(item.station, 56);
  art.classList.add('feat-card__art');
  const body = document.createElement('div');
  body.className = 'feat-card__body';
  if (item.badge?.label) {
    const badge = document.createElement('div');
    badge.className = 'feat-card__badge';
    badge.textContent = item.badge.label;
    body.append(badge);
  }
  const name = document.createElement('div');
  name.className = 'feat-card__name';
  name.textContent = item.station.name;
  body.append(name);
  if (item.blurb) {
    const blurb = document.createElement('div');
    blurb.className = 'feat-card__blurb';
    blurb.textContent = item.blurb;
    body.append(blurb);
  }
  card.append(art, body);
  card.addEventListener('click', () => onRowPlay(item.station));
  return card;
}

/** Let a horizontal scroller respond to a vertical mouse wheel, so
 *  desktop/mouse users can scroll the featured rail without a trackpad
 *  swipe. No-op when the gesture is already horizontal or the rail is at
 *  an edge — there the event bubbles so the page keeps scrolling. */
function enableWheelScroll(el: HTMLElement): void {
  el.addEventListener(
    'wheel',
    (e) => {
      if (e.deltaY === 0 || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0) return;
      if ((e.deltaY < 0 && el.scrollLeft <= 0) || (e.deltaY > 0 && el.scrollLeft >= max)) return;
      el.scrollLeft = Math.max(0, Math.min(max, el.scrollLeft + e.deltaY));
      e.preventDefault();
    },
    { passive: false },
  );
}

function renderDiscovery(): void {
  const featured = resolveHighlights(
    highlightsRaw,
    stationById,
    todayISO(),
    DISCOVERY_HIGHLIGHT_LIMIT,
  );

  // Section order mirrors the iOS BrowseDiscoveryContent: genre chips,
  // country chips, then the Featured rail, then the "Browse all" footer.
  const counts = getDiscoveryCounts();
  const gChips = genreChips(counts);
  if (gChips.length > 0) {
    $content.append(discoverySection('Browse by genre'));
    const row = document.createElement('div');
    row.className = 'disc-chips';
    for (const c of gChips) row.append(discoveryChip(c.label, c.count, () => selectGenreChip(c.id)));
    $content.append(row);
  }
  const cChips = countryChips(counts, countryName);
  if (cChips.length > 0) {
    $content.append(discoverySection('Browse by country'));
    const row = document.createElement('div');
    row.className = 'disc-chips';
    for (const c of cChips) row.append(discoveryChip(c.label, c.count, () => selectCountryChip(c.id)));
    $content.append(row);
  }

  if (featured.length > 0) {
    $content.append(discoverySection('Featured'));
    const rail = document.createElement('div');
    rail.className = 'feat-rail';
    for (const f of featured) rail.append(featuredCard(f));
    enableWheelScroll(rail);
    $content.append(rail);
  }

  // "Browse all" footer with the iOS logo peek: up to four featured
  // stations carrying real artwork, overlapping like stacked avatars.
  // Per the iOS rule, show nothing rather than a lonely one or two — the
  // cluster only appears once at least three highlights have a favicon.
  const all = document.createElement('button');
  all.type = 'button';
  all.className = 'disc-browse-all';
  all.setAttribute('aria-label', 'Browse all stations');
  const lbl = document.createElement('span');
  lbl.textContent = 'Browse all stations';
  const trailing = document.createElement('span');
  trailing.className = 'disc-browse-all__trailing';
  const clusterStations = featured.map((f) => f.station).filter((s) => Boolean(s.favicon));
  if (clusterStations.length >= 3) {
    const cluster = document.createElement('span');
    cluster.className = 'disc-browse-all__cluster';
    cluster.setAttribute('aria-hidden', 'true');
    const logos = clusterStations.slice(0, 4);
    logos.forEach((s, i) => {
      const logo = buildFavicon(s, 26);
      logo.classList.add('disc-browse-all__logo');
      // First logo on top, each tucking behind the one before it.
      logo.style.zIndex = String(logos.length - i);
      cluster.append(logo);
    });
    trailing.append(cluster);
  }
  const cnt = document.createElement('span');
  cnt.className = 'disc-browse-all__count';
  cnt.textContent = abbreviateCount(BUILTIN_STATIONS.length);
  trailing.append(cnt);
  all.append(lbl, trailing);
  all.addEventListener('click', enterBrowseAll);
  $content.append(all);
}

function selectGenreChip(id: string): void {
  browseMode = null;
  syncBrowseModeButtons();
  activeCountry = 'all';
  syncCountry();
  activeTag = id;
  syncGenre();
  browseAll = false;
  track(`discovery/genre/${id}`);
  void runQuery();
}

function selectCountryChip(code: string): void {
  browseMode = null;
  syncBrowseModeButtons();
  activeTag = 'all';
  syncGenre();
  activeCountry = code;
  syncCountry();
  browseAll = false;
  track(`discovery/country/${code}`);
  void runQuery();
}

function enterBrowseAll(): void {
  browseAll = true;
  track('discovery/browse-all');
  void runQuery();
}

/** Clear every Browse narrowing and return to the discovery landing. */
function resetToDiscovery(): void {
  clearSearch(false);
  activeTag = 'all';
  syncGenre();
  activeCountry = 'all';
  syncCountry();
  browseMode = null;
  syncBrowseModeButtons();
  browseAll = false;
  curatedOnly = false;
  syncCuratedToggle();
  activeQuality.clear();
  syncQuality();
  activeSort = null;
  syncSort();
  void runQuery();
}

function backToDiscoveryBar(): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'disc-back';
  btn.setAttribute('aria-label', 'Back to discovery');
  btn.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>';
  const span = document.createElement('span');
  span.textContent = 'Discovery';
  btn.append(span);
  btn.addEventListener('click', resetToDiscovery);
  return btn;
}

function renderContent(): void {
  $content.replaceChildren();

  // View-signature reset for the local-catalog cap. Same view across
  // calls = persist the user's "Show more" clicks; new view = reset.
  const sig = `${activeTab}|${browseMode}|${curatedOnly}|${activeTag}|${activeCountry}|${$search.value.trim()}|${browseAll}|${activeSort}|${[...activeQuality].sort().join(',')}`;
  if (sig !== lastViewSig) {
    homeViewLimit = HOME_VIEW_PAGE_SIZE;
    lastViewSig = sig;
  }

  if (activeTab === 'browse') {
    const query = $search.value.trim();
    const activeGenre = findGenre(activeTag);
    const countryFilter = activeCountry === 'all' ? undefined : activeCountry.toUpperCase();
    const noFilter = !query && !activeGenre && !countryFilter;
    // News mode is a special case that pretends the "news" chip is
    // active even when the dropdown says "all". Resolve it through the
    // taxonomy so synonyms (noticias / local news) fold in.
    const newsGenre = browseMode === 'news' ? findGenre('news') : undefined;
    const effectiveGenre = newsGenre ?? activeGenre;
    // Map view only renders inside the home view (no genre/country/search);
    // disable the toggle visually when it'd be a no-op.
    $mapToggle.disabled = !noFilter;

    // Sort refines a result list, so it's hidden (in the filter popup) on
    // the discovery landing — there's no list to act on. Quality stays,
    // since picking it enters results. Keep the funnel dot in sync.
    const onDiscovery = inDiscovery();
    $sortCell.hidden = onDiscovery;
    syncFilterDot();

    // Discovery landing is the default unfiltered Browse view; anything
    // that narrows the catalog (a mode, Browse-all, a filter, or a
    // search) drops into the result list with a back-to-discovery row.
    if (onDiscovery) {
      renderDiscovery();
      const counter = siteCounter();
      if (counter) $content.append(counter);
      return;
    }
    if (!mapView) $content.append(backToDiscoveryBar());

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
      } else {
        // Quality filter + ordering (featured-first for the Top / Browse-all
        // list; the alphabet sort when set). Played / News keep their order.
        const refined = refine(stations, { textQuery: '', featuredFirst: browseMode === null });
        // Worldwide expansion only when we're not constrained to the
        // curated catalog (curatedOnly hides the section + button).
        const showWorldwide = browseMode === 'played' && !curatedOnly;
        const worldwide = showWorldwide
          ? refine(homeRbStations, { textQuery: '', featuredFirst: false })
          : [];
        if (refined.length > 0) {
          $content.append(sectionLabel(restLabel, refined.length));
          // Cap the initial render — bigger catalogs (2k+ rows) made
          // tab-switch DOM build cost ~1s. "Show more" reveals the
          // next page in place.
          const visibleHome = refined.slice(0, homeViewLimit);
          $content.append(rowsGrid(visibleHome));
          const remainingHome = refined.length - visibleHome.length;
          if (remainingHome > 0) $content.append(homeShowMoreButton(remainingHome));
          // Pagination — RB-sourced modes (null/news) paginate the
          // primary list; played mode appends a separate "Worldwide"
          // section on demand below the curated catalog.
          if ((browseMode === null || browseMode === 'news') && browseHasMore) {
            $content.append(loadMoreButton());
          }
        }
        if (showWorldwide) {
          if (worldwide.length > 0) {
            $content.append(sectionLabel('Worldwide', worldwide.length));
            $content.append(rowsGrid(worldwide));
          }
          if (homeRbHasMore) $content.append(loadMoreHomeButton());
        }
        // Quality filter emptied everything → one empty-state, only when
        // there's truly nothing to show (not above a populated Worldwide).
        if (refined.length === 0 && worldwide.length === 0 && activeQuality.size > 0) {
          $content.append(
            emptyState(ICON_EMPTY, 'No stations match', 'Try a lower quality filter'),
          );
        }
      }

      const counter = siteCounter();
      if (counter) $content.append(counter);
      return;
    }

    // Filtered view (search / genre / country): built-ins + custom
    // matches first ("My stations"), then Radio Browser long-tail.
    const tagMatch = (s: Station): boolean =>
      !effectiveGenre || stationMatchesGenre(s, effectiveGenre);
    const countryMatch = (s: Station): boolean =>
      !countryFilter || (s.country ?? '').toUpperCase() === countryFilter;
    const mySource = [...BUILTIN_STATIONS, ...getCustom()];
    const myFiltered = refine(
      filterStations(mySource, query).filter(tagMatch).filter(countryMatch),
      { textQuery: query, featuredFirst: true },
    );
    const results = refine(lastBrowseStations, { textQuery: query, featuredFirst: false });

    if (myFiltered.length > 0) {
      $content.append(sectionLabel('My stations', myFiltered.length));
      const visibleMy = myFiltered.slice(0, homeViewLimit);
      $content.append(rowsGrid(visibleMy));
      const remainingMy = myFiltered.length - visibleMy.length;
      if (remainingMy > 0) $content.append(homeShowMoreButton(remainingMy));
    }
    if (results.length > 0) {
      const label = query ? 'Results' : effectiveGenre?.label ?? 'Results';
      $content.append(sectionLabel(label, results.length));
      $content.append(rowsGrid(results));
      if (browseHasMore) $content.append(loadMoreButton());
    } else if (myFiltered.length === 0) {
      $content.append(emptyState(ICON_EMPTY, 'No stations match', 'Try a different search or genre'));
    }
    const counter = siteCounter();
    if (counter) $content.append(counter);
    return;
  }

  const query = $search.value.trim();

  if (activeTab === 'library') {
    renderLibraryHome(query);
    return;
  }

  if (activeTab === 'fav') {
    const all = getFavorites();
    const list = filterStations(all, query);
    const label = query ? 'Results' : 'Favorites';
    // Backup actions (export + import icons) appear only on the
    // unfiltered Favorites view — they operate on the full stored list,
    // not the search-filtered subset.
    const actions = !query ? favoriteHeaderActions() : undefined;
    $content.append(sectionLabel(label, list.length, actions));
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
    // Recents is a Library sub-view — offer a back affordance to the home.
    const back = listActionBtn(ICON_BACK, 'Back to library', () => setTab('library'));
    back.classList.add('section-label__back');
    const recLabel = sectionLabel(label, list.length);
    recLabel.classList.add('section-label--list-detail');
    recLabel.prepend(back);
    $content.append(recLabel);
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
// Render — Lists (named station lists, gh #520)
// ─────────────────────────────────────────────────────────────

/** Small icon button for a section-label action slot (new/rename/delete). */
function listActionBtn(icon: string, label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'section-label__action';
  btn.setAttribute('aria-label', label);
  btn.title = label;
  btn.innerHTML = icon;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return btn;
}

/** Clear the transient list-management UI flags. Called on navigation so
 *  a half-typed create/rename or an open delete-confirm never lingers. */
function resetListUiState(): void {
  listCreateOpen = false;
  listRenameOpen = false;
  listDeleteConfirmId = null;
}

/** Inline "name your list" form (input + confirm + cancel) — the in-app
 *  replacement for window.prompt, used for both create and rename. Enter
 *  submits, Esc cancels (stopping propagation so it doesn't also close an
 *  enclosing sheet); a blank name is ignored. */
function buildListNameForm(opts: {
  initial?: string;
  placeholder: string;
  submitLabel: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}): HTMLFormElement {
  const form = document.createElement('form');
  form.className = 'list-name-form';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'list-name-form__input';
  input.placeholder = opts.placeholder;
  input.value = opts.initial ?? '';
  input.autocomplete = 'off';
  input.maxLength = 60;
  input.setAttribute('aria-label', opts.placeholder);
  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'list-name-form__save';
  save.textContent = opts.submitLabel;
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'list-name-form__cancel';
  cancel.textContent = 'Cancel';
  form.append(input, save, cancel);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name) {
      input.focus();
      return;
    }
    opts.onSubmit(name);
  });
  cancel.addEventListener('click', (e) => {
    e.preventDefault();
    opts.onCancel();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      opts.onCancel();
    }
  });
  return form;
}

/** Inline two-step delete confirm ("Delete list? Cancel / Delete") — the
 *  in-app replacement for window.confirm. Used in the lists index row and
 *  the detail header. Button clicks stop propagation so a surrounding
 *  clickable row doesn't also fire. */
function buildDeleteConfirm(onConfirm: () => void, onCancel: () => void): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'list-confirm';
  const q = document.createElement('span');
  q.className = 'list-confirm__q';
  q.textContent = 'Delete list?';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'list-confirm__cancel';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', (e) => {
    e.stopPropagation();
    onCancel();
  });
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'list-confirm__delete';
  del.textContent = 'Delete';
  del.addEventListener('click', (e) => {
    e.stopPropagation();
    onConfirm();
  });
  wrap.append(q, cancel, del);
  return wrap;
}

/** The Library home: the user's lists + a pinned Recents entry (matching
 *  iOS, whose Library home renders lists + Recents and excludes Favorites,
 *  which is its own tab). A specific list open → its detail view. */
function renderLibraryHome(query: string): void {
  // Detail view — a specific list is open.
  if (openListId) {
    const list = getList(openListId);
    if (list) {
      renderListDetail(list, query);
      return;
    }
    // The open list was deleted out from under us — fall back to the home.
    openListId = null;
  }
  renderLibraryIndex(query);
}

function renderLibraryIndex(query: string): void {
  const all = getLists();
  const q = query.toLowerCase();
  const lists = q ? all.filter((l) => l.name.toLowerCase().includes(q)) : all;
  const newBtn = listActionBtn(ICON_LIST_ADD, 'New list', () => {
    listCreateOpen = true;
    renderContent();
  });
  $content.append(sectionLabel('Library', lists.length, [newBtn]));

  // Inline create row (in-app replacement for window.prompt). Focused
  // after it lands in the DOM so the user can type immediately.
  if (listCreateOpen) {
    const form = buildListNameForm({
      placeholder: 'Name your list',
      submitLabel: 'Add',
      onSubmit: (name) => {
        const list = createList(name);
        track('list-create');
        listCreateOpen = false;
        openListId = list.id;
        renderContent();
        $content.scrollTo({ top: 0 });
      },
      onCancel: () => {
        listCreateOpen = false;
        renderContent();
      },
    });
    $content.append(form);
    (form.querySelector('input') as HTMLInputElement | null)?.focus();
  }

  // A search query scopes to list names; if none match, say so (the
  // Recents entry is hidden while filtering).
  if (q && lists.length === 0) {
    $content.append(emptyState(ICON_EMPTY, 'No matches', 'No list name matches that search'));
    return;
  }

  const wrap = document.createElement('div');
  wrap.className = 'lists-index';
  for (const l of lists) wrap.append(buildListIndexRow(l));
  // Recents is a system entry pinned at the tail of the Library home
  // (matching iOS); shown only on the unfiltered home.
  if (!q) wrap.append(buildRecentsRow());
  $content.append(wrap);
}

/** The pinned Recents entry on the Library home — a non-removable system
 *  row that opens the Recents sub-view. */
function buildRecentsRow(): HTMLElement {
  const recents = getRecents();
  const row = document.createElement('div');
  row.className = 'list-item list-item--system';
  row.setAttribute('role', 'button');
  row.tabIndex = 0;

  const icon = document.createElement('div');
  icon.className = 'list-item__icon';
  icon.innerHTML = ICON_RECENT;

  const info = document.createElement('div');
  info.className = 'list-item__info';
  const name = document.createElement('div');
  name.className = 'list-item__name';
  name.textContent = 'Recents';
  const sub = document.createElement('div');
  sub.className = 'list-item__sub';
  sub.textContent = `${recents.length} station${recents.length === 1 ? '' : 's'}`;
  info.append(name, sub);

  const chev = document.createElement('div');
  chev.className = 'list-item__chev';
  chev.innerHTML = ICON_CHEVRON_RIGHT;

  row.append(icon, info, chev);
  const open = () => setTab('recent');
  row.addEventListener('click', open);
  row.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open();
    }
  });
  return row;
}

function buildListIndexRow(list: StationList): HTMLElement {
  const row = document.createElement('div');
  row.className = 'list-item';
  row.setAttribute('role', 'button');
  row.tabIndex = 0;
  row.dataset.listId = list.id;

  const icon = document.createElement('div');
  icon.className = 'list-item__icon';
  icon.innerHTML = ICON_LIST;

  const info = document.createElement('div');
  info.className = 'list-item__info';
  const name = document.createElement('div');
  name.className = 'list-item__name';
  name.textContent = list.name;
  const sub = document.createElement('div');
  sub.className = 'list-item__sub';
  sub.textContent = `${list.stations.length} station${list.stations.length === 1 ? '' : 's'}`;
  info.append(name, sub);

  row.append(icon, info);

  // Delete-confirm mode: the row swaps its chevron + trash for an inline
  // "Delete list?" confirm and is no longer clickable.
  if (listDeleteConfirmId === list.id) {
    row.classList.add('list-item--confirming');
    row.append(
      buildDeleteConfirm(
        () => {
          deleteList(list.id);
          track('list-delete');
          listDeleteConfirmId = null;
          renderContent();
        },
        () => {
          listDeleteConfirmId = null;
          renderContent();
        },
      ),
    );
    return row;
  }

  const del = listActionBtn(ICON_TRASH, `Delete ${list.name}`, () => {
    listDeleteConfirmId = list.id;
    renderContent();
  });
  del.classList.add('list-item__del');

  const chev = document.createElement('div');
  chev.className = 'list-item__chev';
  chev.innerHTML = ICON_CHEVRON_RIGHT;

  row.append(del, chev);
  const open = () => {
    openListId = list.id;
    resetListUiState();
    renderContent();
    $content.scrollTo({ top: 0 });
  };
  row.addEventListener('click', open);
  row.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open();
    }
  });
  return row;
}

function renderListDetail(list: StationList, query: string): void {
  const back = listActionBtn(ICON_BACK, 'Back to lists', () => {
    openListId = null;
    resetListUiState();
    renderContent();
  });
  back.classList.add('section-label__back');

  const stations = query ? filterStations(list.stations, query) : list.stations;

  if (listRenameOpen) {
    // Inline rename: the header title becomes a text input (prefilled).
    const header = document.createElement('div');
    header.className = 'section-label section-label--list-detail section-label--editing';
    header.append(back);
    const form = buildListNameForm({
      initial: list.name,
      placeholder: 'List name',
      submitLabel: 'Save',
      onSubmit: (name) => {
        renameList(list.id, name);
        track('list-rename');
        listRenameOpen = false;
        renderContent();
      },
      onCancel: () => {
        listRenameOpen = false;
        renderContent();
      },
    });
    header.append(form);
    $content.append(header);
    const input = form.querySelector('input') as HTMLInputElement | null;
    input?.focus();
    input?.select();
  } else {
    const actions: HTMLElement[] =
      listDeleteConfirmId === list.id
        ? [
            buildDeleteConfirm(
              () => {
                deleteList(list.id);
                track('list-delete');
                openListId = null;
                resetListUiState();
                renderContent();
              },
              () => {
                listDeleteConfirmId = null;
                renderContent();
              },
            ),
          ]
        : [
            listActionBtn(ICON_PENCIL, 'Rename list', () => {
              listRenameOpen = true;
              listDeleteConfirmId = null;
              renderContent();
            }),
            listActionBtn(ICON_TRASH, 'Delete list', () => {
              listDeleteConfirmId = list.id;
              renderContent();
            }),
          ];
    const label = sectionLabel(list.name, stations.length, actions);
    label.classList.add('section-label--list-detail');
    label.prepend(back);
    $content.append(label);
  }

  if (list.stations.length === 0) {
    $content.append(
      emptyState(
        ICON_LIST,
        'This list is empty',
        'Add stations with the list icon on any station row.',
      ),
    );
    return;
  }
  if (stations.length === 0) {
    $content.append(emptyState(ICON_EMPTY, 'No matches', 'Nothing in this list matches that search'));
    return;
  }
  $content.append(renderRows(stations));
}

// ── Add-to-list sheet ────────────────────────────────────────────────

function openListSheet(station: Station): void {
  addToListStation = station;
  sheetCreateOpen = false;
  renderListPicker();
  $listSheet.classList.add('open');
  $listSheet.setAttribute('aria-hidden', 'false');
}

function closeListSheet(): void {
  $listSheet.classList.remove('open');
  $listSheet.setAttribute('aria-hidden', 'true');
  addToListStation = null;
  sheetCreateOpen = false;
  $listNewBtn.hidden = false;
}

function renderListPicker(): void {
  const station = addToListStation;
  $listPicker.replaceChildren();
  if (!station) return;
  $listSheetTitle.textContent = `Add ${station.name} to…`;
  const lists = getLists();
  if (lists.length === 0 && !sheetCreateOpen) {
    const empty = document.createElement('li');
    empty.className = 'list-picker__empty';
    empty.textContent = 'No lists yet — create one below.';
    $listPicker.append(empty);
  }
  for (const l of lists) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'list-picker__btn';
    const inIt = listContains(l.id, station.id);
    btn.classList.toggle('is-in', inIt);
    btn.setAttribute('aria-pressed', String(inIt));

    const check = document.createElement('span');
    check.className = 'list-picker__check';
    check.innerHTML = ICON_CHECK;
    const name = document.createElement('span');
    name.className = 'list-picker__name';
    name.textContent = l.name;
    const count = document.createElement('span');
    count.className = 'list-picker__count';
    count.textContent = String(l.stations.length);

    btn.append(check, name, count);
    btn.addEventListener('click', () => {
      const nowIn = toggleInList(l.id, station);
      track(nowIn ? 'list-add' : 'list-remove');
      renderListPicker();
      if (activeTab === 'library') renderContent();
    });
    li.append(btn);
    $listPicker.append(li);
  }

  // Inline create row, toggled by the footer "New list…" button. Creating
  // here also adds the current station to the new list (create-and-add).
  $listNewBtn.hidden = sheetCreateOpen;
  if (sheetCreateOpen) {
    const li = document.createElement('li');
    li.className = 'list-picker__create';
    const form = buildListNameForm({
      placeholder: 'Name your list',
      submitLabel: 'Create',
      onSubmit: (name) => {
        const list = createList(name);
        track('list-create');
        addToList(list.id, station);
        track('list-add');
        sheetCreateOpen = false;
        renderListPicker();
        if (activeTab === 'library') renderContent();
      },
      onCancel: () => {
        sheetCreateOpen = false;
        renderListPicker();
      },
    });
    li.append(form);
    $listPicker.append(li);
    (form.querySelector('input') as HTMLInputElement | null)?.focus();
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
  //  · OR we're on the discovery landing (no list to fill yet — the RB
  //    Top feed loads when the user taps "Browse all")
  // Mode='news' and mode=null both need an RB fetch (unless curated-only
  // is on, in which case we'd never use the result).
  const needsRb =
    !curatedOnly &&
    !inDiscovery() &&
    (hasAnyFilter || browseMode === null || browseMode === 'news');
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

/** Local-catalog "Show more" button — bumps the in-memory cap and
 *  re-renders. No network. Pairs with the HOME_VIEW_PAGE_SIZE cap
 *  applied to the home view + filtered "My stations" list. */
function homeShowMoreButton(remaining: number): HTMLButtonElement {
  const next = Math.min(HOME_VIEW_PAGE_SIZE, remaining);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'load-more';
  btn.textContent = `Show ${next} more · ${remaining} remaining`;
  btn.addEventListener('click', () => {
    homeViewLimit += HOME_VIEW_PAGE_SIZE;
    renderContent();
  });
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
  // Keep the Recents sub-view and the Library home's Recents count fresh.
  if (activeTab === 'recent' || activeTab === 'library') renderContent();
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
  // Close Now Playing if open, then reset Browse to its discovery landing.
  if ($np.classList.contains('open')) openNp(false);
  const wasDiscovery = activeTab === 'browse' && inDiscovery();
  clearSearch(false);
  activeTag = 'all';
  activeCountry = 'all';
  // Reset every Browse narrowing back to the discovery landing.
  browseMode = null;
  browseAll = false;
  curatedOnly = false;
  syncCuratedToggle();
  syncBrowseModeButtons();
  activeQuality.clear();
  syncQuality();
  activeSort = null;
  syncSort();
  syncGenre();
  syncCountry();
  if (activeTab !== 'browse') {
    setTab('browse'); // setTab also runs the query
  } else if (!wasDiscovery) {
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

  // Drop any half-finished list create/rename/delete when changing tabs.
  resetListUiState();

  // Track the last list tab so closing Now Playing returns there.
  if (tab !== 'playing') {
    lastListTab = tab;
  }

  activeTab = tab;
  $body.classList.toggle('tab-playing', tab === 'playing');
  $np.classList.toggle('open', tab === 'playing');
  // On desktop the NP pane is permanently docked and visible, so it must
  // stay in the a11y tree regardless of which list tab is active.
  $np.setAttribute('aria-hidden', String(!isDesktop() && tab !== 'playing'));

  renderTabBar();
  renderTopBar();
  if (tab === 'browse') void runQuery();
  else if (tab !== 'playing') renderContent();

  track(`tab/${tab}`);
}

// Desktop (≥1024px) shows Now Playing as a persistent docked pane next
// to the list, so opening/closing it is a no-op there — the pane is
// always mounted and the $np* updates run on every player event
// regardless of which list tab is active. On mobile it stays the
// slide-up destination reached via the 'playing' tab.
const desktopMq = matchMedia('(min-width: 1024px)');
function isDesktop(): boolean {
  return desktopMq.matches;
}

function openNp(open: boolean): void {
  if (isDesktop()) return;
  if (open) setTab('playing');
  else if (activeTab === 'playing') setTab(lastListTab);
}

/** Keep layout-mode-dependent state in sync with the breakpoint. On
 *  desktop the docked NP pane is always part of the page (aria-hidden
 *  false); on mobile its visibility follows the 'playing' tab. If the
 *  viewport grows while the 'playing' overlay is up, drop back to the
 *  underlying list so the centre pane shows the catalog and NP docks on
 *  the right. Called at boot and whenever the breakpoint is crossed. */
function syncLayoutMode(): void {
  if (isDesktop()) {
    $np.setAttribute('aria-hidden', 'false');
    if (activeTab === 'playing') setTab(lastListTab);
  } else {
    $np.setAttribute('aria-hidden', String(activeTab !== 'playing'));
  }
}
desktopMq.addEventListener('change', syncLayoutMode);

// Theme persistence + DOM application live in ./theme. Boot wiring
// applies the persisted choice before first paint, then keeps the
// `<meta name="theme-color">` tint in sync with the OS preference if
// the user hasn't picked an explicit theme.
bootstrapTheme();

// About + Add are now tabs of the unified Settings sheet, not their own
// slide-up sheets. About is reachable only via the tab strip; Add keeps a
// programmatic opener (openAddSheet) for the post-submit close + any future
// "add station" affordance.

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

// Dashboard types + aggregation helpers live in ./dashboard.

interface DashboardPayload {
  range_days: number;
  days: string[];
  totals: PublicTotals;
  top_stations: {
    items: TopStationItem[];
    total: number;
    distinct_stations: number;
  };
  locations: { items: PublicLocationItem[]; total: number };
}

// `cache: 'no-store'` so the browser's HTTP cache never serves a stale
// snapshot from an earlier visit. Cloudflare's edge cache still answers
// (the response carries `Cache-Control: public, max-age=300`), so the
// upstream GC load is one fetch per 5 min regardless of traffic.
async function fetchDashboardPayload(): Promise<DashboardPayload | null> {
  try {
    const res = await fetch(DASHBOARD_URL, { cache: 'no-store' });
    if (!res.ok) {
      reportWorkerError(new Error(`HTTP ${res.status}`), '/api/public/dashboard', res.status);
      return null;
    }
    return (await res.json()) as DashboardPayload;
  } catch (err) {
    reportWorkerError(err, '/api/public/dashboard');
    return null;
  }
}

function renderDashKpis(d: DashboardData, totals: PublicTotals | null): void {
  // Visits is GoatCounter's `/stats/total` `total` field — the
  // headline number on GC's own dashboard. Prominent so the rrradio
  // sheet matches what shows up there.
  $dashVisits.textContent = totals?.total != null ? totals.total.toLocaleString() : '—';
  // Plays is the rrradio-specific derived metric (sum of `play:`
  // events). Verifiable in GC by summing the same path prefix; muted
  // because it's a filtered view, not a native GC number.
  $dashPlays.textContent = d.totalPlays > 0 ? d.totalPlays.toLocaleString() : '—';
}

function renderDashCountryTable(d: DashboardData): void {
  $dashCountryTable.replaceChildren();
  const sorted = [...d.byListenerCountry.entries()].sort((a, b) => b[1] - a[1]);
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

/** Build a fixed-height bar sparkline. Each `series` entry is one
 *  calendar day; bars share a single max across the whole table (passed
 *  in `maxAcrossTable`) so a row with one big day reads as taller than
 *  a row with a flat baseline. Days run oldest → newest, so the
 *  rightmost bar is today. */
function renderSparkline(series: number[], maxAcrossTable: number, days: string[]): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'bar__spark';
  wrap.setAttribute('role', 'img');
  const totalRow = series.reduce((s, v) => s + v, 0);
  wrap.setAttribute(
    'aria-label',
    `${totalRow} plays over the last ${series.length} days`,
  );
  series.forEach((v, idx) => {
    const cell = document.createElement('div');
    cell.className = 'bar__spark-cell';
    const fill = document.createElement('div');
    fill.className = 'bar__spark-fill';
    // sqrt-scale would compress big spikes; the brief is "show the
    // shape per day", so a linear scale stays honest. Floor at 4% so
    // a single-play day still leaves a visible nub instead of vanishing.
    const pct = v > 0 ? Math.max(4, (v / maxAcrossTable) * 100) : 0;
    fill.style.height = `${pct}%`;
    if (v === 0) fill.classList.add('is-empty');
    const day = days[idx];
    cell.title = day ? `${day}: ${v}` : String(v);
    cell.append(fill);
    wrap.append(cell);
  });
  return wrap;
}

function renderDashStationTable(items: TopStationItem[], days: string[]): void {
  $dashStationTable.replaceChildren();
  if (items.length === 0) return;
  const max = items[0]?.count ?? 1;
  const total = items.reduce((s, it) => s + it.count, 0);
  // Per-day plays sparkline when the worker ships a series. Falls back
  // to the single share-of-max bar for older worker builds. Max is the
  // highest single-day value across every visible row so the bars are
  // cross-station-comparable.
  const showSpark = items.some((it) => it.series && it.series.length > 0);
  let sparkMax = 0;
  if (showSpark) {
    for (const it of items) {
      for (const v of it.series ?? []) if (v > sparkMax) sparkMax = v;
    }
    if (sparkMax === 0) sparkMax = 1;
  }
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
    if (showSpark && it.series && it.series.length > 0) {
      bar.append(renderSparkline(it.series, sparkMax, days));
    } else {
      bar.innerHTML = `<div class="bar__track"><div class="bar__fill" style="width:${(it.count / max) * 100}%"></div></div>`;
    }
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
  const data = d.byListenerCountry;

  if (data.size === 0) {
    const empty = document.createElement('div');
    empty.className = 'dash-map-empty';
    empty.textContent = 'No listener-location data yet';
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
      marker.bindTooltip(`${countryName(cc)} · ${count} visitors`, {
        direction: 'top',
        offset: [0, -r],
        opacity: 0.95,
      });
    }
  });
}

async function openDashboardSheet(open: boolean): Promise<void> {
  $dashboardSheet.classList.toggle('open', open);
  $dashboardSheet.setAttribute('aria-hidden', String(!open));
  if (!open) {
    teardownDashMap();
    return;
  }
  $dashVisits.textContent = '…';
  $dashPlays.textContent = '…';
  const payload = await fetchDashboardPayload();
  const items = (payload?.top_stations.items ?? []).filter(
    (i) => typeof i.name === 'string' && i.name.length > 0,
  );
  const data = aggregateDashboard(
    payload?.locations.items ?? [],
    payload?.top_stations.total ?? 0,
    payload?.top_stations.distinct_stations ?? 0,
    payload?.days ?? [],
  );
  renderDashKpis(data, payload?.totals ?? null);
  renderDashCountryTable(data);
  renderDashStationTable(items, payload?.days ?? []);
  void renderDashMap(data);
}

function openAddSheet(open: boolean): void {
  if (open) {
    openSettingsSheet(true);
    selectSettingsTab('add');
    renderCustomList();
    $addError.hidden = true;
    // Focus the first field when opening
    window.setTimeout(() => {
      const first = $addForm.querySelector<HTMLInputElement>('input[name="name"]');
      first?.focus();
    }, 280);
  } else {
    openSettingsSheet(false);
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
//   · syncWakeUi() reflects armed state on the bottom alarm icon and
//     the Arm/Disarm button (which doubles as the "armed pill")
//   · setWakePane() opens/closes the inline editor on Now Playing
//   · armWakeFromSheet() persists, arms the scheduler
//   · onWakeFire() switches station + fades up + notifies
const wakeScheduler = new WakeScheduler();
let countdownTickTimer: number | undefined;

/** Show or hide the inline wake-edit pane on Now Playing. The pane
 *  replaces the regular track row when visible (CSS-driven via the
 *  body's `is-wake-edit` class). Wake state (armed / unarmed) is
 *  independent of pane visibility — toggling the pane just shows or
 *  hides the editor. */
function setWakePane(open: boolean): void {
  $body.classList.toggle('is-wake-edit', open);
  $wakePane.hidden = !open;
  // Mirror the open state on the alarm icon so the user gets clear
  // feedback that tapping the icon actually did something.
  syncWakeIconActive();
  if (!open) return;

  const armed = wakeScheduler.current();
  // Default to: armed time → user's last-used wake time → 07:00.
  // Persisting the last-used time means the user doesn't re-pick
  // 23:00 every night just because they disarmed in the morning.
  $wakeTime.value = armed?.time ?? getLastWakeTime() ?? '07:00';
  syncWakeArmButton();
  // Disable Arm when we don't have a station to arm against. The user
  // has to play something first; the topbar wake icon's tooltip
  // surfaces the same idea.
  // Exclude the silent bed — if a previous wake fired and the station
  // swap silently failed, currentNP.station is still SILENT_BED, and
  // arming a wake that targets the silent bed produces silence at fire
  // time. Treat SILENT_BED as "no station to arm against".
  const npStation =
    currentNP.station.id && currentNP.station.id !== SILENT_BED_ID
      ? currentNP.station
      : null;
  const station = armed?.station ?? npStation;
  $wakeArmBtn.disabled = !station && !armed;
}

/** Update the Set/Unset button so it doubles as the "armed pill":
 *    Unarmed → label "Set", no meta line
 *    Armed   → label "Unset", meta "07:00 · in 6h 12m"
 *  Called on pane open and after every arm/disarm/tick. */
function syncWakeArmButton(): void {
  const armed = wakeScheduler.current();
  const isArmed = !!armed;
  $wakeArmBtn.classList.toggle('is-armed', isArmed);
  if (!isArmed || !armed) {
    $wakeArmLabel.textContent = 'Set';
    $wakeArmMeta.hidden = true;
    $wakeArmMeta.textContent = '';
    $wakeArmBtn.setAttribute('aria-label', 'Set wake-to-radio');
    return;
  }
  const remain = nextFireTime(armed) - Date.now();
  $wakeArmLabel.textContent = 'Unset';
  $wakeArmMeta.textContent = `${armed.time} · ${formatCountdown(remain)}`;
  $wakeArmMeta.hidden = false;
  $wakeArmBtn.setAttribute(
    'aria-label',
    `Unset — wakes to ${armed.station.name} at ${armed.time}, ${formatCountdown(remain)}`,
  );
}

/** Drive the green "active" tint on the bottom alarm icon. The icon
 *  is green whenever the wake-edit pane is open OR a wake is armed,
 *  so it's clear at a glance that the alarm surface is engaged. */
function syncWakeIconActive(): void {
  const armed = !!wakeScheduler.current();
  const open = $body.classList.contains('is-wake-edit');
  $npWake.classList.toggle('is-fav', armed || open);
}

/** Toggle the inline wake-edit pane. Wired to the alarm icon at the
 *  bottom of NP controls. */
function toggleWakePane(): void {
  setWakePane(!$body.classList.contains('is-wake-edit'));
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
  // Exclude the silent bed — if a previous wake fired and the station
  // swap silently failed, currentNP.station is still SILENT_BED, and
  // arming a wake that targets the silent bed produces silence at fire
  // time. Treat SILENT_BED as "no station to arm against".
  const npStation =
    currentNP.station.id && currentNP.station.id !== SILENT_BED_ID
      ? currentNP.station
      : null;
  const station = armed?.station ?? npStation;
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
  startCountdownTick();
  ensureNotificationPermission();
  // Telemetry: capture the actual values being stored + the resulting
  // fire delta so the dashboard can flag when arm goes wrong (e.g.
  // user reports "I set 22:02, pill says 23h" — was the time stored
  // different, or was the bump rule wrong?).
  const fireDelta = nextFireTime(wake) - wake.armedAt;
  const fireMin = Math.round(fireDelta / 60_000);
  track('wake/arm', `${time} → in ${fireMin}m`);
  // Sheet stays open — the user just flipped the radio to "Armed" and
  // wants to see the resulting state. They dismiss explicitly via the
  // X or by tapping the alarm icon again.

  // Critical: start the silent bed right now while the user gesture
  // from the Arm tap is still in scope. The bed is a 1-second
  // silent AAC clip looped via audio.loop = true. From here the
  // audio element keeps producing samples through the night, the
  // tab stays alive on lock, and the fire-time station swap stays
  // within the same active media-playback session — no fresh
  // gesture needed.
  //
  // ALSO: prime a sidecar audio element with the wake station URL
  // inside the same gesture so it gets its own iOS user-activation
  // token. At fire time, swap() adopts that primed element. The
  // activation on the *main* element (the silent bed) appears to
  // weaken on iOS over hours of idle audio, so a freshly-activated
  // sidecar is the reliable path for the morning station swap.
  void player.play(SILENT_BED, { loop: true, silent: true }).then(() => {
    player.setTrackTitle(`Wake to ${wake.station.name} at ${wake.time}`, {
      track: `Wake to ${wake.station.name} at ${wake.time}`,
      artist: 'rrradio',
    });
  });
  void player.prime(wake.station);
}

function disarmWake(persist = true): void {
  // Capture the originally-armed station before clearing the
  // scheduler — we restore it as currentNP below so the NP view
  // doesn't lose the "I was listening to X" thread.
  const armed = wakeScheduler.current();
  wakeScheduler.disarm();
  if (persist) setWakeTo(null);
  stopCountdownTick();
  syncWakeUi();
  track('wake/disarm');

  // If the silent bed is currently playing (i.e. user armed and then
  // disarmed before fire time), restore the originally-armed station
  // as currentNP without auto-playing. The NP view goes back to
  // showing "B1 (paused)" instead of the silent bed, and the user
  // can hit the play button to resume audio. Falls back to a clean
  // idle stop if the armed wake had no station for some reason.
  if (currentNP.station.id === SILENT_BED.id) {
    if (armed?.station) {
      player.setStation(armed.station);
    } else {
      player.stop();
    }
  }
}

function onWakeFire(wake: WakeTo): void {
  // Swap from the silent bed to the wake station. Audio session has
  // been active since arm time (silent bed looping), so the play()
  // call is treated as continuation, not a fresh autoplay attempt.
  setWakeTo(null);
  stopCountdownTick();
  // Drop the wake-edit pane (if it was left open) so the user lands
  // on the regular Now Playing track row when they grab the phone —
  // the alarm has done its job, the editor would just be in the way.
  setWakePane(false);
  // Make sure the NP screen itself is visible — if the user was
  // browsing other tabs when the alarm fired, jump them to the
  // wake station's NP view so they see what's playing.
  openNp(true);
  // Wake state has cleared in the scheduler — sync the chrome so the
  // bottom alarm icon (and its chip) drop back to neutral. The wake
  // station starts playing in the swap() below; the visible
  // "alarm fired" cue is simply that the user's station is on the air.
  syncWakeUi();
  track('wake/fire', wake.station.name);
  // Force-unmute defensively in case the user manually muted before
  // sleeping. setMuted(true) wasn't called at arm in v2, but the
  // mute button is still on the UI and the user might have hit it.
  setMuted(false);
  player.setVolume(0);
  // swap() — not play() — so the iOS audio session that the silent
  // bed kept alive overnight stays continuously active across the
  // station switch. play() calls teardown() which does
  // `audio.removeAttribute('src') + audio.load()`, and on iOS Safari
  // that ends the session — making the next audio.play() a fresh
  // autoplay attempt that fails with NotAllowedError. swap() prefers
  // the sidecar primed at arm time (gesture-fresh activation) and
  // falls back to in-place src swap when no prime is available.
  void player.swap(wake.station).then(() => {
    // If swap() landed in 'paused' state, the autoplay block bit us
    // anyway. Surface to telemetry so we can see in the dashboard
    // when the wake silently fails despite the prime + swap.
    const settled = player.getCurrent();
    if (settled.state === 'paused' || settled.state === 'error') {
      track('wake/play-failed', `${wake.station.name} → ${settled.state}`);
    }
  });
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

function startCountdownTick(): void {
  stopCountdownTick();
  syncWakeUi();
  // Update once per minute. The countdown only displays minute
  // resolution ("in 4h 12m"), so a faster cadence would be wasteful.
  countdownTickTimer = window.setInterval(syncWakeUi, 60_000);
}

function stopCountdownTick(): void {
  if (countdownTickTimer !== undefined) {
    window.clearInterval(countdownTickTimer);
    countdownTickTimer = undefined;
  }
}

function syncWakeUi(): void {
  const wake = wakeScheduler.current();
  if (!wake) {
    $npWakeChip.hidden = true;
    $npWakeChip.textContent = '';
    $npWake.setAttribute('aria-label', 'Wake to radio');
  } else {
    $npWakeChip.hidden = false;
    $npWakeChip.textContent = wake.time;
    $npWake.setAttribute('aria-label', `Wake to ${wake.station.name} at ${wake.time}`);
  }
  syncWakeIconActive();
  // Keep the merged Arm/Disarm button in sync so its countdown ticks
  // alongside the chip when the wake-edit pane is open.
  syncWakeArmButton();
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
    void player.play(SILENT_BED, { loop: true, silent: true }).then(() => {
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
  startCountdownTick();
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

// Bottom tab bar (mobile) and sidebar nav (desktop) both carry the
// Browse / Favorites / Library buttons; one handler serves both surfaces.
function handleNavClick(e: Event): void {
  const target = e.target as HTMLElement;
  const btn = target.closest<HTMLButtonElement>('.tab-btn');
  if (!btn) return;
  const raw = btn.dataset.tab;
  // Opening Library always lands on its home (openListId cleared), not a
  // stale list detail from a previous visit.
  if (raw === 'library') openListId = null;
  if (raw) setTab(raw as Tab);
}
$tabbar.addEventListener('click', handleNavClick);
$sidebar.addEventListener('click', handleNavClick);

// Desktop sidebar collapse toggle — narrows the rail to icons only.
// Persisted so the user's choice survives reloads.
const SIDEBAR_COLLAPSED_KEY = 'rrradio.sidebar-collapsed';
function applySidebarCollapsed(collapsed: boolean): void {
  $body.classList.toggle('sidebar-collapsed', collapsed);
  $sidebarCollapse.setAttribute('aria-expanded', String(!collapsed));
  $sidebarCollapse.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
}
$sidebarCollapse.addEventListener('click', () => {
  const collapsed = !$body.classList.contains('sidebar-collapsed');
  applySidebarCollapsed(collapsed);
  setString(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0');
});
applySidebarCollapsed(getString(SIDEBAR_COLLAPSED_KEY) === '1');

// Browse-list collapse toggle (wide desktop only, in the NP pane corner).
// Collapsing the browse list hands the freed width to the player, which
// expands from 2 columns (Album + Schedule/Lyrics) to 3 (Album │ Schedule
// │ Lyrics). Persisted; only takes visual effect at ≥1400px (CSS-gated).
const BROWSE_COLLAPSED_KEY = 'rrradio.browse-collapsed';
function applyBrowseCollapsed(collapsed: boolean): void {
  $body.classList.toggle('browse-collapsed', collapsed);
  $npCollapseBrowse.setAttribute('aria-expanded', String(!collapsed));
  $npCollapseBrowse.setAttribute('aria-label', collapsed ? 'Show browse list' : 'Hide browse list');
  // twocol ⇄ threecol depends on this class — recompute.
  syncNpTabs();
}
$npCollapseBrowse.addEventListener('click', () => {
  const collapsed = !$body.classList.contains('browse-collapsed');
  applyBrowseCollapsed(collapsed);
  setString(BROWSE_COLLAPSED_KEY, collapsed ? '1' : '0');
});
applyBrowseCollapsed(getString(BROWSE_COLLAPSED_KEY) === '1');

// Desktop "close player": hide the docked NP pane so browse fills the
// width. Playback continues — the mini-player reappears as the transport
// and tap-to-reopen control. Not persisted: it's tied to the live
// session and is cleared when a station stops (see updateNowPlaying).
function applyNpClosed(closed: boolean): void {
  $body.classList.toggle('np-closed', closed);
}
$npClose.addEventListener('click', () => applyNpClosed(true));

$search.addEventListener('input', () => {
  syncSearchClear();
  // A live query suppresses the alphabet sort (relevance order wins).
  syncSort();
});
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
  // Toggle off when the user taps the active button. Tapping a mode also
  // leaves the discovery landing (Browse-all) so the chosen list shows.
  const next = browseMode === target ? null : target;
  if (next === browseMode) return;
  browseMode = next;
  browseAll = false;
  syncBrowseModeButtons();
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

// Alphabet sort cycle (off → A–Z → Z–A). Disabled while a query is active.
$sortBtn.addEventListener('click', () => {
  if ($sortBtn.disabled) return;
  activeSort = cycleSort(activeSort);
  syncSort();
  track(`sort/${activeSort ?? 'off'}`);
  void runQuery();
});

// Minimum stream-quality filter. 'all' clears it; 'med' keeps Medium+High;
// 'high' keeps High only. Local-only (never forwarded to Radio Browser).
$quality.addEventListener('change', () => {
  activeQuality.clear();
  if ($quality.value === 'high') {
    activeQuality.add('high');
  } else if ($quality.value === 'med') {
    activeQuality.add('medium');
    activeQuality.add('high');
  }
  syncQuality();
  track(`quality/${$quality.value}`);
  void runQuery();
});

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

$addForm.addEventListener('submit', handleAddSubmit);

$listCancel.addEventListener('click', () => closeListSheet());
$listNewBtn.addEventListener('click', () => {
  // Reveal the inline create row (rendered by renderListPicker); creating
  // there adds the current station to the new list in one step.
  sheetCreateOpen = true;
  renderListPicker();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $listSheet.classList.contains('open')) closeListSheet();
});

// ─── Top-toolbar sheets: filters (funnel) + settings (gear) ───
// The inline filter-row lives inside #filter-sheet (relocated at boot),
// so opening the funnel reveals every existing filter control unchanged.
$filterSheetBody.appendChild($filterRow);
$filterRow.hidden = false;

function openFilterSheet(open: boolean): void {
  $filterSheet.classList.toggle('open', open);
  $filterSheet.setAttribute('aria-hidden', String(!open));
}
function openSettingsSheet(open: boolean): void {
  if (open) {
    syncThemeSeg();
    syncLandingSeg();
    syncMusicToggles();
  }
  $settingsSheet.classList.toggle('open', open);
  $settingsSheet.setAttribute('aria-hidden', String(!open));
}

// ─── Settings sheet tabs: Settings · About · Add · History ───
// About + Add used to be their own slide-up sheets; their markup is
// authored once in #about-src / #add-src and relocated into the matching
// tab panels here at boot (same pattern as the filter-row relocation),
// so every id + handler inside them is preserved.
type SettingsTab = 'settings' | 'about' | 'add' | 'history';
const settingsPanels = new Map<SettingsTab, HTMLElement>();
for (const panel of $settingsSheet.querySelectorAll<HTMLElement>('[data-settings-panel]')) {
  settingsPanels.set(panel.dataset.settingsPanel as SettingsTab, panel);
}
function relocateInto(srcId: string, tab: SettingsTab): void {
  const src = document.getElementById(srcId);
  const panel = settingsPanels.get(tab);
  if (src && panel) panel.append(...Array.from(src.childNodes));
}
relocateInto('about-src', 'about');
relocateInto('add-src', 'add');

function selectSettingsTab(tab: SettingsTab): void {
  for (const btn of $settingsTabs.querySelectorAll<HTMLButtonElement>('.sheet-tab')) {
    const on = btn.dataset.settingsTab === tab;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-selected', String(on));
  }
  for (const [key, panel] of settingsPanels) panel.hidden = key !== tab;
  if (tab === 'history') renderHistoryPanel();
  // Scroll the body back to the top when switching tabs.
  const body = $settingsSheet.querySelector<HTMLElement>('.sheet-body');
  if (body) body.scrollTop = 0;
}

/** Render the History tab → recently-played stations (web's listening-
 *  history equivalent). Reuses the standard station rows; tapping one
 *  plays it and dismisses the sheet to reveal Now Playing. */
function renderHistoryPanel(): void {
  const recents = getRecents();
  $settingsHistoryList.replaceChildren();
  if (recents.length === 0) {
    $settingsHistoryList.append(
      emptyState(ICON_RECENT, 'No history yet', 'Stations you play will show up here'),
    );
    return;
  }
  $settingsHistoryList.append(renderRows(recents));
}

$settingsTabs.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.sheet-tab');
  if (!btn) return;
  selectSettingsTab((btn.dataset.settingsTab as SettingsTab) ?? 'settings');
});
// A tap on a recent-station row plays it (the row's own handler) and we
// close the sheet so Now Playing is revealed underneath.
$settingsHistoryList.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('.row')) openSettingsSheet(false);
});

/** Lights the funnel's accent dot when any filter / mode narrows Browse. */
function syncFilterDot(): void {
  const active =
    activeTag !== 'all' ||
    activeCountry !== 'all' ||
    activeQuality.size > 0 ||
    browseMode !== null ||
    curatedOnly;
  $filterDot.hidden = !active;
}

$filterBtn.addEventListener('click', () => openFilterSheet(true));
$filterClose.addEventListener('click', () => openFilterSheet(false));
$settingsBtn.addEventListener('click', () => {
  openSettingsSheet(true);
  selectSettingsTab('settings');
});
$settingsClose.addEventListener('click', () => openSettingsSheet(false));
// ─── Settings: theme · landing page · music services ───
const LANDING_KEY = 'rrradio.landing';
type MusicService = 'apple' | 'spotify' | 'youtube';
const MS_KEYS: Record<MusicService, string> = {
  apple: 'rrradio.ms.apple',
  spotify: 'rrradio.ms.spotify',
  youtube: 'rrradio.ms.youtube',
};
/** Music-service deep-links default ON; '0' = user turned it off. */
function msEnabled(svc: MusicService): boolean {
  return getString(MS_KEYS[svc]) !== '0';
}

function syncSeg(seg: HTMLElement, attr: string, value: string): void {
  for (const btn of seg.querySelectorAll<HTMLButtonElement>('.seg__btn')) {
    const on = btn.dataset[attr] === value;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-checked', String(on));
  }
}
function syncThemeSeg(): void {
  syncSeg($themeSeg, 'themeChoice', readStoredTheme() ?? 'system');
}
function syncLandingSeg(): void {
  syncSeg($landingSeg, 'landing', getString(LANDING_KEY) || 'browse');
}
function syncMusicToggles(): void {
  $msApple.setAttribute('aria-pressed', String(msEnabled('apple')));
  $msSpotify.setAttribute('aria-pressed', String(msEnabled('spotify')));
  $msYoutube.setAttribute('aria-pressed', String(msEnabled('youtube')));
}
/** Hide the open-in links the user turned off in Settings. */
function syncMusicServiceLinks(): void {
  $npTrackAppleMusic.style.display = msEnabled('apple') ? '' : 'none';
  $npTrackSpotify.style.display = msEnabled('spotify') ? '' : 'none';
  $npTrackYoutubeMusic.style.display = msEnabled('youtube') ? '' : 'none';
}

$themeSeg.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.seg__btn');
  if (!btn) return;
  const choice = btn.dataset.themeChoice ?? 'system';
  applyTheme(choice === 'system' ? null : (choice as 'light' | 'dark'));
  syncThemeSeg();
  track(`theme/${choice}`);
});
$landingSeg.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.seg__btn');
  if (!btn) return;
  const landing = btn.dataset.landing ?? 'browse';
  setString(LANDING_KEY, landing);
  syncLandingSeg();
  track(`landing/${landing}`);
});
function bindMusicToggle(btn: HTMLButtonElement, svc: MusicService): void {
  btn.addEventListener('click', () => {
    const next = !msEnabled(svc);
    setString(MS_KEYS[svc], next ? '1' : '0');
    syncMusicToggles();
    syncMusicServiceLinks();
    track(`music-service/${svc}/${next ? 'on' : 'off'}`);
  });
}
bindMusicToggle($msApple, 'apple');
bindMusicToggle($msSpotify, 'spotify');
bindMusicToggle($msYoutube, 'youtube');

$settingsBackup.addEventListener('click', () => {
  openSettingsSheet(false);
  exportBackupNow();
});
$settingsRestore.addEventListener('click', () => {
  openSettingsSheet(false);
  pickImportFile();
});

$settingsStats.addEventListener('click', () => {
  openSettingsSheet(false);
  void openDashboardSheet(true);
});

// ─── Backup & restore ──────────────────────────────────────────────
// UI lives on the Favorites tab header (icons rendered by
// renderFavoritesActions below). About sheet describes the feature
// but holds no buttons of its own. A small toast under the topbar
// reports the result; replaces itself on the next action.

let $backupToast: HTMLElement | null = null;
let backupToastTimer: ReturnType<typeof setTimeout> | null = null;

function showBackupToast(text: string, tone: 'ok' | 'err'): void {
  if (!$backupToast) {
    $backupToast = document.createElement('div');
    $backupToast.className = 'backup-toast';
    $backupToast.setAttribute('role', 'status');
    document.body.appendChild($backupToast);
  }
  $backupToast.textContent = text;
  $backupToast.dataset.tone = tone;
  $backupToast.hidden = false;
  if (backupToastTimer) clearTimeout(backupToastTimer);
  // Errors persist longer — users need time to read them.
  backupToastTimer = setTimeout(() => {
    if ($backupToast) $backupToast.hidden = true;
  }, tone === 'err' ? 7_000 : 4_000);
}

/** Snapshot the current app settings for a backup. Reads through the
 *  same accessors the app uses at boot, so the file always reflects the
 *  live state. Omitted (undefined) keys drop out of the JSON. */
function collectSettings(): BackupSettings {
  return {
    theme: readStoredTheme() ?? undefined,
    landing: getString(LANDING_KEY) ?? undefined,
    musicServices: {
      apple: msEnabled('apple'),
      spotify: msEnabled('spotify'),
      youtube: msEnabled('youtube'),
    },
    sidebarCollapsed: getString(SIDEBAR_COLLAPSED_KEY) === '1',
    browseCollapsed: getString(BROWSE_COLLAPSED_KEY) === '1',
  };
}

/** Apply imported settings live — persist each key and call the same
 *  apply functions the toggles use, so a restore takes effect without a
 *  reload. Only the keys present in the file are touched. */
function applySettings(s: BackupSettings): void {
  if (s.theme) applyTheme(s.theme);
  if (s.landing) setString(LANDING_KEY, s.landing);
  if (s.musicServices) {
    const ms = s.musicServices;
    if (typeof ms.apple === 'boolean') setString(MS_KEYS.apple, ms.apple ? '1' : '0');
    if (typeof ms.spotify === 'boolean') setString(MS_KEYS.spotify, ms.spotify ? '1' : '0');
    if (typeof ms.youtube === 'boolean') setString(MS_KEYS.youtube, ms.youtube ? '1' : '0');
    syncMusicServiceLinks();
  }
  if (typeof s.sidebarCollapsed === 'boolean') {
    setString(SIDEBAR_COLLAPSED_KEY, s.sidebarCollapsed ? '1' : '0');
    applySidebarCollapsed(s.sidebarCollapsed);
  }
  if (typeof s.browseCollapsed === 'boolean') {
    setString(BROWSE_COLLAPSED_KEY, s.browseCollapsed ? '1' : '0');
    applyBrowseCollapsed(s.browseCollapsed);
  }
}

function exportBackupNow(): void {
  const favs = getFavorites();
  const cus = getCustom();
  const lists = getLists();
  const recents = getRecents();
  const settings = collectSettings();
  const text = serializeBackup(favs, cus, lists, recents, settings);
  // Blob URL + temporary anchor for the download. Works on desktop;
  // iOS Safari opens inline (Save to Files is two taps from there).
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = backupFilename();
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  const exportParts: string[] = [];
  if (favs.length > 0) exportParts.push(`${favs.length} favorite${favs.length === 1 ? '' : 's'}`);
  if (cus.length > 0) exportParts.push(`${cus.length} custom station${cus.length === 1 ? '' : 's'}`);
  if (lists.length > 0) exportParts.push(`${lists.length} list${lists.length === 1 ? '' : 's'}`);
  if (recents.length > 0)
    exportParts.push(`${recents.length} recent${recents.length === 1 ? '' : 's'}`);
  exportParts.push('settings');
  showBackupToast(`Exported ${joinNatural(exportParts)}.`, 'ok');
  track(
    'backup-export',
    `favs=${favs.length} custom=${cus.length} lists=${lists.length} recents=${recents.length}`,
  );
}

/** "a", "a and b", "a, b and c" — matches backup.ts's joinParts wording. */
function joinNatural(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function importBackupFromFile(file: File): void {
  const reader = new FileReader();
  reader.onerror = () => showBackupToast("Couldn't read that file.", 'err');
  reader.onload = () => {
    try {
      const text = String(reader.result ?? '');
      const snap = parseBackup(text);
      const summary = mergeSnapshot(
        getFavorites(),
        getCustom(),
        getLists(),
        getRecents(),
        snap,
      );
      setFavorites(summary.mergedFavorites);
      setCustom(summary.mergedCustom);
      setLists(summary.mergedLists);
      setRecents(summary.mergedRecents);
      applySettings(summary.mergedSettings);
      showBackupToast(summaryMessage(summary), 'ok');
      track(
        'backup-import',
        `favsAdded=${summary.favoritesAdded} customAdded=${summary.customAdded} listsAdded=${summary.listsAdded} recentsAdded=${summary.recentsAdded} settings=${summary.settingsApplied}`,
      );
      void runQuery();
      renderCustomList();
      // Favorites / Library / Recents all may have changed — re-render if visible.
      if (activeTab === 'fav' || isLibraryTab(activeTab)) renderContent();
    } catch (err) {
      const msg =
        err instanceof BackupParseError
          ? err.message
          : `Import failed: ${err instanceof Error ? err.message : String(err)}`;
      showBackupToast(msg, 'err');
    }
  };
  reader.readAsText(file);
}

/** Trigger the file-picker. The input is created on demand so the DOM
 *  doesn't carry a permanently-mounted hidden file input. */
function pickImportFile(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.style.display = 'none';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) importBackupFromFile(file);
    input.remove();
  });
  document.body.appendChild(input);
  input.click();
}

/** Build the export + import icon buttons for the Favorites tab header.
 *  The backup now carries everything (favorites, custom, lists, recents
 *  and settings), so export is always available — even an empty dial
 *  exports the user's settings. Import is how a fresh device populates. */
function favoriteHeaderActions(): HTMLElement[] {
  const exportBtn = document.createElement('button');
  exportBtn.type = 'button';
  exportBtn.className = 'section-label__action';
  exportBtn.setAttribute('aria-label', 'Export backup');
  exportBtn.title = 'Export everything to a file';
  exportBtn.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>';
  exportBtn.addEventListener('click', exportBackupNow);

  const importBtn = document.createElement('button');
  importBtn.type = 'button';
  importBtn.className = 'section-label__action';
  importBtn.setAttribute('aria-label', 'Import backup');
  importBtn.title = 'Import from a backup file';
  importBtn.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21V9"/><path d="m17 14-5-5-5 5"/><path d="M5 3h14"/></svg>';
  importBtn.addEventListener('click', pickImportFile);

  return [exportBtn, importBtn];
}
$dashboardClose.addEventListener('click', () => void openDashboardSheet(false));

// Tap the alarm icon at the bottom of NP controls → toggle the
// inline wake-edit pane. Second tap exits back to the regular track
// row; the wake (if armed) persists.
$npWake.addEventListener('click', toggleWakePane);

// While armed, a change to the clock means "re-arm with this new
// time" — that's the user's intent when they tap the clock to edit.
// armWakeFromSheet() handles the disarm-then-arm via wakeScheduler.
$wakeTime.addEventListener('change', () => {
  if (wakeScheduler.current()) {
    armWakeFromSheet();
    syncWakeArmButton();
  }
});

// Single Arm/Disarm button — toggles based on current armed state.
$wakeArmBtn.addEventListener('click', () => {
  if ($wakeArmBtn.disabled) return;
  if (wakeScheduler.current()) {
    disarmWake();
  } else {
    armWakeFromSheet();
    // armWakeFromSheet bails silently if no station is playing AND no
    // previous wake station is on file. Surface a one-off hint via
    // the merged Arm/Disarm button so the user isn't left wondering
    // why the tap did nothing.
    if (!wakeScheduler.current()) {
      $wakeArmLabel.textContent = 'Play a station first';
      $wakeArmMeta.hidden = true;
      $wakeArmMeta.textContent = '';
      return;
    }
  }
  syncWakeArmButton();
});

$mini.addEventListener('click', () => {
  // On desktop the mini only surfaces when the player was closed; clicking
  // it re-docks the full pane. On mobile it opens the Now Playing overlay.
  if (isDesktop()) applyNpClosed(false);
  else openNp(true);
});

const $npBack = document.getElementById('np-back') as HTMLButtonElement;
$npBack.addEventListener('click', () => openNp(false));
$miniToggle.addEventListener('click', (e) => {
  e.stopPropagation();
  handlePlayToggle();
});

// Mini-player skip — same gesture as the lock-screen "next" control:
// cycles through favorites. Stops propagation so it doesn't also
// trigger the parent .mini click that opens Now Playing.
$miniSkip.addEventListener('click', (e) => {
  e.stopPropagation();
  skipFavorite(1);
});

$npPlay.addEventListener('click', () => handlePlayToggle());

// Open-in popup — arrow trigger reveals a small panel with service
// text links. Click outside / Esc / pick a link closes it. The
// wrapper carries the open-state for hover styling.
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
  // Reflect the user's per-service Settings toggles before showing.
  syncMusicServiceLinks();
  positionOpenInPopup();
  $npTrackOpenInPopup.hidden = false;
  $npTrackOpenInWrap.dataset.open = 'true';
  $npTrackOpenIn.setAttribute('aria-expanded', 'true');
  track('open-in/show');
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
// uses them. Track strings stay out of telemetry.
$npTrackSpotify.addEventListener('click', () => {
  track('open-spotify');
  closeOpenInPopup();
});
$npTrackAppleMusic.addEventListener('click', () => {
  track('open-apple-music');
  closeOpenInPopup();
});
$npTrackYoutubeMusic.addEventListener('click', () => {
  track('open-youtube-music');
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

function setReportBrokenState(state: 'idle' | 'sending' | 'sent' | 'error'): void {
  $npReportBroken.classList.toggle('is-sent', state === 'sent');
  $npReportBroken.classList.toggle('is-error', state === 'error');
  $npReportBroken.disabled = state === 'sending' || !currentNP.station.id;
  $npReportBrokenLabel.textContent =
    state === 'sending'
      ? 'Sending...'
      : state === 'sent'
        ? 'Report sent'
        : state === 'error'
          ? 'Could not send'
          : 'Broken station';
}

$npReportBroken.addEventListener('click', async () => {
  const station = currentNP.station;
  if (!station.id || station.id === SILENT_BED_ID) return;
  setReportBrokenState('sending');
  try {
    await reportBrokenStation(station, currentNP.errorMessage);
    setReportBrokenState('sent');
  } catch (err) {
    reportWorkerError(err, '/api/public/report-broken');
    setReportBrokenState('error');
  }
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
  // Translate a generic stream-failed error into a friendly
  // geo-restricted message when the curated `availableIn` flag tells
  // us this station is region-locked and the visitor is outside the
  // allow-list. The browser only surfaces a vague MediaError code on
  // the 401 the AIS9 streaming server returns, so without this
  // override the user would see "Cannot decode stream" or "Stream
  // error" for what's really a licensing geo-gate. Telemetry then
  // records the override message too, which is actually more useful
  // than the generic code — confirmed-geo errors get their own bucket.
  if (np.state === 'error' && !isAvailableInUserRegion(np.station)) {
    const label = geoRestrictionLabel(np.station, countryName);
    if (label) {
      np = { ...np, errorMessage: `${label} — region-locked by the broadcaster.` };
    }
  }
  const stationLost = !np.station.id && currentNP.station.id && activeTab === 'playing';
  const stationChanged = np.station.id && np.station.id !== currentNP.station.id;
  currentNP = np;
  // Refresh schedule when the user starts a new station — schedules
  // are per-station, fetched once on station change.
  if (stationChanged) {
    void loadSchedule(np.station);
    resetLyrics();
    setReportBrokenState('idle');
  }
  $body.classList.toggle('is-playing', np.state === 'playing');
  $body.classList.toggle('has-station', !!np.station.id);
  // A stopped/cleared station resets the closed-player state, so the pane
  // docks again by default next time something plays.
  if (!np.station.id) $body.classList.remove('np-closed');
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
      const sanitizedReason = truncateErrorMessage(reason);
      track(`error: ${np.station.name || 'unknown'}`, sanitizedReason);
      reportStreamError(sanitizedReason, np.station.id);
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
syncLayoutMode();
syncGenre();
syncCountry();
syncSearchClear();
syncBrowseModeButtons();
syncSort();
syncQuality();
syncMusicServiceLinks();
// Landing-page preference: open Favorites / Recents on launch when the
// user picked one (and there's no inbound ?q search / station deep-link
// taking precedence — those still win via runQuery / autoLoadStationFromUrl).
{
  const landing = getString(LANDING_KEY);
  const hasQuery = !!new URLSearchParams(window.location.search).get('q');
  if (!hasQuery && (landing === 'fav' || landing === 'recent')) setTab(landing);
}
// Stations.json defines the built-in catalog (Featured strip + per-station
// metadata fetcher overrides). Render once it lands so the first paint
// already has the Featured tiles.
void loadBuiltinStations().then(() => {
  syncCountryOptions();
  if (activeTab === 'browse') renderContent();
  autoLoadStationFromUrl();
});
// Editorial Featured rail on the discovery landing — load once, then
// re-render if we're still on the discovery view when it lands.
void loadHighlights().then((list) => {
  highlightsRaw = list;
  if (inDiscovery()) renderContent();
});
// Fetch the visitor's country from the worker so geo-restricted
// station rows can show a "<Country> only" badge instead of failing
// silently at play time. Fire-and-forget — the result is cached in
// localStorage for 24h, and the rerender on resolve is cheap when
// nothing geo-restricted is visible. We re-render unconditionally
// because the answer could just as easily be "unknown" (in which
// case we already render correctly), but a single extra renderContent
// pass on page load is harmless.
void fetchUserRegion().then(() => {
  renderContent();
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
