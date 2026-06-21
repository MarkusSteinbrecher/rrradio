import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  BUILTIN_STATIONS,
  findFetcher,
  findScheduleFetcher,
  loadBuiltinStations,
} from './builtins';
import type { ScheduleDay } from './metadata';
import { searchITunes, isLowResCoverUrl } from './coverArt';
import { FavoritesCoverStore, type FavCoverEntry } from './favoritesMetadata';
import { lookupLyrics } from './lyrics';
import type { LyricsResult } from './lyrics';
import { MetadataPoller, icyFetcher } from './metadata';
import { AudioPlayer } from './player';
import { track } from './telemetry';
import { pseudoFrequency } from './radioBrowser';
import { PAGE_SIZE, fetchStations, searchStations } from './stations';
import { GENRES, findGenre, stationMatchesGenre } from './genre-taxonomy';
import { stationQualityBucket, type QualityBucket } from './quality';
import { type BrowseSort, cycleSort, sortStations, orderFeaturedFirst } from './sort';
import {
  discoveryCounts,
  genreChips,
  countryChips,
  abbreviateCount,
  DISCOVERY_HIGHLIGHT_LIMIT,
  DISCOVERY_BROWSE_ALL_LOGO_LIMIT,
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
  type LyricsPaneRefs,
  type NowPlayingRefs,
  renderLyricsPane as renderLyricsPaneImpl,
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
} from './icons';
import {
  bootstrapTheme,
  applyTheme,
  readStoredTheme,
  effectiveTheme,
} from './theme';
import { bootstrapAccent, readAccent, setAccent, DEFAULT_ACCENT } from './accent';
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

// Per-station "now playing" cover art for library feeds (Favorites, Lists,
// Recents) — iOS FavoriteNowPlayingStore parity. Polls the visible rows and
// paints each station's current-track cover into its card in place.
const favCovers = new FavoritesCoverStore(() => paintFavCovers());

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
// Filter sheet (iOS BrowseFiltersSheet port) — collapsible multi-select
// sections built into #bf-sections, with a draft-model footer.
const $bfSections = document.getElementById('bf-sections') as HTMLElement;
const $bfCancel = document.getElementById('bf-cancel') as HTMLButtonElement;
const $bfClear = document.getElementById('bf-clear') as HTMLButtonElement;
const $bfApply = document.getElementById('bf-apply') as HTMLButtonElement;
const $tabStatus = document.getElementById('tab-status') as HTMLElement;
const $content = document.getElementById('content') as HTMLElement;
const $tabbar = document.getElementById('tabbar') as HTMLElement;
const $topnavNav = document.querySelector('.topnav-nav') as HTMLElement;

const $mini = document.getElementById('mini') as HTMLElement;
const $miniFav = document.getElementById('mini-fav') as HTMLElement;
const $miniArt = document.getElementById('mini-art') as HTMLElement;
const $miniName = document.getElementById('mini-name') as HTMLElement;
const $miniTrack = document.getElementById('mini-track') as HTMLElement;
const $miniMeta = document.getElementById('mini-meta') as HTMLElement;
const $miniToggle = document.getElementById('mini-toggle') as HTMLElement;
const $miniPrev = document.getElementById('mini-prev') as HTMLElement;
const $miniSkip = document.getElementById('mini-skip') as HTMLElement;
const $miniVolume = document.getElementById('mini-volume') as HTMLElement;
const $miniVolumeSlider = document.getElementById('mini-volume-slider') as HTMLInputElement;

const $np = document.getElementById('np') as HTMLElement;
const $npName = document.getElementById('np-name') as HTMLElement;
const $npStationLogo = document.getElementById('np-station-logo') as HTMLImageElement;
const $npTags = document.getElementById('np-tags') as HTMLElement;
const $npBitrate = document.getElementById('np-bitrate') as HTMLElement;
const $npOrigin = document.getElementById('np-origin') as HTMLElement;
const $npListeners = document.getElementById('np-listeners') as HTMLElement;
const $npPaneTabs = document.getElementById('np-pane-tabs') as HTMLElement;
const $npPaneNow = document.getElementById('np-pane-now') as HTMLButtonElement;
const $npPaneProgram = document.getElementById('np-pane-program') as HTMLButtonElement;
const $npPaneLyrics = document.getElementById('np-pane-lyrics') as HTMLButtonElement;
const $npProgramPane = document.getElementById('np-program-pane') as HTMLElement;
const $npProgramHead = document.getElementById('np-program-head') as HTMLElement;
const $npProgramHeadName = document.getElementById('np-program-head-name') as HTMLElement;
const $npProgramHeadSub = document.getElementById('np-program-head-sub') as HTMLElement;
const $npProgramMeta = document.getElementById('np-program-meta') as HTMLElement;
const $npProgramCount = document.getElementById('np-program-count') as HTMLElement;
const $npProgramList = document.getElementById('np-program-list') as HTMLElement;
const $npProgramEmpty = document.getElementById('np-program-empty') as HTMLElement;
const $npLyricsPane = document.getElementById('np-lyrics-pane') as HTMLElement;
const $npLyricsHead = document.getElementById('np-lyrics-head') as HTMLElement;
const $npLyricsTitle = document.getElementById('np-lyrics-title') as HTMLElement;
const $npLyricsArtist = document.getElementById('np-lyrics-artist') as HTMLElement;
const $npLyricsText = document.getElementById('np-lyrics-text') as HTMLElement;
const $npLyricsSource = document.getElementById('np-lyrics-source') as HTMLAnchorElement;
const $npLyricsSourceText = document.getElementById('np-lyrics-source-text') as HTMLElement;
const $npLyricsEmpty = document.getElementById('np-lyrics-empty') as HTMLElement;
const $npSecondaryEmpty = document.getElementById('np-secondary-empty') as HTMLElement;
const $npCollapseBrowse = document.getElementById('np-collapse-browse') as HTMLButtonElement;
const $npClose = document.getElementById('np-close') as HTMLButtonElement;
const $npTrackRow = document.getElementById('np-track-row') as HTMLElement;
const $npTrackTitle = document.getElementById('np-track-title') as HTMLElement;
const $npTrackArtist = document.getElementById('np-track-artist') as HTMLElement;
const $npTrackProgram = document.getElementById('np-track-program') as HTMLElement;
const $npTrackStatus = document.getElementById('np-track-status') as HTMLElement;
const $npTrackStatusText = document.getElementById('np-track-status-text') as HTMLElement;
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
const $npVolume = document.getElementById('np-volume') as HTMLElement;
const $npVolumeSlider = document.getElementById('np-volume-slider') as HTMLInputElement;
const $npVolumeValue = document.getElementById('np-volume-value') as HTMLElement;
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
const $filterClose = document.getElementById('filter-close') as HTMLButtonElement;
const $settingsBtn = document.getElementById('settings-btn') as HTMLButtonElement;
const $settingsSheet = document.getElementById('settings-sheet') as HTMLElement;
const $settingsClose = document.getElementById('settings-close') as HTMLButtonElement;
const $themeSeg = document.getElementById('theme-seg') as HTMLElement;
const $accentSeg = document.getElementById('accent-seg') as HTMLElement;
const $accentRow = document.getElementById('accent-row') as HTMLElement;
const $accentPicker = document.getElementById('accent-picker') as HTMLInputElement;
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
// Browse filter — multi-select, mirroring the iOS BrowseFilter model.
// Genre ids (from GENRES) and uppercase ISO country codes; News is the
// in-filter toggle iOS keeps in the Genre section. When ANY of these (or
// activeQuality) is set, the Browse list is matched locally against the
// catalog — no Radio Browser fetch — so the live "Show N" count is real.
const filterGenres = new Set<string>();
const filterCountries = new Set<string>();
let filterNews = false;
// Alphabet sort for the result list (off → A–Z → Z–A). Lives on the page
// (the results row), not in the filter. Suppressed while a text query is
// active (relevance order wins).
let activeSort: BrowseSort = null;
// Stream-quality buckets to keep (empty = no quality filter). Part of the
// filter; matched locally, never forwarded to Radio Browser.
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

