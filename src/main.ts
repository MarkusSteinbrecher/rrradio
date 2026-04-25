import { AudioPlayer, stateLabel } from './player';
import { fetchStations, searchStations } from './stations';
import { getFavorites, pushRecent, toggleFavorite } from './storage';
import type { NowPlaying, Station } from './types';

const player = new AudioPlayer();

const $body = document.body;
const $list = document.getElementById('station-list') as HTMLElement;
const $listStatus = document.getElementById('list-status') as HTMLElement;
const $search = document.getElementById('search') as HTMLInputElement;
const $tags = document.getElementById('tags') as HTMLElement;

const $mini = document.getElementById('mini-player') as HTMLElement;
const $miniArt = document.getElementById('mini-art') as HTMLElement;
const $miniArtFallback = document.getElementById('mini-art-fallback') as HTMLElement;
const $miniName = document.getElementById('mini-name') as HTMLElement;
const $miniStatus = document.getElementById('mini-status') as HTMLElement;
const $miniToggle = document.getElementById('mini-toggle') as HTMLButtonElement;
const $miniExpand = document.getElementById('mini-expand') as HTMLButtonElement;

const $npBack = document.getElementById('np-back') as HTMLButtonElement;
const $npArt = document.getElementById('np-art') as HTMLElement;
const $npStation = document.getElementById('np-station') as HTMLElement;
const $npTags = document.getElementById('np-tags') as HTMLElement;
const $npTrack = document.getElementById('np-track') as HTMLElement;
const $npStatus = document.getElementById('np-status') as HTMLElement;
const $npToggle = document.getElementById('np-toggle') as HTMLButtonElement;
const $npFav = document.getElementById('np-fav') as HTMLButtonElement;
const $npSleep = document.getElementById('np-sleep') as HTMLButtonElement;
const $npSleepChip = document.getElementById('np-sleep-chip') as HTMLElement;

const TAG_PRESETS = ['jazz', 'ambient', 'classical', 'electronic', 'news', 'rock'];
const SLEEP_CYCLE_MIN = [0, 15, 30, 60];

let activeTag: string | null = null;
let queryToken = 0;
let sleepIndex = 0;
let sleepTimer: number | undefined;
let currentNP: NowPlaying = {
  station: { id: '', name: '', streamUrl: '' },
  state: 'idle',
};

function setView(view: 'home' | 'playing'): void {
  $body.dataset.view = view;
}

function initials(name: string): string {
  const cleaned = name.replace(/[—–\-_·.|/]+/g, ' ');
  const parts = cleaned.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '·';
  const second = parts[1]?.[0] ?? parts[0]?.[1] ?? '';
  return (first + second).toUpperCase();
}

function setBgImage(el: HTMLElement, url: string | undefined): void {
  if (url) {
    el.style.backgroundImage = `url(${JSON.stringify(url)})`;
    el.classList.add('has-img');
  } else {
    el.style.backgroundImage = '';
    el.classList.remove('has-img');
  }
}

function renderArtwork(station: Station): void {
  const showInitials = (): void => {
    $npArt.replaceChildren();
    const span = document.createElement('span');
    span.className = 'artwork__initials';
    span.textContent = initials(station.name);
    $npArt.append(span);
  };
  $npArt.replaceChildren();
  if (station.favicon) {
    const img = document.createElement('img');
    img.src = station.favicon;
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', showInitials, { once: true });
    $npArt.append(img);
  } else {
    showInitials();
  }
}

function renderNowPlaying(np: NowPlaying): void {
  const s = np.station;
  $npStation.textContent = s.name || '—';
  $npTags.textContent = (s.tags ?? []).slice(0, 4).join(' · ').toUpperCase();
  $npTrack.textContent = np.trackTitle ?? '—';
  $npStatus.textContent = np.errorMessage ?? stateLabel(np.state);
  $npStatus.dataset.state = np.state;
  renderArtwork(s);
  $npFav.classList.toggle('is-active', getFavorites().has(s.id));
}

function renderMini(np: NowPlaying): void {
  if (!np.station.id) {
    $mini.hidden = true;
    return;
  }
  $mini.hidden = false;
  $miniName.textContent = np.station.name;
  $miniStatus.textContent = np.errorMessage ?? stateLabel(np.state);
  setBgImage($miniArt, np.station.favicon);
  $miniArtFallback.textContent = initials(np.station.name);
}

function showStatus(message: string): void {
  $list.replaceChildren();
  $listStatus.textContent = message;
  $listStatus.hidden = false;
}

