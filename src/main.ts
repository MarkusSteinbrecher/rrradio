import { BUILTIN_STATIONS, findFetcher, loadBuiltinStations } from './builtins';
import { lookupCover } from './coverArt';
import { MetadataPoller, icyFetcher } from './metadata';
import { AudioPlayer, stateLabel } from './player';
import { pseudoFrequency } from './radioBrowser';
import { fetchStations, searchStations } from './stations';
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
  const display = parsed.artist
    ? `${parsed.artist} — ${parsed.track}`
    : parsed.track;
  player.setTrackTitle(display, parsed);

  // Cover-art enrichment via iTunes Search. Runs when:
  //   (a) the station's metadata feed has no cover at all, OR
  //   (b) the cover it supplied is from a known low-res source.
  // Grrif only publishes 246×246 JPEGs at /Medias/Covers/m/ — visibly
  // upscaled on retina inside our ~260 CSS-px frame. iTunes serves
  // 600×600 for the same track, so we prefer it when the lookup hits.
  // If iTunes misses, we keep the station's URL — still better than
  // falling all the way back to the station favicon.
  const lowRes = parsed.coverUrl ? isLowResCoverUrl(parsed.coverUrl) : false;
  if (!parsed.coverUrl || lowRes) {
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

const $signalStatus = document.getElementById('signal-status') as HTMLElement;
const $wordmark = document.getElementById('wordmark') as HTMLButtonElement;
const $search = document.getElementById('search') as HTMLInputElement;
const $searchClear = document.getElementById('search-clear') as HTMLButtonElement;
const $genre = document.getElementById('genre') as HTMLSelectElement;
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
const $npTags = document.getElementById('np-tags') as HTMLElement;
const $npBitrate = document.getElementById('np-bitrate') as HTMLElement;
const $npOrigin = document.getElementById('np-origin') as HTMLElement;
const $npListeners = document.getElementById('np-listeners') as HTMLElement;
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

// ─────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────

let activeTab: Tab = 'browse';
/** Last list tab we were on, so closing Now Playing returns there. */
let lastListTab: ListTab = 'browse';
let activeTag = 'all';
let queryToken = 0;
let sleepIndex = 0;
let sleepTimer: number | undefined;
let currentNP: NowPlaying = {
  station: { id: '', name: '', streamUrl: '' },
  state: 'idle',
};
let lastBrowseStations: Station[] = [];

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
  const freqEl = document.createElement('span');
  freqEl.className = 'row-freq';
  freqEl.textContent = station.frequency ?? '—';
  const eq = buildEq(isPaused);
  const heart = buildHeart(isFav);
  heart.addEventListener('click', (e) => {
    e.stopPropagation();
    onToggleFav(station);
  });
  right.append(freqEl, eq, heart);

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

function signalStatusText(np: NowPlaying): string {
  if (np.state === 'playing') {
    return np.station.bitrate ? `ON AIR · ${np.station.bitrate}KBPS` : 'ON AIR';
  }
  return 'STANDBY';
}

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
  $npBitrate.textContent = s.bitrate ? `${s.bitrate} kbps` : '—';
  $npOrigin.textContent = s.country ?? '—';
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
}

function renderTabBar(): void {
  $tabbar.querySelectorAll<HTMLButtonElement>('.tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === activeTab);
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

function renderFeatured(stations: Station[]): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'featured-strip';
  const list = document.createElement('ul');
  list.className = 'featured';
  const currentId = currentNP.station.id;
  for (const s of stations) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'featured-tile' + (s.id === currentId ? ' is-playing' : '');
    btn.dataset.id = s.id;
    btn.setAttribute('aria-label', `Play ${s.name}`);

    const art = document.createElement('span');
    art.className = 'featured-tile__art';
    if (s.favicon) {
      const img = document.createElement('img');
      img.src = s.favicon;
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      art.append(img);
    } else {
      const fallback = document.createElement('span');
      fallback.textContent = s.name.slice(0, 2).toUpperCase();
      fallback.style.cssText = 'font-family: var(--mono); font-size: 18px; color: var(--ink-2);';
      art.append(fallback);
    }

    const name = document.createElement('span');
    name.className = 'featured-tile__name';
    name.textContent = s.name;

    btn.append(art, name);
    btn.addEventListener('click', () => onRowPlay(s));
    li.append(btn);
    list.append(li);
  }
  wrap.append(list);
  return wrap;
}

