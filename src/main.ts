import { AudioPlayer, stateLabel } from './player';
import { fetchStations, searchStations } from './stations';
import { pushRecent } from './storage';
import type { Station } from './types';

const player = new AudioPlayer();

const $list = document.getElementById('station-list') as HTMLElement;
const $listStatus = document.getElementById('list-status') as HTMLElement;
const $search = document.getElementById('search') as HTMLInputElement;
const $tags = document.getElementById('tags') as HTMLElement;
const $footer = document.getElementById('player') as HTMLElement;
const $stationName = document.getElementById('player-station') as HTMLElement;
const $status = document.getElementById('player-status') as HTMLElement;
const $toggle = document.getElementById('player-toggle') as HTMLButtonElement;

const TAG_PRESETS = ['jazz', 'ambient', 'classical', 'electronic', 'news', 'rock'];
let activeTag: string | null = null;
let queryToken = 0;

$toggle.addEventListener('click', () => player.toggle());

player.subscribe((np) => {
  if (!np.station.id) {
    $footer.hidden = true;
    return;
  }
  $footer.hidden = false;
  $stationName.textContent = np.station.name;
  $status.textContent = np.errorMessage ?? stateLabel(np.state);
  $toggle.textContent = np.state === 'playing' ? '❚❚' : '▶';
});

function showStatus(message: string): void {
  $list.replaceChildren();
  $listStatus.textContent = message;
  $listStatus.hidden = false;
}

function renderStations(stations: Station[]): void {
  if (stations.length === 0) {
    showStatus('No stations match.');
    return;
  }
  $listStatus.hidden = true;
  $list.replaceChildren(
    ...stations.map((station) => {
      const card = document.createElement('button');
      card.className = 'station-card';
      card.type = 'button';
      card.innerHTML = `
        <div class="station-name"></div>
        <div class="station-tags"></div>
      `;
      (card.querySelector('.station-name') as HTMLElement).textContent = station.name;
      (card.querySelector('.station-tags') as HTMLElement).textContent =
        (station.tags ?? []).slice(0, 4).join(' · ');
      card.addEventListener('click', () => {
        pushRecent(station.id);
        void player.play(station);
      });
      return card;
    }),
  );
}

function renderTags(): void {
  $tags.replaceChildren(
    ...TAG_PRESETS.map((tag) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'tag-chip' + (activeTag === tag ? ' active' : '');
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
  showStatus('Loading…');

  try {
    const stations =
      query || activeTag
        ? await searchStations({ query: query || undefined, tag: activeTag ?? undefined })
        : await fetchStations();
    if (myToken !== queryToken) return;
    renderStations(stations);
  } catch (err) {
    if (myToken !== queryToken) return;
    showStatus(`Couldn’t load stations: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
  let t: number | undefined;
  return (...args: A) => {
    if (t !== undefined) window.clearTimeout(t);
    t = window.setTimeout(() => fn(...args), ms);
  };
}

$search.addEventListener('input', debounce(() => void runQuery(), 300));

renderTags();
void runQuery();
