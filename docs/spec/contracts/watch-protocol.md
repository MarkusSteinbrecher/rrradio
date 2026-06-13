# Watch Remote Protocol Contract

```yaml
status: draft
platforms: [ios]
reconciled-against: 800bb74
```

The Apple Watch companion is an iPhone *remote*, not an independent player. It
holds no audio, no catalog, and no library of its own. It mirrors the iPhone's
playback state from a periodically published snapshot, fetches station-list
rosters on demand, and sends back commands the iPhone executes. This contract
pins the wire format of both directions.

> Platform scope: **iOS + watchOS only.** Web and Android have no watch
> companion (see [Platforms](../platforms.md) and [Playback](../playback.md)).
> Every type below lives in the shared iOS/watchOS code and ships in both the
> phone app and the watch app; nothing here is portable to web or Android.

## Purpose

- Pins the **command set** the watch may send and the **snapshot schema** the
  watch renders, so the two embedded targets stay decodable against each other
  across app updates.
- Honored by exactly two parties: the **iPhone app** (snapshot producer +
  command executor) and the **watch app** (snapshot consumer + command sender).
- The iPhone is the single source of truth. The watch never mutates playback,
  the catalog, or the library directly; it only emits commands and renders the
  last snapshot it received.

## Definition

### Transport

- All traffic rides **WatchConnectivity** (`WCSession`).
- Three message shapes, all `[String: Any]` dictionaries with two keys:
  - `type` (`String`) — one of the type identifiers below.
  - `payload` (`Data`) — the JSON-encoded envelope, snapshot, or list detail.
- Type identifiers (versioned strings):
  - Command: `org.rrradio.watch.command.v1`
  - Snapshot: `org.rrradio.watch.snapshot.v1`
  - List detail: `org.rrradio.watch.list-detail.v1`
- `payload` is **JSON** produced by `JSONEncoder()` / consumed by
  `JSONDecoder()` with **default settings** (no custom date/key strategy).
  Therefore `Date` fields are encoded as a JSON **number**: seconds since the
  reference date `2001-01-01T00:00:00Z` (Apple reference epoch), not Unix epoch
  and not ISO-8601. A decoder reconstructing this format must use the same
  reference epoch.

### Channels

| Direction | Channel | Delivery semantics |
|---|---|---|
| iPhone → watch, ambient state | `updateApplicationContext` | **Coalesced.** Only the latest snapshot is retained/delivered; intermediate snapshots are dropped. Survives app-not-running; read on next launch via `receivedApplicationContext`. |
| watch → iPhone, command | `sendMessage(_:replyHandler:errorHandler:)` | Requires both apps reachable. iPhone executes, then replies with a fresh `snapshot.v1` — except `requestStationListStations`, which is answered with a `list-detail.v1` instead (no state change, no context publish). |
| watch → iPhone, command (offline) | queued locally on watch | Held in a bounded pending buffer, flushed on activation/reachability (see Failure & fallback). |

### Command envelope (`WatchPlaybackCommandEnvelope`)

A command is `kind` + up to two optional id parameters + a timestamp.

```
WatchPlaybackCommandEnvelope := {
  kind: WatchPlaybackCommandKind,   // required
  stationID: String?,               // station target, kind-dependent
  stationListID: String?,           // list target, kind-dependent
  requestedAt: Date                 // command creation time
}
```

### Command set (`WatchPlaybackCommandKind`)

Exactly these 14 cases. The iPhone resolves every command against its own live
state; the watch supplies only ids.

