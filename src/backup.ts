/**
 * Backup & restore for favorites + custom stations + named lists (gh
 * #127, #520).
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
 *
 * Versioning: v1 carried favorites + custom only. v2 adds `lists`. We
 * read both — a v1 file imports with zero lists — and always write v2.
 */

import type { Station } from './types';
import type { StationList } from './lists';

export const BACKUP_VERSION = 2;
const SUPPORTED_VERSIONS = [1, 2];

export interface BackupSnapshot {
  version: number;
  exportedAt: string;
  favorites: Station[];
  custom: Station[];
  lists: StationList[];
}

export interface ImportSummary {
  favoritesAdded: number;
  favoritesAlreadyHad: number;
  customAdded: number;
  customAlreadyHad: number;
  listsAdded: number;
  listsAlreadyHad: number;
  /** Snapshots of the merged collections, ready to write back to storage. */
  mergedFavorites: Station[];
  mergedCustom: Station[];
  mergedLists: StationList[];
}

export class BackupParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupParseError';
  }
}

export function serializeBackup(
  favorites: Station[],
  custom: Station[],
  lists: StationList[] = [],
  now = new Date(),
): string {
  const snap: BackupSnapshot = {
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    favorites,
    custom,
    lists,
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
  if (!SUPPORTED_VERSIONS.includes(version)) {
    throw new BackupParseError(
      `Backup version ${version} isn't supported (expected ${SUPPORTED_VERSIONS.join(' or ')}).`,
    );
  }
  const favorites = sanitizeStations(obj.favorites);
  const custom = sanitizeStations(obj.custom);
  // `lists` arrived in v2; a v1 file simply has none.
  const lists = sanitizeLists(obj.lists);
  return {
    version,
    exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : '',
    favorites,
    custom,
    lists,
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

/** Drop entries that don't look like a StationList, and sanitize each
 *  list's stations. Mirrors `getLists` in lists.ts so an imported file
 *  can never inject a malformed list. */
function sanitizeLists(raw: unknown): StationList[] {
  if (!Array.isArray(raw)) return [];
  const out: StationList[] = [];
  for (const l of raw) {
    if (
      typeof l !== 'object' ||
      l === null ||
      typeof (l as StationList).id !== 'string' ||
      typeof (l as StationList).name !== 'string'
    ) {
      continue;
    }
    const ll = l as StationList;
    out.push({
      id: ll.id,
      name: ll.name,
      stations: sanitizeStations(ll.stations),
      createdAt: typeof ll.createdAt === 'number' ? ll.createdAt : 0,
    });
  }
  return out;
}

/** Merge an imported snapshot with what's already on the device. Union
 *  by id — never overwrites or removes. Incoming entries are appended
 *  AFTER existing ones so the user's current dial order is preserved. */
export function mergeSnapshot(
  existingFavorites: Station[],
  existingCustom: Station[],
  existingLists: StationList[],
  incoming: BackupSnapshot,
): ImportSummary {
  const fav = mergeById(existingFavorites, incoming.favorites);
  const cus = mergeById(existingCustom, incoming.custom);
  const lst = mergeLists(existingLists, incoming.lists);
  return {
    favoritesAdded: fav.added,
    favoritesAlreadyHad: fav.alreadyHad,
    customAdded: cus.added,
    customAlreadyHad: cus.alreadyHad,
    listsAdded: lst.added,
    listsAlreadyHad: lst.alreadyHad,
    mergedFavorites: fav.merged,
    mergedCustom: cus.merged,
    mergedLists: lst.merged,
  };
}

/** Merge lists union-by-id. Lists carry random ids, so a collision means
 *  the same list already exists on this device — we keep the existing one
 *  untouched rather than guessing how to reconcile two divergent edits. */
function mergeLists(
  existing: StationList[],
  incoming: StationList[],
): { merged: StationList[]; added: number; alreadyHad: number } {
  const haveIds = new Set(existing.map((l) => l.id));
  const merged = [...existing];
  let added = 0;
  let alreadyHad = 0;
  for (const l of incoming) {
    if (haveIds.has(l.id)) {
      alreadyHad++;
      continue;
    }
    merged.push(l);
    haveIds.add(l.id);
    added++;
  }
  return { merged, added, alreadyHad };
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
  if (s.listsAdded > 0) parts.push(`${s.listsAdded} list${s.listsAdded === 1 ? '' : 's'}`);
  const alreadyHad = s.favoritesAlreadyHad + s.customAlreadyHad + s.listsAlreadyHad;
  if (parts.length === 0) {
    return alreadyHad > 0
      ? `Already had everything in that backup (${alreadyHad} item${alreadyHad === 1 ? '' : 's'}).`
      : 'That backup is empty.';
  }
  const tail = alreadyHad > 0 ? ` (${alreadyHad} already had).` : '.';
  return `Imported ${joinParts(parts)}${tail}`;
}

/** Oxford-comma-free natural join: "a", "a and b", "a, b and c". */
function joinParts(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
