#!/usr/bin/env node
/**
 * Reads data/genre-art.yaml and writes public/genre-art.json: the
 * pictures on the Browse genre cards, served at
 * https://rrradio.org/genre-art.json.
 *
 * The apps fetch the file, cache the last good copy and fall back to
 * their built-in pictures, so a pick changes with a web deploy instead
 * of an app release. Contract: docs/spec/contracts/genre-art.md.
 *
 * Each genre holds a list of sets; a set is three pictures, hero first.
 * Clients show one set per genre and move to the next every
 * `rotateEveryDays` days (see `rotationIndex`).
 *
 * Music genres link album covers on Apple's artwork servers
 * (`*.mzstatic.com`). Spoken-word genres use photos hosted here in
 * public/genre-art/, each listed with its licence in
 * public/genre-art/SOURCES.md.
 *
 * The build is deterministic (no timestamps), so the committed artifact
 * is reproducible and `npm run check-genre-art` can byte-compare it.
 *
 *   npm run genre-art        — regenerate public/genre-art.json
 *   npm run check-genre-art  — validate + verify the committed JSON
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { GENRES } from '../src/genre-taxonomy.data.mjs';
import { parseImageHeader } from './lib/image-header.mjs';

export const SCHEMA_VERSION = 1;
export const DEFAULT_ROTATION_DAYS = 7;
export const SET_SIZE = 3;
export const PHOTO_MIN_PX = 480;
export const PHOTO_MAX_PX = 600;
export const SITE_HOST = 'rrradio.org';
export const PHOTO_DIR = 'genre-art';

/** Genres with no records to show: their cards use hosted photos. */
export const SPOKEN_GENRES = new Set(['news', 'talk', 'sports', 'public']);

const GENRE_IDS = new Set(GENRES.map((g) => g.id));
const ENTRY_KEYS = new Set(['artist', 'album', 'image']);
const TOP_KEYS = new Set(['schemaVersion', 'rotateEveryDays', 'genres']);

/**
 * Which of `count` sets shows at `unixSeconds`. Periods count from
 * Monday 1970-01-05 00:00 UTC, so with 7 days the set changes every
 * Monday and every device agrees on it. Mirrors the iOS client
 * (`GenreArtStore.rotationIndex`).
 */
export function rotationIndex(unixSeconds, days, count) {
  if (!(count > 1)) return 0;
  const period = Math.max(1, days) * 86400;
  const index = Math.floor((unixSeconds - 4 * 86400) / period) % count;
  return index < 0 ? index + count : index;
}

