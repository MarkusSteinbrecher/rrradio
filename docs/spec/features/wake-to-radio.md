# Wake To Radio Specification

```yaml
status: review
platforms: [web, ios, android]
reconciled-against: d241aa9
```

## Purpose

Wake to radio is best-effort alarm-style playback: the user picks a station and a
time, and rrradio tries to start that station at that time. It is a soft alarm,
not a Clock-app replacement — it is bounded by each operating system's rules for
autoplay, background execution, exact alarms, and app relaunch, and it degrades to
the most reliable user-visible cue (a local notification) when it cannot auto-start
audio. See the operations note [Wake to radio on iOS](../../wake-to-radio.md) for
setup guidance and platform-limit prose; this spec does not duplicate it.

## Entry points

- **Wake button on Now Playing** — a round control labeled "Wake to radio"
  (alarm glyph; fills to `alarm.fill` while armed). Opens the wake sheet. Disabled
  when no station is playing and no alarm is armed.
- **Program schedule on Now Playing** — tapping a scheduled broadcast opens the
  wake sheet pre-filled (preset) with that broadcast's station, start time, and
  program name as the alarm title, with the notification toggle on by default.
- **Settings** — two persistent wake preference rows (default wake time, Lock Screen
  notification toggle) seed the next alarm but do not arm one; a denied-permission
  warning row appears under them only while an alarm is armed with the notification
  preference on and OS permission denied. Keep-audio-alive has no Settings row — it
  lives only in the wake sheet, even though its default is part of preference sync.
- **Notification tap** — tapping the fired wake notification re-enters the app and
  drives the notification → playback flow (see Interactions).
- **Shortcuts / Siri (iOS)** — three App Intents reach this feature:
  - "Set Wake Alarm" (station + time) arms the in-app alarm directly, opening the
    app; it stores only the time-of-day, so "tomorrow" resolves at arm time.
  - "Play Station" and "Play Last Station" let a user build a Time-of-Day Personal
    Automation that starts a station on a schedule — a parallel path that plays
    immediately rather than arming the alarm.

## Layout

The wake sheet, top to bottom:

- **Header** — a centered title row: alarm glyph (filled + accent when armed) plus
  the title "Wake to", closed by a full-width hairline rule. When armed, a live
  countdown capsule ("IN 7H 20M") rides the trailing edge of the row and ticks every
  30s without pulling the title off-center. The header stays pinned; the rest of the
  sheet scrolls under it.
- **Station identity line** — directly under the rule, a centered favicon + station
  name for the wake target. When no station is resolvable, shows "Play a station
  first" instead. (The alarm title/program name is carried on the alarm but is not
  shown on this line; it surfaces in the notification body.)
- **Time wheel** — hour/minute picker (follows the device 24-hour setting, not the
  app language). Defaults to the preset time, else the current alarm time, else the
  saved default wake time.
- **Lock Screen notification toggle** — with detail copy. Disabled while an alarm
  is armed (unless the sheet is editing that armed alarm).
- **Notification-denied warning** (conditional) — shown only when the notification
  toggle is on and OS permission is denied: a bell-slash icon, a warning line, and
  an "Open Settings" button that deep-links to the app's system settings.
- **Keep-audio-alive toggle** — with detail copy. Disabled while an alarm is armed.
- **Footer button pair** — a centered `xmark` capsule (dismiss without changing the
  alarm) beside the action button. The action button reads "SET" when no alarm (or
  editing one) and "UNSET" when armed and unchanged; it carries no subtitle. The SET
  state is disabled (dimmed) when no station resolves; UNSET is always available.

The Now Playing wake button shows the armed time as a small accent chip while armed
(`alarm.fill` glyph + time); the chip is decorative and is not exposed as an
accessibility value.

## States

| State | What shows | Actionable |
|---|---|---|
| Disarmed, station playing | Sheet pre-fills station + default/last time; SET enabled. | Set an alarm. |
| Disarmed, nothing playing | Station line shows "Play a station first"; SET disabled. | Pick time/toggles only; cannot set. |
| Armed | Header countdown capsule; button reads UNSET (no subtitle); toggles locked; lock-screen Live Activity glances the station + fire time. | Unset; edit (changing time/station/title flips to SET). |
| Editing an armed alarm | Button flips back to SET; toggles re-enabled. | Re-arm with new values. |
| Notification permission denied | Denied-warning block under the notification toggle (only while toggle on and alarm armed); same warning row appears in Settings. | Open Settings. |
| Fired (alarm reached) | Alarm disarms itself; Live Activity ends; if the app is alive it switches to the station; Now Playing surfaces shortly after. | Normal playback. |
| Missed (app was suspended/asleep) | The fired local notification is the cue; on next launch a stale alarm is cleared (see deviations). | Tap notification to start; or re-arm. |

