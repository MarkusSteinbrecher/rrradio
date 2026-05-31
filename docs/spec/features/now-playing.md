# Now Playing Specification

```yaml
status: draft
platforms: [web, ios, android]
reconciled-against: 9336321
```

## Purpose

Now Playing is a destination view for the current station, not a transient
modal. It carries playback controls, current track/program metadata, station
identity, artwork, and secondary listening actions (favorite, sleep timer, wake
alarm, music-service links, schedule, lyrics). A persistent mini-player keeps the
current station and its controls one tap away from every page; tapping it expands
into the full Now Playing surface. The user value: one place that always answers
"what is playing, on what station, and what can I do with it right now".

## Entry points

- **Mini-player** — the persistent bottom strip; tapping it expands Now Playing.
- **Station rows** — playing a station from Browse / Favorites / Recents /
  station lists routes the resulting playback through the same mini-player.
- **System media surface** — the lock screen / Control Center now-playing card
  reflects this state and feeds its commands back into the player (see
  [playback-state-machine](../contracts/playback-state-machine.md)).
- **Watch remote** — the watchOS companion mirrors the same playback state and
  transport (iOS-only; see [platforms](../platforms.md)).

## Layout

### Mini-player (persistent bottom strip)

Fixed-height bar (88 pt on iOS), left to right:

- **Leading icon** — station favicon (46 pt) with a fallback monogram; an offline
  glyph (`wifi.slash`) replaces it when there is no current station and the
  device is offline. A small list badge overlays the favicon when playback is
  driven by a station-list queue.
- **Metadata lines** (stacked, flexing to fill):
  - Station name + country flag emoji; a calendar glyph appears when program info
    exists. When offline, this line becomes a short "no internet" label instead.
  - Track line `"<artist> - <title>"` (or title alone) when a track is resolved.
  - Program line `"<program> . <subtitle>"` when present; otherwise, if no track,
    a state line (`Standby` / `Loading` / `Live` / `Paused` / error phrase) with a
    pulsing dot while playing.
- **Sleep-timer glyph** (`moon.zzz.fill`) when a sleep timer is armed.
- **Album artwork thumbnail** (64 pt) when a track cover art URL resolves and the
  device is online.
- **Trailing control** — play/pause toggle (44 pt). It is replaced by a red close
  ("✕") button while the close prompt is showing, or by a static offline glyph
  when there is no station and the device is offline.

### Full Now Playing (portrait / compact width)

Top to bottom:

- **Header** — centered "NOW PLAYING" eyebrow; a down-chevron dismiss button
  (left, when presented as a sheet) and a close "✕" (right) that stops playback
  and dismisses.
- **Station block** — station favicon (38 pt), station name (large), and a
  heart favorite toggle.
- **Divider**, then a **pane tab strip**: Now (artwork) / Program (calendar) /
  Lyrics (quote). Program and Lyrics tabs are enabled only when that data exists.
- **Paged pane content** (swipeable):
  - **Now pane** — large artwork (220 pt: track cover, else station favicon),
    track title, artist subtitle, and an uppercase program-name caption when known.
  - **Program pane** — program header (name + subtitle), then today's broadcast
    list with start times; the live broadcast is highlighted and tagged "Live".
  - **Lyrics pane** — track header, scrollable lyrics text (selectable), and a
    "Lyrics source: <name>" attribution link.
- **Music-service rail** — Apple Music / Spotify / YouTube Music buttons (hidden
  on the Lyrics pane and until the track is verified as a real song).
- **Expandable station details** — collapsed by default behind a status strip
  chevron; expands to show website link, stream URL, country, format
  (codec/bitrate/quality), genres, metadata source, and a "Report broken station"
  action.
- **Stream-info status strip** — a tappable line `"<state> . <codec> . <bitrate>"`
  with a status dot; the chevron toggles the details panel.
- **Controls block** — wake-alarm button (left), previous-station, play/pause
  (large, 64 pt), next-station, sleep-timer button (right). Wake and sleep
  buttons carry a countdown chip when armed.

### Full Now Playing (landscape / iPad split)

Branch work introduces a width-driven split layout selected when the surface is
wider than tall (so iPad landscape and portrait full-screen both get it; the
choice keys off surface aspect, not the vertical size class):

- **Top station bar** — dismiss chevron, station favicon, station name (flexes),
  inline music-service buttons, favorite toggle, close "✕".
- **Left artwork column** — artwork (sized to the column), track title, artist,
  program caption; vertically centered.
- **Right pane column** — Program / Lyrics tab strip (only when either exists) and
  the corresponding scrollable pane. When neither exists, the right column shows a
  details list (stream, country, format, genres) under the track text.
- **Bottom bar** — the expandable details panel (height-capped, scrolls up over
  the pane instead of pushing the transport), the stream-info status strip, then
  the transport row: wake, previous, play/pause (52 pt), next, sleep.

