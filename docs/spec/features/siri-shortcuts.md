# Siri & Shortcuts Specification

```yaml
status: draft
platforms: [ios]
reconciled-against: 9336321
```

## Purpose

Lets a user control rrradio hands-free, without touching the app. iOS exposes a
set of App Intents that Siri, the Shortcuts app, and Spotlight can run: start a
named station, resume the last station, and run transport commands
(pause / resume / stop / next / previous) and a favorite toggle on the live
stream. Stations surface as first-class, searchable system entities so a user
can say "Play Grrif in rrradio", run a shortcut, or tap a Spotlight result and
hear audio with no manual navigation. This surface is iOS-only; web and Android
reach the same product value through their own OS equivalents (PWA / Web Share
Target, Android App Actions / Assistant), which are not yet built.

## Entry points

- **Siri voice** — a spoken phrase matching one of the registered app shortcut
  phrases (see Business rules → Phrases).
- **Shortcuts app** — each intent appears as an action a user can drop into a
  custom shortcut or automation; parameterized intents prompt for the station.
- **Spotlight search** — each known station is indexed as a searchable item;
  tapping a result runs the Play Station intent for that station.
- **Siri Suggestions / Shortcuts gallery** — the app's shortcuts are offered as
  suggested actions; up to 25 stations are surfaced as suggested entities.
- **Action Button / Back Tap / Lock Screen / Control Center widgets** — any iOS
  surface that can run an App Intent or Shortcut runs these the same way.

These intents are NOT a visible in-app screen. They are a system-level surface;
their only in-app consequence is playback / library state changing and the Now
Playing destination appearing after a launch.

## Layout

This feature has no rrradio-drawn screen. Its visible elements live in iOS
system UI, populated by the app's intent and entity definitions:

| Surface | What shows |
|---|---|
| Shortcuts action list | One row per intent: short title + system glyph (radio, dot.radiowaves.left.and.right, pause.fill, play.fill, stop.fill, forward.fill, backward.fill, heart). |
| Action parameter summary | Human sentence, e.g. "Play [Station]", "Pause rrradio", "Toggle favorite on [Station]". |
| Station picker (parameterized intents) | A searchable list of station entities; each row shows station name (title) and a subtitle. |
| Station entity subtitle | `broadcaster · country` when both known and differ; else broadcaster, else country, else nothing. |
| Spotlight result | Station name (title + display name), description = broadcaster else country, artist = broadcaster, audio content type. |
| Siri response | System confirmation that the intent ran; for app-opening intents the app launches to Now Playing. |

## States

Intents have no rendered loading/empty UI of their own; "state" is the outcome
of running one.

| State | What happens | Actionable |
|---|---|---|
| Resolved + app launches | Play / Play Last open the app, route to the resolved station, start playback, surface Now Playing after a short delay. | Full app UI. |
| Resolved, app already running | Transport / favorite intents (which do not open the app) wake the running app via one shared request; it applies the action in place. | Existing UI. |
| Station picker, no query | Up to 25 suggested stations (favorites → recents → custom → catalog order) are listed for selection. | Pick a station. |
| Station picker, query typed | Up to 25 stations whose name contains the query (case-insensitive) are listed. | Pick a station; refine query. |
| Empty roster (cold, no catalog) | Picker / suggestions resolve from whatever local sources exist; with none, the bundled snapshot still provides stations. An unresolvable id is a no-op. | None until catalog loads. |
| Unresolved station id | The intent posts the request, but on consume the id matches no known station: silently dropped, no playback, no error dialog. | None. |
| Transport intent, app not running | The action is recorded and no-ops on the next launch (it is not replayed as a stale command). | None. |
| Play Last, no recents | No station resolves; no playback starts. | None. |

## Interactions