There is at most **one** active wake intent at a time.

While armed, a dedicated lock-screen / Dynamic Island **Live Activity** glances the
alarm independent of current playback: an alarm glyph, the wake station name, the
fire time, and a relative countdown, themed in the app's effective accent/surface
colors. It is a glanceable surface only — the alarm still fires via the in-app timer,
keep-alive, and scheduled notification, so the activity expiring (e.g. iOS's ~12 h
Live Activity lifetime cap on an alarm set far ahead) never affects whether the alarm
goes off. It updates on re-arm and ends on disarm/fire; if Live Activities are
disabled or starting one fails, the alarm is unaffected.

## Interactions

| Control / gesture | Precondition | Result | Side effects |
|---|---|---|---|
| Tap wake button (Now Playing) | Station playing or alarm armed | Opens wake sheet | Refreshes notification-authorization state |
| Tap scheduled broadcast | Program schedule visible | Opens wake sheet preset to that broadcast | Title = program name; notification default on |
| Spin time wheel | Sheet open | Updates selected wake time | If armed, flips action to SET (edit) |
| Toggle Lock Screen notification | Not armed, or editing armed | Arms/disarms notification scheduling for this alarm | Persists preference; cancels or schedules the local notification |
| Toggle keep-audio-alive | Not armed | Selects keep-alive for the next alarm | Persists default; pushed to cloud sync |
| Tap "Open Settings" | Notification denied | Opens app's iOS Settings page | — |
| Tap SET | Station resolves | Arms the alarm; computes next fire date; starts in-app timer; schedules notification (if enabled + permitted); starts keep-alive (if enabled and not already playing); dismisses if notifications available | Persists alarm; requests notification permission if undetermined; pushes prefs to cloud sync |
| Tap UNSET | Armed | Disarms; stops timer + keep-alive; cancels notification; restores default time | Clears persisted alarm; pushes prefs |
| Tap close (`xmark`) | Sheet open | Dismisses without change | — |
| Alarm time reached, app alive | Armed | Timer fires: disarms, stops keep-alive, plays the station | Diagnostic "timer fired"; Now Playing surfaces |
| App launch / foreground with pending fire | `firesAt` already passed but within grace | Fires immediately on activate | — |
| Tap fired notification | Notification delivered | Queues the station id; on next active app pass, fires the armed alarm (or plays the station directly if no longer armed) | Now Playing surfaces |
| Pause playback while armed (keep-alive off) | Armed, keep-alive off, warning not suppressed | One-time alert: alarm may not auto-play; offers "Don't show again" + "OK" | Suppress flag persisted on dismiss-with-don't-show |
| Run "Set Wake Alarm" intent (station + time) | App launchable by iOS | Queues an arm request (time-of-day only); app foregrounds and arms the in-app alarm | Independent of the notification-tap path; resolves the station against everything playable; stale requests past the intent lifetime are dropped |
| Run "Play Station" / "Play Last Station" intent | App launchable by iOS | Queues a playback request; app foregrounds and plays | Plays immediately; does not arm an alarm |

## Business rules

- **Single intent:** one armed alarm at a time; arming replaces any prior alarm and
  its scheduled notification (same fixed notification identifier).
- **Default time:** falls back to `07:00` when unset.
- **Next-fire computation:** the next future occurrence of `HH:MM` after the arm
  instant, in the device-local calendar/timezone, skipping non-existent times and
  taking the first of a repeated (fall-back DST) time — so it is DST-safe and never
  fires in the past.
- **Time validation:** `HH` in 0–23, `MM` in 0–59; an unparseable time no-ops the
  arm.
- **Keep-alive default:** on. It plays a looped near-silent local sound (volume
  ~0.001) only when an alarm is armed, keep-alive is enabled, and no real station is
  playing; it stops the moment a station starts or the alarm fires/disarms.
- **Notification default:** on when no alarm has ever been stored; the notification
  is a one-shot calendar trigger matching year/month/day/hour/minute of the fire
  date.
- **Stale grace:** an alarm whose fire time has passed by more than **60 s** is
  treated as stale and cleared at next launch (see deviations).
- **Pause warning:** shown at most once per armed alarm, only when keep-alive is
  off and the user hasn't chosen "Don't show again".
- **Telemetry:** wake diagnostics record station name/id and stream host but follow
  the project privacy boundary — no full private stream URLs leak. Diagnostics are
  local opt-in.
