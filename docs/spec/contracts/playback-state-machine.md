# Playback State Machine Contract

```yaml
status: review
platforms: [web, ios, android]
reconciled-against: d241aa9
```

## Purpose

The formal machine behind [Playback](../playback.md). It pins the cross-platform
invariants of the live-stream player: the legal playback states and transitions,
the stream-retry policy, the playback-queue model and stepping semantics, and the
media-control surface (now-playing fields, remote commands). Every platform's
player must expose these states, honor these transitions, and respect these queue
and retry rules — even where the native audio engine differs.

Honored by: web (`HTMLAudioElement` / `hls.js`), iOS (AVPlayer reference), Android
(Media3/ExoPlayer). This contract does not restate prose from
[Playback](../playback.md) or [Now Playing](../features/now-playing.md); it makes
their behavior machine-checkable.

## Definition

### States

Five states. Exactly one is active at a time.

```
idle · loading · playing · paused · error(message)
```

The watch remote mirrors this 5-case set 1:1 as `WatchRemotePlaybackState`; see
[watch-protocol](watch-protocol.md).

- `error` carries a human-readable message string.
- `idle` is the only state with no selected station.
- The other four states always have a selected `current` station.

### Transition table

`S` is the start state; the trigger column is the event; the target is the
resulting state. Triggers are user actions, media-control commands, player
callbacks, and system (audio-session) events.

| From | Trigger | To | Notes |
|---|---|---|---|
| any | `play(stationB)` (new station) | `loading` | Tears down current source, builds a new one, selects B, resets retry budget. |
| `playing`/`loading`/`paused` | `play(sameStation)` | `playing` | Unpause in place; no source rebuild. From `error` or failed item → manual retry (rebuild). |
| `loading` | item ready, rate > 0 | `playing` | |
| `loading` | item ready, rate == 0 | `paused` | |
| `playing` | `pause()` / pause command | `paused` | Keeps station selected. Cancels pending retry. |
| `loading` | `pause()` / pause command | `paused` | |
| `paused`/`error` | `resume()` / play command / toggle | `playing` | From `error`, resume rebuilds the source (manual retry). |
| `playing` | toggle | `paused` | |
| `paused`/`error` | toggle | `playing` | |
| `idle`/`loading` | toggle | (unchanged) | No-op. |
| `playing`/`loading` | item failed / stalled / failed-to-end | `loading` → … | Schedules automatic retry (see policy); `error` after budget. |
| `playing`/`loading` | retry budget exhausted | `error(msg)` | |
| `playing`/`loading` | geo-restricted failure | `error(geoMsg)` | No retry; permanent. |
| `loading` (during retry) | retry rebuild fires | `loading` | New source; converges to `playing` or re-fails. |
| `playing`/`loading` | interruption began | `paused` | Session deactivated; resume armed if it was audible. |
| `paused` (armed) | interruption ended + shouldResume | `playing` | Reactivates session, resumes. |
| `playing`/`loading` | output route lost (e.g. headphones unplugged) | `paused` | |
| `playing`/`loading` | media services reset | `loading` | Rebuilds player + session, replays if it was audible; else `paused`. |
| any (station selected) | `stop()` | `idle` | Clears station, queue, metadata, now-playing; deactivates session. |
| `loading`/`playing`/`error` | network restored | `loading` | Auto-reconnect rebuilds the source for the current station. |
| `paused`/`idle` | network restored | (unchanged) | Paused/idle do not auto-reconnect. |

### Auto-resume predicate

Used by network-restored reconnection:

- Reconnect iff a station is selected AND state ∈ {`loading`, `playing`, `error`}.
- `paused` and `idle` never auto-reconnect.

### Stream-retry policy (automatic)

Fires on a transient playback problem: item `failed`, `failedToPlayToEndTime`, or
`playbackStalled`.

- **Eligibility:** automatic retry is armed only after a user-initiated `play`/
  `resume`. `pause`, `stop`, and interruption-began disarm it.
- **Budget:** max **3** attempts per station session.
- **Backoff:** delay before attempt _n_ = `min(30, 2^(min(n−1, 5)))` seconds →
  attempt 1 = 1s, attempt 2 = 2s, attempt 3 = 4s (capped at 30s for higher _n_).
- **Mechanism:** retry **rebuilds the media source** (new player item from the
  station stream URL) and replays — it does NOT merely call play again. State goes
  to `loading` while the rebuild is pending.
