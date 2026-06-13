import { describe, it, expect } from 'vitest';
import {
  findStation,
  patchStationFields,
  clearFaviconFields,
  removeStation,
} from './catalog-json-patch.mjs';

const make = () => [
  {
    id: 'a-one',
    name: 'One FM',
    streamUrl: 'https://a.example/one.mp3',
    bitrate: 128,
    codec: 'MP3',
    tags: ['pop', 'rock'],
    favicon: 'stations/a-one.png',
    favicons: { 76: 'favicons/a-one-76.png' },
    faviconSource: 'broadcaster',
    shortName: 'One',
    status: 'working',
  },
  { id: 'b-two', name: 'Two FM', streamUrl: 'http://b.example/two', status: 'stream-only' },
];

describe('patchStationFields', () => {
  it('sets scalar + array fields in place, preserving key order', () => {
    const stations = make();
    const r = patchStationFields(stations, 'a-one', {
      streamUrl: 'https://a.example/new.aac',
      codec: 'AAC',
      tags: ['jazz'],
    });
    expect(r).toEqual({ found: true, changed: true, applied: ['streamUrl', 'codec', 'tags'] });
    const s = findStation(stations, 'a-one');
    expect(s.streamUrl).toBe('https://a.example/new.aac');
    expect(s.codec).toBe('AAC');
    expect(s.tags).toEqual(['jazz']);
    // key order unchanged (no new keys, no reordering)
    expect(Object.keys(s)[0]).toBe('id');
    expect(Object.keys(s)[2]).toBe('streamUrl');
  });
  it('skips undefined values and unknown/unpatchable fields', () => {
    const stations = make();
    const r = patchStationFields(stations, 'a-one', { codec: undefined, status: 'broken', homepage: 'x' });
    expect(r.changed).toBe(false);
    expect(findStation(stations, 'a-one').status).toBe('working');
  });
  it('is a no-op when the value already matches', () => {
    const stations = make();
    const r = patchStationFields(stations, 'a-one', { codec: 'MP3' });
    expect(r.changed).toBe(false);
    expect(r.applied).toEqual([]);
  });
  it('reports found=false for unknown id', () => {
    const r = patchStationFields(make(), 'nope', { codec: 'AAC' });
    expect(r).toEqual({ found: false, changed: false, applied: [] });
  });
});

describe('clearFaviconFields', () => {
  it('drops every favicon-related field', () => {
    const stations = make();
    const r = clearFaviconFields(stations, 'a-one');
    expect(r).toEqual({ found: true, changed: true });
    const s = findStation(stations, 'a-one');
    expect('favicon' in s).toBe(false);
    expect('favicons' in s).toBe(false);
    expect('faviconSource' in s).toBe(false);
    expect(s.name).toBe('One FM'); // untouched
  });
  it('is a no-op when there is nothing to clear', () => {
    const stations = make();
    const r = clearFaviconFields(stations, 'b-two');
    expect(r).toEqual({ found: true, changed: false });
  });
});

describe('removeStation', () => {
  it('removes the station and signals removal', () => {
    const { stations, removed } = removeStation(make(), 'b-two');
    expect(removed).toBe(true);
    expect(stations.map((s) => s.id)).toEqual(['a-one']);
  });
  it('signals no removal for unknown id', () => {
    const { stations, removed } = removeStation(make(), 'nope');
    expect(removed).toBe(false);
    expect(stations).toHaveLength(2);
  });
});
