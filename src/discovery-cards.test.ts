import { describe, expect, it, vi } from 'vitest';
import { countryCard, genreCard, highlightCard } from './discovery-cards';
import type { ResolvedHighlight } from './highlights';
import type { Station } from './types';

const station = (id: string, extra: Partial<Station> = {}): Station =>
  ({ id, name: `Radio ${id}`, streamUrl: `https://example.com/${id}`, favicon: `https://example.com/${id}.png`, ...extra }) as Station;
const cover = (n: number) => ({ artist: 'A', album: 'B', image: `https://is1-ssl.mzstatic.com/${n}/600x600bb.jpg` });

describe('genreCard', () => {
  it('draws three circles, the hero last so it paints in front, and the title', () => {
    const onPick = vi.fn();
    const card = genreCard({ id: 'jazz', label: 'Jazz', count: 812, covers: [cover(0), cover(1), cover(2)], fallback: [] }, onPick);
    const circles = [...card.querySelectorAll('.disc-genre__circle')];
    expect(circles.map((c) => c.className.split('--')[1])).toEqual(['leading', 'trailing', 'hero']);
    expect(circles[2].querySelector('img')?.getAttribute('src')).toBe(cover(0).image);
    expect(card.querySelector('.disc-genre__title')?.textContent).toBe('Jazz');
    expect(card.getAttribute('aria-label')).toBe('Jazz, 812 stations');
    card.click();
    expect(onPick).toHaveBeenCalledOnce();
  });

  it('loads a hosted photo from this origin', () => {
    const photo = { image: 'https://rrradio.org/genre-art/news-1.jpg' };
    const card = genreCard({ id: 'news', label: 'News', count: 5, covers: [photo, photo, photo], fallback: [] }, () => {});
    expect(card.querySelector('.disc-genre__circle--hero img')?.getAttribute('src')).toMatch(/genre-art\/news-1\.jpg$/);
    expect(card.querySelector('.disc-genre__circle--hero img')?.getAttribute('src')).not.toContain('rrradio.org');
  });

  it('falls back to station logos, then to quiet circles', () => {
    const logos = genreCard({ id: 'jazz', label: 'Jazz', count: 1, covers: [], fallback: [station('a')] }, () => {});
    expect(logos.querySelector('.disc-genre__circle--hero .disc-genre__logo img')?.getAttribute('src')).toBe('https://example.com/a.png');
    expect(logos.querySelector('.disc-genre__circle--leading')?.childElementCount).toBe(0);
  });

  it('leaves the quiet circle when a picture fails to load', () => {
    const card = genreCard({ id: 'jazz', label: 'Jazz', count: 1, covers: [cover(0), cover(1), cover(2)], fallback: [] }, () => {});
    const img = card.querySelector('.disc-genre__circle--hero img');
    img?.dispatchEvent(new Event('error'));
    expect(card.querySelector('.disc-genre__circle--hero')?.childElementCount).toBe(0);
  });
});

describe('countryCard', () => {
  const data = { code: 'DE', label: 'Germany', count: 1200 };

  it('shows four logo tiles, the flag and the name', () => {
    const card = countryCard({ ...data, stations: ['a', 'b', 'c', 'd', 'e'].map((id) => station(id)) }, () => {});
    expect(card.querySelectorAll('.disc-mix__art--grid .disc-tile')).toHaveLength(4);
    expect(card.querySelector('.disc-mix__flag')?.textContent).toBe('🇩🇪');
    expect(card.querySelector('.disc-mix__name')?.textContent).toBe('Germany');
    expect(card.getAttribute('aria-label')).toBe('Germany, 1200 stations');
  });

  it('shows one tile with fewer than four logos and the flag with none', () => {
    const one = countryCard({ ...data, stations: [station('a'), station('b')] }, () => {});
    expect(one.querySelectorAll('.disc-mix__art--single .disc-tile')).toHaveLength(1);
    const none = countryCard({ ...data, stations: [] }, () => {});
    expect(none.querySelector('.disc-mix__art--flag')?.textContent).toBe('🇩🇪');
  });

  it('draws initials when a logo fails to load', () => {
    const card = countryCard({ ...data, stations: [station('a', { name: 'Bayern Eins' })] }, () => {});
    card.querySelector('.disc-tile img')?.dispatchEvent(new Event('error'));
    const tile = card.querySelector('.disc-tile');
    expect(tile?.classList.contains('is-initials')).toBe(true);
    expect(tile?.textContent?.length).toBeGreaterThan(0);
  });
});

describe('highlightCard', () => {
  const item = {
    stationId: 'a',
    station: station('a', { name: 'Tilos', country: 'HU' }),
    badge: { label: 'Station of the week', accent: '#0f8a40' },
    blurb: 'A blurb.',
  } as ResolvedHighlight;

  it('shows three covers, the logo tile, badge, name with flag, and blurb', () => {
    const onPlay = vi.fn();
    const card = highlightCard(item, [cover(0), cover(1), cover(2)], onPlay);
    expect(card.querySelectorAll('.feat-card__cover img')).toHaveLength(3);
    expect(card.querySelector('.feat-card__logo img')?.getAttribute('src')).toBe('https://example.com/a.png');
    expect(card.querySelector('.feat-card__badge')?.textContent).toBe('Station of the week');
    expect(card.querySelector('.feat-card__name-text')?.textContent).toBe('Tilos');
    expect(card.querySelector('.feat-card__flag')?.textContent).toBe('🇭🇺');
    expect(card.querySelector('.feat-card__blurb')?.textContent).toBe('A blurb.');
    expect(card.style.getPropertyValue('--feat-accent')).toBe('#0f8a40');
    card.click();
    expect(onPlay).toHaveBeenCalledOnce();
  });

  it('keeps three quiet cells without covers', () => {
    const card = highlightCard(item, [], () => {});
    expect(card.querySelectorAll('.feat-card__cover')).toHaveLength(3);
    expect(card.querySelectorAll('.feat-card__cover img')).toHaveLength(0);
  });
});
