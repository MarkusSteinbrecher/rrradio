import { AudioPlayer, stateLabel } from './player';
import { fetchStations, searchStations } from './stations';
import {
  getFavorites,
  getRecents,
  isFavorite,
  pushRecent,
  toggleFavorite,
} from './storage';
import type { NowPlaying, Station } from './types';

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const TAG_PRESETS = ['all', 'jazz', 'ambient', 'classical', 'electronic', 'indie', 'news', 'eclectic'];
const SLEEP_CYCLE_MIN = [0, 15, 30, 60];
const DIAL_MIN = 87.5;
const DIAL_MAX = 108.0;
const DIAL_STEP = 0.1;
const DIAL_TICK_W = 18;

type Tab = 'browse' | 'fav' | 'recent';

// ─────────────────────────────────────────────────────────────
// Element refs
// ─────────────────────────────────────────────────────────────

const player = new AudioPlayer();
const $body = document.body;

const $signalStatus = document.getElementById('signal-status') as HTMLElement;
const $wordmark = document.getElementById('wordmark') as HTMLButtonElement;
const $search = document.getElementById('search') as HTMLInputElement;
const $searchClear = document.getElementById('search-clear') as HTMLButtonElement;
const $tags = document.getElementById('tags') as HTMLElement;
const $tabStatus = document.getElementById('tab-status') as HTMLElement;
const $content = document.getElementById('content') as HTMLElement;
const $tabbar = document.getElementById('tabbar') as HTMLElement;

const $mini = document.getElementById('mini') as HTMLButtonElement;
const $miniFav = document.getElementById('mini-fav') as HTMLElement;
const $miniName = document.getElementById('mini-name') as HTMLElement;
const $miniMeta = document.getElementById('mini-meta') as HTMLElement;
const $miniToggle = document.getElementById('mini-toggle') as HTMLElement;

const $np = document.getElementById('np') as HTMLElement;
const $npClose = document.getElementById('np-close') as HTMLButtonElement;
const $npName = document.getElementById('np-name') as HTMLElement;
const $npTags = document.getElementById('np-tags') as HTMLElement;
const $npFreqNum = document.getElementById('np-freq-num') as HTMLElement;
const $npBitrate = document.getElementById('np-bitrate') as HTMLElement;
const $npOrigin = document.getElementById('np-origin') as HTMLElement;
const $npListeners = document.getElementById('np-listeners') as HTMLElement;
const $npStream = document.getElementById('np-stream') as HTMLAnchorElement;
const $npStreamHost = document.getElementById('np-stream-host') as HTMLElement;
const $npHome = document.getElementById('np-home') as HTMLAnchorElement;
const $npHomeHost = document.getElementById('np-home-host') as HTMLElement;
const $npFav = document.getElementById('np-fav') as HTMLButtonElement;
const $npSleep = document.getElementById('np-sleep') as HTMLButtonElement;
const $npPlay = document.getElementById('np-play') as HTMLButtonElement;
const $npLiveText = document.getElementById('np-live-text') as HTMLElement;
const $npFormat = document.getElementById('np-format') as HTMLElement;
const $npShare = document.getElementById('np-share') as HTMLButtonElement;
const $npLabel = document.querySelector('.np-label') as HTMLElement;
const $dialTrack = document.getElementById('dial-track') as HTMLElement;

// ─────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────

let activeTab: Tab = 'browse';
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
// Tuner Dial
// ─────────────────────────────────────────────────────────────

function buildDial(): { setFrequency(freq: string | undefined): void } {
  const total = Math.round((DIAL_MAX - DIAL_MIN) / DIAL_STEP) + 1;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < total; i++) {
    const f = DIAL_MIN + i * DIAL_STEP;
    const isMajor = Math.abs(f - Math.round(f)) < 0.01;
    const tick = document.createElement('div');
    tick.className = 'dial-tick' + (isMajor ? ' major' : '');
    if (isMajor) {
      const lab = document.createElement('span');
      lab.className = 'lab';
      lab.textContent = String(Math.round(f));
      tick.append(lab);
    }
    frag.append(tick);
  }
  $dialTrack.append(frag);
  return {
    setFrequency(freq) {
      if (!freq) return;
      const f = parseFloat(freq);
      if (Number.isNaN(f)) return;
      const offset = ((f - DIAL_MIN) / DIAL_STEP) * DIAL_TICK_W;
      $dialTrack.style.transform = `translateX(calc(50% - ${offset}px - ${DIAL_TICK_W / 2}px))`;
    },
  };
}

const dial = buildDial();

// ─────────────────────────────────────────────────────────────
// Now-Playing label flash (used for ephemeral feedback)
// ─────────────────────────────────────────────────────────────

const NP_LABEL_DEFAULT = 'Now Playing';
let labelFlashTimer: number | undefined;