### Full Now Playing (car mode)

When car mode is active the layout is replaced by a large-touch-target variant:

- **Header** + a prominent `car.fill` button that opens a "turn off car mode"
  confirmation.
- **Large artwork** (250 pt), station name (24 pt), track title, artist.
- **Car-mode status caption** with the audio route label.
- **Oversized play/pause** (92 pt) plus a row of large round buttons: favorite,
  wake alarm, sleep timer (each with armed-state chip).

## States

| State | Mini-player | Full Now Playing |
|---|---|---|
| **empty** (idle, no station) | Favicon placeholder; metadata blank; play/pause disabled; tap does nothing. | Reached only if opened with no station: blank station name, "Live stream" placeholder, controls disabled. |
| **loading** | State line "Loading"; play/pause disabled; track/cover suppressed. | Artwork = station favicon; title "Connecting"; play button shows animated loading dots and is disabled. |
| **loaded / playing** | Track + program lines; pulsing dot; play→pause; cover thumbnail when resolved. | Full artwork/track/program; transport enabled; status dot accent-tinted; "LIVE". |
| **paused** | State line "Paused"; pause→play. | Same layout; play button shows play glyph; status "PAUSED". |
| **partial** (station, no track metadata) | Station name + state line; no track line; calendar glyph if program exists. | Artwork = favicon; title "Live stream"; subtitle = station name; music-service rail hidden; Program/Lyrics tabs disabled if no data. |
| **error** | State line = shortened error phrase (country phrase trimmed before em-dash). | Title "Playback error"; subtitle = error message; controls remain (play retries). |
| **offline** | Offline glyph + short "no internet" label; track/program lines suppressed; cover hidden. | Track text becomes offline phrase in a warm tint; subtitle = station name; status strip shows "no internet / offline / no stream". |

Actionable in every non-empty state: play/pause toggle, favorite toggle, sleep and
wake entry (sleep/wake also reachable while armed even with no current station).

## Interactions

| Control / gesture | Precondition | Result | Side effects |
|---|---|---|---|
| Tap mini-player | A station is current; no close prompt showing | Presents full Now Playing | Sheet (iPhone) or full-screen (iPad) per idiom |
| Tap mini-player while close prompt shown | Close prompt visible | Dismisses the close prompt | No navigation |
| Long-press mini-player (≥0.45 s) | A station is current | Shows the red close prompt on the trailing control | Light haptic |
| Tap mini-player play/pause | Station current, not loading | Toggles play/pause | Per [playback-state-machine](../contracts/playback-state-machine.md) |
| Tap mini-player close "✕" | Close prompt visible | Stops playback, dismisses Now Playing if open | Player → idle; prompt cleared |
| Station identity changes | Mini-player visible | Auto-dismisses any open close prompt | — |
| Tap header down-chevron | Now Playing presented as sheet | Dismisses Now Playing | Playback continues |
| Tap header / station-bar "✕" | Now Playing open | Stops playback and dismisses | Player → idle |
| Tap favorite heart | A station is current | Toggles favorite; glyph fills / empties | Writes library; iCloud sync per [sync-merge](../contracts/sync-merge.md) |
| Tap play/pause (full) | Station current, not loading | Toggles play/pause | Loading shows dots; disabled while loading |
| Tap previous-station | Active queue has >1 station | Steps to previous station (circular) | Rebuilds source; see queue rules |
| Tap next-station | Active queue has >1 station | Steps to next station (circular) | As above |
| Swipe pane / tap pane tab | Target pane enabled | Switches Now / Program / Lyrics | Program pane auto-scrolls to the live broadcast |
| Tap a program-schedule row | A station is current | Opens the wake-alarm sheet preset to that broadcast's start time + title | Notifications default ON for the preset |
| Tap wake-alarm button | Station current OR wake armed | Opens wake-alarm sheet | See [wake-to-radio](wake-to-radio.md) |
| Tap sleep-timer button | Station current OR sleep armed | Opens sleep-timer sheet | See [sleep-timer](sleep-timer.md) |
| Tap a music-service button | Track verified as a real song; service enabled | Opens that service (Apple Music deep-link when available; else search) | External app/URL; never sent to telemetry |
| Tap status strip / chevron | — | Expands / collapses station details panel | Transport keeps its bottom anchor |
| Tap website / stream link rows | Row present | Opens the URL externally | — |
| Tap "Report broken station" | A station is current; not already reporting | Sends a broken-station report; shows sent/failed alert; offers an email fallback on failure | Coarse diagnostic recorded locally |
| Tap car-mode `car.fill` | Car mode active | Confirmation dialog → turning off disables manual + automatic car mode | — |
| Station change while reporting | A report is in flight | Cancels the report; clears its status | — |
| Background / dismiss view | — | Cancels any in-flight broken-station report | Playback unaffected |

