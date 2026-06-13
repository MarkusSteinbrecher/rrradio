# Data And Sync Specification

```yaml
status: review
platforms: [web, ios, android]
reconciled-against: d241aa9
```

## Purpose

rrradio has no cross-platform account system today. Each platform owns its
local user data. The web app supports user-initiated backup export/import as a
manual sync/transfer mechanism for selected library data. iOS additionally
ships a versioned settings backup file (export and import) and private
iCloud/CloudKit sync between the user's Apple devices.

This spec defines the **data classes** and **per-platform storage/privacy
boundaries** — what may and must not leave the device, and by which path. The
CloudKit record schema, merge algebra, push timing, and on-disk backup file
format are pinned in [sync-merge](contracts/sync-merge.md); the cross-platform
privacy invariant (every outbound byte, enumerated) is pinned in
[privacy & data boundaries](contracts/privacy-data-boundaries.md). This spec
does not restate either; it links to them.

## Data Classes

| Data | Description | Privacy level |
|---|---|---|
| Favorites | User-selected stations and order. | Private user library. |
| Recents | Recently played stations, capped. | Private local activity. |
| Station lists | Named station collections. | Private user library. |
| Custom stations | User-entered streams and labels. | Private user content. |
| Preferences | Theme, accent, language, landing page, display modes, timer/wake/car defaults, music-service deep-link toggles, AI-blurb toggle, history settings. | Private settings. |
| Wake state | One armed wake-to-radio intent. | Private local intent. |
| Listening history | Optional playback-session history. | Private local activity. |
| Diagnostics | Optional operational events. | Private support data. |
| Catalog cache | Published station catalog. | Public app data. |
| Region cache | Cached GeoIP country for geo-restriction badging. | Private local cache. |
| Backup file | User-exported snapshot for manual transfer. | Private user library. |

## Platform Behavior

| Data | Web | iOS | Android |
|---|---|---|---|
| Favorites | `localStorage`, export/import supported. | Local plus optional CloudKit sync; export/import supported. | Local DataStore. |
| Recents | `localStorage`, capped. | Local-only, capped. | Local DataStore, capped. |
| Station lists | Not planned for current web. | Local plus optional CloudKit sync; export/import supported. | Local DataStore. |
| Custom stations | `localStorage`, export/import supported. | Local plus optional CloudKit sync; export/import supported. | Local DataStore. |
| Preferences | Local browser preferences. | Local plus optional CloudKit sync for the synced preference set; export/import supported. | Local-only for first port. |
| Wake state | Local-only, one armed wake. | Local-only for the active wake intent; wake default-time, notification, and keep-alive preferences sync. | Local-only. |
| Listening history | Not part of current web storage contract. | Local-only, opt-in, retention-controlled; closed sessions sync to the user's own iCloud (never to the backup file). | Local-only, off by default, opt-in. |
| Diagnostics | Anonymous production events only. | Local opt-in diagnostic log. | Local opt-in diagnostic log, capped and exportable. |
| Catalog cache | Browser/runtime cache. | Disk cache and bundled index fallback. | Cache-backed catalog loading; optional search index is deferred. |
| Region cache | `localStorage`, 24h. | Local UserDefaults, 24h, fail-open. | Local cache if implemented. |
| Backup file | Manual export/import for favorites and custom stations. | Versioned JSON export and import (favorites, custom stations, station lists, preferences; no listening history). | Manual export/import for library data and preferences. |

## iCloud And CloudKit

iCloud/CloudKit is an iOS-only feature. The record types, merge algebra,
conflict rules, push/retry timing, silent-push subscription, and
decode-isolation are pinned in [sync-merge](contracts/sync-merge.md); the
privacy classification of what may and may not leave the device is
[privacy & data boundaries](contracts/privacy-data-boundaries.md).

- iCloud sync defaults **on** at first launch and can be turned off in Settings.
- Sync targets the user's **own** private CloudKit database — not an
  rrradio-operated store. No data is shared with rrradio or any third party.
- When CloudKit is unavailable (signed out, restricted, unsigned/simulator
  build, offline), iOS stays local-only. No user-facing feature may require
  iCloud to function.
- The user can remove all synced data from iCloud from Settings; a tombstone
  propagates the removal to the user's other paired devices.

