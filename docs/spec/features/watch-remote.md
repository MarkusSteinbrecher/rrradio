# Watch Remote Specification

```yaml
status: draft
platforms: [ios]
reconciled-against: 9336321
```

## Purpose

The Apple Watch companion is a wrist-worn remote for the iPhone app. It mirrors
what the iPhone is playing and what is in the user's library, and lets the user
start a station, step through a queue, and play/pause/stop — all without taking
the iPhone out of a pocket. The watch holds no audio, no catalog, and no library
of its own: the iPhone is the single source of truth, the watch renders the last
snapshot it received and emits commands the iPhone executes. The wire format is
the [watch-protocol](../contracts/watch-protocol.md) contract; this spec covers
only what a user sees and does on the watch.

> Platform scope: **iOS + watchOS only.** Web and Android have no watch companion
> (see [Platforms](../platforms.md)). Every behavior below is Not applicable to
> those platforms.

## Entry points

- Launch the **rrradio watch app** from the watch app grid, the Dock, or a
  complication/Smart-Stack tap.
- Hardware/system: the watch app may be woken by the system; on appear it pulls a
  fresh snapshot from the iPhone.
- Cross-tab: a watchOS **double-tap** hand gesture from any tab jumps to the Now
  Playing tab (and, when already on Now Playing, toggles play/pause).

## Layout

The app is a **paged TabView of four pages**, swiped horizontally, with a page
indicator. Page order, left to right:

1. **Lists** — header (list icon + "Lists"). One tappable row per station list:
   first-station favicon, list name, and a station count ("1 station" /
   "N stations"). A "Showing N of M lists" boundary line when capped.
2. **Now Playing** — the destination page (see below).
3. **Favorites** — header (heart icon + "Favorites"). A 3-column grid of favorite
   tiles: favicon + station name (2 lines, scaled). The currently-playing tile is
   ringed yellow with a yellow dot badge. "Showing N of M favorites" when capped.
4. **Recents** — header (clock icon + "Recents"). One tappable row per recent
   station: favicon, name, broadcaster-or-country subtitle, and a yellow speaker
   badge on the current station. "Showing N of M recents" when capped.

### Now Playing page (top to bottom)

- **App logo** header (rrradio mark).
- **Artwork pair**: large track/cover art (70 pt, `music.note` placeholder) beside
  the smaller station favicon (48 pt).
- **Headline** — track title, else program name, else station name, else "No
  station".
- **Subheadline** — track artist, else broadcaster, else country.
- **Queue line** — `<queue name> <index>/<count>` (e.g. "Favorites 2/12") when the
  active queue holds more than one station; just `<queue name> <count>` when the
  current position is unknown.
- **Loading spinner** when playback state is loading.
- **"Playback error"** (red) when playback state is error.
- **Transport controls** — a row of four circular buttons: previous, play/pause
  (icon flips with state), next, stop.
- **Connection status** — a colored dot + label: green "iPhone ready" when
  reachable, orange "Open iPhone app" when not. Below it, the last error string
  (orange) when present.
- **Active queue section** — when a queue is active, a header (queue name + an icon
  reflecting its source: heart for favorites, list icon for a station list, music
  note otherwise) and tappable rows for each queue station, current one badged.
  "Showing N of M stations" when capped.

## States

| State | What shows | What is actionable |
|---|---|---|
| **Empty** (first launch, nothing received) | Now Playing reads "No station"; each list page shows its empty caption ("No lists yet" / "No favorites yet" / "No recents yet"); controls disabled. | Swiping between tabs; nothing sends until a snapshot + reachability arrive. |
| **Loading** (iPhone state == loading) | Now Playing shows a mini progress spinner; play/pause shows the pause icon (loading is treated as "playing"). | All controls, if reachable. |
| **Loaded** (snapshot received) | Now Playing, lists, favorites grid, recents, active queue all render from the snapshot. | Every tappable row + transport control, gated on reachability. |
| **Partial** (capped/degraded snapshot) | Capped collections show "Showing N of M …" boundary lines; favicons may be missing (placeholder art) when the snapshot was degraded for size. | Same as loaded. |
| **Error** (iPhone playback failed) | Now Playing shows "Playback error" (red); the last command error appears under the connection row. | Controls remain tappable (a fresh play/resume retries). |
| **Offline / unreachable** (iPhone not reachable) | Connection row shows orange dot + "Open iPhone app"; all command buttons are disabled. | Swiping only. Commands are not sent (see Edge cases / Known deviations). |
| **Not ready** (session not yet activated) | Same disabled controls; transient errors suppressed during a short activation grace window. | Taps are queued and flushed once activation completes. |

