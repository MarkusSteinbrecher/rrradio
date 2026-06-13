# Library Sync & Merge Contract
```yaml
status: review
platforms: [ios]
reconciled-against: d241aa9
```

## Purpose

Pins down how the iOS app reconciles a device's local library/preferences with
the user's iCloud (CloudKit private database) so two Apple devices converge on
the same state without losing user data. This is an **iOS-only** sync path.

- The *transport* (CloudKit record schema, push debounce, retry, silent-push
  subscription) is iOS-only and nothing else implements it.
- The *merge algebra* (union of favorites, remote-order-wins, custom-station
  conflict rule, preference last-write) is the reusable invariant. Web and
  Android are **local-only** (no account, no cloud) and reuse the same merge
  semantics when they merge a user-initiated **backup file** into the live
  library. See [data-sync.md](../data-sync.md) for the data-class privacy
  boundaries (what may and must not sync) — this contract does not restate them.
- iOS also ships a **settings backup file** (a versioned JSON document holding
  the same favorites / custom stations / station lists / preferences the cloud
  snapshot carries, **but never listening history** — backups are made to be
  shared outside the sandbox). It works with iCloud sync off. **Restore replaces**
  the live library wholesale (the backup's index flags are authoritative — it is
  a replace, not the union merge), then pushes the restored state to iCloud like
  any local edit. See Backup file below.
- Cross-platform account sync is **not planned**. A future shared backend
  requires its own ADR (tracked in [data-sync.md](../data-sync.md) §Future
  Cross-Platform Sync). This contract is the iOS reference and the local-merge
  reference; it is not a cross-device wire protocol for web/Android.

## Definition

### Record types (CloudKit private database)

The synced state is **not** one blob. It is a set of records keyed by stable
record names. Per-entry records hold an opaque JSON blob; index records hold the
authoritative id ordering.

| Record type | Record name(s) | Holds |
|---|---|---|
| `Favorite` | `favorite-<sha256(stationId)>` | one favorite station blob |
| `FavoritesOrder` | `favorites-order` (singleton) | authoritative ordered favorite ids |
| `CustomStation` | `custom-<sha256(stationId)>` | one custom station blob |
| `CustomStationsIndex` | `custom-stations-index` (singleton) | authoritative custom-station ids |
| `StationList` | `station-list-<sha256(listId)>` | one station-list blob |
| `StationListsIndex` | `station-lists-index` (singleton) | authoritative station-list ids |
| `Preferences` | `preferences` (singleton) | all synced preference fields |
| `ListeningHistory` | `listening-history` (singleton) | one blob of all shared closed listening-history sessions |
| `SyncState` | `sync-state` (singleton) | `resetAt` deletion tombstone |

- Per-entry record id = `"<prefix>-" + hex(SHA256(utf8(id)))`. Hashing keeps long
  / unusual station ids inside CloudKit record-name limits.
- A station/list blob is `JSONEncoder().encode(...)` of the model, stored in the
  `stationData` / `listData` field.
- The **index record is authoritative for membership and order**: an id present
  in the index but with no decodable per-entry record is "unresolved" (see
  Failure & fallback), not a deletion.

### Sync cycle (state machine)

`DiagnosticState`: `idle → checking → {emptyRemote | restored | synced | pushed
| resetApplied | removedCloudData | unavailable | failed}`.

Two operations drive a cycle. Only one runs at a time (`isSyncing` guard);
requests that arrive mid-cycle are coalesced and re-fired in `finishSync`.

1. **Pull + merge + push** (`refreshFromCloud`) — on launch, on enable, and on
   every silent remote-change notification:
   - Check account status. If not `available`, end as `unavailable`.
   - Fetch remote snapshot (all record types in parallel).
   - If a `resetAt` tombstone applies (see Failure & fallback), apply empty and
     end `resetApplied`.
   - If remote is empty AND local has no user payload AND no pending preferences
     push, end `emptyRemote` (nothing written).
   - Else `merged = CloudSyncMerge.merged(local, remote, preferLocalPreferences)`,
     apply merged to live state, then save the (bounded — see Listening-history
     bounds) local snapshot back to cloud to ratify the merge. End `synced`
     (local had payload) or `restored` (it did not).
   - Applying merged state to live also reconciles the player: a station blob
     changed on another device replaces that station everywhere it appears in
     the active playback queue, and a station removed on another device is
     removed from the active queue.
