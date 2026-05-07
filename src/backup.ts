/**
 * Backup & restore for favorites + custom stations (gh #127).
 *
 * Export: write a small JSON snapshot the user downloads, then carries
 * to another device (AirDrop, USB, share sheet — anything that moves a
 * file). Import: parse the snapshot and merge it with whatever's
 * already on the device — never wipe.
 *
 * No backend, no account, no URL fragment. The file is the entire
 * sync mechanism; the user can read it before they import it.
 *
 * This file is pure: no DOM, no localStorage, no fetch. main.ts wires
 * the file-download / file-pick plumbing; tests exercise the helpers
 * with plain string + array fixtures.
 */

import type { Station } from './types';

export const BACKUP_VERSION = 1;

export interface BackupSnapshot {
  version: number;
  exportedAt: string;
  favorites: Station[];
  custom: Station[];
}

export interface ImportSummary {
  favoritesAdded: number;
  favoritesAlreadyHad: number;
  customAdded: number;
  customAlreadyHad: number;
  /** Snapshot of the merged lists, ready to be written back to storage. */
  mergedFavorites: Station[];
  mergedCustom: Station[];
}

export class BackupParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupParseError';
  }
}

export function serializeBackup(favorites: Station[], custom: Station[], now = new Date()): string {
  const snap: BackupSnapshot = {
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    favorites,
    custom,
  };
  return JSON.stringify(snap, null, 2);
}

/** YYYY-MM-DD slice for filenames (consistent across timezones — uses
 *  the user's local date so it matches what they'd type). */
export function backupFilename(now = new Date()): string {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `rrradio-favorites-${yyyy}-${mm}-${dd}.json`;
}

/** Parse a backup file. Throws BackupParseError on any structural
 *  problem — main.ts catches and surfaces a friendly message. */
export function parseBackup(text: string): BackupSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BackupParseError("That doesn't look like a JSON file we can read.");
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new BackupParseError('Backup file is empty or malformed.');
  }
  const obj = parsed as Record<string, unknown>;
  const version = obj.version;
  if (typeof version !== 'number') {
    throw new BackupParseError('Backup file has no version marker.');
  }
  if (version !== BACKUP_VERSION) {
    throw new BackupParseError(
      `Backup version ${version} isn't supported (expected ${BACKUP_VERSION}).`,
    );
  }
  const favorites = sanitizeStations(obj.favorites);
  const custom = sanitizeStations(obj.custom);
  return {
    version,
    exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : '',
    favorites,
    custom,
  };
}

/** Drop entries that don't look like a Station — same shape-check the
 *  storage layer uses on read. Mirrors `readStations` in storage.ts. */
function sanitizeStations(raw: unknown): Station[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (s): s is Station =>
      typeof s === 'object' &&
      s !== null &&
      typeof (s as Station).id === 'string' &&
      typeof (s as Station).name === 'string' &&
      typeof (s as Station).streamUrl === 'string',
  );
}

/** Merge an imported snapshot with what's already on the device. Union
 *  by id — never overwrites or removes. Incoming entries are appended
 *  AFTER existing ones so the user's current dial order is preserved. */
export function mergeSnapshot(
  existingFavorites: Station[],
  existingCustom: Station[],
  incoming: BackupSnapshot,
): ImportSummary {
  const fav = mergeById(existingFavorites, incoming.favorites);
  const cus = mergeById(existingCustom, incoming.custom);
  return {
    favoritesAdded: fav.added,
    favoritesAlreadyHad: fav.alreadyHad,
    customAdded: cus.added,
    customAlreadyHad: cus.alreadyHad,
    mergedFavorites: fav.merged,
    mergedCustom: cus.merged,
  };
}

function mergeById(
  existing: Station[],
  incoming: Station[],
): { merged: Station[]; added: number; alreadyHad: number } {
  const haveIds = new Set(existing.map((s) => s.id));
  const merged = [...existing];
  let added = 0;
  let alreadyHad = 0;
  for (const s of incoming) {
    if (haveIds.has(s.id)) {
      alreadyHad++;
      continue;
    }
    merged.push(s);
    haveIds.add(s.id);
    added++;
  }
  return { merged, added, alreadyHad };
}

/** Render a one-line user-facing summary of an import. Single source of
 *  truth so main.ts and tests agree on the wording. */
export function summaryMessage(s: ImportSummary): string {
  const parts: string[] = [];
  if (s.favoritesAdded > 0) parts.push(`${s.favoritesAdded} favorite${s.favoritesAdded === 1 ? '' : 's'}`);
  if (s.customAdded > 0)
    parts.push(`${s.customAdded} custom station${s.customAdded === 1 ? '' : 's'}`);
  if (parts.length === 0) {
    const total = s.favoritesAlreadyHad + s.customAlreadyHad;
    return total > 0
      ? `Already had everything in that backup (${total} item${total === 1 ? '' : 's'}).`
      : 'That backup is empty.';
  }
  const tail =
    s.favoritesAlreadyHad + s.customAlreadyHad > 0
      ? ` (${s.favoritesAlreadyHad + s.customAlreadyHad} already had).`
      : '.';
  return `Imported ${parts.join(' and ')}${tail}`;
}