The iOS app syncs:

- Favorites.
- Favorite order.
- Station lists.
- Custom stations.
- Closed listening-history sessions (to the user's own iCloud only; see the
  boundary note below).
- Theme and accent preferences.
- Language preference.
- Landing-page preference, plus the pinned landing station and landing list IDs.
- Favorites display-mode preferences (selected mode, ordered set, visible set).
- Sleep timer default.
- Wake default-time, notification, and keep-alive preferences.
- Car mode preferences (automatic and manual).
- Listening-history preferences (enabled, level, retention).
- Music-service deep-link toggles (Apple Music, Spotify, YouTube Music).
- AI station-blurb toggle.

The iOS app must not sync:

- Recents.
- Diagnostics.
- The one-shot **active** wake intent (only wake *preferences* sync).
- Raw playback errors.
- Search queries.

These five are **structurally absent** from the sync snapshot — there is no
field to carry them — so they can never be synced.

### Listening-history boundary

Listening-history *records* are private but **do sync to the user's own
iCloud** as a single shared blob of closed sessions, so a user sees one history
across their Apple devices. This sync is strictly bounded:

- Only **closed** sessions travel; the active (in-flight) session never leaves
  the device.
- The blob lives only in the user's **own** private CloudKit database — never
  in an exported backup file, never to any rrradio-operated or third-party
  endpoint.
- The opt-in preference gates whether new sessions are *recorded*, not whether
  already-recorded sessions sync; any closed sessions still present upload
  regardless of the current toggle.
- The uploaded blob is trimmed for transport (retention window, record count,
  encoded-byte caps) — local storage keeps everything. See
  [sync-merge](contracts/sync-merge.md) §Listening-history upload bounds.

The three listening-history *preference* fields (enabled / level / retention)
sync in the preferences block, separately from the records.

## Web

The web app has no account or cloud sync, but it does support manual file
export/import:

- No account.
- No CloudKit.
- No automatic cross-device sync.
- Export writes a user-readable backup file.
- Import merges the backup with the current browser library.
- The backup file is the user-controlled sync/transfer mechanism.
- Current backup scope is favorites and custom stations.
- Clearing site data clears the local library.

## iOS Settings Backup File

iOS ships a versioned JSON settings backup, independent of iCloud (it reads and
writes local state only and works with sync off). The file format, version
gate, and restore semantics are pinned in [sync-merge](contracts/sync-merge.md)
§Backup file.

- **Export** writes the current local snapshot (favorites, custom stations,
  station lists, preferences) to a JSON file shared via the OS share sheet;
  suggested file name `rrradio-settings-<yyyy-MM-dd>.json`.
- **Import (restore)** decodes a chosen file and **replaces** favorites, custom
  stations, station lists, and preferences with the backup's contents, then
  pushes the restored state to iCloud like any local edit (when sync is on).
- Listening history is deliberately excluded from the backup file — backups are
  made to be shared and saved outside the app sandbox, and history is private.
- A file made by a newer app version (a higher schema version) is rejected with
  a clear "made with a newer version" message; a non-backup file is rejected
  with "this is not a rrradio settings backup."

## Android

The Android app is local-only:

- No CloudKit.
- No iCloud compatibility layer.
- No account requirement.
- No shared backend.
- Manual backup import/export is a user-controlled transfer path, but it is
  not a substitute for a shared sync backend.
- Favorites, recents, custom stations, and station lists are persisted in
  DataStore today.
- Preferences are currently partly modeled on Android; system/light/dark,
  accent, landing page, Favorites display mode, sleep default, history, and
  diagnostics preferences are local DataStore data. Language, custom accent,
  wake, and car-surface preferences remain separate parity work.
- Listening history remains off by default and does not sync.
- Diagnostics remain off by default, are capped locally, and export only when
  the user explicitly requests it.
- Data should be structured so a future sync backend can be added without
  rewriting feature logic.

Android storage should use stable schema versions for user data. Prefer a
simple local model first; introduce Room only when the feature set needs
queryable history, more complex list management, or catalog search.

## Android Backup File

Android backup files are JSON with `schemaVersion: 1`, `platform: "android"`,
`exportedAt`, and these top-level data sets:

- `favorites`
- `customStations`
- `stationLists`
- `preferences`