/** Distinct uppercase country codes present in the catalog, ordered by
 *  display name. Memoised against catalog size; feeds the filter sheet's
 *  Country section. Empty before stations.json loads. */
let catalogCountriesCache: string[] | null = null;
let catalogCountriesForLen = -1;
function catalogCountries(): string[] {
  if (catalogCountriesCache && catalogCountriesForLen === BUILTIN_STATIONS.length) {
    return catalogCountriesCache;
  }
  const codes = new Set<string>();
  for (const s of BUILTIN_STATIONS) {
    if (s.country && s.country.length >= 2) codes.add(s.country.toUpperCase());
  }
  catalogCountriesCache = [...codes].sort((a, b) => countryName(a).localeCompare(countryName(b)));
  catalogCountriesForLen = BUILTIN_STATIONS.length;
  return catalogCountriesCache;
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

// Infinite scroll: the active result list's "load more" action, or null
// when nothing more is available. renderContent() recomputes it each render;
// the $content scroll listener (wired in init) fires it as the user nears the
// bottom — iOS parity, so stations load on scroll, not via a button tap. The
// manual "Load more" / "Show more" buttons stay as a keyboard/fallback path.
let pendingLoadMore: (() => void) | null = null;
// A short first page (RB dedupes a 60-page down to ~25) may not fill a tall
// viewport, leaving nothing to scroll to engage infinite scroll. Auto-pull the
// next batch(es) until the list overflows — capped per view so a degenerate
// run of all-duplicate RB pages can't loop forever (the manual button remains).
let autoFillTries = 0;
const AUTO_FILL_MAX = 6;

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

interface RowOptions {
  /** Library feeds (Favorites / Lists / Recents) carry a trailing cover-art
   *  slot showing the station's current-track art (iOS parity). Browse rows
   *  don't. */
  cover?: boolean;
}

function buildRow(
  station: Station,
  currentId: string,
  state: NowPlaying['state'],
  favs: Set<string>,
  opts: RowOptions = {},
): HTMLDivElement {
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
  if (geoLabel) {
    const geo = document.createElement('span');
    geo.className = 'row-geo';
    geo.textContent = geoLabel;
    // Hover/long-press tooltip — same copy the player error path
    // falls back to when AVPlayer or the browser fails on the 401.
    geo.title = `${geoLabel} — likely a music-licensing geo-block from the broadcaster.`;
    tags.append(geo);
  }
  // Genre tags appear on Browse rows only. Library cards (Favorites / Lists
  // / Recents) show the now-playing track under the name instead — or just
  // the station name when nothing is playing (iOS favorites layout).
  if (!opts.cover) {
    const tagsText = document.createElement('span');
    tagsText.className = 'row-tags__text';
    tagsText.textContent = (station.tags ?? []).slice(0, 3).join(' · ');
    tags.append(tagsText);
  }
  info.append(name);
  // Only attach the tags line when it has content: Browse always has the
  // genre text; a library card only when the station is geo-restricted.
  if (tags.childElementCount > 0) info.append(tags);
  // Library feeds carry a now-playing subtitle (artist — track) shown once
  // the cover poll resolves a track.
  if (opts.cover) {
    const now = document.createElement('div');
    now.className = 'row-now';
    now.hidden = true;
    info.append(now);
  }

  // Library feeds (Favorites / Lists / Recents) render as iOS-style cards:
  // no inline add/heart/equalizer — the trailing slot is the station's
  // now-playing cover art, and the subtitle carries the current track.
  // Browse rows keep the equalizer + add-to-list + favorite controls.
  if (opts.cover) {
    const cover = document.createElement('span');
    cover.className = 'row-cover';
    const entry = favCovers.get(station.id);
    if (entry) setRowCover(cover, entry.coverUrl);
    row.append(fav, info, cover);
    applyRowNowPlaying(row, entry);
  } else {
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
  }

  row.addEventListener('click', () => onRowPlay(station));
  row.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onRowPlay(station);
    }
  });

  return row;
}

/** Fill a row's cover slot with a track-art image. Idempotent (no-op when the
 *  URL is unchanged). A broken/blocked cover removes itself so the slot
 *  collapses back to the station-logo-only layout. */
function setRowCover(slot: HTMLElement, url: string): void {
  let img = slot.querySelector('img');
  if (img && img.getAttribute('src') === url) return;
  if (!img) {
    img = document.createElement('img');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
    img.addEventListener('error', () => {
      slot.classList.remove('has-cover');
      img?.remove();
    });
    slot.appendChild(img);
  }
  img.src = url;
  slot.classList.add('has-cover');
}

/** Build the now-playing subtitle line ("artist — track", or just the
 *  track) from a cover-store entry. Empty when there's no resolved track. */
function nowPlayingLine(entry: FavCoverEntry | undefined): string {
  if (!entry?.title) return '';
  return entry.artist ? `${entry.artist} — ${entry.title}` : entry.title;
}

/** Swap a library row's subtitle between the genre tags and the live
 *  now-playing line. When a track is known it wins (matching iOS, which
 *  shows the current track under the station name); otherwise the genre
 *  tags stay visible. */
function applyRowNowPlaying(row: HTMLElement, entry: FavCoverEntry | undefined): void {
  const now = row.querySelector<HTMLElement>('.row-now');
  if (!now) return;
  const tags = row.querySelector<HTMLElement>('.row-tags');
  const line = nowPlayingLine(entry);
  if (line) {
    now.textContent = line;
    now.hidden = false;
    if (tags) tags.hidden = true;
  } else {
    now.hidden = true;
    if (tags) tags.hidden = false;
  }
}

/** Repaint every visible cover slot + now-playing line from the store.
 *  Called when a poll cycle lands new art — patches the DOM in place (no
 *  re-render, no scroll loss). */
function paintFavCovers(): void {
  for (const slot of document.querySelectorAll<HTMLElement>('.row-cover')) {
    const row = slot.closest<HTMLElement>('.row');
    const id = row?.dataset.id;
    if (!id || !row) continue;
    const entry = favCovers.get(id);
    if (entry) setRowCover(slot, entry.coverUrl);
    applyRowNowPlaying(row, entry);
  }
}