- **Preference sync:** default time, notification-enabled, and keep-alive-enabled
  are all part of the cloud-sync snapshot; changing any of the three (via its
  setter or the wake sheet) pushes to sync, and applying a remote snapshot suppresses
  the re-push. The armed alarm itself (station, time, title) is device-local — only
  the three defaults sync.

## Data dependencies

- [playback-state-machine](../contracts/playback-state-machine.md) — the fire
  action and notification-tap path both end in a `play(station)` that drives the
  five-state player; keep-alive uses the same playback audio session. The alarm
  itself is not a player state — it is an external trigger into `play`.
- The wake target is a catalog/library [Station]; the notification-tap flow
  resolves the pending station id against favorites, recents, custom stations, and
  the cached catalog.
- Operations / setup prose: [Wake to radio on iOS](../../wake-to-radio.md) (link,
  do not duplicate).

## Edge cases

- **App suspended/terminated before fire:** the in-app timer cannot run; the local
  notification is the only OS cue. A force-quit app cannot relaunch itself or start
  audio.
- **Notification-only wake (no tap):** if the banner plays sound but the user never
  taps it, no station id is queued and the radio does not start. (Known deviation
  W1.)
- **Missed alarm past grace:** stored alarm is silently cleared at next launch with
  no user-visible "you missed your alarm" cue. (Known deviation W2.)
- **Permission denied:** scheduling is skipped; the warning block surfaces while the
  toggle is on and the alarm is armed. A user who denies after arming and then
  disarms loses the warning surface. (Known deviation W12.)
- **Permission undetermined at SET:** arming requests permission inline; the sheet
  dismisses only once permission is resolved as available (or notifications were
  off).
- **DST day:** fire date resolution is DST-safe but the chosen `firesAt` is not
  logged, so a silently-shifted firing is hard to diagnose. (Known deviation W4.)
- **Travel across time zones mid-arm:** the notification trigger fires in the new
  local time matching the original components (no pinned timezone). (Known
  deviation W10.)
- **Backgrounding with keep-alive on:** keep-alive holds the audio session active to
  reduce the chance of suspension; it costs battery overnight and does not survive
  force-quit.
- **Fire while another station is playing:** the alarm switches playback to the
  wake station (stops keep-alive first).
- **Pending fire on cold launch:** if `firesAt` already elapsed (within grace), the
  alarm fires on activate so a just-opened app still honors a barely-missed alarm.
- **Concurrent cold-launch triggers:** landing preference, wake, and intent
  playback can all arrive near-simultaneously; the Now Playing surface is
  debounced (~300 ms) to a single presentation.

## Accessibility

- Wake button carries the localized "Wake to radio" label; the armed-time chip is a
  visual badge only and is not exposed as an accessibility value.
- Footer close button has an explicit "Close" accessibility label; the action button
  is labeled "Set"/"Unset" to match its state.
- Toggles expose title + detail text; the denied warning is readable as a labeled
  block with an "Open Settings" action.
- Header title and station name use `minimumScaleFactor` so they scale rather than
  truncate under large Dynamic Type.
- Countdown capsule updates on a 30s timeline; it is decorative relative to the
  primary time, which remains the source of truth.
- The wake Live Activity collapses to a single element labeled "Alarm set for
  <station>"; its alarm glyph is hidden from VoiceOver.

## Localization

This surface owns these strings (English reference values):

- `wakeTo` — "Wake to" (wake-sheet header title)
- `wakeToRadio` — "Wake to radio" (Now Playing wake button label)
- `wakeTime` — "Wake time"
- `defaultWake` — "Default wake time" (Settings row)
- `wakeNotification` — "Lock Screen notification"
- `wakeNotificationDetail` — "Shows a wake alert at the set time. Program alarms turn this on by default."
- `wakeNotificationsDeniedWarning` — denied-permission warning
- `wakeKeepAlive` — "Keep audio alive until wake"
- `wakeKeepAliveDetail` — near-silent-sound + battery explanation
- `wakePauseWarningTitle` / `wakePauseWarningMessage` — pause-while-armed alert
- `playStationFirst` — "Play a station first"
- `set` / `unset`, `openSettings`, `dontShowAgain`, `close`, `ok` (shared)

`wakeHint` (autoplay/keep-alive footnote) and `unsetWakeAlarm` remain defined but
are no longer rendered after the sheet restructure; the keep-alive guidance now lives
in `wakeKeepAliveDetail`.