- **Single-flight:** at most one retry is scheduled at a time; the scheduler is a
  no-op while a retry is already pending.
- **Exhaustion:** after attempt 3 fails, disarm and enter `error(message)`.
- **Budget reset:** after the stream plays healthily (rate > 0) for **5 minutes**
  continuously, the attempt counter resets to 0, so a long-lived stream that
  hiccups again later gets a fresh budget.
- **Disarm triggers:** `pause`, `stop`, interruption-began, geo-restricted
  failure, and budget exhaustion all clear the armed flag and cancel pending
  retry/reset tasks.
- **Geo-restricted streams never retry.** A station whose curated `availableIn`
  excludes the listener's region is treated as a permanent failure: skip retry,
  set `error` with the friendly region-locked message. The `availableIn` field
  and its normalization are defined in [catalog-schema](catalog-schema.md).

### Manual retry

A user `play`/`resume`/toggle on a station currently in `error` (or whose item
already failed) triggers a manual retry: full teardown + fresh `play` of the same
station with the same queue, re-arming automatic retry and resetting the budget.

### Stream-quality selection

The catalog MAY ship multiple delivery variants per station as an ordered
`streams: StreamVariant[]` (best→worst, `streams[0].url === streamUrl`); see
[catalog-schema](catalog-schema.md). When present, the player selects which
variant to play from a **persisted, global listener preference**:

- **Preference:** `best` (default) or `data` (data-saver) — one value, stored
  locally (web: `localStorage` key `rrradio.qualityPref.v1`), applied to every
  station.
- **Per-station resolution:** pick the variant whose `tier` matches the
  preference; if that tier is absent, **fall back toward `best`** (`data` walks
  down from `best` to the lowest available; `best` always resolves to
  `streams[0]`). A single-stream station (no `streams`) ignores the preference
  and plays `streamUrl`.
- **Failure fallback:** when the selected variant fails to play, the retry
  rebuild advances to the next **lower** variant before surfacing `error`; the
  variant list bounds the attempt budget (see Stream-retry policy). A
  single-stream station keeps the one-rebuild-then-error behaviour.
- **Changing the preference** re-plays the current station on the newly chosen
  variant. HLS sources still adapt bitrate internally *within* a chosen variant.