## Interactions

| Control / gesture | Precondition | Result | Side effects |
|---|---|---|---|
| Swipe horizontally | any | Move between the four tabs (Lists ↔ Now Playing ↔ Favorites ↔ Recents). | Page indicator updates. |
| Tap a **Lists** row | reachable; list has ≥1 station | Play that list's first station inside a station-list queue. | iPhone pushes first station to recents; snapshot refreshes. |
| Tap a **Favorites** tile | reachable | Play that favorite inside a favorites queue. | Pushed to recents; tile ring/badge moves to it on next snapshot. |
| Tap a **Recents** row | reachable | Play that station. | Pushed to recents; badge moves on next snapshot. |
| Tap an **active-queue** row | reachable | Play that station in place within the active queue (else fall back to standalone play). | Pushed to recents. |
| Tap **play/pause** (▶/⏸) | reachable; a current station exists OR a list/favorite exists to start | Pause if it believes playback is live; resume a paused current station; else start the first list, else the first favorite. | iPhone toggles/starts playback; snapshot refreshes. |
| Tap **previous** (⏮) | reachable; stepping available | Step backward in the active queue (else step backward through favorites). | Re-selecting the already-current station is a no-op; otherwise plays + pushes recent. |
| Tap **next** (⏭) | reachable; stepping available | Step forward in the active queue (else step forward through favorites). | Same as previous. |
| Tap **stop** (⏹) | reachable; a current station exists | Stop the player and clear active playback. | iPhone goes idle; Now Playing reverts to "No station" on next snapshot. |
| **Double-tap** hand gesture (watchOS 11+) | not on Now Playing | Jump to the Now Playing tab. | — |
| **Double-tap** hand gesture | on Now Playing; reachable | Toggle play/pause (same as the primary play/pause action). | — |
| App appears / re-appears | session usable | Request a fresh snapshot from the iPhone. | iPhone replies with current state. |
| Reachability returns | pending commands buffered (not-activated path) | Buffered commands flush; if none buffered, a snapshot is requested. | See [watch-protocol](../contracts/watch-protocol.md) "Command precedence". |

Controls are **dimmed and non-tappable** whenever the iPhone is unreachable, the
session is not activated, or a command is already in flight. Step buttons
(previous/next) are additionally dimmed when stepping is unavailable; stop is
dimmed with no current station.

## Business rules

- **iPhone is authoritative.** The watch never mutates playback, the catalog, or
  the library directly; it sends commands and renders the last snapshot. All
  command semantics (12 kinds), step rules, and fallbacks live in
  [watch-protocol](../contracts/watch-protocol.md) and
  [playback-state-machine](../contracts/playback-state-machine.md).
- **Snapshot list caps** (iPhone-side, before send): favorites 30, recents 30,
  station lists 20, active-queue stations 60. The total before capping is preserved
  and rendered as the "Showing N of M" boundary line. (Caps and the 50000-byte
  size-degradation rule are pinned in
  [watch-protocol](../contracts/watch-protocol.md).)
- **Primary action resolution** (play/pause button and double-tap on Now Playing):
  pause if the watch believes playback is live → resume if a current station exists
  but is paused → else play the first list → else play the first favorite.
- **"Playing" includes loading.** The play/pause button shows the pause icon while
  the iPhone is loading, so it never flickers to "play" during buffering.
- **Stepping availability** (watch enable check): active queue has >1 station, OR
  the snapshot has >1 favorite. (The favorites-only case is a Known deviation — it
  can replace the active queue.)