| Control / gesture | Precondition | Result | Side effects |
|---|---|---|---|
| Run "Play Station" (pick / phrase with station) | Station resolves to a known id | App opens, plays that station, shows Now Playing after ~300 ms | Pending play-station id stored; `intentPlaybackRequested` posted; recents updated by playback |
| Run "Play Last Station" / "Start rrradio" | A recent exists | App opens, plays most-recent station, shows Now Playing | Pending play-last flag set; play-station id cleared |
| Run "Pause" | App reachable; stream audible | Running app pauses in place; station stays selected | Pending action `pause`; does NOT open app |
| Run "Resume" | App reachable; paused/error | Running app resumes the current station | Pending action `resume`; does NOT open app |
| Run "Stop" | App reachable; station selected | Running app stops: clears station, queue, metadata; goes idle | Pending action `stop`; does NOT open app |
| Run "Next Station" | App reachable; steppable queue (>1) | App steps forward (circular) and plays the next station | Pending action `nextStation`; no app open |
| Run "Previous Station" | App reachable; steppable queue (>1) | App steps backward (circular) and plays the previous station | Pending action `previousStation`; no app open |
| Run "Toggle Favorite" (pick / phrase with station) | Station resolves to a known id | Adds station to favorites, or removes it if already saved | Pending action `toggleFavorite` + station id; library mutated; no app open |
| Type in station picker | Parameterized intent | Filters to ≤25 stations whose name contains the text (case-insensitive) | None |
| Tap a Spotlight station result | Station indexed | Runs Play Station for that station id | Same as Play Station |
| Siri disambiguation prompt | Phrase resolves to multiple stations | iOS asks the user to choose from matching entities before running | None until chosen |
| App enters foreground / catalog refreshes | A pending intent/transport request exists | App drains the pending request(s) and applies them | Pending keys cleared on consume |

## Business rules

- **Intent set (8):** Play Station, Play Last Station, Pause, Resume, Stop,
  Next Station, Previous Station, Toggle Favorite Station.
- **App-opening intents (2):** Play Station and Play Last Station open the app.
  All transport and favorite intents do NOT open the app — they target an
  already-running session.
- **Single wake channel:** every intent records its intent (id and/or action)
  to a pending store and posts one shared `intentPlaybackRequested` request; the
  running app inspects the store to decide what to do. Play / Play Last route
  through the station-consume path; everything else through the
  transport-action path.
- **At most one outcome per drain:** a single consume call returns one play
  outcome and one transport outcome, so a play + transport request arriving in
  rapid succession does not double-fire.
- **Transport intents are fire-and-no-op-if-dead:** if the app is not running,
  the recorded action is applied (or ignored) on the next launch rather than
  resurrecting playback from a cold start. Only Play / Play Last cold-start
  audio.
- **Station resolution roster** (de-duplicated by id, first occurrence wins,
  order preserved): favorites → recents → custom stations → cached catalog →
  bundled catalog snapshot. The play-consume path additionally unions the
  intent-supplied candidate entities with this local roster.
- **Play Last** resolves to the first entry of recents.
- **Picker / search limits:** entity query and suggested-entity lists return at
  most **25** stations. An empty query returns the first 25 of the local roster;
  a non-empty query filters by case-insensitive name substring, then takes 25.
- **Spotlight indexing:** each station entity is indexed once when iOS indexes
  the entity set (the entity is an `IndexedEntity`), as audio content with
  keywords `[name, "radio", "rrradio", broadcaster?, country?]`.
- **Activity type:** the app advertises the `org.rrradio.playStation` user
  activity type for handoff/indexing of the play action.
- **Entity subtitle rule:** `broadcaster · country` when both present and
  unequal; else broadcaster, else country, else title-only.
- **Toggle Favorite** is idempotent per state: present ⇒ remove; absent ⇒ add.

## Data dependencies

- [playback-state-machine](../contracts/playback-state-machine.md) — Play /
  Play Last drive `play(station)` (→ `loading`); Pause → `pause()`; Resume →
  `resume()`; Stop → `stop()` (→ `idle`, clears station/queue/metadata); Next /
  Previous map to circular queue stepping (forward / backward), gated on a
  steppable queue (>1 station). The intents are command sources into this
  machine; they do not redefine any transition.
- [catalog-schema](../contracts/catalog-schema.md) — station entities are built
  from `Station` records (`id`, `name`, `broadcaster`, `country`); resolution
  uses the same local-roster sources and the cache → bundled snapshot fallback
  ladder defined there. Reserved id prefixes (`custom-`, `rb-`) flow through
  unchanged.

## Edge cases

- **Unknown station id on consume:** dropped silently; no playback, no alert.
- **Play Last with empty recents:** no station resolves; no-op.
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
- **Rapid sequence (cold launch):** landing-preference, wake-alarm, and intent
  requests can fire near-simultaneously; the Now Playing presentation is
  debounced (~300 ms, single sheet) and each pending request is drained once.
- **Backgrounding:** transport intents are picked up when the app next processes
  the shared request (foreground / catalog-refresh / explicit notification);
  background audio continues per the playback contract regardless.
- **Duplicate ids across sources:** de-duplicated by id with first-source-wins,
  so a favorited catalog station resolves once.
- **Stations without broadcaster/country (test seeds, some community streams):**
  entity subtitle falls back gracefully; Spotlight description/keywords omit the
  missing fields.