The `preferences` object currently stores theme, accent, landing page,
Favorites display mode, sleep default, listening-history preference, and
diagnostics preference. Import merges favorites, custom stations, and station
lists by id, then applies included preferences.

Android backup files intentionally exclude recents, listening-history records,
diagnostic log entries, active wake state, raw playback errors, and any
automatic account/cloud state.

## Future Cross-Platform Sync

Cross-platform sync requires a new product and architecture decision. It should
not be implied by the Android port.

A future sync ADR must decide:

- Whether rrradio remains accountless.
- Whether sync is optional or required.
- Where user data is stored.
- How conflicts merge across web, iOS, and Android.
- What data classes are excluded for privacy.
- How users can delete all remote data.
- Whether iCloud remains iOS-only or becomes a migration source.

Until that ADR exists, web and Android have no automatic account/cloud sync.
Web still has manual file export/import, and iOS CloudKit sync remains
Apple-device-only.

## Platform Matrix

| Behavior | Web | iOS | Android |
|---|---|---|---|
| Library data local-first, private by default | Supported | Reference | Planned |
| Optional cloud sync to the user's own account | Not planned | Reference | Not planned (Apple-only) |
| iCloud sync defaults on, removable from Settings | Not planned | Reference | Not planned |
| Sync degrades to local-only when account unavailable | Not planned | Reference | Not planned |
| Listening-history records sync to user's own iCloud only | Not planned | Reference | Not planned |
| Listening-history records excluded from backup file | Supported (no history) | Reference | Supported |
| Recents / diagnostics / active wake intent never synced | Supported | Reference | Planned |
| Versioned settings backup export | Partial (favorites + custom only) | Reference | Planned |
| Settings backup import (restore replaces live library) | Partial (import merges) | Reference | Planned |
| Region/GeoIP cache, 24h, fail-open | Supported | Reference | Planned |
| Catalog cache with bundled fallback | Supported | Reference | Partial |

## Open questions

1. **Backup restore vs. import semantics.** iOS backup restore **replaces** the
   live library wholesale; web/Android backup import **merges** by id (imported
   copy wins on collision). These should be reconciled to one cross-platform
   intent (replace-on-restore vs. union-on-import). Tracked in
   [sync-merge](contracts/sync-merge.md) §Open questions.
2. **Backup scope parity.** Web exports only favorites and custom stations; iOS
   and Android also carry station lists and preferences. Decide the canonical
   backup scope across platforms.
3. **Future shared backend.** Whether a future account-based cross-platform sync
   reuses the iOS record schema or defines its own wire format is deferred to
   the cross-platform sync ADR above.

## Reference

iOS source (the only place iOS mechanics are named):

- `rrradio/CloudSync/CloudSyncController.swift` — sync enable/disable (default on),
  pull/merge/push cycle, settings-backup encode/restore, remove-all-cloud-data.
- `rrradio/CloudSync/CloudSyncStore.swift` — CloudKit record types/names, save
  plan, fetch, silent-push subscription, container `iCloud.ios.rrradio.org`.
- `rrradio/CloudSync/CloudSyncSnapshot.swift` — the synced snapshot schema, the
  merge algebra, and listening-history upload bounds.
- `rrradio/CloudSync/SettingsBackup.swift` — the on-disk backup file schema,
  version gate, encode/decode, suggested file name.
- `rrradio/Views/SettingsView.swift` — iCloud toggle, remove-all-cloud-data,
  backup export (share sheet) and import (file importer) UI.
- `rrradio/Models/RegionResolver.swift` — GeoIP region cache
  (`rrradio.region.v1`, 24h, fail-open) for geo-restriction badging.

The CloudKit record schema, merge algebra, push timing, and backup file format
are specified in [sync-merge](contracts/sync-merge.md); the outbound-data
boundary (including the region cache and the iCloud row) in
[privacy & data boundaries](contracts/privacy-data-boundaries.md).

## Known deviations

- The decode-failure → data-loss cascade in the CloudKit merge and the binary
  pending-preferences flag are tracked in [sync-merge](contracts/sync-merge.md)
  §Known deviations (slice10 §C1 fixed, §C7 open). This spec states the intended
  data-class boundaries; the contract owns the merge-level deviations.