function buildStationCard(station: Station, playingId: string | undefined): HTMLLIElement {
  const li = document.createElement('li');
  const card = document.createElement('button');
  card.className = 'station-card' + (station.id === playingId ? ' is-playing' : '');
  card.type = 'button';
  card.dataset.id = station.id;

  const main = document.createElement('div');
  main.className = 'station-card__main';

  const name = document.createElement('div');
  name.className = 'station-card__name';
  name.textContent = station.name;

  const tags = document.createElement('div');
  tags.className = 'station-card__tags';
  const tagText = (station.tags ?? []).slice(0, 3).join(' · ').toUpperCase();
  tags.textContent = tagText || '—';

  main.append(name, tags);

  const meta = document.createElement('div');
  meta.className = 'station-card__meta';

  const country = document.createElement('span');
  country.className = 'station-card__country';
  country.textContent = (station.country ?? '··').toUpperCase();

  const eq = document.createElement('div');
  eq.className = 'eq station-card__eq';
  eq.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 4; i++) eq.append(document.createElement('span'));

  meta.append(country, eq);
  card.append(main, meta);

  card.addEventListener('click', () => {
    pushRecent(station.id);
    void player.play(station);
    window.setTimeout(() => setView('playing'), 90);
  });

  li.append(card);
  return li;
}

function renderStations(stations: Station[]): void {
  if (stations.length === 0) {
    showStatus('No signal · try another search');
    return;
  }
  $listStatus.hidden = true;
  const playingId = currentNP.station.id || undefined;
  $list.replaceChildren(...stations.map((s) => buildStationCard(s, playingId)));
}

function renderTags(): void {
  $tags.replaceChildren(
    ...TAG_PRESETS.map((tag) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'tag-chip' + (activeTag === tag ? ' is-active' : '');
      chip.textContent = tag;
      chip.setAttribute('aria-pressed', String(activeTag === tag));
      chip.addEventListener('click', () => {
        activeTag = activeTag === tag ? null : tag;
        renderTags();
        void runQuery();
      });
      return chip;
    }),
  );
}

async function runQuery(): Promise<void> {
  const myToken = ++queryToken;
  const query = $search.value.trim();
  showStatus('Tuning in…');
  try {
    const stations =
      query || activeTag
        ? await searchStations({ query: query || undefined, tag: activeTag ?? undefined })
        : await fetchStations();
    if (myToken !== queryToken) return;
    renderStations(stations);
  } catch (err) {
    if (myToken !== queryToken) return;
    showStatus(`Off air · ${err instanceof Error ? err.message : String(err)}`);
  }
}

function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
  let t: number | undefined;
  return (...args: A) => {
    if (t !== undefined) window.clearTimeout(t);
    t = window.setTimeout(() => fn(...args), ms);
  };
}

function syncListPlayingState(stationId: string): void {
  $list.querySelectorAll<HTMLElement>('.station-card').forEach((card) => {
    card.classList.toggle('is-playing', card.dataset.id === stationId);
  });
}

function setSleep(minutes: number): void {
  if (sleepTimer !== undefined) {
    window.clearTimeout(sleepTimer);
    sleepTimer = undefined;
  }
  if (minutes === 0) {
    $npSleep.classList.remove('is-active');
    $npSleepChip.hidden = true;
    return;
  }
  $npSleep.classList.add('is-active');
  $npSleepChip.hidden = false;
  $npSleepChip.textContent = `${minutes}m`;
  sleepTimer = window.setTimeout(() => {
    player.pause();
    setSleep(0);
    sleepIndex = 0;
  }, minutes * 60 * 1000);
}

$miniExpand.addEventListener('click', () => setView('playing'));
$npBack.addEventListener('click', () => setView('home'));
$miniToggle.addEventListener('click', (e) => {
  e.stopPropagation();
  player.toggle();
});
$npToggle.addEventListener('click', () => player.toggle());

$npFav.addEventListener('click', () => {
  const id = currentNP.station.id;
  if (!id) return;
  const isFav = toggleFavorite(id);
  $npFav.classList.toggle('is-active', isFav);
});

$npSleep.addEventListener('click', () => {
  sleepIndex = (sleepIndex + 1) % SLEEP_CYCLE_MIN.length;
  setSleep(SLEEP_CYCLE_MIN[sleepIndex]);
});

$search.addEventListener('input', debounce(() => void runQuery(), 300));

player.subscribe((np) => {
  currentNP = np;
  $body.classList.toggle('is-playing', np.state === 'playing');
  $body.classList.toggle('is-loading', np.state === 'loading');
  renderMini(np);
  renderNowPlaying(np);
  syncListPlayingState(np.station.id);
});

renderTags();
void runQuery();