| `kind` | Required param | iPhone effect |
|---|---|---|
| `playStation` | `stationID` | Resolve station; if it is a favorite, play it inside a favorites queue, else play it standalone; push to recents if it is a catalog station. |
| `playActiveQueueStation` | `stationID` | If the station is in the current active queue, play it in place; else fall back to `playStation` semantics. |
| `playStationList` | `stationListID` | Resolve the list; play its first station inside a station-list queue sourced from that list. |
| `playStationInList` | `stationID` + `stationListID` | Resolve the list, find the station *within it*, play it inside that list's queue — so next/previous walk the list, not favorites. |
| `pause` | — | Pause the player. |
| `resume` | — | Resume the player (restarts the current station). |
| `toggle` | — | Toggle play/pause on the player (iPhone resolves direction from its own real-time state). |
| `stop` | — | Stop the player and clear active playback. |
| `nextStation` | — | Step forward in the active queue; if none, fall back to stepping forward through favorites. |
| `previousStation` | — | Step backward in the active queue; if none, fall back to stepping backward through favorites. |
| `nextFavorite` | — | Identical to `nextStation` today (same forward-step handler). |
| `previousFavorite` | — | Identical to `previousStation` today (same backward-step handler). |
| `requestSnapshot` | — | No state change; the iPhone replies with / publishes the current snapshot. |
| `requestStationListStations` | `stationListID` | No state change; the iPhone replies with the list's roster as a `list-detail.v1` message (see below) instead of a snapshot. Lists ride the broadcast snapshot only as summaries, so the watch fetches a roster on first drill-in. |

- Step semantics: a forward/backward step within the active queue **never jumps
  to unrelated catalog stations**; it only walks the active queue, then
  favorites (see [Playback](../playback.md) "Queue Rules"). A step that would
  re-select the already-current station is a no-op. These steps mirror the
  circular stepping semantics in
  [playback-state-machine](playback-state-machine.md).
- Favorite stepping wraps modulo the favorites count; with no current station in
  favorites, forward starts at the first favorite and backward at the last.

### Snapshot (`WatchPlaybackSnapshot`)

The complete state the watch renders. Produced only by the iPhone.

```
WatchPlaybackSnapshot := {
  playbackState: WatchRemotePlaybackState,   // required
  currentStation: WatchStationSummary?,
  nowPlayingTitle: String?,
  nowPlayingArtist: String?,
  nowPlayingProgramName: String?,
  nowPlayingCoverURL: URL?,
  favorites: [WatchStationSummary],          // capped, see limits
  favoriteCount: Int,                        // total before capping
  recents: [WatchStationSummary],            // capped
  recentsCount: Int,                         // total before capping
  stationLists: [WatchStationListSummary],   // capped
  stationListCount: Int,                     // total before capping
  activeQueue: WatchPlaybackQueueSummary?,
  activeQueueStations: [WatchStationSummary],// capped, see limits
  catalogStationCount: Int,                  // required
  generatedAt: Date                          // required
}
```

### Playback state enum (`WatchRemotePlaybackState`)

Exactly these 5 cases, mirroring the iPhone player state in
[playback-state-machine](playback-state-machine.md) 1:1:

`idle` · `loading` · `playing` · `paused` · `error`

### Nested wire types

```
WatchStationSummary := {
  id: String, name: String,
  broadcaster: String?, country: String?, favicon: URL?
}

WatchStationListSummary := {
  id: String, name: String, stationCount: Int,
  firstStation: WatchStationSummary?
}

WatchPlaybackQueueSummary := {
  source: WatchPlaybackQueueSource,  // browse | favorites | recents | stationList | single
  sourceID: String?, name: String?,
  stationCount: Int, currentIndex: Int?
}
```

