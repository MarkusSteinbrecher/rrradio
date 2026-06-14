import { describe, expect, it } from 'vitest';
import {
  BACKUP_VERSION,
  BackupParseError,
  backupFilename,
  mergeSnapshot,
  parseBackup,
  serializeBackup,
  summaryMessage,
  type BackupSnapshot,
} from './backup';
import type { Station } from './types';
import type { StationList } from './lists';

const fm4: Station = {
  id: 'fm4',
  name: 'FM4',
  streamUrl: 'https://example.com/fm4',
  country: 'AT',
  tags: ['alternative'],
};
const oe1: Station = {
  id: 'oe1',
  name: 'Ö1',
  streamUrl: 'https://example.com/oe1',
  country: 'AT',
};
const customNoise: Station = {
  id: 'mynoise',
  name: 'My Noise',
  streamUrl: 'https://example.com/mynoise',
};
const roadtrip: StationList = {
  id: 'list-roadtrip',
  name: 'Roadtrip',
  stations: [fm4, oe1],
  createdAt: 1,
};

describe('serializeBackup', () => {
  it('writes the version + ISO timestamp + all three collections', () => {
    const at = new Date('2026-05-07T12:00:00.000Z');
    const out = serializeBackup([fm4], [customNoise], [roadtrip], at);
    const parsed = JSON.parse(out) as BackupSnapshot;
    expect(parsed.version).toBe(BACKUP_VERSION);
    expect(parsed.exportedAt).toBe('2026-05-07T12:00:00.000Z');
    expect(parsed.favorites).toEqual([fm4]);
    expect(parsed.custom).toEqual([customNoise]);
    expect(parsed.lists).toEqual([roadtrip]);
  });

  it('produces JSON that round-trips through parseBackup', () => {
    const text = serializeBackup([fm4, oe1], [], [roadtrip]);
    const back = parseBackup(text);
    expect(back.favorites).toEqual([fm4, oe1]);
    expect(back.custom).toEqual([]);
    expect(back.lists).toEqual([roadtrip]);
  });

  it('defaults lists to empty when omitted', () => {
    const back = parseBackup(serializeBackup([fm4], []));
    expect(back.lists).toEqual([]);
  });
});

describe('backupFilename', () => {
  it('renders YYYY-MM-DD from local date', () => {
    const at = new Date(2026, 0, 5); // local Jan 5 2026
    expect(backupFilename(at)).toBe('rrradio-favorites-2026-01-05.json');
  });
});

describe('parseBackup', () => {
  it('rejects non-JSON input', () => {
    expect(() => parseBackup('not json {')).toThrow(BackupParseError);
  });

  it('rejects null / non-object input', () => {
    expect(() => parseBackup('null')).toThrow(BackupParseError);
    expect(() => parseBackup('"a string"')).toThrow(BackupParseError);
  });

  it('rejects missing version', () => {
    expect(() => parseBackup('{}')).toThrow(/version/);
  });

  it('rejects unsupported version', () => {
    const text = JSON.stringify({ version: 99, favorites: [], custom: [] });
    expect(() => parseBackup(text)).toThrow(/version 99/);
  });

  it('still accepts a v1 file (no lists) and imports zero lists', () => {
    const text = JSON.stringify({ version: 1, favorites: [fm4], custom: [] });
    const out = parseBackup(text);
    expect(out.favorites).toEqual([fm4]);
    expect(out.lists).toEqual([]);
  });

  it('drops entries missing required Station fields', () => {
    const text = JSON.stringify({
      version: BACKUP_VERSION,
      favorites: [fm4, { id: 'broken' }, { name: 'no id', streamUrl: 'x' }],
      custom: [],
    });
    const out = parseBackup(text);
    expect(out.favorites).toEqual([fm4]);
  });

  it('drops malformed lists and sanitizes list members', () => {
    const text = JSON.stringify({
      version: BACKUP_VERSION,
      favorites: [],
      custom: [],
      lists: [
        { id: 'ok', name: 'OK', stations: [fm4, { id: 'broken' }], createdAt: 3 },
        { id: 'noName' }, // dropped
        'garbage', // dropped
      ],
    });
    const out = parseBackup(text);
    expect(out.lists).toHaveLength(1);
    expect(out.lists[0].stations).toEqual([fm4]);
  });

  it('treats missing favorites/custom/lists as empty arrays', () => {
    const out = parseBackup(JSON.stringify({ version: BACKUP_VERSION }));
    expect(out.favorites).toEqual([]);
    expect(out.custom).toEqual([]);
    expect(out.lists).toEqual([]);
  });
});

