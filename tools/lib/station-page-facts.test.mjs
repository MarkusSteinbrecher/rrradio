import { describe, expect, it } from 'vitest';
import {
  homepageLink,
  logoUrl,
  nowPlayingText,
  scheduleText,
  stationFacts,
  streamQualityText,
} from './station-page-facts.mjs';

const SITE = 'https://rrradio.org';

describe('station-page-facts', () => {
  it('formats stream quality from codec + bitrate, dropping missing parts', () => {
    expect(streamQualityText({ codec: 'mp3', bitrate: 192 })).toBe('MP3 · 192 kbps');
    expect(streamQualityText({ codec: 'AAC+' })).toBe('AAC+');
    expect(streamQualityText({ bitrate: 128 })).toBe('128 kbps');
    expect(streamQualityText({ codec: '  ', bitrate: 0 })).toBeNull();
  });

  it('maps the metadata strategy to a now-playing phrase', () => {
    expect(nowPlayingText({ metadataStrategy: 'api' })).toMatch(/broadcaster/);
    expect(nowPlayingText({ metadataStrategy: 'icy' })).toMatch(/stream/);
    expect(nowPlayingText({ metadataStrategy: 'none' })).toMatch(/Not published/);
    expect(nowPlayingText(undefined)).toBeNull();
  });

  it('only reports a schedule when one exists', () => {
    expect(scheduleText({ hasSchedule: true })).toMatch(/schedule/);
    expect(scheduleText({ hasSchedule: false })).toBeNull();
    expect(scheduleText(undefined)).toBeNull();
  });

  it('accepts only http(s) homepages and labels them by host', () => {
    expect(homepageLink({ homepage: 'https://www.fm4.orf.at/' })).toEqual({
      href: 'https://www.fm4.orf.at/',
      label: 'fm4.orf.at',
    });
    expect(homepageLink({ homepage: 'javascript:alert(1)' })).toBeNull();
    expect(homepageLink({ homepage: 'not a url' })).toBeNull();
    expect(homepageLink({})).toBeNull();
  });

  it('builds absolute logo URLs and skips non-https schemes', () => {
    expect(logoUrl({ favicon: 'stations/fm4.png?v=1' }, SITE)).toBe(`${SITE}/stations/fm4.png?v=1`);
    expect(logoUrl({ favicon: 'https://cdn.example/logo.png' }, SITE)).toBe('https://cdn.example/logo.png');
    expect(logoUrl({ favicon: 'http://cdn.example/logo.png' }, SITE)).toBeNull();
    expect(logoUrl({}, SITE)).toBeNull();
  });

  it('orders facts and omits the ones without data', () => {
    const full = stationFacts(
      { codec: 'MP3', bitrate: 192, homepage: 'https://fm4.orf.at/' },
      { metadataStrategy: 'api', hasSchedule: true },
      'Austria',
    );
    expect(full.map((f) => f.label)).toEqual([
      'Country',
      'Stream quality',
      'Now playing',
      'Schedule',
      'Official website',
    ]);
    expect(full.at(-1)).toMatchObject({ href: 'https://fm4.orf.at/', text: 'fm4.orf.at' });
    expect(stationFacts({}, undefined, undefined)).toEqual([]);
  });
});