Notification body interpolates station name and time, with a separate body when an
alarm title is set; localization must keep the station/time parameters. The Live
Activity strings ("Alarm", "Alarm set for <station>") and the App Intent titles
("Set Wake Alarm", "Play Station", "Play Last Station") are not yet part of the
localized string table. No plural forms required (countdown uses compact "Hh Mm"
formatting; "now"/"soon" are special-cased).

## Platform Matrix

| Behavior | Web | iOS | Android |
|---|---|---|---|
| In-app timer | Supported while tab/session remains alive. | Supported while app remains alive. | Planned while process/service remains alive. |
| Keep audio alive | Silent-bed audio workaround. | Near-silent local audio keep-alive (default on). | TBD, likely foreground service if allowed. |
| Local notification fallback | Partial (best-effort `Notification` fired at wake time only when the page is alive and permission granted; no scheduled/background fallback). | Supported (one-shot, fixed identifier). | Planned. |
| Notification-tap → playback | Not planned (no notification-tap path; audio starts directly from the in-page timer). | Supported (queued, consumed on next active pass — see W1). | Planned. |
| Pre-armed default time / prefs | Partial (last-used wake time persists in localStorage; no notify or keep-alive preference rows). | Supported (default time, notify, keep-alive). | Planned. |
| Program-schedule preset arming | Not planned (no schedule → wake preset path on web). | Supported. | Planned. |
| DST-safe next-fire resolution | Required. | Supported. | Required. |
| Pause-while-armed warning | Not applicable (web swaps to the silent bed on pause, so the keep-alive footgun the warning guards against does not exist). | Supported (once per alarm, keep-alive off). | TBD. |
| Lock-screen wake Live Activity | Not applicable. | Supported (glanceable; independent of playback). | TBD. |
| Shortcuts/automation | Not applicable. | Supported (Set Wake Alarm arms; Play Station / Play Last Station play). | Not applicable. |
| Exact alarm | Not available. | Not available to third-party app in this sense. | Open decision; may require permission. |
| Survives force quit | No. | No. | No reliable guarantee. |
| Preference cloud sync | Not planned. | Supported for time + notify + keep-alive. | Not applicable. |

## Web

The web wake flow is browser-limited. It can work while the page and audio session
remain eligible, but it must not promise alarm-clock reliability. The in-page
scheduler (a clamped `setTimeout`, a 30s heartbeat, a `visibilitychange` re-check,
and a best-effort screen Wake Lock) only runs while the tab is open; closing the
page ends the alarm. A silent-bed audio workaround (always on while armed, not a
user preference) stands in for the iOS keep-alive — it loops a near-silent AAC clip
so the audio session stays active across the fire-time station swap. The Media
Session API supplies the lock-screen "Wake to …" title. The notification is fired
best-effort at wake time (only when the page is alive and `Notification` permission
is granted), not scheduled to fire while the tab is suspended; there is no
notification-tap-to-play path, no program-schedule preset arming, and no
preference cloud sync on web. Only the last-used wake time persists in localStorage.

## iOS

iOS is the current reference behavior:

- In-app wake alarm with a runloop-`.common` timer (survives scroll).
- Near-silent keep-alive option (default on).
- One-shot local notification fallback.
- Lock-screen / Dynamic Island Live Activity while armed (glanceable only).
- App Intents / Shortcuts actions "Set Wake Alarm" (arms the alarm), "Play Station",
  and "Play Last Station" (play immediately).

See [Wake to radio on iOS](../../wake-to-radio.md) for setup and limits.

## Android

Android wake-to-radio needs a separate implementation decision before coding. The
spec should decide:

- Whether exact alarms are acceptable, and whether requesting exact-alarm
  permission matches the product.
- Whether a foreground media service is required while armed.
- How to explain battery-optimization limits.
- What fallback notification copy says when autoplay cannot happen.

The first Android port may defer wake-to-radio if playback, Favorites, and custom
stations are the launch scope.

## Open questions

- Should keep-alive default to forced-on for any armed alarm (removing the footgun
  of disabling it), or keep it user-controlled? (W1 mitigation options.)
- Should a missed-wake event surface a user-visible cue at next launch rather than
  silently clearing? (W2.)
- Should the notification trigger pin a timezone so travel mid-arm behaves
  predictably? (W10.)
- Should there be a persistent "wake notifications are denied" cue outside the armed
  sheet? (W12.)
- Android exact-alarm vs. foreground-service decision (above).

## Reference

iOS source files (the only place iOS mechanics are named):