/** The host rule clients apply: https, rrradio.org or *.mzstatic.com. */
export function imageHost(image) {
  let url;
  try {
    url = new URL(image);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase();
  if (host === SITE_HOST) return 'site';
  if (host.endsWith('.mzstatic.com')) return 'apple';
  return null;
}

/** `https://rrradio.org/genre-art/news-1.jpg` → `news-1.jpg`, else null. */
export function photoFileName(image) {
  const url = new URL(image);
  const m = url.pathname.match(new RegExp(`^/${PHOTO_DIR}/([a-z]+-[1-9][0-9]*\\.jpg)$`));
  return m && !url.search && !url.hash ? m[1] : null;
}

/** File names (`news-1.jpg`) listed in the licence table of SOURCES.md. */
export function licensedPhotos(sourcesMarkdown) {
  const out = new Map();
  for (const line of sourcesMarkdown.split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    const m = cells[1]?.match(/^`([a-z]+-[1-9][0-9]*\.jpg)`$/);
    if (m) out.set(m[1], cells[2] ?? '');
  }
  return out;
}

const ALLOWED_LICENCES = /^(CC0|Public domain)$/;

/**
 * Validate the YAML document and return the publishable payload. Pure:
 * photo facts come in through `photos` (file name → { width, height },
 * as read from public/genre-art/) and `licences` (file name → licence,
 * from SOURCES.md). Pass neither to skip the file checks.
 *
 * @returns {{ payload: object, errors: string[] }}
 */
export function buildGenreArtPayload(doc, { photos, licences } = {}) {
  const errors = [];
  const payload = { schemaVersion: SCHEMA_VERSION, rotateEveryDays: DEFAULT_ROTATION_DAYS, genres: {} };

  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return { payload, errors: ['document must be a map with schemaVersion and genres'] };
  }
  for (const key of Object.keys(doc)) {
    if (!TOP_KEYS.has(key)) errors.push(`unknown top-level key "${key}"`);
  }
  if (doc.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${SCHEMA_VERSION} (got ${JSON.stringify(doc.schemaVersion)})`);
  }
  if (doc.rotateEveryDays !== undefined) {
    if (!Number.isInteger(doc.rotateEveryDays) || doc.rotateEveryDays < 1) {
      errors.push(`rotateEveryDays must be a whole number of days, 1 or more (got ${JSON.stringify(doc.rotateEveryDays)})`);
    } else {
      payload.rotateEveryDays = doc.rotateEveryDays;
    }
  }
  const genres = doc.genres;
  if (!genres || typeof genres !== 'object' || Array.isArray(genres)) {
    errors.push('genres must be a map of genre id → list of sets');
    return { payload, errors };
  }

  const seenImages = new Map(); // image URL → where first used
  const seenAlbums = new Map(); // "artist — album" → where first used

  for (const [genreId, sets] of Object.entries(genres)) {
    if (!GENRE_IDS.has(genreId)) {
      errors.push(`${genreId}: not a catalog genre id (see src/genre-taxonomy.data.mjs)`);
      continue;
    }
    if (!Array.isArray(sets) || sets.length === 0) {
      errors.push(`${genreId}: must be a non-empty list of sets (leave the genre out to keep the built-in pictures)`);
      continue;
    }
    const spoken = SPOKEN_GENRES.has(genreId);
    const outSets = [];
    sets.forEach((set, si) => {
      const at = `${genreId} set ${si + 1}`;
      if (!Array.isArray(set) || set.length !== SET_SIZE) {
        errors.push(`${at}: a set is exactly ${SET_SIZE} entries, hero first`);
        return;
      }
      const outSet = [];
      set.forEach((entry, ei) => {
        const where = `${at} entry ${ei + 1}`;
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          errors.push(`${where}: must be a map with an image`);
          return;
        }
        for (const key of Object.keys(entry)) {
          if (!ENTRY_KEYS.has(key)) errors.push(`${where}: unknown key "${key}"`);
        }
        for (const key of ['artist', 'album']) {
          if (entry[key] !== undefined && (typeof entry[key] !== 'string' || !entry[key].trim())) {
            errors.push(`${where}: ${key} must be a non-empty string when given`);
          }
        }
        if (typeof entry.image !== 'string' || !entry.image) {
          errors.push(`${where}: image is required`);
          return;
        }
        const host = imageHost(entry.image);
        if (!host) {
          errors.push(`${where}: image must be https on ${SITE_HOST} or *.mzstatic.com (${entry.image})`);
          return;
        }
        if (seenImages.has(entry.image)) {
          errors.push(`${where}: image already used at ${seenImages.get(entry.image)} (${entry.image})`);
        } else {
          seenImages.set(entry.image, where);
        }

        if (host === 'apple') {
          if (spoken) errors.push(`${where}: spoken-word genres use photos hosted on ${SITE_HOST}, not album covers`);
          if (typeof entry.artist !== 'string' || typeof entry.album !== 'string') {
            errors.push(`${where}: an album cover needs artist and album`);
          } else {
            const albumKey = `${entry.artist.trim().toLowerCase()} — ${entry.album.trim().toLowerCase()}`;
            if (seenAlbums.has(albumKey)) {
              errors.push(`${where}: album already used at ${seenAlbums.get(albumKey)} (${entry.artist} — ${entry.album})`);
            } else {
              seenAlbums.set(albumKey, where);
            }
          }
        } else {
          // Album covers are never hosted here, only the spoken-word photos.
          if (!spoken) errors.push(`${where}: music genres link album covers on *.mzstatic.com; do not host copies on ${SITE_HOST}`);
          const file = photoFileName(entry.image);
          if (!file) {
            errors.push(`${where}: a hosted photo is https://${SITE_HOST}/${PHOTO_DIR}/<genre>-<n>.jpg (${entry.image})`);
          } else {
            if (spoken && !file.startsWith(`${genreId}-`)) {
              errors.push(`${where}: ${file} is not a ${genreId} photo (name it ${genreId}-<n>.jpg)`);
            }
            if (photos) {
              const dim = photos.get(file);
              if (!dim) {
                errors.push(`${where}: public/${PHOTO_DIR}/${file} does not exist`);
              } else if (dim.width !== dim.height || dim.width < PHOTO_MIN_PX || dim.width > PHOTO_MAX_PX) {
                errors.push(
                  `${where}: ${file} is ${dim.width}×${dim.height}; photos are square, ${PHOTO_MIN_PX} to ${PHOTO_MAX_PX} px`,
                );
              }
            }
            if (licences) {
              const licence = licences.get(file);
              if (licence === undefined) {
                errors.push(`${where}: ${file} has no row in public/${PHOTO_DIR}/SOURCES.md`);
              } else if (!ALLOWED_LICENCES.test(licence)) {
                errors.push(`${where}: ${file} is listed as "${licence}"; photos must be CC0 or Public domain`);
              }
            }
          }
        }

        const out = {};
        if (typeof entry.artist === 'string') out.artist = entry.artist.trim();
        if (typeof entry.album === 'string') out.album = entry.album.trim();
        out.image = entry.image;
        outSet.push(out);
      });
      if (outSet.length === SET_SIZE) outSets.push(outSet);
    });
    if (outSets.length > 0) payload.genres[genreId] = outSets;
  }

  // A photo on disk that no set uses still ships to rrradio.org, so it
  // needs its licence row too.
  if (photos && licences) {
    for (const file of photos.keys()) {
      if (!licences.has(file)) errors.push(`public/${PHOTO_DIR}/${file} has no row in public/${PHOTO_DIR}/SOURCES.md`);
    }
  }

  return { payload, errors };
}