describe('mergeSnapshot', () => {
  const snap = (favs: Station[], cus: Station[], lists: StationList[] = []): BackupSnapshot => ({
    version: BACKUP_VERSION,
    exportedAt: '',
    favorites: favs,
    custom: cus,
    lists,
  });

  it('appends new favorites at the end (preserves existing order)', () => {
    const out = mergeSnapshot([fm4], [], [], snap([oe1], []));
    expect(out.mergedFavorites).toEqual([fm4, oe1]);
    expect(out.favoritesAdded).toBe(1);
    expect(out.favoritesAlreadyHad).toBe(0);
  });

  it('skips ids the user already has', () => {
    const out = mergeSnapshot([fm4, oe1], [], [], snap([fm4], []));
    expect(out.mergedFavorites).toEqual([fm4, oe1]);
    expect(out.favoritesAdded).toBe(0);
    expect(out.favoritesAlreadyHad).toBe(1);
  });

  it('merges custom stations independently from favorites', () => {
    const out = mergeSnapshot([fm4], [], [], snap([], [customNoise]));
    expect(out.mergedFavorites).toEqual([fm4]); // untouched
    expect(out.mergedCustom).toEqual([customNoise]);
    expect(out.customAdded).toBe(1);
  });

  it('merges lists union-by-id (keeps existing on collision)', () => {
    const mine: StationList = { id: 'list-roadtrip', name: 'Mine', stations: [], createdAt: 9 };
    const out = mergeSnapshot([], [], [mine], snap([], [], [roadtrip]));
    // same id → kept the existing "Mine", didn't overwrite with "Roadtrip"
    expect(out.mergedLists).toEqual([mine]);
    expect(out.listsAdded).toBe(0);
    expect(out.listsAlreadyHad).toBe(1);
  });

  it('appends a genuinely new list', () => {
    const out = mergeSnapshot([], [], [], snap([], [], [roadtrip]));
    expect(out.mergedLists).toEqual([roadtrip]);
    expect(out.listsAdded).toBe(1);
  });

  it('handles a fully-empty incoming backup gracefully', () => {
    const out = mergeSnapshot([fm4], [], [], snap([], []));
    expect(out.mergedFavorites).toEqual([fm4]);
    expect(out.favoritesAdded).toBe(0);
    expect(out.favoritesAlreadyHad).toBe(0);
    expect(out.listsAdded).toBe(0);
  });
});

describe('summaryMessage', () => {
  const base = { mergedFavorites: [], mergedCustom: [], mergedLists: [] };

  it('shows the added counts when something was new', () => {
    const msg = summaryMessage({
      ...base,
      favoritesAdded: 3,
      favoritesAlreadyHad: 1,
      customAdded: 2,
      customAlreadyHad: 0,
      listsAdded: 0,
      listsAlreadyHad: 0,
    });
    expect(msg).toBe('Imported 3 favorites and 2 custom stations (1 already had).');
  });

  it('includes lists in the natural-language join', () => {
    const msg = summaryMessage({
      ...base,
      favoritesAdded: 3,
      favoritesAlreadyHad: 0,
      customAdded: 2,
      customAlreadyHad: 0,
      listsAdded: 1,
      listsAlreadyHad: 0,
    });
    expect(msg).toBe('Imported 3 favorites, 2 custom stations and 1 list.');
  });

  it('handles singular wording', () => {
    const msg = summaryMessage({
      ...base,
      favoritesAdded: 1,
      favoritesAlreadyHad: 0,
      customAdded: 0,
      customAlreadyHad: 0,
      listsAdded: 0,
      listsAlreadyHad: 0,
    });
    expect(msg).toBe('Imported 1 favorite.');
  });

  it('says "already had everything" when nothing was new but counts > 0', () => {
    const msg = summaryMessage({
      ...base,
      favoritesAdded: 0,
      favoritesAlreadyHad: 4,
      customAdded: 0,
      customAlreadyHad: 1,
      listsAdded: 0,
      listsAlreadyHad: 2,
    });
    expect(msg).toBe('Already had everything in that backup (7 items).');
  });

  it('says "empty" when the backup carried no entries', () => {
    const msg = summaryMessage({
      ...base,
      favoritesAdded: 0,
      favoritesAlreadyHad: 0,
      customAdded: 0,
      customAlreadyHad: 0,
      listsAdded: 0,
      listsAlreadyHad: 0,
    });
    expect(msg).toBe('That backup is empty.');
  });
});
