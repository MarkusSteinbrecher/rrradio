# Library Sync & Merge Contract
```yaml
status: draft
platforms: [ios]
reconciled-against: 9336321
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
     apply merged to live state, then `save(localSnapshot())` (ratify the merge
     back to cloud). End `synced` (local had payload) or `restored` (it did not).
2. **Push** (`pushLocalSnapshot`) — a debounced write of the local snapshot only.
   Triggered by a local library/preferences change. End `pushed`.

### Merge algebra (`CloudSyncMerge.merged`)

Stated per data class. `local` = this device's snapshot; `remote` = fetched
snapshot.

| Data class | Rule |
|---|---|
| **Favorites** | Authoritative-remote when `remote.hasFavoritesOrder`: result = remote favorites, then any unresolved id's local copy appended, then **reordered by `remote.favoritesOrder`** (ids not in the order list trail in merged order). When remote has no order index: union by id, remote blob wins on id collision, local-only ids appended. |
| **Custom stations** | Authoritative-remote when `remote.hasCustomStationsIndex`: result = remote list + unresolved-id local fallbacks. Otherwise union by id with **remote-wins on collision** (`mergeStations`), local-only appended. |
| **Station lists** | Authoritative-remote when `remote.hasStationListsIndex`: result = remote list + unresolved-id local fallbacks. Otherwise union by id with **remote-wins (remote first, then local-only)**. |
| **Preferences** | All-or-nothing block. `useRemotePreferences = remote.hasPreferences && !preferLocalPreferences`. When true, every preference field takes the remote value; when false, every field keeps local. (One exception: `sleepTimerDefaultMinutes` takes remote only if `remote > 0`.) `preferLocalPreferences` is set when this device has a queued, not-yet-pushed local preference edit. |
| **Index flags** | `hasFavoritesOrder/hasCustomStationsIndex/hasStationListsIndex/hasPreferences` in merged output = local OR remote (sticky). |
| **`favoritesOrder`** in merged output | = `remote.favoritesOrder` verbatim. |
| **`resetAt`** in merged output | = `remote.resetAt`. |

Recents / listening-history records / diagnostics / active wake intents are
**absent from the snapshot entirely** — they have no field, so they are never
synced (enforced structurally, not by filter). See [data-sync.md](../data-sync.md).

### Push timing

| Knob | Value | Meaning |
|---|---|---|
| Push debounce | 750 ms (`750_000_000` ns) | Coalesce a burst of local edits into one push. |
| Retry base | 5 s (`5_000_000_000` ns) | First retry delay after a retryable push failure. |
| Backoff | exponential `base × 2^(attempt-1)`, capped 60 s | Per-attempt deferred-push delay. |
| Max retries | 3 | After which the pending push is **suspended** (kept dirty, retried on next external trigger), not dropped. |

### Silent push (`CKDatabaseSubscription`)

- A single `CKDatabaseSubscription` id `rrradio.private-db-changes.v1` is
  installed idempotently in the private database.
- `NotificationInfo.shouldSendContentAvailable = true` → silent push (no alert,
  no badge, no sound). It only wakes the app to pull.
- On delivery the app calls `handleRemoteChangeNotification` → `refreshFromCloud`
  (coalesced if a sync is already running).

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
above sync. Listening-history *records* never sync — only the three history
*preference* fields above. (See [data-sync.md](../data-sync.md).)

### Per-entry / index records

| Record | Key field(s) | Notes |
|---|---|---|
| `Favorite` | `stationId` (String), `stationData` (Data), `addedAt` (Date, set once) | Re-saved only when blob changed. |
| `CustomStation` | `stationId`, `stationData` | Re-saved only when blob changed. |
| `StationList` | `listId`, `listData` | Re-saved only when blob changed. |
| `FavoritesOrder` | `stationIds` (String array) | Authoritative order. |
| `CustomStationsIndex` | `stationIds` (String array) | Authoritative membership. |
| `StationListsIndex` | `listIds` (String array) | Authoritative membership. |
| `SyncState` | `resetAt` (Date) | Deletion tombstone for "remove all cloud data". |

### Local sync flags (`UserDefaults`)

| Key | Meaning |
|---|---|
| `rrradio.icloudSync.enabled.v1` | Sync on/off (defaults **on** at first launch). |
| `rrradio.icloudSync.pendingPreferencesPush.v1` | A local preference edit awaits push → forces `preferLocalPreferences` on next merge. |
| `rrradio.icloudSync.resetAcknowledgedAt.v1` | Last `resetAt` this device has honored. |
| `rrradio.icloudSync.subscriptionInstalled.v1` | Subscription install confirmed locally. |

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

### Reset tombstone

```
removeAllCloudData():
  save SyncState{resetAt: now}; delete all Favorite/CustomStation/StationList
  + the three index records + Preferences.
Other device on next refresh: resetAt > resetAcknowledgedAt and no payload
  beyond the tombstone => apply empty locally, acknowledge resetAt, end resetApplied.
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
  step (`save(localSnapshot())`) re-encodes any decodable blob with the current
  encoder, which heals stale-but-decodable records opportunistically.

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
| Concurrent request during a running cycle | Coalesced: a pending reset, pending remote-refresh, or pending push is re-fired once the current cycle finishes (`finishSync`). |

All errors are sanitized before surfacing: no stack traces, no PII; record names
and CKError codes only.

## Platform obligations

| # | Web | iOS | Android |
|---|---|---|---|
| 1 | Local-only; no CloudKit, no account, no automatic cross-device sync. | Implements the full CloudKit sync above. | Local-only; no CloudKit, no account. |
| 2 | When importing a backup file, merge with the **same algebra**: favorites/custom/list union by id with the imported copy winning on collision; preferences applied as a block. | Honor the merge algebra exactly so two iOS devices converge. | Same backup-import merge algebra as web. |
| 3 | Never require cloud to function. | Degrade to local-only when iCloud is unavailable; no feature blocks on it. | Never require cloud to function. |
| 4 | Treat recents, listening-history records, diagnostics, and active wake intent as non-syncable (export must exclude them per [data-sync.md](../data-sync.md)). | Same exclusions, enforced structurally (absent from snapshot). | Same exclusions. |
| 5 | Decode failure on import must not wipe surviving local entries — keep local on un-decodable id. | Keep local copy for unresolved ids; never let a single bad blob wipe or stall. | Decode failure on import must not wipe surviving local entries. |
| 6 | Provide a user-initiated "remove all" only over local/backup data. | Provide "remove all iCloud data" via the `resetAt` tombstone; other devices honor it. | Provide "remove all" over local data. |

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
- `rrradio/CloudSync/CloudSyncSnapshot.swift` — `CloudSyncSnapshot` schema and the
  `CloudSyncMerge` algebra (`mergeFavorites`/`mergeStations`/`mergeStationLists`/
  `preservingUnresolved`).

## Known deviations

- **C1 — decode-failure → authoritative-index → data-loss cascade (Fixed).**
  Index records are authoritative, so a per-entry blob that failed to decode
  used to be dropped via `compactMap`, the merge overwrote local with the empty/
  partial array, and `save(localSnapshot())` ratified the wipe back to CloudKit
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
- **C11 — subscription existence check round-trips on every cold launch even
  when the local installed-flag is set (Open, low).** See slice10 §C11.