export function serializePayload(payload) {
  return JSON.stringify(payload, null, 2) + '\n';
}

/** Read the photo facts `buildGenreArtPayload` checks against. */
export function readPhotoFacts(root) {
  const dir = join(root, 'public', PHOTO_DIR);
  const photos = new Map();
  if (existsSync(dir)) {
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.jpg')) continue;
      const header = parseImageHeader(readFileSync(join(dir, file)));
      photos.set(file, { width: header?.width ?? 0, height: header?.height ?? 0 });
    }
  }
  const sourcesPath = join(dir, 'SOURCES.md');
  const licences = licensedPhotos(existsSync(sourcesPath) ? readFileSync(sourcesPath, 'utf8') : '');
  return { photos, licences };
}

/** Load data/genre-art.yaml and build the payload with all file checks. */
export function loadGenreArt(root) {
  const doc = parseYaml(readFileSync(join(root, 'data/genre-art.yaml'), 'utf8'));
  return buildGenreArtPayload(doc, readPhotoFacts(root));
}

// ─── CLI ────────────────────────────────────────────────────────────────
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const { payload, errors } = loadGenreArt(root);
  if (errors.length > 0) {
    for (const e of errors) console.error(`build-genre-art: ${e}`);
    console.error(`build-genre-art: ${errors.length} validation error(s), nothing written`);
    process.exit(1);
  }
  const outPath = join(root, 'public/genre-art.json');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, serializePayload(payload));
  const sets = Object.values(payload.genres).reduce((n, s) => n + s.length, 0);
  console.log(`genre-art: ${Object.keys(payload.genres).length} genre(s), ${sets} set(s) → public/genre-art.json`);
}