- A non-interactive stream-quality **meter** (a 1–4 indicator derived from a
  variant's `bitrate`/`codec`) is a display affordance, not the selector.

**Implementation status:** the catalog ships `streams[]` now; the web player
selection + Now Playing toggle and the iOS parity are **Planned** (the wire
schema lands first so clients adopt incrementally). See
`design/decisions/001-stream-variants-and-catalog-collapse.md`.

### Playback queue model

A queue is `(source, sourceID?, stations[])` with a `current` station.

- **Sources:** `browse`, `favorites`, `recents`, `stationList`, `single`. The
  watch remote mirrors this source enum and the step semantics below as
  `WatchPlaybackQueueSource`; see [watch-protocol](watch-protocol.md).
- **Construction:** when `play` is called with a queue, the queue is rebuilt
  around the started station as `current`. When `play` is called with no queue,
  if the current queue does not already contain the station, a `single`-source
  queue holding just that station replaces it.
- **De-duplication:** stations are de-duplicated by `id`, first occurrence wins,
  original order preserved. If `current` is not already present it is inserted at
  index 0.
- **Stepping is circular** (wrap-around) within the queue.
- **Stepping precondition:** stepping is available iff a station is selected AND
  the active queue holds more than one station.

#### Stepping semantics

| Condition | `previous` (backward) | `next` (forward) |
|---|---|---|
| Empty queue | nil (no-op) | nil (no-op) |
| `current` not in queue | last station | first station |
| Single-station queue | the only station (step is a no-op) | the only station |
| Multi-station queue | `stations[(i − 1 + n) % n]` | `stations[(i + 1) % n]` |

Stepping to a station that equals `current` is a no-op (does not rebuild).
Stepping to a different station calls `play` on it (rebuild, `loading`).

#### Queue mutation while playing

- **Replace** a station by id: substitute in-place in queue and in `current`;
  preserves order and source. Used when the catalog refreshes a station's fields.
- **Remove** a station by id: filter it out. If the queue becomes empty, the
  active queue is cleared (stepping becomes unavailable); the current station
  keeps playing.

### Audio-session + media-control contract

- **Session category:** playback (continues in background; mixes per platform
  background-audio entitlement). The category is set **dormant** at startup —
  configured but not activated — so an idle app never registers as the system
  Now Playing app or shows an empty lock-screen card.
- **Lazy activation:** the session is activated only when audible work begins:
  on `play`, on `resume`, and when the wake keep-alive starts.
- **Deactivation:** the session is released (with notify-others-on-deactivation)
  whenever nothing is playing — on `stop`, on interruption-began, when
  now-playing is cleared (no `current` station) and no wake keep-alive is
  running, and when the wake keep-alive stops with the player idle. A user
  `pause` keeps the session active so resume from the lock screen is instant.
- **Wake keep-alive (iOS-only):** a near-silent looped tone can hold the audio
  session alive while the app waits to start playback at a scheduled wake time;
  starting `play` tears it down and starts the real stream. It supports the
  wake-to-radio alarm and is not part of the cross-platform state machine.
- **Now-playing info published** (see Detail) so the lock screen / system surface
  shows station identity, current track, live-stream flag, playback rate, queue
  position, and artwork.
- **Remote commands handled:** play, pause, toggle play/pause, previous track
  (= step backward), next track (= step forward).
- **Remote commands disabled:** skip-forward, skip-backward, change-playback-
  position — live streams have no seekable timeline.
- **Previous/next enablement** mirrors the stepping precondition: enabled iff the
  active queue has more than one station.

## Detail

### State fields

| State | Has `current`? | Now-playing playback state | Meaning |
|---|---|---|---|
| `idle` | no | stopped | Nothing selected; session may be deactivated. |
| `loading` | yes | playing | Source building / buffering / retry pending. Reported as "playing" to the system so the lock screen does not flicker to paused. |
| `playing` | yes | playing | Audible, rate > 0. |
| `paused` | yes | paused | User- or system-paused; station retained. |
| `error(message)` | yes | stopped | Playback failed; `message` is user-facing. Treated as "waiting for connection". |

### Retry parameters

| Parameter | Value | Meaning | Default |
|---|---|---|---|
| Max attempts | 3 | Automatic retries per station session before `error`. | 3 |
| Backoff | `min(30, 2^min(n−1,5))` s | Delay before attempt _n_ (1s, 2s, 4s, …, ≤30s). | as formula |
| Healthy reset | 5 min | Continuous rate > 0 before the attempt counter resets to 0. | 300s |
| Single-flight | 1 | At most one scheduled retry at a time. | 1 |
| Geo-restricted | no retry | Permanent failure; keep curated message. | — |

### Queue fields

| Field | Type | Optional? | Meaning | Default |
|---|---|---|---|---|
| `source` | enum {`browse`,`favorites`,`recents`,`stationList`,`single`} | no | Where the queue came from. | `single` |
| `sourceID` | string | yes | Identifies the specific list when source is list-like (e.g. a station-list id). | nil |
| `stations` | array of stations | no | De-duplicated by id, order preserved, `current` inserted at 0 if absent. | — |
| `current` | station | construction-only | The playing station; used to position the queue. | — |
| queue index | int | derived | Zero-based index of `current` in `stations`. | — |
| queue count | int | derived | `stations.count`. | — |

### Now-playing info fields (system media surface)

The track/program fields below (title, artist, program name, cover) are fed by
the `NowPlayingMetadata` struct produced in
[metadata-fetchers](metadata-fetchers.md).

| Field | Type | Value | When |
|---|---|---|---|
| Title | string | Station name; `"<station> - <program>"` when a program name is known; sleep-timer suffix `" - Sleep in <n>m"` appended when armed. | always when station selected |
| Artist (subtitle) | string | `"<artist> - <title>"` for music tracks (or bare `<title>` when no artist); else a per-state label — `Loading` / `Live` / `Paused` / `Error` (and, in the defensive `idle`-with-station branch, the station's uppercased country code or `Standby`). | when a station is selected |
| Media type | enum | audio | always |
| Is live stream | bool | true | always |
| Playback rate | number | 1.0 when state == `playing`, else 0.0 | always |
| Queue index | int | position of `current` | when an active multi-element queue exists |
| Queue count | int | queue length | when an active multi-element queue exists |
| Artwork | image | track cover, else station favicon; sleep-timer badge overlaid when armed | when an image resolves |

### Remote commands

| Command | Handled? | Maps to |
|---|---|---|
| play | yes | resume |
| pause | yes | pause |
| toggle play/pause | yes | toggle |
| previous track | yes (when steppable) | step backward |
| next track | yes (when steppable) | step forward |
| skip forward | disabled | — |
| skip backward | disabled | — |
| change playback position | disabled | — |

## Examples

### Cold start of a browse-queued station

```
state: idle, current: nil
→ play(stationB, queue: {source: browse, stations: [A, B, C], current: B})
state: loading, current: B, queue: browse [A, B, C] @ index 1
→ item ready, rate > 0
state: playing
now-playing: { title: "<B.name>", isLiveStream: true, rate: 1.0,
               queueIndex: 1, queueCount: 3 }
```

### Circular stepping at queue end

```
queue: favorites [A, B, C], current: C (index 2)
→ next track command
step forward → stations[(2 + 1) % 3] = A
→ play(A)  → loading → playing
queue: favorites [A, B, C], current: A (index 0)
→ previous track command
step backward → stations[(0 - 1 + 3) % 3] = C
```

### Transient stall with automatic retry

```
state: playing, retryAttempt: 0
→ playbackStalled
schedule retry: attempt 1, delay 1s, state → loading
→ (1s) rebuild source, replay
→ item ready, rate > 0 → playing
→ 5 min continuous playback → retryAttempt reset to 0
```

### Retry exhaustion

```
state: playing
→ item failed → attempt 1 (1s) → loading → fails
→ attempt 2 (2s) → loading → fails
→ attempt 3 (4s) → loading → fails
→ attempt 4 > max(3): disarm, state → error("stream unavailable")
```

### Geo-restricted station (no retry)

```
state: loading
→ item failed, availableIn excludes listener region
state: error("<Country> only — region-locked by the broadcaster.")
(no retry scheduled)
```

### Audio interruption (phone call) and resume

```
state: playing
→ interruption began
pause, deactivate session, arm resume; state → paused
→ interruption ended, options.shouldResume == true
reactivate session, resume; state → playing
```

## Versioning & evolution

- The state set, retry budget, backoff curve, queue sources, and remote-command
  set are the versioned surface. Adding a state or source, or changing the retry
  numbers, is a contract change and must update this file plus
  [Playback](../playback.md).
- The station payload carries `schemaVersion` (currently `1`); this machine
  consumes only `streamUrl`, `streams`, `availableIn`, `bitrate`, `codec`. See
  the station schema (Station model) for evolution of those fields.
- **Backward compatibility:** a missing `availableIn` means no geo restriction
  (the common case) — retry proceeds normally. A queue with an unknown `source`
  string should degrade to `single`.
- **Forward compatibility:** platforms must tolerate now-playing fields they do
  not render and remote commands they cannot wire; absence of queue index/count
  simply hides previous/next.

## Failure & fallback

| Input | Behavior |
|---|---|
| Malformed / unreachable stream URL | Item fails → automatic retry (≤3) → `error(message)`. |
| Stall mid-playback | Treated as transient → retry from `playing`/`loading`. |
| Geo-restricted (curated `availableIn`) | No retry; `error` with friendly region message; message preserved across any defensive retry-exhaustion branch. |
| Network lost then restored | Auto-reconnect only from {`loading`,`playing`,`error`}; rebuilds source. Never from `paused`/`idle`. |
| Output route lost (e.g. unplugged headphones) | Pause (do not keep playing aloud on the speaker). |
| Audio interruption | Pause + deactivate session; resume only if it was audible AND the system grants `shouldResume`. |
| Media services reset | Rebuild player and session; replay if it was audible, else `paused`; if no station, `idle`. |
| Step on empty / single queue | No-op or stays on the only station; never jumps to an unrelated catalog station. |
| Removing the last queue entry | Active queue cleared; current station keeps playing; stepping disabled. |
| Missing track metadata | Now-playing subtitle falls back to a state label (`Live`/`Paused`/…) or country code; artwork falls back to station favicon. |

## Platform obligations

### Web

- Exposes the five states (`idle`/`loading`/`playing`/`paused`/`error`) as a
  flat enum. It honors the user-driven transitions (play/pause/toggle/stop) and
  the play-rebuild rule, but does **not** implement the system-event transitions
  (audio interruption, output-route lost, media-services reset) or the
  network-restored auto-reconnect predicate — those are iOS/native concerns.
- Treats `HTMLAudioElement` as unreliable after failure: **rebuilds the source**,
  does not only re-call play (per [Playback](../playback.md) Recovery). Every
  `play()` tears down and rebuilds; live streams are never resumed in place.
- **Planned: the automatic retry budget/backoff is not yet implemented.** Web
  recovery today is (a) a stall **watchdog** — if `currentTime` stops advancing
  for ~8s it forces one fresh rebuild — and (b) surfacing the `<audio>` `error`
  event as `error(message)`. There is no attempt counter, no `min(30, 2^…)`
  backoff curve, and no healthy-reset timer. The ≤3-budget exponential-backoff
  reconnect is deferred (see the `Phase 4` note in `src/player.ts`).
- Uses the Media Session API where supported to wire play/pause/previous/next and
  to publish a reduced now-playing surface — title, artist, album, artwork only.
  It does **not** publish the live-stream flag, playback rate, or queue
  index/count via Media Session.
- **Divergence: no cross-platform queue model.** Web has no
  `(source, sourceID, stations[])` queue, no browse/favorites/recents/
  stationList/single sources, and no circular stepping over an active queue.
  Previous/next are wired unconditionally (not gated on a steppable queue) and
  cycle the user's **favorites list only**; when the current station is not in
  favorites, skip jumps to the first/last favorite, and skip is a no-op when
  there are no favorites. The "no jump to unrelated stations" rule is therefore
  not honored — skip can land on any favorite.
- Geo-restricted streams: surfaces the friendly region-locked message and does
  not retry (consistent — there is no automatic retry to suppress).

### iOS (reference)

- States, transitions, retry policy, queue model, and media-control surface are
  the reference implementation in this contract.
- Rebuild the AVPlayer item on retry; handle interruption, route-change, and
  media-services-reset session events as above.
- Publish all listed now-playing fields; disable skip/seek commands.

### Android

The first Android port runs playback in a foreground `MediaSessionService`
(Media3/ExoPlayer) — the Android-native mechanic for background audio plus
lock-screen / notification controls, the counterpart to iOS's background-audio
entitlement + remote-command center. It mirrors the **state model** and the
**queue/stepping** core, with a divergent retry budget and no system-event or
geo handling yet.

- **Supported — five states.** A `PlayerState` enum (`idle`/`loading`/`playing`/
  `paused`/`error`) mirrors the contract's 5-case set 1:1, driven by ExoPlayer
  `Player.Listener` callbacks (`onPlaybackStateChanged`, `onIsPlayingChanged`,
  `onPlayerError`). User-driven transitions (play/toggle/pause/stop, step) and
  the play-rebuild rule are honored. `loading` is reported while buffering;
  `stop` clears station, queue, and metadata back to `idle`.
- **Supported — circular queue + stepping.** A real `(stations[])` queue with
  de-duplication by id and circular wrap-around stepping (`% n`), gated on a
  steppable queue (more than one station) both in the service `step()` and in the
  UI (`canStepStations = queueSize > 1`). Previous/next map to step
  backward/forward.
- **Partial — retry rebuilds, but the budget and backoff diverge.** Retry
  rebuilds the player item (`setMediaItems` + `prepare`, single-flight) — it does
  not merely re-call play. **Divergence:** the budget is **2** attempts (not 3),
  the backoff is a linear `attempt × 1.5 s` capped at 5 s (1.5 s, 3 s — not the
  `min(30, 2^(n−1))` curve), and there is **no 5-minute healthy-reset timer** —
  the counter resets whenever the player reaches `STATE_READY`. Aligning the
  budget (3), the exponential backoff curve, and the healthy-reset window to the
  contract is **Planned**.
- **Supported — playlist resolution.** `.pls` and `.m3u` are fetched and parsed
  to the underlying stream URL before playback (`StreamUrlResolver`); `.m3u8` is
  left native — ExoPlayer plays HLS directly, so no hls.js-style shim is needed
  (the Android counterpart to the web HLS path).
- **Partial — now-playing surface.** The Media3 session publishes the
  notification/lock-screen card with transport controls and the station title +
  country-code subtitle. **Gap:** it does not yet publish the full now-playing
  field set (live-stream flag, playback rate, queue index/count, track-cover
  artwork via the system surface) — those are tracked in app state but not pushed
  to `MediaMetadata`. Publishing the full field set is **Planned**.
- **Planned — queue sources.** The queue is built from the visible station list
  but carries no `source`/`sourceID` (browse/favorites/recents/stationList/
  single) tagging; the source enum and list identity are **Planned** toward
  parity.
- **Planned — system-event transitions.** Audio interruption / audio-focus loss,
  output-route-lost ("becoming noisy"), media-services-reset, and
  network-restored auto-reconnect are **not yet wired** (no audio-focus,
  becoming-noisy receiver, or connectivity callback in the service). These are
  **Planned**; the native mechanics will be `AudioManager` audio-focus +
  `ACTION_AUDIO_BECOMING_NOISY` + a `ConnectivityManager` network callback,
  standing in for iOS's `AVAudioSession` interruption / route-change /
  media-services-reset handlers.
- **Planned — geo-restricted = no retry.** Not implemented: the Station model has
  no `availableIn` field (its `geo` field is lat/long coordinates, unrelated), so
  geo-restricted failures currently retry like any transient error. The
  curated-region permanent-failure path is **Planned**.

## Open questions

- **Listener-selectable stream quality (`best`/`data`).** **Resolved (schema) /
  Planned (clients).** The catalog now ships per-variant URLs as `streams[]`
  ([catalog-schema](catalog-schema.md)), and the preference + per-station
  resolution + failure-fallback model is defined above under "Stream-quality
  selection". What remains is implementation: the web player selection + Now
  Playing toggle and iOS parity are not yet shipped. See
  `design/decisions/001-stream-variants-and-catalog-collapse.md`.
- **Pause-time session deactivation.** Whether to deactivate the audio session on
  a long pause (vs. keeping it active for fast resume) is an unresolved tradeoff;
  see Known deviations for the related shipped gap.
- **Backoff curve uniformity.** The exact backoff per attempt is currently an iOS
  reference value; web/Android need only honor "≤3 attempts, growing delay, no
  tight loop" unless the curve is promoted to a hard cross-platform number.

## Reference

- **Related contracts:** [watch-protocol](watch-protocol.md) (mirrors the 5-case
  state enum, the queue-source enum, and the step semantics),
  [metadata-fetchers](metadata-fetchers.md) (produces the `NowPlayingMetadata`
  this machine's now-playing-info table consumes),
  [catalog-schema](catalog-schema.md) (defines `availableIn` and the other
  `Station` fields this machine reads).
- `rrradio-ios/rrradio/Player/AudioPlayer.swift` — `State` enum, transitions,
  retry scheduler (`scheduleStreamRetry`, `rebuildCurrentStreamItem`,
  `scheduleHealthyPlaybackRetryResetIfNeeded`), backoff
  (`defaultStreamRetryDelayNanoseconds`), session handling
  (`prepareAudioSessionCategory` dormant-at-init, `configureAudioSession`/
  `deactivateAudioSession`, `clearNowPlaying`, `startWakeKeepAlive`/
  `stopWakeKeepAlive`, interruption / route-change /
  media-services-reset handlers), remote commands (`wireRemoteCommands`,
  `updateRemoteStationCommandAvailability`), now-playing (`updateNowPlaying`,
  `nowPlayingPlaybackState`), auto-reconnect
  (`reconnectCurrentAfterConnectivityRestored`,
  `shouldAutoResumeAfterConnectivityRestored`).
- `rrradio-ios/Shared/StationPlaybackQueue.swift` — `Source` enum, de-dup
  (`uniqueStations`), circular `station(from:direction:)`, `queueInfo`,
  `replacingStation`/`removingStation`.
- `rrradio-ios/Shared/Station.swift` — `streamUrl`, `availableIn`, `bitrate`,
  `codec`, `schemaVersion` consumed by this machine.

## Known deviations

- **Audio session deactivation (slice 5 A2 / slice 24 N6) — largely remediated.**
  The audit flagged that shipped iOS code left `AVAudioSession` active across every
  stop path; only interruption-began deactivated. At the reconciled commit this is
  mostly fixed: `stop`, the now-playing-cleared path, and wake-keep-alive stop (when
  idle) now deactivate, so the slice 24 N6 close-player surface releases the session.
  `pause` still deliberately keeps the session active (fast lock-screen resume —
  defensible per the audit), and `teardownPlayer` does not itself deactivate but is
  only reached from callers that do. See
  `rrradio-ios/internal/audit/2026-05-25-ios-code-review-slice5.md` (A2),
  `…-slice24.md` (N6), and the remediation plan in
  `rrradio-ios/internal/audit/2026-05-25-fixes-prioritized.md` (PR 3).