function renderContent(): void {
  $content.replaceChildren();

  if (activeTab === 'browse') {
    const query = $search.value.trim();
    const tagFilter = activeTag === 'all' ? undefined : activeTag;
    const noFilter = !query && !tagFilter;

    // Featured strip — only on the unfiltered Browse view, so search/filter
    // results stay focused. The same stations remain reachable below in
    // the "My stations" section when a filter is applied.
    if (noFilter && BUILTIN_STATIONS.length > 0) {
      $content.append(renderFeatured(BUILTIN_STATIONS));
    }

    // "My stations" = built-ins + custom when filtering, custom-only when
    // unfiltered (built-ins live in the featured strip in that case).
    const tagMatch = (s: Station): boolean =>
      !tagFilter || (s.tags ?? []).some((t) => t.toLowerCase().includes(tagFilter));
    const mySource = noFilter ? getCustom() : [...BUILTIN_STATIONS, ...getCustom()];
    const myFiltered = filterStations(mySource, query).filter(tagMatch);

    if (myFiltered.length > 0) {
      $content.append(sectionLabel('My stations', myFiltered.length));
      $content.append(renderRows(myFiltered));
    }
    if (lastBrowseStations.length > 0) {
      const label = query ? 'Results' : tagFilter ?? 'Curated';
      $content.append(sectionLabel(label, lastBrowseStations.length));
      $content.append(renderRows(lastBrowseStations));
    } else if (myFiltered.length === 0 && !noFilter) {
      $content.append(emptyState(ICON_EMPTY, 'No stations match', 'Try a different search or genre'));
    }
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
  $content.replaceChildren(statusLine('Tuning in…'));
  try {
    const query = $search.value.trim();
    const tagFilter = activeTag === 'all' ? undefined : activeTag;
    const stations = query || tagFilter
      ? await searchStations({ query: query || undefined, tag: tagFilter })
      : await fetchStations();
    if (myToken !== queryToken) return;
    lastBrowseStations = stations;
    renderContent();
  } catch (err) {
    if (myToken !== queryToken) return;
    lastBrowseStations = [];
    $content.replaceChildren(
      statusLine(`Off air · ${err instanceof Error ? err.message : String(err)}`),
    );
  }
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
  if (activeTab === 'recent') renderContent();
  // Open Now Playing on first play of this station
  openNp(true);
}

function onToggleFav(station: Station): void {
  toggleFavorite(station);
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
  $content.querySelectorAll<HTMLElement>('.featured-tile').forEach((tile) => {
    tile.classList.toggle('is-playing', !!id && tile.dataset.id === id);
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
  const wasBrowseDefault = activeTab === 'browse' && activeTag === 'all' && $search.value === '';
  clearSearch(false);
  activeTag = 'all';
  syncGenre();
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

  activeTab = tab;
  $body.classList.toggle('tab-playing', tab === 'playing');
  $np.classList.toggle('open', tab === 'playing');
  $np.setAttribute('aria-hidden', String(tab !== 'playing'));

  renderTabBar();
  renderTopBar();
  if (tab === 'browse') void runQuery();
  else if (tab !== 'playing') renderContent();
}

function openNp(open: boolean): void {
  if (open) setTab('playing');
  else if (activeTab === 'playing') setTab(lastListTab);
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
  const tab = btn.dataset.tab as Tab | undefined;
  if (tab) setTab(tab);
});

$search.addEventListener('input', () => syncSearchClear());
$search.addEventListener('input', debounce(() => void runQuery(), 300));

$genre.addEventListener('change', () => {
  activeTag = $genre.value || 'all';
  void runQuery();
});

$searchClear.addEventListener('click', () => {
  clearSearch(true);
  void runQuery();
});

$wordmark.addEventListener('click', goHome);

$addBtn.addEventListener('click', () => openAddSheet(true));
$addCancel.addEventListener('click', () => openAddSheet(false));
$addForm.addEventListener('submit', handleAddSubmit);

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
player.subscribe((np) => {
  const stationLost = !np.station.id && currentNP.station.id && activeTab === 'playing';
  currentNP = np;
  $body.classList.toggle('is-playing', np.state === 'playing');
  $body.classList.toggle('has-station', !!np.station.id);
  // If the station was unloaded while the Playing tab was active,
  // bounce back to the last list tab so the user isn't stranded.
  if (stationLost) setTab(lastListTab);
  $signalStatus.textContent = signalStatusText(np);
  renderMiniPlayer(np);
  renderNowPlaying(np);
  syncRowPlayingState();

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
syncSearchClear();
// Stations.json defines the built-in catalog (Featured strip + per-station
// metadata fetcher overrides). Render once it lands so the first paint
// already has the Featured tiles.
void loadBuiltinStations().then(() => {
  if (activeTab === 'browse') renderContent();
});
void runQuery();