`WatchPlaybackQueueSource` is a wire-side mirror of the iPhone playback-queue
source enum in [playback-state-machine](playback-state-machine.md); the five
cases are identical. (Deliberately a separate type so the wire format can evolve
independently of the model — audit finding #15.)

### List-detail reply (`WatchStationListDetail`)

The on-demand roster of one station list — the payload behind the
`list-detail.v1` type identifier. The broadcast snapshot carries lists only as
summaries (name + count + first station); when the user drills into a list on
the watch, the watch sends `requestStationListStations` and the iPhone answers
with this instead of a snapshot. The roster is built from the same
`StationListFeed` the iOS list page renders, so the watch sees what the phone
shows.

```
WatchStationListDetail := {
  id: String,                        // the station list id
  name: String,                      // resolved list title
  stationCount: Int,                 // true total, before capping
  stations: [WatchStationSummary]    // capped at 100, then payload-trimmed
}
```

The watch caches received rosters per list id for the session
(`listDetails`); a list is fetched once per launch, on first drill-in.

## Detail

### Command envelope fields

| Field | Type | Optional? | Meaning | Default |
|---|---|---|---|---|
| `kind` | enum string | no | Which command (14 cases). | — |
| `stationID` | string | yes | Target station id; required for `playStation`, `playActiveQueueStation`, `playStationInList`. | `nil` |
| `stationListID` | string | yes | Target list id; required for `playStationList`, `playStationInList`, `requestStationListStations`. | `nil` |
| `requestedAt` | Date (number) | no | Time the watch built the command. | now() |

If a `kind` that needs `stationID`/`stationListID` arrives without it, the
iPhone **silently ignores** the command (no error, no reply mutation). The one
exception is `requestStationListStations`: a missing or unresolvable
`stationListID` is answered with an **empty roster** (`id` echoed or empty,
`name` empty, `stationCount` 0, `stations` `[]`) rather than ignored.

### Snapshot fields

| Field | Type | Optional? | Meaning | Default |
|---|---|---|---|---|
| `playbackState` | enum string | no | Mirror of iPhone player state. | — |
| `currentStation` | WatchStationSummary | yes | Station currently selected/playing. | `nil` |
| `nowPlayingTitle` | string | yes | Live track title. | `nil` |
| `nowPlayingArtist` | string | yes | Live track artist. | `nil` |
| `nowPlayingProgramName` | string | yes | Live program/show name. | `nil` |
| `nowPlayingCoverURL` | URL | yes | Track/cover artwork URL. | `nil` |
| `favorites` | [WatchStationSummary] | no (may be `[]`) | Favorite rows, capped at 30. | `[]` |
| `favoriteCount` | Int | yes on decode | Total favorites before the 30-cap. | `favorites.count` |
| `recents` | [WatchStationSummary] | yes on decode | Recent rows, capped at 30. | `[]` |
| `recentsCount` | Int | yes on decode | Total recents before cap. | `recents.count` |
| `stationLists` | [WatchStationListSummary] | yes on decode | List rows, capped at 20. | `[]` |
| `stationListCount` | Int | yes on decode | Total lists before cap. | `stationLists.count` |
| `activeQueue` | WatchPlaybackQueueSummary | yes | Summary of the current playback queue. | `nil` |
| `activeQueueStations` | [WatchStationSummary] | yes on decode | Queue station rows, capped at 60. Only populated for `favorites`/`stationList` queue sources; empty for `browse`/`recents`/`single`. | `[]` |
| `catalogStationCount` | Int | no | Size of the iPhone catalog (informational). | — |
| `generatedAt` | Date (number) | no | Snapshot build time. | — |

Required-on-decode (decode **fails** if missing): `playbackState`, `favorites`,
`catalogStationCount`, `generatedAt`. All other fields decode-if-present; the
`*Count` fields fall back to their array's `.count` when absent. This makes the
snapshot **forward-tolerant**: a producer may omit `recents`, `stationLists`,
`activeQueue`, `activeQueueStations` and the consumer still decodes.

### List caps (iPhone-side, before send)

| Collection | Cap | Total preserved in |
|---|---|---|
| `favorites` | 30 | `favoriteCount` |
| `recents` | 30 | `recentsCount` |
| `stationLists` | 20 | `stationListCount` |
| `activeQueueStations` | 60 | `activeQueue.stationCount` |
| `WatchStationListDetail.stations` | 100 | `stationCount` |

The `*Count` / `stationCount` total lets the watch render an honest
"Showing N of M" boundary line without shipping the whole library.

The snapshot's favorites/recents/list rows are built from the same
`StationFeed` instances the iOS feed pages render (issue #21 phase 5), so the
watch sees exactly what the phone's own pages show — including feed-level
ordering and titles.

### Payload size constraint

- Hard ceiling: **50000 bytes** (`maximumSnapshotPayloadBytes`) of JSON-encoded
  payload — well under the WatchConnectivity application-context limit. The
  same ceiling governs both snapshots and list-detail replies.
- A snapshot over the ceiling is degraded deterministically before send:
  1. **Drop all favicons** from every station summary (set `favicon` / nested
     `firstStation.favicon` to `nil`). Favicons are URLs; dropping them is the
     cheapest large reduction.
  2. If still over, **remove one trailing visible row at a time**, always from
     whichever collection currently has the most rows, in priority order
     `activeQueueStations ≥ favorites ≥ recents ≥ stationLists`. Repeat until
     under the ceiling or no row can be removed.
- A list-detail reply over the ceiling degrades with the same two-stage
  strategy applied to its single collection: favicons dropped first, then
  trailing `stations` rows removed until it fits.
- The `*Count` / `stationCount` totals are **not** decremented during
  degradation, so the "Showing N of M" boundary line stays truthful even after
  rows are dropped.

## Examples

### Command: play a station list (watch → iPhone)

Envelope (pre-encode, conceptual):

```json
{
  "kind": "playStationList",
  "stationListID": "list-morning",
  "requestedAt": 770000000.0
}
```

On the wire (the dictionary actually sent):

```
{
  "type": "org.rrradio.watch.command.v1",
  "payload": <Data: JSON bytes of the envelope above>
}
```

### Command: fetch a list roster (watch → iPhone → watch)

Sent on first drill-in to a station list (the roster is then cached for the
session):

```json
{
  "kind": "requestStationListStations",
  "stationListID": "list-morning",
  "requestedAt": 770000150.0
}
```

The reply is a **`list-detail.v1`** message, not a snapshot:

```json
{
  "id": "list-morning",
  "name": "Morning",
  "stationCount": 124,
  "stations": [
    { "id": "fm4", "name": "FM4", "broadcaster": "ORF", "country": "Austria", "favicon": null }
  ]
}
```

`stationCount` (124) exceeds `stations.length` (capped at 100, here further
payload-trimmed) — the watch renders "Showing N of 124 stations". Tapping a
station in the rendered roster sends `playStationInList` with both ids, so the
iPhone builds the queue from that list.

### Command: primary play/pause (watch → iPhone)

The watch's primary action sends `pause` when it believes playback is live,
`resume` when a current station exists but is paused, else falls back to
`playStationList` (first list) or `playStation` (first favorite). All four are
plain envelopes with no params except the fallback ids:

```json
{ "kind": "pause", "requestedAt": 770000123.0 }
```

> Note: `toggle` exists in the protocol and is honored by the iPhone, but the
> shipped watch does not currently send it (audit finding #8).

### Snapshot reply (iPhone → watch)

Envelope (pre-encode, favicons stripped because the full payload exceeded 50000
bytes):

```json
{
  "playbackState": "playing",
  "currentStation": {
    "id": "fm4",
    "name": "FM4",
    "broadcaster": "ORF",
    "country": "Austria",
    "favicon": null
  },
  "nowPlayingTitle": "Teardrop",
  "nowPlayingArtist": "Massive Attack",
  "nowPlayingProgramName": "Morning Show",
  "nowPlayingCoverURL": "https://example.org/cover.jpg",
  "favorites": [ { "id": "fm4", "name": "FM4", "broadcaster": "ORF", "country": "Austria", "favicon": null } ],
  "favoriteCount": 42,
  "recents": [],
  "recentsCount": 0,
  "stationLists": [
    { "id": "list-morning", "name": "Morning", "stationCount": 5,
      "firstStation": { "id": "fm4", "name": "FM4", "broadcaster": "ORF", "country": "Austria", "favicon": null } }
  ],
  "stationListCount": 3,
  "activeQueue": {
    "source": "favorites",
    "sourceID": null,
    "name": "Favorites",
    "stationCount": 42,
    "currentIndex": 0
  },
  "activeQueueStations": [ { "id": "fm4", "name": "FM4", "broadcaster": "ORF", "country": "Austria", "favicon": null } ],
  "catalogStationCount": 18342,
  "generatedAt": 770000200.0
}
```

`favoriteCount` (42) exceeds `favorites.length` (1 after degradation) — the
watch renders "Showing 1 of 42 favorites".

### Empty snapshot

The watch's initial state and the iPhone's not-yet-configured state:

```json
{
  "playbackState": "idle",
  "currentStation": null,
  "nowPlayingTitle": null,
  "nowPlayingArtist": null,
  "nowPlayingProgramName": null,
  "nowPlayingCoverURL": null,
  "favorites": [],
  "favoriteCount": 0,
  "recents": [],
  "recentsCount": 0,
  "stationLists": [],
  "stationListCount": 0,
  "activeQueue": null,
  "activeQueueStations": [],
  "catalogStationCount": 0,
  "generatedAt": <now>
}
```

## Versioning & evolution

- **Type identifiers carry an explicit version suffix** (`.v1`). A decoder MUST
  reject (ignore) a message whose `type` does not match the version it
  understands. Today only `.v1` exists for all three message types.
- **Payloads themselves carry no version field** inside the JSON — versioning is
  expressed only by the `type` string. Adding a v2 means a new type identifier,
  not a field inside the payload. (Open question: see below.)
- **Field additions are backward-tolerant** within v1: the snapshot decoder
  uses decode-if-present for every optional/array field, so a newer producer may
  add fields and an older consumer ignores them, and a newer consumer reading an
  older producer's snapshot supplies array/count defaults.
- **Enum additions are NOT tolerant.** `WatchPlaybackCommandKind`,
  `WatchRemotePlaybackState`, and `WatchPlaybackQueueSource` are plain
  `String`-raw enums; an unknown case in any of them throws on decode and fails
  the whole message. Introducing a new command kind or playback state is a
  breaking change unless both targets ship together (they do — watch and phone
  are one app submission).
- Because both targets are built from the same shared source and shipped in one
  binary submission, in practice command-set and state-enum changes are
  atomic across the pair. The version suffix exists to protect the
  ship-skew window (a watch app left on an older OS while the phone updates,
  or a stale `receivedApplicationContext` written by a prior build).

## Failure & fallback

| Condition | Behavior |
|---|---|
| Message `type` unrecognized | Treated as not-a-command / not-a-snapshot / not-a-list-detail; decoder returns nil; iPhone replies with an empty dict, watch ignores. |
| `payload` missing or not `Data` | Decode throws `invalidPayload`; iPhone records a diagnostic and replies empty. |
| Reply decode fails (missing required field, unknown enum case) | The watch decodes every reply as both a snapshot and a list detail and applies whichever succeeds; an undecodable reply is **silently ignored** and the prior state kept. (No user-facing error — see Known deviations.) |
| Command needs an id it lacks | iPhone ignores the command, still replies with a current snapshot — except `requestStationListStations`, which is answered with an empty roster. |
| iPhone not yet configured (catalog/library/player unset) | Command is **enqueued** on the iPhone side (bounded buffer of 5, oldest dropped) and drained once configured. Exception: `requestStationListStations` is never enqueued — an unconfigured iPhone answers it immediately with an empty roster. |
| Watch session activated but iPhone unreachable | Command is dropped on the watch side (the watch sets a "Open rrradio on the iPhone" error; `refresh` and roster requests drop **silently** — they send with the not-ready report suppressed). **Known deviation — commands are lost, see below.** |
| Watch session not yet activated | Command is enqueued on the watch (bounded buffer of 5; duplicate `requestSnapshot` deduped) and flushed on activation/reachability. When the pending buffer is empty at drain time, a lone `requestSnapshot` is sent to pull fresh state. Within a 2 s activation-grace window after `activate()`, the "iPhone connection is not ready." error is suppressed (the command still enqueues). |
| Roster already cached on the watch | `requestStationListStations` is not sent — `listDetails` is a per-session cache keyed by list id; only the first drill-in fetches. |
| Snapshot or list detail too large (> 50000 B) | Degraded deterministically (favicons, then trailing rows) before send. If the iPhone's reply still exceeds the WatchConnectivity limit, WatchConnectivity surfaces `payloadTooLarge`; the watch maps it to "The iPhone library is too large to sync to the watch." |
| iPhone app closed when state changes | `updateApplicationContext` is coalesced and read on next watch launch via `receivedApplicationContext`; intermediate changes are not delivered live. |
| Stale snapshot (watch's local mirror lags real iPhone state) | Watch renders the last snapshot it received; the next published context corrects it. The watch's pause-vs-resume decision can be wrong under a state-flip race — **Known deviation, see below.** |

### Command precedence / overlap

- The iPhone **executes commands in arrival order**, one at a time on the main
  actor; each reply carries a fresh post-execution snapshot (or, for a roster
  request, the list detail). There is no command merging or last-write-wins on
  the iPhone side.
- The watch's **pending buffer** (used only while not-activated) is FIFO,
  capped at 5; on overflow the oldest commands are dropped. Only
  `requestSnapshot` is deduplicated within the buffer.
- WatchConnectivity does not guarantee ordering between an in-flight
  `sendMessage` reply and an `updateApplicationContext` push, so the watch's
  rendered state is "the most recently applied snapshot from either channel."

## Platform obligations

| Obligation | iOS (phone) | iOS (watch) | Web | Android |
|---|---|---|---|---|
| Implement this protocol | Yes — producer + executor | Yes — consumer + sender | Not applicable | Not applicable |
| Use the exact `type` identifiers and `{type,payload}` envelope | Yes | Yes | — | — |
| Encode `Date` against the Apple reference epoch (matching `JSONEncoder` defaults) | Yes | Yes | — | — |
| Honor the 14-case command set verbatim | Execute all 14 | Send a subset (need not send all) | — | — |
| Treat the iPhone as the single source of playback truth | Yes | Yes — never mutate locally | — | — |
| Reject/ignore unknown `type` versions | Yes | Yes | — | — |
| Apply snapshot size degradation before send | Yes (producer only) | n/a | — | — |
| Keep the `*Count` totals truthful through capping/degradation | Yes | Render "N of M" honestly | — | — |
| Never sync recents-equivalent or other excluded data beyond this snapshot | See [Data and sync](../data-sync.md) | — | — | — |

The watch app is **not applicable** to web and Android: neither platform has a
watch companion target (Wear OS is out of scope for the first Android port — see
[Playback](../playback.md)). This contract therefore imposes no obligation on
web or Android.

## Open questions

- **No in-payload version field.** Versioning lives only in the `type` string
  (`.v1`). There is no `schemaVersion`/`version` field inside the command or
  snapshot JSON, so a payload cannot self-describe its version once detached
  from its envelope. Decide whether a future cross-version watch/phone skew
  needs an in-payload version (mirrors the same open question the Android
  backup file resolved with `schemaVersion: 1` in [Data and sync](../data-sync.md)).
- **`nextFavorite` / `previousFavorite` are aliases.** They map to the same
  forward/backward step handlers as `nextStation` / `previousStation` today.
  Decide whether they should ever diverge (e.g. always step within favorites
  regardless of the active queue) or be removed.
- **`toggle` has no sender.** It is honored by the iPhone but never sent by the
  shipped watch; the watch sends `pause`/`resume` instead — even the watchOS 11
  double-tap hand gesture routes through the same pause/resume primary action.
  Decide whether `toggle` becomes the primary action (it removes the
  stale-mirror race) or is dropped (audit findings #4, #8).
- **`catalogStationCount` is shipped but unrendered.** The watch does not
  display it. Decide whether it stays in the contract.

## Reference

- **Related contracts:** [playback-state-machine](playback-state-machine.md) —
  the source of truth this protocol mirrors: the 5-case `WatchRemotePlaybackState`,
  the `WatchPlaybackQueueSource` enum, and the forward/backward step semantics.
- `Shared/WatchRemoteProtocol.swift` — all wire types incl.
  `WatchStationListDetail`, the command/state enums, `WatchRemoteMessageCodec`
  (three type ids, 50000-byte limit, encode/decode), and the
  `constrainedToPayloadLimit` degradation logic for both snapshot and list
  detail.
- `rrradio/WatchRemote/PhoneRemoteControlController.swift` — iPhone side:
  command execution, the snapshot-vs-list-detail `CommandReply` split,
  feed-driven snapshot construction, list caps (30/30/20/60 + 100 for roster
  replies), pending buffer of 5, the `WCReplyHandlerBox` Sendable boundary.
- `rrradioWatch/WatchRemoteModel.swift` — watch side: command sending, pending
  buffer, snapshot + list-detail decode/apply, the per-session `listDetails`
  roster cache, reachability handling, `payloadTooLarge` mapping.
- `rrradioWatch/App.swift` — watch UI consuming the snapshot: three pages,
  Player (Now Playing) → Favorites (app grid) → Library (station lists with
  drill-down rosters, Recents below, mirroring the phone). Launch lands on the
  Player when a station is current, else on Favorites, with a ~2.5 s armed
  window that auto-routes to the Player if playback starts; the watchOS 11
  double-tap gesture jumps to the Player or fires the primary action there.

## Known deviations

Mostly from `rrradio-ios/internal/audit/2026-05-25-watch-code-review.md`:

- **Reply-decode failures are silent.** The reply handler decodes with `try?`
  and ignores an undecodable reply; the "Could not read iPhone state." surface
  lives only in `applySnapshotReply`, which lost its last caller in the
  list-detail reply split (d61f85a) and is now dead code. Either re-wire the
  error surface or remove the dead method.

- **Commands dropped when unreachable** (finding #3): the watch's `send`
  enqueues when *not activated* but **drops** the command when activated yet the
  iPhone is unreachable. A tapped play is lost; reachability return only sends a
  `requestSnapshot`. The contract's intent is queue-and-flush in both cases.
- **Stale-mirror pause/resume race** (finding #4): the watch chooses
  `pause` vs `resume` from its last-received `playbackState`, which lags real
  iPhone state under coalesced context delivery; it can send the wrong command
  during a state flip. Intended fix is to send `toggle` and let the iPhone
  resolve direction.
- **`toggle` is dead wire surface** (finding #8): defined and iPhone-handled but
  never sent by the watch.
- **Linear per-command catalog/library search** (`PhoneRemoteControlController.station(id:)`):
  every id-bearing command scans the active queue, favorites, custom stations,
  and *every* station list's stations before falling back to the catalog's O(1)
  `stationsByID` lookup. The catalog itself is indexed; the resolver's
  pre-catalog linear scans are not. (Not a correctness bug; an efficiency note
  not individually filed in the watch audit.)
- **`visibleContentToken` allocates a large string with no caller** (finding
  #17): latent; safe today, easy to misuse into an O(library) per-render churn.
- **`canStepStations` enables stepping on favorites count alone** (finding #5):
  next/prev light up with ≥2 favorites even without an active queue, and an
  iPhone-side favorite step then silently replaces the active queue.