function flashLabel(text: string, ms = 1500): void {
  if (labelFlashTimer !== undefined) window.clearTimeout(labelFlashTimer);
  $npLabel.textContent = text;
  labelFlashTimer = window.setTimeout(() => {
    $npLabel.textContent = NP_LABEL_DEFAULT;
  }, ms);
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
  $npFreqNum.textContent = s.frequency ?? '—';
  $npBitrate.textContent = s.bitrate ? `${s.bitrate} kbps` : '—';
  $npOrigin.textContent = s.country ?? '—';
  $npListeners.textContent = s.listeners ? s.listeners.toLocaleString() : '—';
  $npLiveText.textContent = npLiveText(np);
  $npFormat.textContent = npFormatText(s);

  $npFav.classList.toggle('is-fav', !!s.id && isFavorite(s.id));
  $npFav.setAttribute('aria-label', isFavorite(s.id) ? 'Remove favorite' : 'Add favorite');

  $npPlay.classList.toggle('is-loading', np.state === 'loading');
  $npPlay.setAttribute('aria-label', np.state === 'playing' ? 'Pause' : 'Play');

  if (s.frequency) dial.setFrequency(s.frequency);

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
  // Search is available on every tab. Tags are Browse-only.
  $tags.hidden = activeTab !== 'browse';
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

function renderTags(): void {
  $tags.replaceChildren(
    ...TAG_PRESETS.map((tag) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'tag' + (activeTag === tag ? ' active' : '');
      chip.textContent = tag;
      chip.setAttribute('aria-pressed', String(activeTag === tag));
      chip.addEventListener('click', () => {
        activeTag = tag;
        renderTags();
        void runQuery();
      });
      return chip;
    }),
  );
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

function renderContent(): void {
  $content.replaceChildren();

  if (activeTab === 'browse') {
    const label = $search.value.trim()
      ? 'Results'
      : activeTag === 'all'
        ? 'Curated'
        : activeTag;
    $content.append(sectionLabel(label, lastBrowseStations.length));
    if (lastBrowseStations.length === 0) {
      $content.append(emptyState(ICON_EMPTY, 'No stations match', 'Try a different search or tag'));
    } else {
      $content.append(renderRows(lastBrowseStations));
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
  window.setTimeout(() => openNp(true), 100);
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
  renderTags();
  if (activeTab !== 'browse') {
    setTab('browse'); // setTab also runs the query
  } else if (!wasBrowseDefault) {
    void runQuery();
  }
  $content.scrollTo({ top: 0, behavior: 'smooth' });
}

function setTab(tab: Tab): void {
  if (activeTab === tab) return;
  activeTab = tab;
  renderTabBar();
  renderTopBar();
  if (tab === 'browse') void runQuery();
  else renderContent();
}

function openNp(open: boolean): void {
  if (open && !currentNP.station.id) return;
  $np.classList.toggle('open', open);
  $np.setAttribute('aria-hidden', String(!open));
}

async function shareCurrentStation(): Promise<void> {
  const s = currentNP.station;
  if (!s.id) return;
  const url = s.homepage || s.streamUrl;
  const data: ShareData = {
    title: s.name,
    text: `${s.name} on rrradio`,
    url,
  };
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share(data);
      return;
    } catch (err) {
      // AbortError = user cancelled; anything else, fall back to copy
      if (err instanceof DOMException && err.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    flashLabel('Link copied');
  } catch {
    window.open(url, '_blank', 'noopener');
  }
}

function setSleep(minutes: number): void {
  if (sleepTimer !== undefined) {
    window.clearTimeout(sleepTimer);
    sleepTimer = undefined;
  }
  if (minutes === 0) {
    $npSleep.classList.remove('is-fav'); // reuse accent border style
    $npSleep.removeAttribute('data-min');
    $npSleep.setAttribute('aria-label', 'Sleep timer');
    return;
  }
  $npSleep.classList.add('is-fav');
  $npSleep.dataset.min = String(minutes);
  $npSleep.setAttribute('aria-label', `Sleep timer (${minutes}m)`);
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

$searchClear.addEventListener('click', () => {
  clearSearch(true);
  void runQuery();
});

$wordmark.addEventListener('click', goHome);

$mini.addEventListener('click', () => openNp(true));
$miniToggle.addEventListener('click', (e) => {
  e.stopPropagation();
  player.toggle();
});

$npClose.addEventListener('click', () => openNp(false));
$npPlay.addEventListener('click', () => player.toggle());
$npShare.addEventListener('click', () => void shareCurrentStation());

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

player.subscribe((np) => {
  currentNP = np;
  $body.classList.toggle('is-playing', np.state === 'playing');
  $signalStatus.textContent = signalStatusText(np);
  renderMiniPlayer(np);
  renderNowPlaying(np);
  syncRowPlayingState();
});

// ─────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────

renderTabBar();
renderTopBar();
renderTags();
syncSearchClear();
void runQuery();
