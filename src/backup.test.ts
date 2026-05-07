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

describe('serializeBackup', () => {
  it('writes the version + ISO timestamp + both lists', () => {
    const at = new Date('2026-05-07T12:00:00.000Z');
    const out = serializeBackup([fm4], [customNoise], at);
    const parsed = JSON.parse(out) as BackupSnapshot;
    expect(parsed.version).toBe(BACKUP_VERSION);
    expect(parsed.exportedAt).toBe('2026-05-07T12:00:00.000Z');
    expect(parsed.favorites).toEqual([fm4]);
    expect(parsed.custom).toEqual([customNoise]);
  });

  it('produces JSON that round-trips through parseBackup', () => {
    const text = serializeBackup([fm4, oe1], []);
    const back = parseBackup(text);
    expect(back.favorites).toEqual([fm4, oe1]);
    expect(back.custom).toEqual([]);
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

  it('drops entries missing required Station fields', () => {
    const text = JSON.stringify({
      version: BACKUP_VERSION,
      favorites: [fm4, { id: 'broken' }, { name: 'no id', streamUrl: 'x' }],
      custom: [],
    });
    const out = parseBackup(text);
    expect(out.favorites).toEqual([fm4]);
  });

  it('treats missing favorites/custom as empty arrays', () => {
    const out = parseBackup(JSON.stringify({ version: BACKUP_VERSION }));
    expect(out.favorites).toEqual([]);
    expect(out.custom).toEqual([]);
  });
});

describe('mergeSnapshot', () => {
  const snap = (favs: Station[], cus: Station[]): BackupSnapshot => ({
    version: BACKUP_VERSION,
    exportedAt: '',
    favorites: favs,
    custom: cus,
  });

  it('appends new favorites at the end (preserves existing order)', () => {
    const existing: Station[] = [fm4];
    const incoming = snap([oe1], []);
    const out = mergeSnapshot(existing, [], incoming);
    expect(out.mergedFavorites).toEqual([fm4, oe1]);
    expect(out.favoritesAdded).toBe(1);
    expect(out.favoritesAlreadyHad).toBe(0);
  });

  it('skips ids the user already has', () => {
    const existing: Station[] = [fm4, oe1];
    const incoming = snap([fm4], []);
    const out = mergeSnapshot(existing, [], incoming);
    expect(out.mergedFavorites).toEqual([fm4, oe1]);
    expect(out.favoritesAdded).toBe(0);
    expect(out.favoritesAlreadyHad).toBe(1);
  });

  it('merges custom stations independently from favorites', () => {
    const existing: Station[] = [fm4];
    const existingCustom: Station[] = [];
    const incoming = snap([], [customNoise]);
    const out = mergeSnapshot(existing, existingCustom, incoming);
    expect(out.mergedFavorites).toEqual([fm4]); // untouched
    expect(out.mergedCustom).toEqual([customNoise]);
    expect(out.customAdded).toBe(1);
  });

  it('handles a fully-empty incoming backup gracefully', () => {
    const existing: Station[] = [fm4];
    const out = mergeSnapshot(existing, [], snap([], []));
    expect(out.mergedFavorites).toEqual([fm4]);
    expect(out.favoritesAdded).toBe(0);
    expect(out.favoritesAlreadyHad).toBe(0);
  });
});

describe('summaryMessage', () => {
  const base = { mergedFavorites: [], mergedCustom: [] };

  it('shows the added counts when something was new', () => {
    const msg = summaryMessage({
      ...base,
      favoritesAdded: 3,
      favoritesAlreadyHad: 1,
      customAdded: 2,
      customAlreadyHad: 0,
    });
    expect(msg).toBe('Imported 3 favorites and 2 custom stations (1 already had).');
  });

  it('handles singular wording', () => {
    const msg = summaryMessage({
      ...base,
      favoritesAdded: 1,
      favoritesAlreadyHad: 0,
      customAdded: 0,
      customAlreadyHad: 0,
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
    });
    expect(msg).toBe('Already had everything in that backup (5 items).');
  });

  it('says "empty" when the backup carried no entries', () => {
    const msg = summaryMessage({
      ...base,
      favoritesAdded: 0,
      favoritesAlreadyHad: 0,
      customAdded: 0,
      customAlreadyHad: 0,
    });
    expect(msg).toBe('That backup is empty.');
  });
});
