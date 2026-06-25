# Siri & Shortcuts Specification

```yaml
status: review
platforms: [ios]
reconciled-against: d241aa9
```

## Purpose

Lets a user control rrradio hands-free, without touching the app. iOS exposes a
set of App Intents that Siri, the Shortcuts app, and Spotlight can run: start a
named station, play a named station list, resume the last station, run transport
commands (pause / resume / stop / next / previous), toggle a favorite, arm a
sleep timer or wake alarm, and ask what's playing. Stations and station lists
surface as first-class, searchable system entities so a user can say "Play Grrif
in rrradio", run a shortcut, or tap a Spotlight result and hear audio with no
manual navigation. Query intents (What's Playing, Set Sleep Timer) speak a Siri
answer drawn from a persisted now-playing snapshot, so they work even when the
app is asleep. This surface is iOS-only; web and Android reach the same product
value through their own OS equivalents (PWA / Web Share Target, Android App
Actions / Assistant), which are not yet built.

## Entry points

- **Siri voice** — a spoken phrase matching one of the registered app shortcut
  phrases (see Business rules → Phrases).
- **Shortcuts app** — each intent appears as an action a user can drop into a
  custom shortcut or automation; parameterized intents prompt for the station.
- **Spotlight search** — each known station is indexed as a searchable item;
  tapping a result runs the Play Station intent for that station.
- **Siri Suggestions / Shortcuts gallery** — the app's shortcuts are offered as
  suggested actions; up to 25 stations and all of the user's station lists are
  surfaced as suggested entities.
- **Action Button / Back Tap / Lock Screen / Control Center widgets** — any iOS
  surface that can run an App Intent or Shortcut runs these the same way.

These intents are NOT a visible in-app screen. They are a system-level surface;
their in-app consequences are playback / library / timer state changing and the
Now Playing destination appearing after a launch. Two intents (What's Playing,
Set Sleep Timer) produce only a spoken Siri answer and change nothing on a
sleeping app.

## Layout

This feature has no rrradio-drawn screen. Its visible elements live in iOS
system UI, populated by the app's intent and entity definitions:

| Surface | What shows |
|---|---|
| Shortcuts action list | One row per intent: short title + system glyph (radio, dot.radiowaves.left.and.right, pause.fill, play.fill, list.star, forward.fill, backward.fill, music.note, moon.zzz, alarm). |
| Action parameter summary | Human sentence, e.g. "Play [Station]", "Play list [List]", "Pause rrradio", "Toggle favorite on [Station]", "Set a sleep timer for [Minutes] minutes", "Wake to [Station] at [Time]", "Get what's playing in rrradio". |
| Station picker (parameterized intents) | A searchable list of station entities; each row shows station name (title) and a subtitle. |
| Station list picker (Play Station List) | A searchable list of station-list entities; each row shows list name (title) and "N stations" subtitle. |
| Station entity subtitle | `broadcaster · country` when both known and differ; else broadcaster, else country, else nothing. |
| Spotlight result | Station name (title + display name), description = broadcaster else country, artist = broadcaster, content sources = country, audio content type. |
| Siri response | System confirmation that the intent ran; query intents speak a dialog ("Playing [track] on [station].", "Sleep timer set for N minutes.", "Nothing is playing in rrradio right now."); for app-opening intents the app launches to Now Playing. |

## States

Intents have no rendered loading/empty UI of their own; "state" is the outcome
of running one.

| State | What happens | Actionable |
|---|---|---|
| Resolved + app launches | Play / Play Station List / Play Last / Set Wake Alarm open the app, route to the resolved station (or list head), start playback (Wake Alarm arms, no playback), surface Now Playing after a short delay. | Full app UI. |
| Resolved, app already running | Transport / favorite / sleep-timer intents (which do not open the app) wake the running app via one shared request; it applies the action in place. | Existing UI. |
| Query intent (What's Playing / Set Sleep Timer) | Reads the persisted now-playing snapshot and speaks a Siri dialog; arms the timer only if the snapshot says something is playing. No app launch, no screen. | None (spoken only). |
| Station picker, no query | Up to 25 suggested stations (favorites → recents → custom → cached catalog → bundled order) are listed for selection. | Pick a station. |
| Station picker, query typed | Up to 25 stations whose name contains the query (case-insensitive) are listed. | Pick a station; refine query. |
| Station-list picker | Every station list the user owns is listed (no cap); empty-query lists all, a query filters by case-insensitive name substring. | Pick a list. |
| Empty roster (cold, no catalog) | Picker / suggestions resolve from whatever local sources exist; with none, the bundled snapshot still provides stations. An unresolvable id is a no-op. | None until catalog loads. |
| Unresolved station / list id | The intent posts the request, but on consume the id matches nothing known: silently dropped, no playback, no error dialog. | None. |
| Transport intent, app not running | The action is recorded and no-ops on the next launch (it is not replayed as a stale command). | None. |
| Timed intent (sleep / wake) consumed late | If more than 60 s passed between firing and consume, the request is dropped rather than armed against the wrong moment. | None. |
| Play Last, no recents | No station resolves; no playback starts. | None. |

## Interactions

| Control / gesture | Precondition | Result | Side effects |
|---|---|---|---|
| Run "Play Station" (pick / phrase with station) | Station resolves to a known id | App opens, plays that station with the library queue it belongs to, shows Now Playing after ~300 ms | Pending play-station id stored; `intentPlaybackRequested` posted; recent pushed if catalog station |
| Run "Play Station List" / "Play list X" | List resolves and has ≥1 station | App opens, plays the list's first station inside the full station-list queue, shows Now Playing | Pending list id stored; recent pushed for the head station |
| Run "Play Last Station" / "Start rrradio" | A recent exists | App opens, plays most-recent station, shows Now Playing | Pending play-last flag set; play-station id cleared |
| Run "Pause" | App reachable; stream audible | Running app pauses in place; station stays selected | Pending action `pause`; does NOT open app |
| Run "Resume" | App reachable; paused/error | Running app resumes the current station | Pending action `resume`; does NOT open app |
| Run "Stop" | App reachable; station selected | Running app stops: clears station, queue, metadata; goes idle | Pending action `stop`; does NOT open app |
| Run "Next Station" | App reachable; steppable queue (>1) | App steps forward (circular) and plays the next station | Pending action `nextStation`; no app open |
| Run "Previous Station" | App reachable; steppable queue (>1) | App steps backward (circular) and plays the previous station | Pending action `previousStation`; no app open |
| Run "Toggle Favorite Station" (pick) | Station resolves to a known id | Adds station to favorites, or removes it if already saved | Pending action `toggleFavorite` + station id; library mutated; no app open |
| Run "Set Sleep Timer" (1–720 min) | Snapshot says something is playing | Running app arms a sleep timer that pauses playback after N minutes; Siri says "Sleep timer set for N minutes." | Pending minutes + timestamp stored; no app open; dropped if not consumed within 60 s |
| Run "Set Sleep Timer", nothing playing | Snapshot absent or `isPlaying` false | No timer armed; Siri says "Nothing is playing in rrradio right now." | None |
| Run "Set Wake Alarm" (station + time) | Station resolves to a known id | App opens and arms a wake alarm for the time-of-day of the picked time on that station | Pending station id + "HH:mm" time + timestamp stored; dropped if not consumed within 60 s |
| Run "What's Playing" | — | Siri speaks the current station and track, or "Nothing is playing…" if the snapshot is absent / not playing | None; no app open |
| Type in station picker | Parameterized intent | Filters to ≤25 stations whose name contains the text (case-insensitive) | None |
| Type in station-list picker | Play Station List | Filters all lists by case-insensitive name substring (no cap) | None |
| Tap a Spotlight station result | Station indexed | Runs Play Station for that station id | Same as Play Station |
| Siri disambiguation prompt | Phrase resolves to multiple entities | iOS asks the user to choose from matching stations / lists before running | None until chosen |
| App enters foreground / catalog refreshes | A pending intent/transport request exists | App drains the pending request(s) and applies them | Pending keys cleared on consume |

## Business rules

- **Intent set (12):** Play Station, Play Station List, Play Last Station,
  Pause, Resume, Stop, Next Station, Previous Station, Toggle Favorite Station,
  Set Sleep Timer, Set Wake Alarm, What's Playing.
- **App-opening intents (4):** Play Station, Play Station List, Play Last
  Station, and Set Wake Alarm open the app. All transport, favorite, sleep-timer,
  and query intents do NOT open the app — they target an already-running session
  or just speak an answer.
- **Single wake channel:** every intent records its intent (id, list, action,
  or timer payload) to a pending store and posts one shared
  `intentPlaybackRequested` request; the running app inspects the store to decide
  what to do. Play / Play Last route through the station-consume path; the list,
  sleep-timer, wake-alarm, and transport/favorite paths each have their own
  consume.
- **At most one outcome per drain:** a single transport consume returns one
  action, so a play + transport request arriving in rapid succession does not
  double-fire.
- **Transport / sleep-timer intents are fire-and-no-op-if-dead:** if the app is
  not running, the recorded action is applied (or ignored) on the next launch
  rather than resurrecting playback from a cold start. Only Play / Play Station
  List / Play Last / Set Wake Alarm cold-start or open the app.
- **Two distinct rosters:**
  - **Entity resolution** (pickers, suggestions, Spotlight) draws from, in
    order: favorites → recents → custom stations → cached catalog → bundled
    catalog snapshot.
  - **Consume-side id resolution** (Play / Toggle Favorite / Wake Alarm) draws
    from: catalog browse order → favorites → recents → custom stations →
    station-list members, unioned with the intent-supplied candidate entities.
  - Both de-duplicate by id, first occurrence wins, order preserved.
- **Play Last** resolves to the first entry of recents.
- **Queue carried on Siri play:** a station played by intent inherits the queue
  of wherever it lives in the library — favorites, else the first station list
  containing it, else recents — so "Next Station" steps somewhere sensible after
  a voice launch. A catalog-only station saved nowhere stays a single-item queue.
  Play Station List always plays inside the full list queue.
- **Picker / search limits:** station entity query and suggested-entity lists
  return at most **25** stations. An empty query returns the first 25 of the
  roster; a non-empty query filters by case-insensitive name substring, then
  takes 25. Station-list query and suggestions are **uncapped** (users own few
  lists, and every list name must be speakable in the parameterized phrase).
- **Timed-request expiry (60 s):** sleep-timer and wake-alarm requests stamp the
  time they were fired; on consume, anything older than 60 s is dropped. Arming a
  bedtime sleep timer against the next morning's stream would be actively wrong,
  unlike a stale Pause (a harmless no-op).
- **Sleep-timer / What's-Playing honesty gate:** both read the persisted
  now-playing snapshot. With nothing playing, Set Sleep Timer arms nothing and
  What's Playing reports nothing — Siri never claims success against silence.
- **Spotlight indexing:** each station entity is indexed once when iOS indexes
  the entity set (the entity is an `IndexedEntity`), as audio content with
  keywords `[name, "radio", "rrradio", broadcaster?, country?]` and content
  sources `[country?]`.
- **Activity donation:** every in-app play donates an `org.rrradio.playStation`
  user activity (per-station persistent id, eligible for search + prediction) so
  the played station becomes Spotlight/Siri-predictable.
- **Entity subtitle rule:** stations show `broadcaster · country` when both
  present and unequal; else broadcaster, else country, else title-only. Station
  lists show "N stations".
- **Toggle Favorite** is idempotent per state: present ⇒ remove; absent ⇒ add.
- **Wake-alarm time** is stored as a wall-clock "HH:mm" string; only the
  time-of-day of the picked date matters — the next occurrence resolves at arm
  time.
- **Zero-setup phrases (Apple caps App Shortcuts at 10):** ten intents ship
  spoken phrases — Play Last ("Play last station…", "Start…"), Play Station
  ("Play [Station]…"), Play Station List ("Play list [List]…", "Play my [List]
  list…"), Pause, Resume, Next ("Next station…", "Skip to next…"), Previous
  ("Previous station…", "Skip back…"), What's Playing ("What's playing…", "What
  song is this…"), Set Sleep Timer ("Set a … sleep timer"), Set Wake Alarm
  ("Wake me up with …"). **Stop** and **Toggle Favorite Station** deliberately
  carry no phrases (Pause covers the live-stream-stop utterance; "toggle favorite
  on X" reads awkwardly) but stay fully usable from the Shortcuts app. Every
  phrase interpolates the localized app name; parameterized phrases interpolate
  the station / list entity.

## Data dependencies

- [playback-state-machine](../contracts/playback-state-machine.md) — Play /
  Play Station List / Play Last drive `play(station, queue:)` (→ `loading`);
  Pause → `pause()`; Resume → `resume()`; Stop → `stop()` (→ `idle`, clears
  station/queue/metadata); Next / Previous map to circular queue stepping
  (forward / backward), gated on a steppable queue (>1 station). The intents are
  command sources into this machine; they do not redefine any transition.
- [catalog-schema](../contracts/catalog-schema.md) — station entities are built
  from `Station` records (`id`, `name`, `broadcaster`, `country`); resolution
  uses the local-roster sources and the cache → bundled snapshot fallback ladder
  defined there. Reserved id prefixes (`custom-`, `rb-`) flow through unchanged.
  Station-list entities are built from the user's saved station lists (id, name,
  member count).
- Sleep Timer and Wake Alarm are local timing surfaces, not cross-platform
  contracts; the intents are command sources into them and inherit their arming
  / firing rules. What's Playing reads the same now-playing data published to the
  lock screen, persisted as a snapshot so it survives the app process sleeping.

## Edge cases

- **Unknown station / list id on consume:** dropped silently; no playback, no
  alert. A pending play-station id and a pending play-list id each survive until
  a matching entry shows up, so a cold launch that consumes before the library
  loads doesn't drop the ask.
- **Play Last with empty recents:** no station resolves; no-op.
- **Play Station List with an empty list:** no head station; no playback.
- **Transport intent with no station selected / single-station queue:** Next /
  Previous no-op on an empty or single-station queue (per the state machine's
  stepping precondition); Pause / Resume / Stop on `idle` are no-ops or stop is
  a clear.
- **Cold catalog (first install, no network):** the bundled snapshot still backs
  the picker, suggestions, and id resolution, so intents work offline before any
  network refresh.
- **App killed between firing a transport intent and consuming it:** the action
  is not replayed as a stale auto-play; transport requests are designed for an
  already-running session.
- **Sleep timer / wake alarm consumed >60 s late:** dropped, so a request the
  user spoke at bedtime never arms against the next morning's session.
- **Set Sleep Timer / What's Playing on a sleeping app:** answered from the
  persisted snapshot without launching; if nothing is playing, Siri says so and
  no timer is armed.
- **Force-quit (swipe-kill) while playing:** the snapshot can be left with a
  stale `isPlaying: true`, so What's Playing may describe the last station once
  after a kill. Every regular pause/stop rewrites the snapshot (a `nil` save
  always writes through), correcting it. See *Known deviations*.
- **Rapid sequence (cold launch):** landing-preference, wake-alarm, and intent
  requests can fire near-simultaneously; the Now Playing presentation is
  debounced (~300 ms, single sheet) and each pending request is drained once.
- **Backgrounding:** transport intents are picked up when the app next processes
  the shared request (foreground / catalog-refresh / explicit notification);
  background audio continues per the playback contract regardless.
- **Duplicate ids across sources:** de-duplicated by id with first-source-wins,
  so a favorited catalog station resolves once.
- **Stations without broadcaster/country (test seeds, some community streams):**
  entity subtitle falls back gracefully; Spotlight description/keywords/content
  sources omit the missing fields.

## Accessibility

- Intent titles, parameter summaries, and short titles are spoken by Siri and
  read by VoiceOver in the Shortcuts app verbatim ("Play Station", "Pause
  rrradio", "Toggle favorite on …", "Set a sleep timer for N minutes").
- Query intents (What's Playing, Set Sleep Timer) speak a full-sentence Siri
  answer, voicing the now-playing station/track or confirming the timer — a
  hands-free, eyes-free report for users who can't look at the screen.
- Station and station-list entities expose a display title (name) and subtitle
  (broadcaster · country, or "N stations") that VoiceOver reads in the picker and
  Siri reads back during disambiguation.
- The surface is voice-first by design — it requires no on-screen interaction,
  serving users who cannot or prefer not to navigate the app UI.
- Dynamic Type, contrast, and focus order are owned by the system Shortcuts /
  Spotlight / Siri UI, not by rrradio.
- Post-launch Now Playing accessibility is owned by
  [Now Playing](now-playing.md).

## Localization

- This surface owns these system-facing strings: each intent's **title**,
  **description**, **parameter summary**, **short title**, the **entity type
  display names** ("Station", "Station List"), the **query-intent dialogs**
  (What's Playing / Set Sleep Timer answers, the "Nothing is playing…" guard),
  and the **invocation phrases**.
- Phrases interpolate the localized application name (`\(.applicationName)`) and,
  where parameterized, the station or station-list entity, the minutes count, or
  the time.
- Station names, broadcaster, country values, list names, and track metadata are
  catalog / library / stream data, not localized by this surface.
- Counts appear in the station-list subtitle ("N stations"), the sleep-timer
  summary/dialog ("N minutes"), and the wake-alarm time — candidates for plural
  forms when those strings are translated.
- All strings are defined as localizable resources (`LocalizedStringResource` /
  `IntentDescription`); shipped string catalogs determine which locales are
  actually translated.

## Platform Matrix

| Behavior | Web | iOS | Android |
|---|---|---|---|
| Voice-assistant playback control | Planned (Web Speech / PWA) | Supported | Planned (Assistant / App Actions) |
| OS shortcut actions (Play / transport / favorite) | Planned | Supported | Planned (App Actions) |
| Play a named station list by voice | Not applicable | Supported | Planned |
| Set sleep timer / wake alarm by voice | Not applicable | Supported | Planned |
| Spoken "What's playing" answer | Not applicable | Supported | Planned |
| Station / station-list entity resolution + disambiguation | Not applicable | Supported | Planned |
| System search indexing of stations (Spotlight) | Browser-dependent | Supported | Planned (App Search / Slices) |
| Suggested shortcuts / entities (≤25 stations, all lists) | Not applicable | Supported | Planned |
| Transport / sleep-timer intents target a running session only | Not applicable | Supported | Planned |
| Timed-request expiry (stale sleep/wake dropped) | Not applicable | Supported | Planned |
| Localized invocation phrases (≤10 App Shortcuts) | Not applicable | Supported | Planned |

## Open questions

- Whether transport intents should optionally cold-start the app (today only
  Play / Play Station List / Play Last / Set Wake Alarm open it) for a "Pause"
  said to a stopped app.
- Whether Spotlight results should support deep-linking into Browse / a station
  detail rather than always starting playback.
- Whether the 60 s timed-request lifetime and the swipe-kill stale-snapshot
  window warrant tightening (e.g. clearing the snapshot on a scene-disconnect).
- Picker/search caps (25 stations; uncapped lists) and the name-substring-only
  match are not yet pinned as a cross-platform contract; web/Android equivalents
  are unspecified.

## Reference

- `rrradio/Shortcuts/PlayStationIntent.swift` — the 12 `AppIntent`s
  (`PlayStationIntent`, `PlayStationListIntent`, `PlayLastStationIntent`,
  `PauseRrradioIntent`, `ResumeRrradioIntent`, `StopRrradioIntent`,
  `NextStationIntent`, `PreviousStationIntent`, `ToggleFavoriteStationIntent`,
  `SetSleepTimerIntent`, `SetWakeAlarmIntent`, `WhatsPlayingIntent`), their
  titles / descriptions / parameter summaries / `openAppWhenRun` / query-intent
  `ProvidesDialog`, and the `RrradioShortcuts` `AppShortcutsProvider` (10 phrase
  slots + short titles + glyphs; Stop and Toggle Favorite have no phrases).
- `rrradio/Shortcuts/StationEntity.swift` — `StationEntity` (`AppEntity`,
  `IndexedEntity`): display representation, Spotlight `attributeSet`; and
  `StationEntityQuery` (`EntityStringQuery`): `entities(for:)`,
  `entities(matching:)` (≤25, case-insensitive name contains),
  `suggestedEntities()` (≤25), and `localStations()` roster assembly +
  de-duplication.
- `rrradio/Shortcuts/StationListEntity.swift` — `StationListEntity` (`AppEntity`)
  with "N stations" subtitle, and `StationListEntityQuery` (`EntityStringQuery`,
  uncapped, reads `Library.readStationLists`).
- `rrradio/Shortcuts/IntentPlaybackRequest.swift` — `IntentPlaybackAction`
  enum, the pending-store keys, `timedRequestLifetime` (60 s),
  `requestPlay` / `requestPlayLastStation` / `requestPlayStationList` /
  `requestTransportAction` / `requestToggleFavorite` / `requestSetSleepTimer` /
  `requestArmWakeAlarm`, the `intentPlaybackRequested` notification,
  `consumePendingStation` / `consumePendingTransportAction` /
  `consumePendingStationList` / `consumePendingSleepTimerMinutes` /
  `consumePendingWakeAlarm`, the `playbackQueue(for:…)` library-queue resolver,
  and `IntentNowPlayingSnapshot` (the persisted lock-screen mirror).
- `rrradio/Views/AppRouter.swift` — `consumePendingIntentPlayback`,
  `consumePendingIntentTransportAction`, `IntentTransportOutcome`,
  `consumePendingIntentStationList`, `consumePendingIntentSleepTimerMinutes`,
  `consumePendingIntentWakeAlarm`, and the `playableStations` consume-side roster.
- `rrradio/Views/ContentView.swift` — `playPendingIntentStationIfPossible`,
  `applyPendingIntentTransportActionIfPossible`, the `intentPlaybackRequested`
  observer, and `showNowPlayingSoon` debounce.
- `rrradio/Player/AudioPlayer.swift` — `donatePlaybackActivity` (the
  `org.rrradio.playStation` `NSUserActivity` donation) and
  `persistIntentNowPlayingSnapshot` (writes the snapshot that query intents read).
- `project.yml` — `NSUserActivityTypes: [org.rrradio.playStation]`.

## Known deviations

- **Stale now-playing snapshot after a swipe-kill.** A force-quit while playing
  can leave the persisted snapshot with `isPlaying: true`, so What's Playing may
  describe the last station once after the kill before the next play/stop
  rewrites it. The intent is that the snapshot always reflects live playback;
  this gap is acknowledged in the implementation (a code comment in
  `IntentPlaybackRequest.swift`) but not yet in a formal `rrradio-ios/internal/audit/`
  entry. File one if it warrants a fix and link it here.

Otherwise none recorded. File any divergence between shipped intent behavior and
this intent under `rrradio-ios/internal/audit/` and link it here.