2. **Push** (`pushLocalSnapshot`) — a debounced write of the local snapshot only
   (listening history bounded for upload first). Triggered by a local library /
   preferences / listening-history change. End `pushed`.

### Merge algebra (`CloudSyncMerge.merged`)

Stated per data class. `local` = this device's snapshot; `remote` = fetched
snapshot.

| Data class | Rule |
|---|---|
| **Favorites** | Authoritative-remote when `remote.hasFavoritesOrder`: result = remote favorites, then any unresolved id's local copy appended, then **reordered by `remote.favoritesOrder`** (ids not in the order list trail in merged order). When remote has no order index: union by id, remote blob wins on id collision, local-only ids appended. |
| **Custom stations** | Authoritative-remote when `remote.hasCustomStationsIndex`: result = remote list + unresolved-id local fallbacks. Otherwise union by id with **remote-wins on collision** (`mergeStations`), local-only appended. |
| **Station lists** | Authoritative-remote when `remote.hasStationListsIndex`: result = remote list + unresolved-id local fallbacks. Otherwise union by id with **remote-wins (remote first, then local-only)**. |
| **Preferences** | All-or-nothing block. `useRemotePreferences = remote.hasPreferences && !preferLocalPreferences`. When true, every preference field takes the remote value; when false, every field keeps local. (One exception: `sleepTimerDefaultMinutes` takes remote only if `remote > 0`.) `preferLocalPreferences` is set when this device has a queued, not-yet-pushed local preference edit. |
| **Listening history** | Union of both devices' **closed** sessions, keyed by `station id + whole-second start` (a session's local record id — a per-device random UUID — is ignored). Local wins on a key collision (it may carry back-filled artwork). **Open (in-flight) sessions are never shared.** Result is sorted chronological ascending. The union is idempotent — re-merging the same sets never duplicates. Unconditional (not gated by `useRemotePreferences`). |
| **Index flags** | `hasFavoritesOrder/hasCustomStationsIndex/hasStationListsIndex/hasPreferences` in merged output = local OR remote (sticky). |
| **`favoritesOrder`** in merged output | = `remote.favoritesOrder` verbatim. |
| **`resetAt`** in merged output | = `remote.resetAt`. |

Recents / diagnostics / active wake intents are **absent from the snapshot
entirely** — they have no field, so they are never synced (enforced
structurally, not by filter). **Listening-history records do sync** (see the
Listening-history rules below); they are the one privacy-sensitive class carried
in the snapshot. The opt-in preference gates whether new sessions are *recorded*,
not whether already-recorded sessions sync — any closed sessions still present
upload regardless of the current toggle. See [data-sync.md](../data-sync.md).

### Listening history (cross-device sessions)

- Only **closed** sessions sync; the active (open) session never leaves the
  device. They travel as **one shared blob record** (`listening-history`), not
  one record per session.
- Pull merges the remote blob into local with the union rule above. The blob is
  re-written on push only when its content actually changed (UUID-insensitive
  comparison) so a steady state doesn't re-save every cycle and bounce silent
  pushes between devices.
- The synced *records* are distinct from the three listening-history *preference*
  fields (enabled / level / retention), which sync in the Preferences block.

### Push timing

| Knob | Value | Meaning |
|---|---|---|
| Push debounce | 750 ms (`750_000_000` ns) | Coalesce a burst of local edits into one push. |
| Retry base | 5 s (`5_000_000_000` ns) | First retry delay after a retryable push failure. |
| Backoff | exponential `base × 2^(attempt-1)`, capped 60 s | Per-attempt deferred-push delay. |
| Max retries | 3 | After which the pending push is **suspended** (kept dirty, retried on next external trigger), not dropped. |

### Listening-history upload bounds