## Accessibility

- Intent titles, parameter summaries, and short titles are spoken by Siri and
  read by VoiceOver in the Shortcuts app verbatim ("Play Station", "Pause
  rrradio", "Toggle favorite on …").
- Station entities expose a display title (name) and subtitle
  (broadcaster · country) that VoiceOver reads in the picker and Siri reads back
  during disambiguation.
- The surface is voice-first by design — it requires no on-screen interaction,
  serving users who cannot or prefer not to navigate the app UI.
- Dynamic Type, contrast, and focus order are owned by the system Shortcuts /
  Spotlight / Siri UI, not by rrradio.
- Post-launch Now Playing accessibility is owned by
  [Now Playing](now-playing.md).

## Localization

- This surface owns these system-facing strings: each intent's **title**,
  **description**, **parameter summary**, **short title**, the **entity type
  display name** ("Station"), and the **invocation phrases**.
- Phrases interpolate the localized application name (`\(.applicationName)`) and,
  where parameterized, the station entity (`\(\.$station)`).
- Station names, broadcaster, and country values are catalog data, not localized
  by this surface.
- No plural forms are required (no counts in any string).
- All strings are defined as localizable resources (`LocalizedStringResource` /
  `IntentDescription`); shipped string catalogs determine which locales are
  actually translated.

## Platform Matrix

| Behavior | Web | iOS | Android |
|---|---|---|---|
| Voice-assistant playback control | Planned (Web Speech / PWA) | Supported | Planned (Assistant / App Actions) |
| OS shortcut actions (Play / transport / favorite) | Planned | Supported | Planned (App Actions) |
| Station entity resolution + disambiguation | Not applicable | Supported | Planned |
| System search indexing of stations (Spotlight) | Browser-dependent | Supported | Planned (App Search / Slices) |
| Suggested shortcuts / entities (≤25) | Not applicable | Supported | Planned |
| Transport intents target a running session only | Not applicable | Supported | Planned |
| Localized invocation phrases | Not applicable | Supported | Planned |

## Open questions

- Whether transport intents should optionally cold-start the app (today only
  Play / Play Last do) for a "Pause" said to a stopped app.
- Whether Spotlight results should support deep-linking into Browse / a station
  detail rather than always starting playback.
- Whether to add intents for Sleep Timer, Wake to Radio, or playing a named
  station list, beyond the current single-station set.
- Picker/search caps (25) and the name-substring-only match are not yet pinned
  as a cross-platform contract; web/Android equivalents are unspecified.

## Reference

- `rrradio/Shortcuts/PlayStationIntent.swift` — the 8 `AppIntent`s
  (`PlayStationIntent`, `PlayLastStationIntent`, `PauseRrradioIntent`,
  `ResumeRrradioIntent`, `StopRrradioIntent`, `NextStationIntent`,
  `PreviousStationIntent`, `ToggleFavoriteStationIntent`), their titles /
  descriptions / parameter summaries / `openAppWhenRun`, and the
  `RrradioShortcuts` `AppShortcutsProvider` (phrases + short titles + glyphs).
- `rrradio/Shortcuts/StationEntity.swift` — `StationEntity` (`AppEntity`,
  `IndexedEntity`): display representation, Spotlight `attributeSet`; and
  `StationEntityQuery` (`EntityStringQuery`): `entities(for:)`,
  `entities(matching:)` (≤25, case-insensitive name contains),
  `suggestedEntities()` (≤25), and `localStations()` roster assembly +
  de-duplication.
- `rrradio/Shortcuts/IntentPlaybackRequest.swift` — `IntentPlaybackAction`
  enum, the pending-store keys, `requestPlay` / `requestPlayLastStation` /
  `requestTransportAction` / `requestToggleFavorite`, the
  `intentPlaybackRequested` notification, and `consumePendingStation` /
  `consumePendingTransportAction`.
- `rrradio/Views/AppRouter.swift` — `consumePendingIntentPlayback`,
  `consumePendingIntentTransportAction`, `IntentTransportOutcome`,
  `playableStations` roster.
- `rrradio/Views/ContentView.swift` — `playPendingIntentStationIfPossible`,
  `applyPendingIntentTransportActionIfPossible`, the `intentPlaybackRequested`
  observer, and `showNowPlayingSoon` debounce.
- `project.yml` — `NSUserActivityTypes: [org.rrradio.playStation]`.

## Known deviations

None recorded. File any divergence between shipped intent behavior and this
intent under `rrradio-ios/internal/audit/` and link it here.