- **Boundary line** appears only when the pre-cap total exceeds the shown count.
- **Single in-flight command.** While one command is awaiting its reply, the whole
  control surface is disabled (Known deviation #11).
- **Activation grace window**: ~2 s after activation starts, "not ready" errors are
  suppressed so a tap during cold start does not flash an error.
- **Pending command buffer**: up to 5, FIFO, oldest dropped on overflow; duplicate
  snapshot requests are de-duplicated. (Applies only on the not-activated path.)
- **Favorites grid** is fixed at 3 columns regardless of watch size (Known
  deviation #13).

## Data dependencies

- [watch-protocol](../contracts/watch-protocol.md) — the command set, the snapshot
  schema the watch renders, the transport/channels, list caps, the 50000-byte size
  degradation, and the failure/fallback table. This feature is the UX over that
  wire format.
- [playback-state-machine](../contracts/playback-state-machine.md) — the 5-case
  playback state the watch mirrors (`idle`/`loading`/`playing`/`paused`/`error`),
  the playback-queue source enum, and the circular forward/backward step semantics
  the previous/next buttons drive.
- Station, favorites, recents, and station-list data the snapshot summarizes come
  from the iPhone library/catalog (see [Favorites](favorites.md),
  [Station lists](station-lists.md), [Browse](browse.md)); the watch sees only the
  capped summaries.

## Edge cases

- **iPhone unreachable on tap.** Controls are disabled, so a tap normally cannot
  fire; if a tap does fire while activated-but-unreachable, the command is dropped
  (not queued) and the watch shows "Open rrradio on the iPhone." — **Known
  deviation #3** (intended behavior is queue-and-flush).
- **Session not yet activated.** Commands are queued (buffer of 5) and flushed when
  activation completes; transient errors suppressed during the grace window.
- **Stale snapshot / state-flip race.** The watch's pause-vs-resume choice reads its
  last-received state, which lags coalesced iPhone updates; under a flip it can send
  the wrong command — **Known deviation #4** (intended fix: send `toggle`).
- **Snapshot too large (>50000 B).** The iPhone degrades it before send: drop all
  favicons (rows then show placeholder art), then drop trailing rows from the
  largest collection. If the reply still overflows the WatchConnectivity limit, the
  watch surfaces "The iPhone library is too large to sync to the watch."
- **iPhone not yet configured** (catalog/library/player unset at boot): the iPhone
  enqueues the command (buffer of 5) and drains it once configured; the reply still
  carries a current snapshot.
- **Command missing a required id** (e.g. play-station with no id): the iPhone
  silently ignores it and still replies with a current snapshot.
- **iPhone app closed while state changes:** ambient snapshots are coalesced; the
  watch reads the last one on next launch — intermediate changes are not delivered
  live.
- **Step on empty / single queue:** no-op; never jumps to an unrelated catalog
  station. Re-selecting the current station is a no-op.
- **Step with no active queue but ≥2 favorites:** plays a favorite and replaces the
  active queue — **Known deviation #5**.
- **In-flight command stalls** (slow radio link): the entire control surface stays
  disabled until the reply/timeout — **Known deviation #11**.
- **Empty library:** each list page shows its empty caption; play/pause is disabled
  when there is no current station and no list/favorite to start.

## Accessibility

- Transport buttons carry explicit labels: "Previous station", "Play"/"Pause"
  (label flips with state), "Next station", "Stop".
- The invisible double-tap hand-gesture button is labeled "Play"/"Pause"/"Open Now
  Playing" by state — it collides with the visible play/pause label in the
  VoiceOver rotor (two "Play" elements on Now Playing). **Known deviation #9.**
- Station/list/recent rows expose their station name and subtitle as readable text;
  the current-station badge is a visual-only cue (yellow ring / dot / speaker).
- Text uses Dynamic-Type-aware system fonts; favorite tile names and boundary lines
  scale down (`minimumScaleFactor`) on the smallest watch.
- Connection status conveys reachability by **both** color (green/orange) and text
  ("iPhone ready" / "Open iPhone app"), so it is not color-only.
- Focus order follows the paged tab structure; within a page, top-to-bottom.

## Localization

- This surface owns short watch-only UI strings: tab headers ("Lists",
  "Favorites", "Recents"), empty captions ("No lists yet", "No favorites yet",
  "No recents yet"), "No station", "Playback error", connection labels ("iPhone
  ready", "Open iPhone app"), the queue source display names (Browse / Favorites /
  Recents / List / Station), and error strings ("iPhone connection is not ready.",
  "Open rrradio on the iPhone.", "The iPhone library is too large to sync to the
  watch.", "Could not read iPhone state.").
- **Plural/parameter needs**: the station-count label ("1 station" / "N stations")
  needs a plural rule; the boundary line "Showing N of M <noun>" takes two integers
  and a collection noun; the queue line "<name> <index>/<count>" / "<name> <count>"
  takes a name plus integers.
- Active-queue display names are sourced from the iPhone's localized strings; the
  watch UI labels above are currently literal English in the watch view.

## Platform Matrix

| Behavior | Web | iOS | Android |
|---|---|---|---|
| Watch companion exists | Not applicable | Supported (watchOS) | Not applicable |
| Now-playing mirror on watch | Not applicable | Supported | Not applicable |
| Favorites / recents / lists browse on watch | Not applicable | Supported | Not applicable |
| Play / pause / stop from watch | Not applicable | Supported | Not applicable |
| Previous / next stepping from watch | Not applicable | Partial (favorites-only stepping can replace the queue — dev #5) | Not applicable |
| Active-queue list on watch | Not applicable | Supported | Not applicable |
| Reachability / connection status | Not applicable | Supported | Not applicable |
| Offline command queue-and-flush | Not applicable | Partial (dropped when unreachable — dev #3) | Not applicable |
| Double-tap hand gesture | Not applicable | Supported (watchOS 11+) | Not applicable |
| Snapshot size degradation (favicon/row drop) | Not applicable | Supported | Not applicable |
| Smart-Stack widget freshness | Not applicable | Partial (stale when watch app closed — see deviations) | Not applicable |

## Open questions

- Should the primary action send `toggle` (iPhone resolves direction) instead of
  the watch deciding pause-vs-resume? See [watch-protocol](../contracts/watch-protocol.md)
  Open questions and deviation #4/#8.
- Should `nextFavorite`/`previousFavorite` ever diverge from `nextStation`/
  `previousStation`, or be removed (they are aliases today)?
- Should the favorites grid adapt its column count to the watch size class
  (40 mm vs 49 mm Ultra)?
- Should the watch render `catalogStationCount` anywhere (shipped but unused)?

## Reference

- `rrradio-ios/rrradioWatch/App.swift` — the watch UI: the four-tab `TabView`
  (Lists / Now Playing / Favorites / Recents), the Now Playing layout, transport
  controls, connection status, active-queue section, boundary lines, and the
  hand-gesture shortcut button.
- `rrradio-ios/rrradioWatch/WatchRemoteModel.swift` — watch-side model:
  `WCSession` activation/reachability, command sending, `primaryPlaybackAction`,
  `canSendCommand`/`canStepStations`, pending buffer, snapshot decode/apply, error
  mapping (`payloadTooLarge`).
- `rrradio-ios/rrradio/WatchRemote/PhoneRemoteControlController.swift` — iPhone
  side: command execution, snapshot construction from the feed pages, list caps
  (30/30/20/60), pending buffer, `WCReplyHandlerBox` Sendable boundary.
- `rrradio-ios/Shared/WatchRemoteProtocol.swift` — shared wire types, the
  command/state enums, `WatchRemoteMessageCodec`, and `constrainedToPayloadLimit`
  degradation (linked from the contract).

## Known deviations

All from `rrradio-ios/internal/audit/2026-05-25-watch-code-review.md`:

- **#3 — commands dropped when unreachable.** A tap that fires while activated but
  with the iPhone unreachable is lost rather than queued; reachability return only
  pulls a snapshot. Intent is queue-and-flush.
- **#4 — stale-mirror pause/resume race.** The primary action chooses pause vs
  resume from the last-received state; under a coalesced-context state flip it can
  send the wrong command. Intended fix: send `toggle`.
- **#5 — `canStepStations` favorites fallback.** Next/previous light up with ≥2
  favorites even with no active queue; stepping then plays a favorite and replaces
  the active queue.
- **#8 — `toggle` is dead wire surface.** Defined and iPhone-handled, never sent by
  the watch.
- **#9 — hand-gesture button accessibility collision.** The invisible double-tap
  button shares "Play"/"Pause" labels with the visible control, producing duplicate
  VoiceOver elements on Now Playing.
- **#11 — full control surface disabled during any in-flight command.** A single
  slow WatchConnectivity round-trip dims and blocks every button.
- **#13 — fixed 3-column favorites grid.** Not adaptive to watch size class.
- **#2 — Smart-Stack widget staleness.** The widget snapshot is written only by the
  watch app, so it goes stale when the watch app is closed while the iPhone keeps
  changing state.
- See also [watch-protocol](../contracts/watch-protocol.md) Known deviations for
  the wire-level framing of #3/#4/#8 and the linear `station(id:)` resolver note.
```
