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
 * Versioning: v1 carried favorites + custom only. v2 added `lists`. v3
 * adds `recents` + `settings` (theme, layout, music-service toggles,
 * library section). We read all three — older files import with the new
 * fields empty — and always write v3.
 */

import type { Station } from './types';
import type { StationList } from './lists';

export const BACKUP_VERSION = 3;
const SUPPORTED_VERSIONS = [1, 2, 3];

/** App settings captured in a backup. Every field is optional so a
 *  partial or older file imports cleanly; restore only touches the keys
 *  a file actually carries. */
export interface BackupSettings {
  theme?: 'light' | 'dark';
  landing?: string;
  musicServices?: { apple?: boolean; spotify?: boolean; youtube?: boolean };
  sidebarCollapsed?: boolean;
  browseCollapsed?: boolean;
}

export interface BackupSnapshot {
  version: number;
  exportedAt: string;
  favorites: Station[];
  custom: Station[];
  lists: StationList[];
  recents: Station[];
  settings: BackupSettings;
}

export interface ImportSummary {
  favoritesAdded: number;
  favoritesAlreadyHad: number;
  customAdded: number;
  customAlreadyHad: number;
  listsAdded: number;
  listsAlreadyHad: number;
  recentsAdded: number;
  recentsAlreadyHad: number;
  /** How many settings keys the imported file carried (and will apply). */
  settingsApplied: number;
  /** Snapshots of the merged collections, ready to write back to storage. */
  mergedFavorites: Station[];
  mergedCustom: Station[];
  mergedLists: StationList[];
  mergedRecents: Station[];
  /** Sanitized incoming settings — restore overwrites the keys present. */
  mergedSettings: BackupSettings;
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
  recents: Station[] = [],
  settings: BackupSettings = {},
  now = new Date(),
): string {
  const snap: BackupSnapshot = {
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    favorites,
    custom,
    lists,
    recents,
    settings,
  };
  return JSON.stringify(snap, null, 2);
}

/** YYYY-MM-DD slice for filenames (consistent across timezones — uses
 *  the user's local date so it matches what they'd type). */
export function backupFilename(now = new Date()): string {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `rrradio-backup-${yyyy}-${mm}-${dd}.json`;
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
  // `lists` arrived in v2; `recents` + `settings` in v3. Older files
  // simply yield empty values for the fields they predate.
  const lists = sanitizeLists(obj.lists);
  const recents = sanitizeStations(obj.recents);
  const settings = sanitizeSettings(obj.settings);
  return {
    version,
    exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : '',
    favorites,
    custom,
    lists,
    recents,
    settings,
  };
}

/** Whitelist the known settings keys + validate each type, so an
 *  imported file can never inject an unexpected or malformed setting.
 *  Anything off-list or wrong-typed is silently dropped. */
function sanitizeSettings(raw: unknown): BackupSettings {
  if (typeof raw !== 'object' || raw === null) return {};
  const r = raw as Record<string, unknown>;
  const out: BackupSettings = {};
  if (r.theme === 'light' || r.theme === 'dark') out.theme = r.theme;
  if (typeof r.landing === 'string') out.landing = r.landing;
  if (typeof r.sidebarCollapsed === 'boolean') out.sidebarCollapsed = r.sidebarCollapsed;
  if (typeof r.browseCollapsed === 'boolean') out.browseCollapsed = r.browseCollapsed;
  if (typeof r.musicServices === 'object' && r.musicServices !== null) {
    const ms = r.musicServices as Record<string, unknown>;
    const picked: { apple?: boolean; spotify?: boolean; youtube?: boolean } = {};
    if (typeof ms.apple === 'boolean') picked.apple = ms.apple;
    if (typeof ms.spotify === 'boolean') picked.spotify = ms.spotify;
    if (typeof ms.youtube === 'boolean') picked.youtube = ms.youtube;
    if (Object.keys(picked).length > 0) out.musicServices = picked;
  }
  return out;
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
  existingRecents: Station[],
  incoming: BackupSnapshot,
): ImportSummary {
  const fav = mergeById(existingFavorites, incoming.favorites);
  const cus = mergeById(existingCustom, incoming.custom);
  const lst = mergeLists(existingLists, incoming.lists);
  const rec = mergeById(existingRecents, incoming.recents);
  return {
    favoritesAdded: fav.added,
    favoritesAlreadyHad: fav.alreadyHad,
    customAdded: cus.added,
    customAlreadyHad: cus.alreadyHad,
    listsAdded: lst.added,
    listsAlreadyHad: lst.alreadyHad,
    recentsAdded: rec.added,
    recentsAlreadyHad: rec.alreadyHad,
    // Settings are singular values: a restore overwrites whatever keys the
    // file carries (sanitized), leaving keys it omits untouched.
    settingsApplied: Object.keys(incoming.settings).length,
    mergedFavorites: fav.merged,
    mergedCustom: cus.merged,
    mergedLists: lst.merged,
    mergedRecents: rec.merged,
    mergedSettings: incoming.settings,
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
  if (s.recentsAdded > 0) parts.push(`${s.recentsAdded} recent${s.recentsAdded === 1 ? '' : 's'}`);
  if (s.settingsApplied > 0) parts.push('settings');
  const alreadyHad =
    s.favoritesAlreadyHad + s.customAlreadyHad + s.listsAlreadyHad + s.recentsAlreadyHad;
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