The shared listening-history blob is trimmed **for upload only** (local storage
keeps everything per the user's retention setting). Before each push:

| Cap | Value | Meaning |
|---|---|---|
| Retention window | per `listeningHistoryRetention` | Sessions older than the cutoff are excluded from the upload. |
| Max records | 2000 | Hard ceiling independent of retention so `forever` can't grow the blob without bound; keeps the most-recent. |
| Max encoded bytes | 800 000 | Safety net under CloudKit's ~1 MB per-record limit; oldest sessions dropped until the encoded blob fits. |

Dropped-session counts are logged to diagnostics; nothing local is touched.

### Silent push (`CKDatabaseSubscription`)

- A single `CKDatabaseSubscription` id `rrradio.private-db-changes.v1` is
  installed idempotently in the private database.
- `NotificationInfo.shouldSendContentAvailable = true` → silent push (no alert,
  no badge, no sound). It only wakes the app to pull.
- On delivery the app calls `handleRemoteChangeNotification` → `refreshFromCloud`
  (coalesced if a sync is already running).
- The subscription's existence is **verified server-side once per app session**
  (and re-attempted on each foreground refresh until it succeeds). The check
  deliberately does **not** trust any persisted "installed" flag: CloudKit
  Development and Production are separate databases, and a flag would survive the
  dev→prod transition and skip creating the Production subscription. The
  existence check is idempotent and cheap, so it self-heals across environments.

## Detail

### `Preferences` record fields (the synced preference set)

`schemaVersion` (Int, current = **1**) and `updatedAt` (Date) plus:

| Field | Type | Default (no remote record) | Meaning |
|---|---|---|---|
| `theme` | String | `system` | Theme choice. |
| `themeAccent` | String | classic accent raw value | Accent color. |
| `locale` | String | `system` | Language choice. |
| `sleepTimerDefaultMinutes` | Int | `SleepTimer.fallbackDefaultMinutes` | Default sleep duration; remote applied only if `> 0`. |
| `landingPage` | String | `browse` | Launch landing surface. |
| `landingStationID` | String | `""` | Pinned launch station. |
| `landingStationListID` | String | `""` | Pinned launch list. |
| `favoritesDisplayMode` | String | `list` | Favorites display mode selection. |
| `favoritesDisplayModeOrder` | String | default raw value | Ordered display-mode set. |
| `favoritesDisplayModeVisible` | String | default raw value | Visible display-mode set. |
| `wakeDefaultTime` | String | `WakeAlarm.fallbackDefaultTime` | Wake-to-radio default time. |
| `wakeNotificationsEnabled` | Bool | `WakeAlarm.defaultNotificationsEnabled` | Wake notification opt-in. |
| `wakeKeepAliveEnabled` | Bool | `WakeAlarm.defaultKeepAliveEnabled` | Wake keep-alive opt-in. |
| `carModeAutomaticEnabled` | Bool | `true` | Auto car mode. |
| `carModeManualEnabled` | Bool | `false` | Manual car mode. |
| `listeningHistoryEnabled` | Bool | `false` | History opt-in. |
| `listeningHistoryLevel` | String | `stations` | History granularity. |
| `listeningHistoryRetention` | String | `days90` | History retention window. |
| `appleMusicEnabled` | Bool | `true` | Apple Music deep-link offered. |
| `spotifyEnabled` | Bool | `true` | Spotify deep-link offered. |
| `youtubeMusicEnabled` | Bool | `true` | YouTube Music deep-link offered. |
| `aiBlurbsEnabled` | Bool | `false` | AI station blurbs. |

Note: the active wake **intent** is not synced; only the wake *preferences*
above sync. The three listening-history *preference* fields above (enabled /
level / retention) sync here; the history *records* themselves sync separately
through the `ListeningHistory` blob (see Listening history above), not in this
Preferences block. (See [data-sync.md](../data-sync.md).)

### Per-entry / index records

| Record | Key field(s) | Notes |
|---|---|---|
| `Favorite` | `stationId` (String), `stationData` (Data), `addedAt` (Date, set once) | Re-saved only when blob changed. |
| `CustomStation` | `stationId`, `stationData` | Re-saved only when blob changed. |
| `StationList` | `listId`, `listData` | Re-saved only when blob changed. |
| `FavoritesOrder` | `stationIds` (String array) | Authoritative order. |
| `CustomStationsIndex` | `stationIds` (String array) | Authoritative membership. |
| `StationListsIndex` | `listIds` (String array) | Authoritative membership. |
| `ListeningHistory` | `records` (Data, ISO-8601 JSON array), `updatedAt` (Date), `count` (Int) | One shared blob of all closed sessions. Empty set → record deleted; unchanged content → not re-written. |
| `SyncState` | `resetAt` (Date) | Deletion tombstone for "remove all cloud data". |

### Local sync flags (`UserDefaults`)

| Key | Meaning |
|---|---|
| `rrradio.icloudSync.enabled.v1` | Sync on/off (defaults **on** at first launch). |
| `rrradio.icloudSync.pendingPreferencesPush.v1` | A local preference edit awaits push → forces `preferLocalPreferences` on next merge. |
| `rrradio.icloudSync.resetAcknowledgedAt.v1` | Last `resetAt` this device has honored. |

### Backup file (iOS, on-disk)

A versioned JSON document the user can export, share, and restore independently
of iCloud (works with sync off — it reads/writes local state only).

| Field | Meaning |
|---|---|
| `version` | Current **1**; reading rejects any file with `version > 1` with a "made with a newer version" message rather than half-decoding. |
| `exportedAt`, `appVersion` | Provenance stamps. |
| `favorites`, `customStations`, `stationLists`, `preferences` | Same data the cloud snapshot carries. **Listening history is deliberately omitted.** |

- Export reads the current local snapshot; suggested file name
  `rrradio-settings-<yyyy-MM-dd>.json`.
- Restore decodes the file, **replaces** favorites / custom stations / station
  lists / preferences live (the backup's index flags are authoritative — restore
  replaces, it does not union), then schedules one push so the restored state
  propagates to iCloud when sync is on.
- A malformed (non-backup) file fails with "this is not a rrradio settings
  backup."

## Examples

### Favorite record (saved)

```
recordType: "Favorite"
recordID.recordName: "favorite-<sha256(stationId)>"
fields:
  stationId:   "soma-groovesalad"
  stationData: <JSON-encoded Station blob>
  addedAt:     2026-05-31T08:12:00Z      # written once, never overwritten
```

### FavoritesOrder record (authoritative order)

```
recordType: "FavoritesOrder"
recordID.recordName: "favorites-order"
fields:
  stationIds: ["soma-groovesalad", "fip", "byte-fm"]
```

### Favorites merge (remote-order-wins)

```
local:  [byte-fm, soma-groovesalad]          (no local order index)
remote: favorites=[soma-groovesalad, fip], favoritesOrder=["soma-groovesalad","fip"], hasFavoritesOrder=true
merged: [soma-groovesalad, fip, byte-fm]
        # remote+order authoritative; local-only byte-fm appended after the ordered ids
```

### Custom-station conflict (remote-wins, non-authoritative branch)

```
local:  [{id:"x", name:"Old"}]
remote: customStations=[{id:"x", name:"New"}], hasCustomStationsIndex=false
merged: [{id:"x", name:"New"}]               # same id → remote blob replaces local
```

### Preference merge (block, last-write-by-flag)

```
remote.hasPreferences = true, preferLocalPreferences = false
=> useRemotePreferences = true
=> merged takes ALL preference fields from remote
   (except sleepTimerDefaultMinutes, which takes remote only if remote > 0)
```

### Listening-history merge (union by station+second, local-wins, open dropped)

```
local:  [ {st:"fip",  start:100, artwork:"A"}, {st:"soma", start:300, OPEN} ]
remote: [ {st:"fip",  start:100, artwork:nil}, {st:"byte", start:200} ]
merged: [ {st:"fip",  start:100, artwork:"A"},      # local wins on key collision
          {st:"byte", start:200} ]                  # remote-only session added
        # soma@300 is open → never shared; result sorted by start ascending
```

### Reset tombstone

```
removeAllCloudData():
  save SyncState{resetAt: now}; delete all Favorite/CustomStation/StationList
  + the three index records + Preferences + the ListeningHistory blob;
  clear local listening history; end removedCloudData.
Other device on next refresh: resetAt > resetAcknowledgedAt and no payload
  beyond the tombstone => apply empty locally, clear local listening history,
  acknowledge resetAt, end resetApplied.
```

## Versioning & evolution

- `Preferences.schemaVersion` is the only explicit version field (current **1**).
  A device only treats a remote `Preferences` record as "matching local"
  (skip-rewrite) when `schemaVersion == 1`; a different version forces a
  re-save, so a newer device's preferences are overwritten by an older device
  that does not understand them. There is **no per-record version on
  station/list/favorite blobs.**
- Per-entry blobs are forward/backward compatible only insofar as `Station` /
  `StationList` `Codable` stays compatible. Adding a required field breaks decode
  of every existing blob (see Failure & fallback and Known deviations).
- Index records and per-entry records are decoupled, so a schema change to one
  blob type does not require migrating the others.
- The subscription id carries a `.v1` suffix; bumping it forces re-creation
  against a new configuration.
- Migration policy: no automatic blob migration exists. The "save back the merge"
  step (re-saving the bounded local snapshot) re-encodes any decodable blob with
  the current encoder, which heals stale-but-decodable records opportunistically.
- The `ListeningHistory` blob carries no `schemaVersion`; it round-trips through
  `ListeningHistoryRecord` `Codable` (ISO-8601 dates). Two devices that
  independently logged the same session hold different local record ids but
  identical content; the change-detection that gates a re-write is
  **id-insensitive**, so the blob does not ping-pong as each device re-asserts
  its own ids.

## Failure & fallback

| Condition | Behavior |
|---|---|
| iCloud account not available (`noAccount`/`restricted`/`couldNotDetermine`/`temporarilyUnavailable`) | End `unavailable`; **local data untouched**; no user feature requires iCloud. |
| Sync disabled | `unavailable("iCloud sync is off for rrradio.")`; subscription registration skipped. |
| Unsigned / simulator build | `UnavailableCloudSyncStore` throws on every op; stays local-only. |
| Remote empty + local empty + no pending prefs | `emptyRemote`; nothing written. |
| Per-entry blob fails to decode (or record missing) but its id is in the index | Id reported as **unresolved**; `preservingUnresolved` keeps the **local** copy for that id. One bad record does not wipe the entry and does not stall the rest of the sync; if no local copy exists the id is simply absent until a good blob arrives. The post-merge save re-writes the preserved local blob, self-healing the record. |
| Id removed from the index (genuine deletion) | Id is **not** flagged unresolved → deletion propagates: entry removed locally and stale per-entry records deleted on next save. |
| Whole-record fetch failure (non-`unknownItem`, or expected id absent from the batch result) | `fetchRecords` throws `CloudSyncRecordFetchError`; cycle ends `failed`; **nothing applied or saved** (fail-closed). |
| Partial save (CloudKit accepts some records, rejects others) | `CloudSyncPartialModifyError`; push marked failed → retry (it is a retryable error). Save is **non-atomic** (`atomically: false`); failed ids are reported. |
| Retryable push error (CloudKit transient, partial-modify) | Exponential backoff, max 3 retries, then suspended (kept dirty). |
| Non-retryable push error (`notAuthenticated`, `permissionFailure`, `quotaExceeded`, unavailable, fetch error) | No retry; pending push suspended; surfaces as `failed`. |
| Stale `resetAt` tombstone with payload still present | Tombstone ignored, acknowledged, sync continues (treats it as a superseded reset). |
| Listening-history blob missing or fails to decode | Treated as **no remote sessions** (empty), not a wipe; the local union is additive, so local sessions survive. |
| Listening-history blob exceeds caps (count / encoded bytes / retention) | Trimmed for upload oldest-first (see Listening-history upload bounds); **local storage keeps everything**; dropped count logged. |
| Concurrent request during a running cycle | Coalesced: a pending reset, pending remote-refresh, or pending push is re-fired once the current cycle finishes (`finishSync`). |

All errors are sanitized before surfacing: no stack traces, no PII; record names
and CKError codes only.

## Platform obligations

| # | Web | iOS | Android |
|---|---|---|---|
| 1 | Local-only; no CloudKit, no account, no automatic cross-device sync. | Implements the full CloudKit sync above. | Local-only; no CloudKit, no account. |
| 2 | Backup covers **favorites + custom stations only** (no station lists, no preferences, no listening history). Import is a **union by id** — but the algebra **diverges from this contract**: the **existing local copy wins on id collision** (incoming is skipped, counted as "already had", never overwriting) and incoming entries are **appended after** existing ones (current order preserved). Decode-shape failures drop only the malformed *imported* entry, never a local one. | Honor the cloud merge algebra exactly so two iOS devices converge. (Note: iOS **backup-file restore replaces** rather than unions — see Open questions.) | **Supported** via a versioned JSON backup file written/read through the Storage Access Framework (SAF `CreateDocument`/`OpenDocument`, `application/json`, suggested name `rrradio-android-backup.json`) — the native analog of iOS's file export. The backup is **broader than web**: it carries favorites, custom stations, **station lists, and preferences** (theme / accent / landing page / favorites display mode / sleep default / listening-history *preference* / diagnostics-enabled), but **never listening-history records**. Import is a **union by id but with the opposite collision rule to web/this contract**: imported entries are placed **first** and dedupe keeps the first occurrence, so the **incoming copy wins on id collision** and incoming entries sit **before** existing ones. Station lists union the same way (imported list-id wins, local-only lists appended); each non-null imported preference field overwrites the local value. A malformed file aborts the whole import before any write (surfaced as "Could not import that backup file.") — so no per-entry decode isolation, but local data is never wiped. Version-gated: a file whose `schemaVersion` exceeds the current schema (**1**) is rejected. Planned toward parity: align the collision rule and decode-shape isolation with this contract's intent. |
| 3 | Never require cloud to function. | Degrade to local-only when iCloud is unavailable; no feature blocks on it. | Never require cloud to function. |
| 4 | Treat recents, diagnostics, and active wake intent as non-syncable; **backup/export files must exclude listening-history records** per [data-sync.md](../data-sync.md). | Recents / diagnostics / active wake intent absent from snapshot (structural). Listening-history **records** sync to iCloud (one shared blob) but are **excluded from the exported backup file**. | Same exclusions; no cloud sync at all (local-only). Listening history is recorded locally (opt-in) but **excluded from the backup file** (only the history *preference* is carried). Diagnostics export through a separate SAF JSON file, never the library backup. |
| 5 | Decode failure on import must not wipe surviving local entries — keep local on un-decodable id. | Keep local copy for unresolved ids; never let a single bad blob wipe or stall. | **Honored at the file level**: an undecodable backup aborts the import before any write, so local data is untouched; a malformed *live* store reads back as empty without crashing. **Per-entry decode isolation is not yet implemented** — a single bad station inside an otherwise-valid file fails the whole decode rather than dropping just that entry. Planned toward parity. |
| 6 | No user-initiated "remove all" data command exists today (favorites/custom are removed per-item only; clearing site data is the browser's own control) — Planned. Any future "remove all" would act over local/backup data only. | Provide "remove all iCloud data" via the `resetAt` tombstone; other devices honor it. | **Planned.** No wholesale "remove all" command exists today — only per-item removal (custom stations, station lists) and scoped clears (listening history, diagnostics). A future "remove all" acts over local data only (there is no cloud to tombstone). |

## Open questions

1. **Per-blob record versioning + decode isolation.** Station/list/favorite
   blobs carry no `schemaVersion`. A `schemaVersion` on each per-entry record
   (mirroring `Preferences.schemaVersion`) would let a reader distinguish
   "forward-schema, keep as-is" from "corrupt, drop" instead of inferring it
   from decode-nil. Proposed rule: each per-entry record stamps
   `schemaVersion`; a reader that sees a *higher* version treats the id as
   **unresolved/keep-local** (never a deletion, never a re-save that would
   downgrade the blob), and only a same-or-lower version that fails to decode is
   treated as corrupt. This isolates a forward-schema record written by a newer
   device from being silently dropped by an older one and prevents the older
   device from overwriting it on save-back.
2. Per-field preference dirty-tracking vs. the single binary
   `pendingPreferencesPush` flag (see Known deviations C7) — should each
   preference field merge independently?
3. Does a future shared backend (web/Android account sync) reuse this record
   schema, or define its own wire format? Deferred to the cross-platform sync
   ADR in [data-sync.md](../data-sync.md).
4. **Listening-history sync vs. the data-sync privacy boundary.**
   [data-sync.md](../data-sync.md) currently states listening history "does not
   sync" and lists listening-history *records* among non-syncable classes. At
   d241aa9 iOS **does** sync closed listening-history records to the user's own
   private CloudKit database (never to a backup file, never to a shared/third
   party). data-sync.md should be reconciled to draw the boundary as
   *private-iCloud-sync-allowed, backup-export-excluded* for history records.
5. **Backup-restore semantics diverge from the contract's backup-import rule.**
   Platform obligation #2 says a backup import should **union** (imported copy
   wins on id collision). iOS's own backup restore instead **replaces** the live
   library wholesale (the backup's index flags are authoritative). "Restore a
   backup" arguably *should* replace, but web/Android are told to union — the two
   should be reconciled to one cross-platform intent (replace-on-restore vs.
   union-on-import).

## Reference

- **Related contracts:** [catalog-schema](catalog-schema.md) — shares the
  per-record decode-failure → data-loss cascade (sync-merge C1 ↔ catalog-schema's
  atomic-decode open question); the `Station`/`StationList` blobs synced here
  decode against that schema.
- `rrradio/CloudSync/CloudSyncController.swift` — sync cycle, debounce, retry/
  backoff, subscription registration, reset acknowledgement, apply-to-live.
- `rrradio/CloudSync/CloudSyncStore.swift` — `CloudSyncStoring`, `CloudKitSyncStore`
  (record types/names, save plan, fetch, subscription), `CloudSyncPreferencesSchema`,
  the unavailable/partial/fetch error types.
- `rrradio/CloudSync/CloudSyncSnapshot.swift` — `CloudSyncSnapshot` schema, the
  `CloudSyncMerge` algebra (`mergeFavorites`/`mergeStations`/`mergeStationLists`/
  `mergeListeningHistory`/`preservingUnresolved`), and the listening-history
  upload bounds (`boundingListeningHistoryForUpload`, `ListeningHistorySyncBounds`).
- `rrradio/CloudSync/SettingsBackup.swift` — the on-disk backup file: schema,
  version gate, encode/decode, suggested file name; restore replaces live state.
- `rrradio/Library/ListeningHistory.swift` — `syncableRecords` /
  `mergeSyncedRecords` / `clear`, and `ListeningHistorySyncCoding` (the
  `dedupKey` and id-insensitive `contentEqual` used by the shared blob).

## Known deviations

- **C1 — decode-failure → authoritative-index → data-loss cascade (Fixed).**
  Index records are authoritative, so a per-entry blob that failed to decode
  used to be dropped via `compactMap`, the merge overwrote local with the empty/
  partial array, and the post-merge save-back ratified the wipe to CloudKit
  — propagating data loss to every paired device. Resolved in two steps: a
  fail-closed throw (`079b773`), then the current unresolved-id +
  `preservingUnresolved` keep-local design (`f03b34f`). See
  `rrradio-ios/internal/audit/2026-05-25-ios-code-review-slice10.md` §C1. The
  contract above documents the **intended** keep-local behavior; the audit owns
  the prior bug and its resolution. This is the same per-record
  decode-failure → data-loss cascade that [catalog-schema](catalog-schema.md)
  flags as its atomic-decode open question (the catalog decode path is the other
  half of the same risk).
- **C7 — binary pending-preferences flag locks ALL preferences (Open).**
  `pendingPreferencesPush` is a single boolean, so one pending local preference
  edit makes *every* local preference field authoritative on the next merge — a
  device's stale theme can overwrite another device's freshly-pushed theme.
  Last-write-wins is correct for the touched field, wrong for the untouched
  ones. See slice10 §C7 (proposed fix in Open questions #2).
- **C10 — `updateAvailability` runs twice per logical sync cycle (Open, low).**
  See slice10 §C10.
- **C11 — subscription existence check round-trips on launch (Superseded /
  intentional).** slice10 §C11 proposed short-circuiting the existence check on a
  persisted "installed" flag. At d241aa9 that flag is **removed**: the check is
  now done **once per app session** (in-memory flag), retried on each foreground
  refresh until it succeeds, and deliberately does **not** trust any persisted
  flag — a persisted flag would survive the dev→prod CloudKit transition and
  cause a device to skip creating the Production subscription (issue #57). The
  per-session round-trip is now intended behavior, not a deviation. See slice10
  §C11 for the original (now-rejected) recommendation.