- `rrradio/Player/WakeAlarm.swift` — `WakeAlarm` (`arm`, `disarm`,
  `activate`, `fire`, `fireFromNotification`, `nextFireDate` DST-safe resolution,
  `formatCountdown`, keep-alive/notification preference `didSet`s that push prefs,
  stale-grace restore in `init`, `shouldShowPauseWarning`/`suppressPauseWarning`,
  `requestNotificationAuthorizationIfNeeded`, `applyCloudSyncPreferences`,
  `shouldShowNotificationPermissionWarning`, `chipText`);
  `WakeAlarmNotification` (payload, category, `requestPlayback`, pending-station id);
  `LocalWakeAlarmNotifier` (`UNCalendarNotificationTrigger`, authorization).
- `rrradio/Player/AudioPlayer.swift` — `startWakeKeepAlive`/
  `stopWakeKeepAlive` (deactivates the session when idle and nothing follows),
  `keepAliveWavData` (near-silent looped WAV, volume 0.001), session
  configure/deactivate.
- `rrradio/Player/WakeAlarmLiveActivityController.swift` — `sync`/`end`, re-adopts a
  surviving activity on launch.
- `Shared/WakeAlarmActivityAttributes.swift` — Live Activity `ContentState`
  (station, `firesAt`, themed colors).
- `rrradioWidget/WakeAlarmLiveActivity.swift` — lock-screen + Dynamic Island
  presentation.
- `rrradio/Views/NowPlayingView.swift` — `WakeAlarmView` sheet (`sheetHeader`,
  `stationLine`, footer SET/UNSET + close pair), `WakeAlarmPreset`,
  `WakeAlarmSheet`, wake button + armed chip, countdown.
- `rrradio/Views/ContentView.swift` — `activate`, `syncWakeKeepAlive`,
  `syncWakeLiveActivity`, `playPendingWakeAlarmNotificationIfPossible`,
  `consumePendingIntentWakeAlarm` arming, pause-warning trigger + alert.
- `rrradio/Views/AppRouter.swift` — `consumePendingWakeNotification`,
  `WakeNotificationOutcome`, `consumePendingIntentWakeAlarm`.
- `rrradio/App.swift` — `AppDelegate` `UNUserNotificationCenterDelegate`
  (`willPresent` → banner+sound, `didReceive` → `requestPlayback`), category
  registration.
- `rrradio/Shortcuts/PlayStationIntent.swift` — `SetWakeAlarmIntent`,
  `PlayStationIntent`, `PlayLastStationIntent`; `IntentPlaybackRequest.swift` —
  `requestArmWakeAlarm` / `consumePendingWakeAlarm` (time-of-day, stale-drop).
- `rrradio/CloudSync/CloudSyncSnapshot.swift` — `wakeDefaultTime`,
  `wakeNotificationsEnabled`, `wakeKeepAliveEnabled`.
- `rrradio/Views/SettingsView.swift` — default-time row, notification
  row, conditional denied-warning row.

## Known deviations

These record shipped iOS code that does not match the intended behavior above; the
spec states intent, the audit owns the bug. See
`internal/audit/2026-05-25-ios-code-review-slice3.md`:

- **W1 (High):** notification-tap handler *queues* playback (consumed on the next
  active app pass) rather than starting it directly; a sound-only, untapped banner
  never starts the radio.
- **W2 (High):** an alarm whose fire time passed by >60 s is silently cleared at
  launch with no missed-wake cue — combined with W1, a user whose phone slept past
  the alarm gets neither playback nor a visible record.
- **W3 (Medium):** `shouldShowPauseWarning()` mutates state as a read side effect
  (non-idempotent getter).
- **W4 (Medium):** DST resolution is fixed but the chosen `firesAt` is not logged,
  so a silently-shifted firing is hard to diagnose.
- **W10 (Low):** the notification trigger is constructed without a pinned timezone;
  travel mid-arm fires at the new local time matching the original components.
- **W11 (Low):** when no notification preference is stored, the default splits on
  whether a stored wake exists (`stored → off`), an undocumented stale-migration
  branch.
- **W12 (Medium):** the denied-permission warning only renders while
  `isArmed && notificationsEnabled && notificationPermissionDenied`; denying after
  arming then disarming loses the in-sheet warning surface (the Settings warning row
  shares the same predicate).

Resolved since the audit (code now matches intent at d241aa9, no longer deviations):
W5 (the `notificationsEnabled` `didSet` now pushes the cloud-sync change, guarded by
the apply-from-sync flag); W6 (keep-alive is in the cloud-sync snapshot and its
`didSet` pushes); and the slice5 (A2) keep-alive teardown gap (`stopWakeKeepAlive`
deactivates the audio session when the player is idle and nothing follows).
