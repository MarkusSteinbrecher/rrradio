import type { Station } from './types';
import { coverSrc, type Cover } from './genre-art';
import type { ResolvedHighlight } from './highlights';
import { flagEmoji, stationInitials } from './station-display';

// Cards of the Browse discovery landing, after the iOS discovery surface
// (rrradio-ios `BrowseMixCard.swift`, `BrowseDiscoveryView.swift`):
//   genre card      three circles of pictures, the genre name inside
//   country card    a 2×2 collage of station logos, flag + name under it
//   highlight card  a panel of three album covers with the station's
//                   logo tile on it, then badge, name and blurb
// Pure DOM builders: data in, element out, the tap handler passed in.

function picture(src: string, className: string): HTMLImageElement {
  const img = document.createElement('img');
  img.className = className;
  img.src = coverSrc(src);
  img.alt = '';
  img.loading = 'lazy';
  img.decoding = 'async';
  img.referrerPolicy = 'no-referrer';
  // A picture that fails to load leaves its quiet placeholder showing.
  img.addEventListener('error', () => img.remove(), { once: true });
  return img;
}

/** A station logo on a white plate, initials when it has none or the
 *  logo fails to load. */
export function logoTile(station: Station, className = 'disc-tile'): HTMLSpanElement {
  const tile = document.createElement('span');
  tile.className = className;
  const drawInitials = (): void => {
    tile.replaceChildren();
    tile.classList.add('is-initials');
    tile.textContent = stationInitials(station.name);
  };
  if (station.favicon) {
    const img = document.createElement('img');
    img.src = station.favicon;
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', drawInitials, { once: true });
    tile.append(img);
  } else {
    drawInitials();
  }
  return tile;
}

export interface GenreCardData {
  id: string;
  label: string;
  count: number;
  /** Hero first. Empty while genre-art.json has no set for the genre. */
  covers: Cover[];
  /** Stations whose logos stand in for missing covers, hero first. */
  fallback: Station[];
}

export function genreCard(data: GenreCardData, onPick: () => void): HTMLButtonElement {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'disc-card disc-genre';
  card.dataset.genre = data.id;
  card.setAttribute('aria-label', `${data.label}, ${data.count} stations`);
  // Side circles first so the hero paints in front of them.
  for (const slot of [1, 2, 0]) {
    const circle = document.createElement('span');
    circle.className = `disc-genre__circle disc-genre__circle--${slot === 0 ? 'hero' : slot === 1 ? 'leading' : 'trailing'}`;
    const cover = data.covers[slot];
    const station = data.fallback[slot];
    if (cover) circle.append(picture(cover.image, 'disc-genre__img'));
    else if (station) circle.append(logoTile(station, 'disc-genre__logo'));
    card.append(circle);
  }
  const title = document.createElement('span');
  title.className = 'disc-genre__title';
  title.textContent = data.label;
  card.append(title);
  card.addEventListener('click', onPick);
  return card;
}

export interface CountryCardData {
  code: string;
  label: string;
  count: number;
  /** Up to four stations with logos; fewer than four shows one, none the flag. */
  stations: Station[];
}

export function countryCard(data: CountryCardData, onPick: () => void): HTMLButtonElement {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'disc-mix';
  card.dataset.country = data.code;
  card.setAttribute('aria-label', `${data.label}, ${data.count} stations`);
  const flag = flagEmoji(data.code);
  const art = document.createElement('span');
  art.className = 'disc-card disc-mix__art';
  if (data.stations.length >= 4) {
    art.classList.add('disc-mix__art--grid');
    for (const s of data.stations.slice(0, 4)) art.append(logoTile(s));
  } else if (data.stations.length > 0) {
    art.classList.add('disc-mix__art--single');
    art.append(logoTile(data.stations[0]));
  } else {
    art.classList.add('disc-mix__art--flag');
    art.textContent = flag;
  }
  art.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.className = 'disc-mix__label';
  if (flag) {
    const glyph = document.createElement('span');
    glyph.className = 'disc-mix__flag';
    glyph.textContent = flag;
    glyph.setAttribute('aria-hidden', 'true');
    label.append(glyph);
  }
  const name = document.createElement('span');
  name.className = 'disc-mix__name';
  name.textContent = data.label;
  label.append(name);
  card.append(art, label);
  card.addEventListener('click', onPick);
  return card;
}

/** The whole card is the play control, as on iOS: no separate button. */
export function highlightCard(item: ResolvedHighlight, covers: Cover[], onPlay: () => void): HTMLButtonElement {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'feat-card';
  card.dataset.id = item.station.id;
  // The editorial accent only tints the badge dot.
  if (item.badge?.accent) card.style.setProperty('--feat-accent', item.badge.accent);

  const panel = document.createElement('span');
  panel.className = 'feat-card__panel';
  const strip = document.createElement('span');
  strip.className = 'feat-card__covers';
  for (let i = 0; i < 3; i++) {
    const cell = document.createElement('span');
    cell.className = 'feat-card__cover';
    if (covers[i]) cell.append(picture(covers[i].image, 'feat-card__cover-img'));
    strip.append(cell);
  }
  panel.append(strip, logoTile(item.station, 'disc-tile feat-card__logo'));
  panel.setAttribute('aria-hidden', 'true');
  card.append(panel);

  const body = document.createElement('span');
  body.className = 'feat-card__body';
  if (item.badge?.label) {
    const badge = document.createElement('span');
    badge.className = 'feat-card__badge';
    badge.textContent = item.badge.label;
    body.append(badge);
  }
  const nameLine = document.createElement('span');
  nameLine.className = 'feat-card__name';
  const name = document.createElement('span');
  name.className = 'feat-card__name-text';
  name.textContent = item.station.name;
  nameLine.append(name);
  const flag = flagEmoji(item.station.country);
  if (flag) {
    const glyph = document.createElement('span');
    glyph.className = 'feat-card__flag';
    glyph.textContent = flag;
    glyph.setAttribute('aria-hidden', 'true');
    nameLine.append(glyph);
  }
  body.append(nameLine);
  if (item.blurb) {
    const blurb = document.createElement('span');
    blurb.className = 'feat-card__blurb';
    blurb.textContent = item.blurb;
    body.append(blurb);
  }
  card.append(body);
  card.addEventListener('click', onPlay);
  return card;
}