/** Point the cover poll at the rows a library feed just rendered. */
function armFavCovers(stations: Station[]): void {
  favCovers.setVisibleStations(stations);
  favCovers.start();
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
  miniArt: $miniArt,
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
  npTags: $npTags,
  npBitrate: $npBitrate,
  npOrigin: $npOrigin,
  npListeners: $npListeners,
  npLiveText: $npLiveText,
  npFormat: $npFormat,
  npTrackRow: $npTrackRow,
  npTrackTitle: $npTrackTitle,
  npTrackArtist: $npTrackArtist,
  npTrackProgram: $npTrackProgram,
  npTrackStatus: $npTrackStatus,
  npTrackStatusText: $npTrackStatusText,
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
  // Filters apply to Browse only, but the top nav is stable chrome: rather
  // than removing the funnel off-Browse (which would reflow the centred
  // nav+search group), keep its slot and just hide it visually.
  $filterBtn.classList.toggle('slot-hidden', activeTab !== 'browse');
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

function renderTabBar(): void {
  // Active-state spans both the bottom tab bar (mobile) and the top-nav
  // section links (desktop) so they never disagree.
  document
    .querySelectorAll<HTMLButtonElement>('.tabbar .tab-btn, .topnav-nav .tab-btn')
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
  // The wide NP is the golden split — album on the left, a switchable
  // Schedule/Lyrics column on the right (the pane-tab strip toggles which) —
  // whenever there's at least one secondary pane to show. Album-only
  // stations stay single-column (centred). 3-column (all panes at once) is
  // no longer auto-selected; the switchable 2-column split is the default.
  const hasProgram = !!(npSchedule && npSchedule.length > 0);
  const hasLyrics = !!(npLyrics && (npLyrics.plain || npLyrics.synced));
  if (hasProgram || hasLyrics) return 'twocol';
  return 'narrow';
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

// renderLyricsPane lives in ./render-np (refs-based). The local wrapper
// closes over the production refs + the current lyrics/track state so the
// rest of main.ts can call it with no args.
const NP_LYRICS_REFS: LyricsPaneRefs = {
  npLyricsText: $npLyricsText,
  npLyricsEmpty: $npLyricsEmpty,
  npLyricsHead: $npLyricsHead,
  npLyricsTitle: $npLyricsTitle,
  npLyricsArtist: $npLyricsArtist,
  npLyricsSource: $npLyricsSource,
  npLyricsSourceText: $npLyricsSourceText,
};

function renderLyricsPane(): void {
  renderLyricsPaneImpl(NP_LYRICS_REFS, npLyrics, currentNP);
}

/** Populate the iOS-parity schedule header: the current show name +
 *  subtitle (from the live now-playing metadata, not the schedule rows)
 *  and a "N broadcasts" count caption. The header collapses entirely
 *  when there's no current-show name, so the column doesn't carry a
 *  redundant label (the tab / column header already says "Schedule"). */
function renderProgramHead(broadcastCount: number): void {
  const programName = currentNP.programName?.trim() ?? '';
  const programSub = currentNP.programSubtitle?.trim() ?? '';
  $npProgramHeadName.textContent = programName;
  $npProgramHeadSub.textContent = programSub;
  $npProgramHeadSub.hidden = programSub.length === 0;
  $npProgramHead.hidden = programName.length === 0;
  $npProgramCount.textContent =
    broadcastCount === 1 ? '1 broadcast' : `${broadcastCount} broadcasts`;
  $npProgramMeta.hidden = broadcastCount === 0;
}

function renderProgramPane(): void {
  if (!npSchedule || npSchedule.length === 0) {
    // Don't touch hidden — that's syncNpTabs's job (which drops the
    // user back to 'now' when hasProgram becomes false). Touching it
    // here used to fight the tab-state and cause the same cover-bleed
    // bug we hit on the lyrics pane (gh #84).
    $npProgramList.replaceChildren();
    renderProgramHead(0);
    $npProgramHead.hidden = true;
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
  renderProgramHead(day.broadcasts.length);
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
    // iOS parity: a LIVE capsule pinned to the right of the on-air row.
    if (isLive) {
      const badge = document.createElement('span');
      badge.className = 'np-program-row__live';
      badge.textContent = 'Live';
      row.append(badge);
    }
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


// Site visit counter (footer of Browse). Pulled from GoatCounter's
// public counter endpoint — no auth, edge-cached 30 min by GC. We
// fetch once per page load and remember the value for re-renders.
function renderRows(stations: Station[], opts: RowOptions = {}): DocumentFragment {
  const frag = document.createDocumentFragment();
  const favs = favIdSet();
  for (const s of stations)
    frag.append(buildRow(s, currentNP.station.id, currentNP.state, favs, opts));
  return frag;
}

/** Browse/Discovery row groups get wrapped in a `.rows` container so the
 *  desktop breakpoint can lay them out as a responsive card grid. A bare
 *  `<div>` on mobile (rows stack exactly as before). Favorites/Recents
 *  intentionally do NOT use this — their drag-reorder assumes a single
 *  vertical column of direct `.row` children. */
function rowsGrid(stations: Station[], opts: RowOptions = {}): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 'rows';
  wrap.append(renderRows(stations, opts));
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
    // Slot pitch = top-to-top distance to an adjacent row, which folds in
    // the inter-card gap now that feed rows are spaced cards (not the old
    // contiguous list). Falls back to the row's own height for a lone row.
    rowHeight = row.getBoundingClientRect().height;
    const below = allRows[originalIndex + 1];
    const above = allRows[originalIndex - 1];
    if (below) {
      rowHeight = below.getBoundingClientRect().top - row.getBoundingClientRect().top;
    } else if (above) {
      rowHeight = row.getBoundingClientRect().top - above.getBoundingClientRect().top;
    }
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
/** True when any filter narrows the catalog (genres / countries / news /
 *  quality). Drives the local-catalog match path + the funnel dot. */
function hasActiveFilter(): boolean {
  return (
    filterGenres.size > 0 || filterCountries.size > 0 || filterNews || activeQuality.size > 0
  );
}

function inDiscovery(): boolean {
  return (
    activeTab === 'browse' &&
    !$search.value.trim() &&
    !hasActiveFilter() &&
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

/** Does a station pass the active filter? Mirrors iOS
 *  `CatalogStationSearch.matchesBrowseFilters`: countries OR within the
 *  set, genres OR within the set, news + quality as extra ANDed gates.
 *  An empty category doesn't constrain. */
function matchesBrowseFilter(
  s: Station,
  genres: Set<string>,
  countries: Set<string>,
  news: boolean,
  quality: Set<QualityBucket>,
): boolean {
  if (countries.size > 0) {
    const code = (s.country ?? '').toUpperCase();
    if (!code || !countries.has(code)) return false;
  }
  if (genres.size > 0) {
    let ok = false;
    for (const id of genres) {
      const g = findGenre(id);
      if (g && stationMatchesGenre(s, g)) {
        ok = true;
        break;
      }
    }
    if (!ok) return false;
  }
  if (news) {
    const ng = findGenre('news');
    if (!ng || !stationMatchesGenre(s, ng)) return false;
  }
  if (quality.size > 0 && !quality.has(stationQualityBucket(s))) return false;
  return true;
}

/** Count of catalog stations the given filter selection matches — the
 *  live "Show N stations" figure on the filter sheet. */
function filterMatchCount(
  genres: Set<string>,
  countries: Set<string>,
  news: boolean,
  quality: Set<QualityBucket>,
): number {
  // An empty selection constrains nothing, so it matches the whole
  // catalog — mirrors iOS, where the accept button shows the full count
  // ("Show 17k stations") rather than zero on an untouched draft.
  let n = 0;
  for (const s of BUILTIN_STATIONS) {
    if (matchesBrowseFilter(s, genres, countries, news, quality)) n += 1;
  }
  return n;
}

/** Short human label for the active filter, used as the result section
 *  header (e.g. "Rock · News · Germany"). Falls back to "Results". */
function filterSummaryLabel(): string {
  const parts: string[] = [];
  for (const id of filterGenres) {
    const g = findGenre(id);
    if (g) parts.push(g.label);
  }
  if (filterNews) parts.push('News');
  for (const code of filterCountries) parts.push(countryName(code));
  return parts.length > 0 ? parts.join(' · ') : 'Results';
}

// ─── Discovery render ───

function discoverySection(title: string): HTMLDivElement {
  const h = document.createElement('div');
  h.className = 'disc-section-label';
  h.textContent = title;
  return h;
}

function discoveryChip(
  label: string,
  count: number,
  onPick: () => void,
  flag?: string,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'disc-chip';
  // Country chips lead with a flag glyph (iOS DiscoveryChip parity); genre
  // chips pass none. Decorative — the country name carries the label, so
  // the flag is aria-hidden and the aria-label stays "{name}, N stations".
  if (flag) {
    const f = document.createElement('span');
    f.className = 'disc-chip__flag';
    f.textContent = flag;
    f.setAttribute('aria-hidden', 'true');
    btn.append(f);
  }
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
  // Per-highlight editorial accent. Mirrors the current iOS HighlightCard,
  // where the accent survives only as a soft tint on the badge dot (no left
  // stripe, no play button); falls back to the app accent.
  if (item.badge?.accent) card.style.setProperty('--feat-accent', item.badge.accent);
  const art = buildFavicon(item.station, 72);
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
  // The whole card is the play affordance (tapping anywhere plays), matching
  // iOS — no separate play button.
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

  // Section order mirrors the iOS BrowseDiscoveryView: genre chips,
  // country chips, the "Browse all" header + logo rail, then the
  // Featured carousel at the bottom. Each chip row is a single
  // horizontally-scrolling line (not a wrapping grid) to match iOS.
  const counts = getDiscoveryCounts();
  const gChips = genreChips(counts);
  if (gChips.length > 0) {
    $content.append(discoverySection('Browse by genre'));
    const row = document.createElement('div');
    row.className = 'disc-chips';
    for (const c of gChips) row.append(discoveryChip(c.label, c.count, () => selectGenreChip(c.id)));
    enableWheelScroll(row);
    $content.append(row);
  }
  const cChips = countryChips(counts, countryName);
  if (cChips.length > 0) {
    $content.append(discoverySection('Browse by country'));
    const row = document.createElement('div');
    row.className = 'disc-chips';
    for (const c of cChips)
      row.append(discoveryChip(c.label, c.count, () => selectCountryChip(c.id), flagEmoji(c.id)));
    enableWheelScroll(row);
    $content.append(row);
  }

  $content.append(browseAllSection(featured));

  if (featured.length > 0) {
    $content.append(discoverySection('Featured'));
    const rail = document.createElement('div');
    rail.className = 'feat-rail';
    for (const f of featured) rail.append(featuredCard(f));
    enableWheelScroll(rail);
    $content.append(rail);
  }
}

/** "Browse all" — a full-width tappable header row plus a horizontal
 *  logo rail (iOS BrowseDiscoveryView.browseAllSection). Tapping the
 *  header or any logo drops into the full catalog list. The rail shows
 *  up to DISCOVERY_BROWSE_ALL_LOGO_LIMIT featured-first stations that
 *  carry real artwork. */
function browseAllSection(featured: ResolvedHighlight[]): DocumentFragment {
  const frag = document.createDocumentFragment();

  const header = document.createElement('button');
  header.type = 'button';
  header.className = 'disc-browse-all';
  header.setAttribute('aria-label', 'Browse all stations');
  const lbl = document.createElement('span');
  lbl.className = 'disc-browse-all__label';
  lbl.textContent = 'Browse all stations';
  const cnt = document.createElement('span');
  cnt.className = 'disc-browse-all__count';
  cnt.textContent = abbreviateCount(BUILTIN_STATIONS.length);
  header.append(lbl, cnt);
  header.addEventListener('click', enterBrowseAll);
  frag.append(header);

  // Prefer the featured stations (recognisable artwork) up front, then
  // fill from the featured-first catalog ordering. Dedupe by id and keep
  // only stations that carry a favicon.
  const seen = new Set<string>();
  const pool: Station[] = [];
  for (const f of featured) {
    if (f.station.favicon && !seen.has(f.station.id)) {
      seen.add(f.station.id);
      pool.push(f.station);
    }
  }
  for (const s of orderFeaturedFirst(BUILTIN_STATIONS)) {
    if (pool.length >= DISCOVERY_BROWSE_ALL_LOGO_LIMIT) break;
    if (s.favicon && !seen.has(s.id)) {
      seen.add(s.id);
      pool.push(s);
    }
  }

  if (pool.length > 0) {
    const rail = document.createElement('div');
    rail.className = 'disc-browse-all-rail';
    rail.setAttribute('aria-hidden', 'true');
    for (const s of pool.slice(0, DISCOVERY_BROWSE_ALL_LOGO_LIMIT)) {
      const item = document.createElement('button');
      item.type = 'button';
      item.tabIndex = -1;
      item.className = 'disc-browse-all-logo';
      const fav = buildFavicon(s, 38);
      // The rail can carry ~100 logos; defer off-screen fetches.
      const img = fav.querySelector('img');
      if (img) {
        img.loading = 'lazy';
        img.decoding = 'async';
      }
      item.append(fav);
      item.addEventListener('click', enterBrowseAll);
      rail.append(item);
    }
    enableWheelScroll(rail);
    frag.append(rail);
  }
  return frag;
}

/** Tapping a discovery genre chip is a one-tap shortcut for the Genre
 *  filter: it replaces the selection with just this genre (mirrors iOS,
 *  where the chip pre-selects that section). */
function selectGenreChip(id: string): void {
  filterGenres.clear();
  filterGenres.add(id);
  filterCountries.clear();
  filterNews = false;
  browseAll = false;
  syncFilterDot();
  track(`discovery/genre/${id}`);
  void runQuery();
}

function selectCountryChip(code: string): void {
  filterCountries.clear();
  filterCountries.add(code.toUpperCase());
  filterGenres.clear();
  filterNews = false;
  browseAll = false;
  syncFilterDot();
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
  filterGenres.clear();
  filterCountries.clear();
  filterNews = false;
  activeQuality.clear();
  browseAll = false;
  activeSort = null;
  syncFilterDot();
  void runQuery();
}

/** Results header row above the list (mirrors iOS BrowseSortRow): a
 *  back-to-discovery chevron, the alphabet sort toggle (off → A–Z → Z–A),
 *  and the match count centered. Sort is suppressed while a text query is
 *  active (relevance order wins). */
function resultsRow(count: number): HTMLElement {
  const row = document.createElement('div');
  row.className = 'results-row';

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'results-row__back';
  back.setAttribute('aria-label', 'Back to Browse');
  back.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>';
  back.addEventListener('click', resetToDiscovery);

  const queryActive = $search.value.trim().length > 0;
  const sort = document.createElement('button');
  sort.type = 'button';
  sort.className = 'results-row__sort';
  sort.classList.toggle('is-active', activeSort !== null && !queryActive);
  sort.disabled = queryActive;
  sort.dataset.sort = activeSort ?? 'off';
  sort.setAttribute(
    'aria-label',
    activeSort === 'az' ? 'Sort Z to A' : activeSort === 'za' ? 'Clear sort' : 'Sort A to Z',
  );
  sort.innerHTML =
    activeSort === 'az'
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"/><path d="m6 11 6 6 6-6"/></svg>'
      : activeSort === 'za'
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="m6 11 6-6 6 6"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3v18"/><path d="m4 7 4-4 4 4"/><path d="M16 21V3"/><path d="m12 17 4 4 4-4"/></svg>';
  sort.addEventListener('click', () => {
    if (sort.disabled) return;
    activeSort = cycleSort(activeSort);
    track(`sort/${activeSort ?? 'off'}`);
    void runQuery();
  });

  const countEl = document.createElement('span');
  countEl.className = 'results-row__count';
  countEl.textContent = String(count);

  row.append(back, sort, countEl);
  return row;
}

function renderContent(): void {
  $content.replaceChildren();
  // Recomputed below per view; a full re-render invalidates the prior loader.
  pendingLoadMore = null;
  // Stop the cover poll by default; the library feeds (Favorites / Lists /
  // Recents) re-arm it with their visible rows via armFavCovers() below.
  favCovers.stop();

  // View-signature reset for the local-catalog cap. Same view across
  // calls = persist the user's "Show more" clicks; new view = reset.
  const sig = `${activeTab}|${[...filterGenres].sort().join('+')}|${[...filterCountries].sort().join('+')}|${filterNews}|${$search.value.trim()}|${browseAll}|${activeSort}|${[...activeQuality].sort().join(',')}`;
  if (sig !== lastViewSig) {
    homeViewLimit = HOME_VIEW_PAGE_SIZE;
    autoFillTries = 0;
    lastViewSig = sig;
  }

  if (activeTab === 'browse') {
    const query = $search.value.trim();
    const filtered = hasActiveFilter();
    syncFilterDot();

    // Discovery landing is the default unfiltered Browse view; anything
    // that narrows the catalog (a filter, Browse-all, or a search) drops
    // into a result list with the results row (back + sort + count).
    const onDiscovery = inDiscovery();
    if (onDiscovery) {
      renderDiscovery();
      return;
    }

    // ── Local-catalog filter (genre / country / news / quality) ──
    // Matched directly against the catalog — no Radio Browser — so this
    // count equals the sheet's "Show N stations" (iOS parity).
    if (filtered && !query) {
      const matched = BUILTIN_STATIONS.filter((s) =>
        matchesBrowseFilter(s, filterGenres, filterCountries, filterNews, activeQuality),
      );
      const ordered = activeSort
        ? sortStations(matched, activeSort)
        : orderFeaturedFirst(matched);
      $content.append(resultsRow(ordered.length));
      if (ordered.length === 0) {
        $content.append(emptyState(ICON_EMPTY, 'No stations match', 'Try removing a filter'));
        return;
      }
      $content.append(sectionLabel(filterSummaryLabel(), ordered.length));
      const visible = ordered.slice(0, homeViewLimit);
      $content.append(rowsGrid(visible));
      const remaining = ordered.length - visible.length;
      if (remaining > 0) {
        $content.append(homeShowMoreButton(remaining));
        pendingLoadMore = (): void => {
          homeViewLimit += HOME_VIEW_PAGE_SIZE;
          renderContent();
        };
      }
      return;
    }

    // ── Text search (Radio-Browser-backed) ──
    // Built-ins + custom matches first ("My stations"), then the RB
    // long-tail ("Results"). Sort is suppressed (relevance wins).
    if (query) {
      const mySource = [...BUILTIN_STATIONS, ...getCustom()];
      const myFiltered = refine(filterStations(mySource, query), {
        textQuery: query,
        featuredFirst: true,
      });
      const results = refine(lastBrowseStations, { textQuery: query, featuredFirst: false });
      $content.append(resultsRow(myFiltered.length + results.length));
      if (myFiltered.length > 0) {
        $content.append(sectionLabel('My stations', myFiltered.length));
        const visibleMy = myFiltered.slice(0, homeViewLimit);
        $content.append(rowsGrid(visibleMy));
        const remainingMy = myFiltered.length - visibleMy.length;
        if (remainingMy > 0) $content.append(homeShowMoreButton(remainingMy));
      }
      if (results.length > 0) {
        $content.append(sectionLabel('Results', results.length));
        $content.append(rowsGrid(results));
        if (browseHasMore) {
          $content.append(loadMoreButton());
          pendingLoadMore = (): void => void loadMore();
        }
      } else if (myFiltered.length === 0) {
        $content.append(
          emptyState(ICON_EMPTY, 'No stations match', 'Try a different search'),
        );
      }
      maybeAutoFill();
      return;
    }

    // ── Browse all (unfiltered, no query) — RB top + Worldwide ──
    const refined = refine(lastBrowseStations, { textQuery: '', featuredFirst: true });
    const worldwide = refine(homeRbStations, { textQuery: '', featuredFirst: false });
    $content.append(resultsRow(refined.length));
    if (refined.length > 0) {
      $content.append(sectionLabel('Top stations', refined.length));
      const visibleHome = refined.slice(0, homeViewLimit);
      $content.append(rowsGrid(visibleHome));
      const remainingHome = refined.length - visibleHome.length;
      if (remainingHome > 0) $content.append(homeShowMoreButton(remainingHome));
      if (browseHasMore) $content.append(loadMoreButton());
      if (remainingHome > 0) {
        pendingLoadMore = (): void => {
          homeViewLimit += HOME_VIEW_PAGE_SIZE;
          renderContent();
        };
      } else if (browseHasMore) {
        pendingLoadMore = (): void => void loadMore();
      }
    }
    if (worldwide.length > 0) {
      $content.append(sectionLabel('Worldwide', worldwide.length));
      $content.append(rowsGrid(worldwide));
    }
    if (homeRbHasMore) $content.append(loadMoreHomeButton());
    maybeAutoFill();
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
      // Desktop lays favorites out as a card grid (iOS landscape tile view);
      // mobile keeps the single-column list. rowsGrid wraps in `.rows`, which
      // is a plain vertical stack on mobile and a card grid at ≥1024px.
      const grid = rowsGrid(list, { cover: true });
      $content.append(grid);
      armFavCovers(list);
      // Reorder is a mobile, single-column affair — the desktop card grid is
      // 2D, so the vertical drag math doesn't apply there. Unfiltered list
      // only (a search result's order doesn't map back to the stored order).
      if (!query && !matchMedia('(min-width: 1024px)').matches) {
        enableFavoriteReorder(grid);
      }
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
      // Recents matches the Favorites layout: iOS-style cards on desktop
      // (single-column stack on mobile) with now-playing cover + track.
      $content.append(rowsGrid(list, { cover: true }));
      armFavCovers(list);
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
  // Settle each favicon strip now that the rows have a measured width,
  // and keep them in sync as the column width changes.
  bindStripResize();
  wrap.querySelectorAll<HTMLElement>('.list-item__strip').forEach(fitStrip);
}

// Favicon-strip sizing for the Library-home rows — mirrors iOS, whose
// cards show a row of station favicons under the title. 36px icons, 6px
// gaps; the trailing "+N more" badge gets ~72px reserved. The visible
// count is recomputed from the row's measured width, so a wide desktop
// column shows every station while a narrow phone column sheds icons
// into "+N more".
const STRIP_ICON = 36;
const STRIP_GAP = 6;
const STRIP_MORE_RESERVE = 72;
// Hard cap on favicon DOM nodes built per row: a 500-station list never
// shows 500 icons, so building past this is wasted work. fitStrip trims
// the visible set well below it on any real viewport.
const STRIP_BUILD_CAP = 48;

/** Build the horizontal favicon strip shown under a Library-home row's
 *  title. Empty lists show a faint hint instead. The visible-icon count
 *  is settled later by fitStrip, once the row has a measured width. */
function buildIconStrip(stations: Station[], emptyHint: string): HTMLElement {
  const strip = document.createElement('div');
  strip.className = 'list-item__strip';
  if (stations.length === 0) {
    const hint = document.createElement('div');
    hint.className = 'list-item__empty';
    hint.textContent = emptyHint;
    strip.append(hint);
    return strip;
  }
  strip.dataset.total = String(stations.length);
  for (const st of stations.slice(0, STRIP_BUILD_CAP)) {
    const ico = buildFavicon(st, STRIP_ICON);
    ico.classList.add('strip-ico');
    strip.append(ico);
  }
  return strip;
}

/** Settle how many favicons a strip shows from its measured width: show
 *  every station when they all fit (and were all built), otherwise fill
 *  the row and collapse the rest into a trailing "+N more" badge. Reading
 *  clientWidth forces layout, so callers run this synchronously right
 *  after the row lands in the DOM. */
function fitStrip(strip: HTMLElement): void {
  const total = Number(strip.dataset.total ?? '0');
  if (!total) return;
  const avail = strip.clientWidth;
  if (!avail) return;
  const icons = Array.from(strip.querySelectorAll<HTMLElement>('.strip-ico'));
  const built = icons.length;
  const per = STRIP_ICON + STRIP_GAP;
  const fitPlain = Math.floor((avail + STRIP_GAP) / per);

  let show: number;
  let more: number;
  if (built >= total && fitPlain >= total) {
    show = total;
    more = 0;
  } else {
    const fitBadged = Math.max(1, Math.floor((avail - STRIP_MORE_RESERVE + STRIP_GAP) / per));
    show = Math.min(built, fitBadged);
    more = total - show;
  }

  icons.forEach((el, i) => {
    el.style.display = i < show ? '' : 'none';
  });
  strip.querySelector('.list-item__more')?.remove();
  if (more > 0) {
    const badge = document.createElement('span');
    badge.className = 'list-item__more';
    badge.textContent = `+${more} more`;
    strip.append(badge);
  }
}

// Re-fit every visible Library-home strip when the viewport changes
// width. Bound once, lazily, the first time the index renders.
let stripResizeBound = false;
function bindStripResize(): void {
  if (stripResizeBound) return;
  stripResizeBound = true;
  let pending = 0;
  window.addEventListener('resize', () => {
    if (pending) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      document.querySelectorAll<HTMLElement>('.list-item__strip').forEach(fitStrip);
    });
  });
}

/** The pinned Recents entry on the Library home — a non-removable system
 *  row that opens the Recents sub-view. */
function buildRecentsRow(): HTMLElement {
  const recents = getRecents();
  const row = document.createElement('div');
  row.className = 'list-item list-item--lib list-item--system';
  row.setAttribute('role', 'button');
  row.tabIndex = 0;

  const info = document.createElement('div');
  info.className = 'list-item__info';
  const name = document.createElement('div');
  name.className = 'list-item__name';
  name.textContent = 'Recents';
  info.append(name, buildIconStrip(recents, 'Stations appear here after you play them.'));

  const chev = document.createElement('div');
  chev.className = 'list-item__chev';
  chev.innerHTML = ICON_CHEVRON_RIGHT;

  row.append(info, chev);
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
  row.className = 'list-item list-item--lib';
  row.setAttribute('role', 'button');
  row.tabIndex = 0;
  row.dataset.listId = list.id;

  const info = document.createElement('div');
  info.className = 'list-item__info';
  const name = document.createElement('div');
  name.className = 'list-item__name';
  name.textContent = list.name;
  info.append(name, buildIconStrip(list.stations, 'Empty list'));

  row.append(info);

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
  // List detail matches the Favorites layout: iOS-style cards on desktop,
  // single-column stack on mobile, with now-playing cover + track.
  $content.append(rowsGrid(stations, { cover: true }));
  armFavCovers(stations);
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
  pendingLoadMore = null;
  const query = $search.value.trim();
  // Radio Browser is fetched only for a text search or the unfiltered
  // "Browse all" view. Local filters (genre / country / news / quality)
  // match the catalog directly — no network — so the discovery landing
  // and every filtered view skip RB entirely.
  const needsRb = !inDiscovery() && (query.length > 0 || (browseAll && !hasActiveFilter()));
  if (!needsRb) {
    if (myToken !== queryToken) return;
    lastBrowseStations = [];
    renderContent();
    return;
  }
  $content.replaceChildren(statusLine('Tuning in…'));
  try {
    const stations = await searchStations({ query: query || undefined, offset: 0 });
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
  const query = $search.value.trim();
  try {
    // Text search paginates via searchStations (carries the query);
    // the unfiltered Browse-all view uses fetchStations (top-by-votes).
    const more = query
      ? await searchStations({ query, offset: nextOffset })
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
  // On desktop, playing keeps you on the list and pops the mini-player —
  // Now Playing opens on demand (tap the mini). On mobile the small screen
  // makes NP the focus, so jump straight there.
  if (!isDesktop()) openNp(true);
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
  // Reset every Browse narrowing back to the discovery landing.
  filterGenres.clear();
  filterCountries.clear();
  filterNews = false;
  activeQuality.clear();
  browseAll = false;
  activeSort = null;
  syncFilterDot();
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
  // NP is only present (and in the a11y tree) when it's the active
  // destination, on every breakpoint.
  $np.setAttribute('aria-hidden', String(tab !== 'playing'));
  // The wide album/schedule/lyrics column count depends on the breakpoint
  // and available panes; re-sync when entering/leaving the destination.
  syncNpTabs();

  renderTabBar();
  renderTopBar();
  if (tab === 'browse') void runQuery();
  else if (tab !== 'playing') renderContent();
  // The player destination skips renderContent, so stop the library cover
  // poll here when leaving a feed for Now Playing.
  else favCovers.stop();

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
  // Now Playing is a full-area destination on every breakpoint (the
  // 'playing' tab), bridged by the persistent mini-player. The desktop
  // dock is gone — playing keeps you on the list, NP opens on demand.
  if (open) setTab('playing');
  else if (activeTab === 'playing') setTab(lastListTab);
}

/** Keep breakpoint-dependent state in sync. NP is a full-area destination
 *  on every breakpoint now (the 'playing' tab), so its a11y visibility
 *  just follows that tab. Crossing the wide breakpoint re-evaluates the
 *  album/schedule/lyrics column count. Called at boot + on breakpoint
 *  changes. */
function syncLayoutMode(): void {
  $np.setAttribute('aria-hidden', String(activeTab !== 'playing'));
  syncNpTabs();
}
desktopMq.addEventListener('change', syncLayoutMode);

// Theme persistence + DOM application live in ./theme. Boot wiring
// applies the persisted choice before first paint, then keeps the
// `<meta name="theme-color">` tint in sync with the OS preference if
// the user hasn't picked an explicit theme.
bootstrapTheme();
bootstrapAccent();

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

/** Reflect the muted flag across the mute button + the volume slider's
 *  speaker icon, without re-toggling the audio element. */
function reflectMuteUi(muted: boolean): void {
  $body.classList.toggle('is-muted', muted);
  $npVolume.classList.toggle('is-muted', muted);
  $miniVolume.classList.toggle('is-muted', muted);
  $npMute.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
}

function setMuted(muted: boolean): void {
  if (player.isMuted() !== muted) player.toggleMute();
  reflectMuteUi(muted);
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

// Bottom tab bar (mobile) and top-nav section links (desktop) both carry
// the Browse / Favorites / Library buttons; one handler serves both.
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
$topnavNav.addEventListener('click', handleNavClick);

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
  // Typing while the Now Playing destination is open jumps back to Browse:
  // the results belong on a list, so we leave NP (which reveals the
  // mini-player) and let Browse run the query. setTab('browse') re-runs
  // runQuery itself, so the debounced handler below just refreshes it.
  if (activeTab === 'playing' && $search.value.trim()) setTab('browse');
  syncSearchClear();
});
$search.addEventListener(
  'input',
  debounce(() => {
    void runQuery();
    if ($search.value.trim()) track('search');
  }, 300),
);

// ─── Filter sheet (port of the iOS BrowseFiltersSheet) ───
// Selections pile up in a draft while the sheet is open; they apply to
// the live filter only when the user taps "Show N stations" (iOS parity).
type BfSection = 'genre' | 'country' | 'quality';
const draftGenres = new Set<string>();
const draftCountries = new Set<string>();
let draftNews = false;
const draftQuality = new Set<QualityBucket>();
const bfExpanded = new Set<BfSection>();
let bfCountrySearch = '';

function copySet<T>(dst: Set<T>, src: Iterable<T>): void {
  dst.clear();
  for (const v of src) dst.add(v);
}

function draftIsEmpty(): boolean {
  return (
    draftGenres.size === 0 && draftCountries.size === 0 && !draftNews && draftQuality.size === 0
  );
}

/** Abbreviate large match counts ("1.4k") so the apply pill stays narrow,
 *  matching the discovery chips. */
function bfCount(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n);
}

const QUALITY_BUCKETS: { id: QualityBucket; label: string; level: number }[] = [
  { id: 'low', label: 'Low', level: 2 },
  { id: 'medium', label: 'Medium', level: 3 },
  { id: 'high', label: 'High', level: 4 },
];

const BF_SECTION_ICON: Record<BfSection, string> = {
  genre:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
  country:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 22V4"/><path d="M5 4h12l-2 4 2 4H5"/></svg>',
  quality:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 20v-4"/><path d="M12 20V9"/><path d="M19 20V4"/></svg>',
};
const CHECK_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

/** A multi-select pick row (label + optional leading glyph + checkmark),
 *  mirroring iOS `pickerRow`. */
function bfPickRow(
  label: string,
  selected: boolean,
  onToggle: () => void,
  lead?: HTMLElement,
): HTMLButtonElement {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'bf-row';
  row.setAttribute('aria-pressed', String(selected));
  const leadEl = document.createElement('span');
  leadEl.className = 'bf-row__lead';
  if (lead) leadEl.append(lead);
  const name = document.createElement('span');
  name.className = 'bf-row__label';
  name.textContent = label;
  const check = document.createElement('span');
  check.className = 'bf-row__check';
  check.innerHTML = CHECK_SVG;
  row.append(leadEl, name, check);
  row.addEventListener('click', onToggle);
  return row;
}

/** The 4-bar ascending quality meter, sized for a pick row (iOS
 *  qualityMeterGraphic). */
function bfQualityMeter(level: number): HTMLElement {
  const meter = document.createElement('span');
  meter.className = 'bf-meter';
  for (let i = 0; i < 4; i += 1) {
    const bar = document.createElement('span');
    bar.className = 'bf-meter__bar' + (i < level ? ' is-on' : '');
    meter.append(bar);
  }
  return meter;
}

/** Repaint the footer: live "Show N stations" count + Clear visibility. */
function bfUpdateFooter(): void {
  const count = filterMatchCount(draftGenres, draftCountries, draftNews, draftQuality);
  $bfApply.textContent = count === 1 ? 'Show 1 station' : `Show ${bfCount(count)} stations`;
  $bfApply.disabled = count === 0;
  $bfApply.classList.toggle('is-active', count > 0);
  $bfClear.hidden = draftIsEmpty();
}

/** Build one collapsible section (header + body) into the sheet. */
function bfSection(
  section: BfSection,
  title: string,
  badgeCount: number,
  fillBody: (body: HTMLElement) => void,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'bf-section';

  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'bf-section__head';
  const expanded = bfExpanded.has(section);
  head.setAttribute('aria-expanded', String(expanded));
  head.innerHTML =
    `<span class="bf-section__icon${badgeCount > 0 ? ' is-on' : ''}">${BF_SECTION_ICON[section]}</span>` +
    `<span class="bf-section__title">${title}</span>` +
    (badgeCount > 0 ? `<span class="bf-section__badge">${badgeCount}</span>` : '') +
    `<span class="bf-section__chev" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${expanded ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'}"/></svg></span>`;
  head.addEventListener('click', () => {
    if (bfExpanded.has(section)) bfExpanded.delete(section);
    else bfExpanded.add(section);
    renderFilterSheet();
  });
  wrap.append(head);

  if (expanded) {
    const body = document.createElement('div');
    body.className = 'bf-section__body';
    fillBody(body);
    wrap.append(body);
  }
  return wrap;
}

/** Rebuild the filter sheet sections from the current draft. */
function renderFilterSheet(): void {
  $bfSections.replaceChildren();

  // Genre — News toggle first, then the taxonomy.
  $bfSections.append(
    bfSection('genre', 'Genre', draftGenres.size + (draftNews ? 1 : 0), (body) => {
      body.append(
        bfPickRow('News', draftNews, () => {
          draftNews = !draftNews;
          renderFilterSheet();
        }),
      );
      for (const g of GENRES) {
        // News has its own dedicated toggle above (iOS parity), so skip
        // the 'news' genre here to avoid showing it twice.
        if (g.id === 'news') continue;
        body.append(
          bfPickRow(g.label, draftGenres.has(g.id), () => {
            if (draftGenres.has(g.id)) draftGenres.delete(g.id);
            else draftGenres.add(g.id);
            renderFilterSheet();
          }),
        );
      }
    }),
  );

  // Country — search box, selected pinned to the top.
  $bfSections.append(
    bfSection('country', 'Country', draftCountries.size, (body) => {
      const search = document.createElement('div');
      search.className = 'bf-search';
      search.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
      const input = document.createElement('input');
      input.type = 'search';
      input.className = 'bf-search__input';
      input.placeholder = 'Search countries…';
      input.value = bfCountrySearch;
      input.setAttribute('aria-label', 'Search countries');
      const list = document.createElement('div');
      list.className = 'bf-country-list';
      const paint = (): void => {
        list.replaceChildren();
        for (const code of orderedDraftCountries()) {
          const flag = document.createElement('span');
          flag.className = 'bf-row__flag';
          flag.textContent = flagEmoji(code) ?? '';
          list.append(
            bfPickRow(
              `${countryName(code)} (${code})`,
              draftCountries.has(code),
              () => {
                if (draftCountries.has(code)) draftCountries.delete(code);
                else draftCountries.add(code);
                // Targeted repaint keeps the search input focused.
                paint();
                bfUpdateBadges();
                bfUpdateFooter();
              },
              flag,
            ),
          );
        }
      };
      input.addEventListener('input', () => {
        bfCountrySearch = input.value;
        paint();
      });
      search.append(input);
      body.append(search, list);
      paint();
    }),
  );

  // Quality — Low / Medium / High buckets with the ascending meter.
  $bfSections.append(
    bfSection('quality', 'Quality', draftQuality.size, (body) => {
      for (const q of QUALITY_BUCKETS) {
        body.append(
          bfPickRow(
            q.label,
            draftQuality.has(q.id),
            () => {
              if (draftQuality.has(q.id)) draftQuality.delete(q.id);
              else draftQuality.add(q.id);
              renderFilterSheet();
            },
            bfQualityMeter(q.level),
          ),
        );
      }
    }),
  );

  bfUpdateFooter();
}

/** Update only the section header badges in place (used by the country
 *  list's targeted repaint so the search input keeps focus). */
function bfUpdateBadges(): void {
  const counts: Record<BfSection, number> = {
    genre: draftGenres.size + (draftNews ? 1 : 0),
    country: draftCountries.size,
    quality: draftQuality.size,
  };
  const heads = $bfSections.querySelectorAll<HTMLElement>('.bf-section');
  const order: BfSection[] = ['genre', 'country', 'quality'];
  heads.forEach((wrap, i) => {
    const section = order[i];
    const icon = wrap.querySelector('.bf-section__icon');
    icon?.classList.toggle('is-on', counts[section] > 0);
    let badge = wrap.querySelector<HTMLElement>('.bf-section__badge');
    const chev = wrap.querySelector('.bf-section__chev');
    if (counts[section] > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'bf-section__badge';
        chev?.before(badge);
      }
      badge.textContent = String(counts[section]);
    } else {
      badge?.remove();
    }
  });
}

/** Draft countries ordered for display: selected pinned to the top, the
 *  rest filtered by the search box. Mirrors iOS `orderedCountries`. */
function orderedDraftCountries(): string[] {
  const all = catalogCountries();
  const q = bfCountrySearch.trim().toLowerCase();
  const matches = (code: string): boolean => {
    if (!q) return true;
    return `${countryName(code)} ${code}`.toLowerCase().includes(q);
  };
  if (draftCountries.size === 0) return all.filter(matches);
  const selected = all.filter((c) => draftCountries.has(c));
  const rest = all.filter((c) => !draftCountries.has(c) && matches(c));
  return [...selected, ...rest];
}

function applyDraftFilter(): void {
  copySet(filterGenres, draftGenres);
  copySet(filterCountries, draftCountries);
  filterNews = draftNews;
  copySet(activeQuality, draftQuality);
  // An empty filter narrows nothing — applying it means "show everything",
  // so drop into the flat browse-all list (matching the footer's "Show N
  // stations" count) instead of bouncing back to the discovery landing.
  browseAll = draftIsEmpty();
  syncFilterDot();
  openFilterSheet(false);
  track('filter/apply');
  void runQuery();
}

$bfCancel.addEventListener('click', () => openFilterSheet(false));
$bfClear.addEventListener('click', () => {
  draftGenres.clear();
  draftCountries.clear();
  draftNews = false;
  draftQuality.clear();
  renderFilterSheet();
});
$bfApply.addEventListener('click', () => {
  if ($bfApply.disabled) return;
  applyDraftFilter();
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
  if (e.key === 'Escape' && $filterSheet.classList.contains('open')) openFilterSheet(false);
});

// ─── Top-toolbar sheets: filters (funnel) + settings (gear) ───

/** Open/close the filter sheet. On open, seed the draft from the live
 *  filter, auto-expand any section that already carries a selection, and
 *  build the sheet (mirrors how the iOS sheet starts from `initial`). */
function openFilterSheet(open: boolean): void {
  if (open) {
    copySet(draftGenres, filterGenres);
    copySet(draftCountries, filterCountries);
    draftNews = filterNews;
    copySet(draftQuality, activeQuality);
    bfCountrySearch = '';
    bfExpanded.clear();
    if (draftGenres.size > 0 || draftNews) bfExpanded.add('genre');
    if (draftCountries.size > 0) bfExpanded.add('country');
    if (draftQuality.size > 0) bfExpanded.add('quality');
    renderFilterSheet();
  }
  $filterSheet.classList.toggle('open', open);
  $filterSheet.setAttribute('aria-hidden', String(!open));
}
function openSettingsSheet(open: boolean): void {
  if (open) {
    syncThemeSeg();
    syncAccentSeg();
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

// About hero (mirrors the iOS AboutContentView header): stamp the build
// version, and reveal the share button only where Web Share is supported.
declare const __BUILD_VERSION__: string;
const $aboutVersion = document.getElementById('about-version');
if ($aboutVersion) {
  const v = typeof __BUILD_VERSION__ !== 'undefined' ? __BUILD_VERSION__ : 'dev';
  $aboutVersion.textContent = `Version ${v}`;
}
const $aboutShare = document.getElementById('about-share');
if ($aboutShare && typeof navigator.share === 'function') {
  $aboutShare.hidden = false;
  $aboutShare.addEventListener('click', () => {
    void navigator
      .share({
        title: 'rrradio.org',
        text: 'Free internet radio without ads.',
        url: 'https://rrradio.org',
      })
      .catch(() => {
        /* user dismissed the share sheet — nothing to do */
      });
  });
}

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

/** Lights the funnel's accent dot when any filter narrows Browse. */
function syncFilterDot(): void {
  $filterDot.hidden = !hasActiveFilter();
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
/** Reflect the custom accent for the *current* appearance: Standard vs
 *  Custom segment, the picker swatch, and whether the picker row shows. */
function syncAccentSeg(): void {
  const theme = effectiveTheme();
  const custom = readAccent(theme);
  syncSeg($accentSeg, 'accent', custom ? 'custom' : 'standard');
  $accentRow.hidden = !custom;
  $accentPicker.value = custom ?? DEFAULT_ACCENT[theme];
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
  // The effective appearance may have changed — repaint the accent picker
  // for the appearance now in effect (applyAccent already ran via the
  // onThemeApplied hook).
  syncAccentSeg();
  track(`theme/${choice}`);
});
// Accent: Standard clears the override; Custom seeds from the current value
// (default if none) so the override takes effect immediately, then the
// swatch fine-tunes it live. Stored per appearance.
$accentSeg.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.seg__btn');
  if (!btn) return;
  const choice = btn.dataset.accent ?? 'standard';
  const theme = effectiveTheme();
  setAccent(theme, choice === 'custom' ? readAccent(theme) ?? DEFAULT_ACCENT[theme] : null);
  syncAccentSeg();
  track(`accent/${choice}`);
});
$accentPicker.addEventListener('input', () => {
  setAccent(effectiveTheme(), $accentPicker.value);
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
  const accent: { light?: string; dark?: string } = {};
  const lightAccent = readAccent('light');
  const darkAccent = readAccent('dark');
  if (lightAccent) accent.light = lightAccent;
  if (darkAccent) accent.dark = darkAccent;
  return {
    theme: readStoredTheme() ?? undefined,
    accent: Object.keys(accent).length > 0 ? accent : undefined,
    landing: getString(LANDING_KEY) ?? undefined,
    musicServices: {
      apple: msEnabled('apple'),
      spotify: msEnabled('spotify'),
      youtube: msEnabled('youtube'),
    },
    browseCollapsed: getString(BROWSE_COLLAPSED_KEY) === '1',
  };
}

/** Apply imported settings live — persist each key and call the same
 *  apply functions the toggles use, so a restore takes effect without a
 *  reload. Only the keys present in the file are touched. */
function applySettings(s: BackupSettings): void {
  if (s.theme) applyTheme(s.theme);
  if (s.accent) {
    if (s.accent.light) setAccent('light', s.accent.light);
    if (s.accent.dark) setAccent('dark', s.accent.dark);
  }
  if (s.landing) setString(LANDING_KEY, s.landing);
  if (s.musicServices) {
    const ms = s.musicServices;
    if (typeof ms.apple === 'boolean') setString(MS_KEYS.apple, ms.apple ? '1' : '0');
    if (typeof ms.spotify === 'boolean') setString(MS_KEYS.spotify, ms.spotify ? '1' : '0');
    if (typeof ms.youtube === 'boolean') setString(MS_KEYS.youtube, ms.youtube ? '1' : '0');
    syncMusicServiceLinks();
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

// Tapping anywhere on the mini-player bar opens the Now Playing destination
// (iOS parity) — except the transport + volume controls, which keep their own
// behavior. prev/toggle/skip already stop propagation; the closest() guard
// also covers the volume slider. The #mini-open button bubbles here too, so a
// keyboard Enter on it still expands to Now Playing.
$mini.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('.mini-prev, .mini-toggle, .mini-skip, .mini-volume')) {
    return;
  }
  openNp(true);
});

const $npBack = document.getElementById('np-back') as HTMLButtonElement;
$npBack.addEventListener('click', () => openNp(false));
$miniToggle.addEventListener('click', (e) => {
  e.stopPropagation();
  handlePlayToggle();
});

// Mini-player prev/next — same gesture as the lock-screen previous/next
// controls: cycle backward/forward through favorites.
$miniPrev.addEventListener('click', (e) => {
  e.stopPropagation();
  skipFavorite(-1);
});
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

// Infinite scroll — load the next batch as the result list nears the bottom
// (iOS parity). pendingLoadMore is set by renderContent() to the current
// view's loader (reveal-more / fetch-next) and cleared when nothing remains.
// The async loaders self-guard against re-entry, so firing on every scroll
// tick near the bottom is safe.
$content.addEventListener(
  'scroll',
  () => {
    if (!pendingLoadMore) return;
    if ($content.scrollTop + $content.clientHeight >= $content.scrollHeight - 600) {
      pendingLoadMore();
    }
  },
  { passive: true },
);

/** If the freshly rendered list is too short to scroll, pull more so the
 *  user can actually reach the bottom (and infinite scroll can take over).
 *  Capped per view via autoFillTries. Call at the end of a browse render. */
function maybeAutoFill(): void {
  if (!pendingLoadMore || autoFillTries >= AUTO_FILL_MAX) return;
  if (browseLoadingMore) return; // a fetch is already in flight — wait for it
  if ($content.scrollHeight > $content.clientHeight + 8) return; // already scrollable
  autoFillTries++;
  pendingLoadMore();
}

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
  reflectMuteUi(player.toggleMute());
});

// ── Volume slider ─────────────────────────────────────────────────
// Desktop has no hardware volume rocker, so the Now Playing surface
// carries its own slider. Level (0–1) persists across sessions; the
// accent-filled portion is drawn by the `--vol` custom property.
const VOLUME_KEY = 'rrradio.volume.v1';

function applyVolumeUi(v: number): void {
  const pct = Math.round(v * 100);
  $npVolumeSlider.value = String(pct);
  $npVolume.style.setProperty('--vol', `${pct}%`);
  $npVolumeValue.textContent = `${pct}%`;
  // The desktop mini-player carries its own slider — keep it in lockstep
  // so the two never disagree (same shared volume state).
  $miniVolumeSlider.value = String(pct);
  $miniVolume.style.setProperty('--vol', `${pct}%`);
}

function setVolume(v: number, persist = true): void {
  const clamped = Math.max(0, Math.min(1, v));
  player.setVolume(clamped);
  applyVolumeUi(clamped);
  if (persist) setString(VOLUME_KEY, clamped.toFixed(2));
}

// Restore the stored level at boot (default full). audio.volume is
// read-only on iOS Safari, so setVolume is a no-op there — the slider
// still reflects the stored value but won't change playback (expected;
// the slider is a desktop affordance).
{
  const stored = Number(getString(VOLUME_KEY));
  const initial = Number.isFinite(stored) && stored >= 0 && stored <= 1 ? stored : 1;
  setVolume(initial, false);
}

function handleVolumeInput(slider: HTMLInputElement): void {
  const v = Number(slider.value) / 100;
  // Dragging up from a muted state unmutes — the slider becoming the
  // primary control would otherwise feel broken.
  if (v > 0 && player.isMuted()) {
    player.toggleMute();
    reflectMuteUi(false);
  }
  setVolume(v);
}

$npVolumeSlider.addEventListener('input', () => handleVolumeInput($npVolumeSlider));
// Desktop mini-player slider — same behaviour, shared volume state.
$miniVolumeSlider.addEventListener('input', () => handleVolumeInput($miniVolumeSlider));

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
syncSearchClear();
syncFilterDot();
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