## Business rules

- **Mini-player height** 88 pt; favicon 46 pt; album thumb 64 pt; controls 44 pt.
- **Long-press threshold** for the close prompt: 0.45 s; the prompt auto-clears
  when the station identity changes.
- **Music-service buttons render only when the track is verified** as a real
  searchable song (iTunes Search confirmed a hit). In-flight or confirmed-miss →
  buttons hidden, so users are never sent to empty search results. See the iTunes
  dual-role gate in [metadata-fetchers](../contracts/metadata-fetchers.md).
- **Music-service set & order**: Apple Music, Spotify, YouTube Music; each has a
  per-app enable toggle (default ON). Apple Music uses a deep link to the exact
  song when iTunes returned a `trackViewUrl`; Spotify and YouTube Music use search
  URLs. URL shapes are owned by [metadata-fetchers](../contracts/metadata-fetchers.md).
- **Program schedule** shows today's broadcasts; the live broadcast (`start ≤ now
  < end`) is highlighted and tagged "Live". The live row is recomputed on a 30 s
  tick and only re-rendered on a boundary crossing. The pane auto-scrolls to the
  live row on open and on boundary change. Schedule is ORF/FM4-only today.
- **Program-only sources** show a program name caption but no music-service rail
  (no artist/title to search).
- **Genres** in the details panel: at most 5 tags, dot-joined. **Format**:
  codec . bitrate . quality level (`/4`).
- **Track line** is suppressed while loading and while offline.
- **Lock-screen title/subtitle/rate/queue/artwork** are governed by the
  now-playing-info table in
  [playback-state-machine](../contracts/playback-state-machine.md); this surface
  does not redefine them.
- **Layout selection** keys off surface aspect (width > height → split), not the
  vertical size class, so iPad landscape gets the split (iPad never reports a
  compact height). iPad presents Now Playing full-screen; iPhone presents it as a
  swipe-to-dismiss bottom sheet. The presentation idiom is fixed across rotation
  so the player never tears down mid-rotation.
- **Car-mode layout** overrides both portrait and landscape while active.

## Data dependencies

- [playback-state-machine](../contracts/playback-state-machine.md) — playback
  states, transitions, play/pause/step semantics, the queue + stepping
  precondition driving previous/next enablement, and the system now-playing-info
  fields.
- [metadata-fetchers](../contracts/metadata-fetchers.md) — track artist/title,
  program name/subtitle, cover-art chain, lyrics lookup, program-schedule fetch,
  the iTunes verification gate for music-service buttons, and the music-service
  link URLs.
- [metadata-artwork](metadata-artwork.md) — artwork fallback order and capability
  hints.
- [sleep-timer](sleep-timer.md), [wake-to-radio](wake-to-radio.md) — the sheets
  reached from the transport row and from program rows.
- [sync-merge](../contracts/sync-merge.md) — favorite-toggle persistence and
  music-service toggle sync (the CloudKit merge algebra).

## Edge cases

- **No station yet** — controls disabled; sleep/wake still open (and stay
  reachable while armed even after the station is cleared).
- **Offline** — mini-player and full view both surface an offline affordance;
  track/cover are hidden; favorite and timers remain usable; the player attempts
  auto-reconnect only from loading/playing/error (never from paused/idle).
- **Track verified false / pending** — music-service rail stays hidden; no empty
  search results.
- **Program data races** — switching away from Program/Lyrics when its data
  disappears falls back to the Now pane (or the remaining enabled pane in the
  landscape split).
- **Broken-station report races** — an in-flight report is cancelled on station
  change or view dismissal; every exit path clears the in-flight flag so the
  button never gets stuck disabled.
- **Report failure** — shows a "failed" alert with an email fallback prefilled
  with station name, id, stream URL, and playback state.
- **Huge schedules** — only today's day is rendered; the full-day scan and list
  rebuild only on a live-broadcast boundary, not on every tick.
- **Rotation / multitasking** — presentation idiom is stable, so the player is not
  torn down; the split/single layout swaps purely on aspect.
- **Closing from mini-player vs. header "✕"** — both stop the player; the sheet
  down-chevron only dismisses and leaves playback running.

## Accessibility

- Every control carries a screen-reader label: dismiss, close, favorite
  (add/remove), play/pause, previous/next station, wake to radio, sleep timer,
  pane tabs (Now / Program / Lyrics), and each music-service button ("Listen on
  Apple Music", "Listen on Spotify", "Search on YouTube Music").
- Mini-player labels: play/pause, close mini-player, sleep-timer-active glyph,
  program/calendar glyph, "playing from list" badge; the offline glyph is hidden
  from the reader (the offline state is conveyed by the text label).
- Brand marks are decorative (hidden); the button's text/label carries the name.
- Text uses `minimumScaleFactor` so long station/track names shrink rather than
  clip; lyrics text is selectable.
- Touch targets: transport and round controls are 44 pt; car-mode targets are
  enlarged (92 pt play/pause) for in-vehicle use.
- Status conveyed by both color (status dot tint) and text (state label), not
  color alone.

## Localization

- This surface owns: NOW PLAYING eyebrow, transport/secondary-control labels,
  pane labels (Now / Program / Lyrics), status labels (Standby / Loading / Live /
  Paused / playback-error / no-internet phrases), details-row labels (Website /
  Stream / Country / Format / Genres / Metadata), the broken-station report
  states (report / sending / sent / failed) and its alert copy, car-mode labels,
  and the "playing from list" badge.
- Music-service accessibility labels are currently English (localization rewrite
  tracked as a deferred slice).
- Plural/parameter needs: broadcast count ("N broadcasts"), countdown chips for
  sleep/wake, sleep/wake target lines, and the lyrics-source attribution
  ("Lyrics source: <name>").
- Country names render via the device display locale; bitrate as "<n> kbps".

## Platform Matrix

| Behavior | Web | iOS | Android |
|---|---|---|---|
| Destination view | Supported. | Reference. | Supported for the core playback surface; secondary panels remain planned. |
| Mini-player handoff | Supported. | Supported. | Supported. |
| Mini-player long-press close prompt | Platform-specific (no equivalent gesture). | Supported. | Planned. |
| Track metadata | Supported. | Reference. | Partial; basic ICY metadata exists. |
| Cover art fallback | Supported. | Reference. | Partial; station artwork fallback exists, track cover art is deferred. |
| Previous/next station controls | Supported. | Reference. | Supported for active playback queues. |
| Program schedule | Supported for wired broadcasters. | Supported for wired broadcasters. | Planned. |
| Lyrics | Supported where lookup matches. | Planned/partial native parity. | Planned. |
| Music-service search links | Supported. | Planned/partial native parity. | Planned. |
| Music-service verification gate | Supported. | Supported. | Planned. |
| Sleep-timer / wake-alarm entry | Supported (browser-limited wake). | Reference. | Partial. |
| Landscape / split layout | Supported via responsive layout. | Supported (iPad split + iPhone landscape). | Planned. |
| Car mode | Not a dedicated web feature. | Supported. | Android Auto/TBD; media notification first. |
| Report broken station | Supported. | Supported. | Planned. |

## Native Port Notes

Android should avoid starting with a thin playback screen. The first native
version should include enough Now Playing behavior to feel like the same app:
station identity, artwork, track metadata, favorite toggle, sleep timer entry,
and media controls.

## Open questions

- Lyrics and music-service links are native-partial; when does Android pick them
  up, and does iOS reach full lyrics parity?
- Program schedule routing is still ORF/FM4-hardcoded; the catalog
  `hasScheduleData` hint is the intended source of truth (see
  [metadata-fetchers](../contracts/metadata-fetchers.md) Open questions).
- Should the music-service accessibility labels be localized (currently English)?
- Should the close "✕" (stop + dismiss) and the down-chevron (dismiss only) be
  unified, or is the two-affordance model intentional cross-platform?

## Reference

- `rrradio/Views/NowPlayingView.swift` — full destination view: portrait
  (`regularBody`), landscape/iPad split (`landscapeBody`), car mode
  (`carModeBody`), pane tabs + paged content, music-service rail, station-detail
  panel, transport controls, the embedded `WakeAlarmView` / `SleepTimerView`
  sheets, `ArtworkView`, and `nowPlayingPresentation` (sheet vs. full-screen by
  idiom).
- `rrradio/Views/MiniPlayerView.swift` — persistent bottom strip, tap-to-expand,
  long-press close prompt (`MiniPlayerClosePromptState`), offline affordances,
  station-list badge, and the `miniPlayerSurface` chrome.
- `rrradio/Player/Metadata/MusicServiceLinks.swift` — `MusicServiceRegistry`
  (Apple Music / Spotify / YouTube Music), per-service toggles, badge-lockup
  rendering, and the search / Apple-Music deep-link URL builders.

## Known deviations

- Metadata display inherits the iOS metadata-fetcher deviations (title-casing,
  HTML-entity leakage, oversized ORF cover, cover-match substring bug) tracked in
  [metadata-fetchers](../contracts/metadata-fetchers.md) Known deviations
  (`rrradio-ios/internal/audit/2026-05-25-ios-code-review-slice6.md`).
- The Now Playing close path is the slice 24 N6 surface of the audio-session
  deactivation gap recorded in
  [playback-state-machine](../contracts/playback-state-machine.md) Known
  deviations (`rrradio-ios/internal/audit/2026-05-25-ios-code-review-slice5.md`
  A2; remediation in `2026-05-25-fixes-prioritized.md` PR 3).
