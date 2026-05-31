# Wake To Radio Specification

```yaml
status: draft
platforms: [web, ios, android]
reconciled-against: 9336321
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
- **Settings** — three persistent preference rows (default wake time, Lock Screen
  notification toggle) seed the next alarm but do not arm one.
- **Notification tap** — tapping the fired wake notification re-enters the app and
  drives the notification → playback flow (see Interactions).
- **Shortcuts / Siri (iOS)** — "Play Station" and "Play Last Station" App Intents
  let a user build a Time-of-Day Personal Automation that starts a station on a
  schedule. This is a parallel path, independent of the in-app alarm.

## Layout

The wake sheet, top to bottom:

- **Close button** — top-trailing `xmark`; dismisses the sheet without changing the
  alarm.
- **Header** — alarm glyph (filled + accent when armed); title "Wake to radio";
  when armed, a live countdown capsule ("IN 7H 20M") that ticks every 30s.
- **Station identity card** — favicon, station name, and (when set) the alarm
  title/program line for the wake target. When no station is resolvable, shows
  "Play a station first" instead.
- **Time wheel** — hour/minute picker. Defaults to the preset time, else the
  current alarm time, else the saved default wake time.
- **Lock Screen notification toggle** — with detail copy. Disabled while an alarm
  is armed (unless the sheet is editing that armed alarm).
- **Notification-denied warning** (conditional) — shown only when the notification
  toggle is on and OS permission is denied: a bell-slash icon, a warning line, and
  an "Open Settings" button that deep-links to the app's system settings.
- **Keep-audio-alive toggle** — with detail copy. Disabled while an alarm is armed.
- **Action button** — "SET" when no alarm (or editing one); "UNSET" when armed and
  unchanged. While armed it shows a subtitle (the new time when editing, else
  "<time> · in <countdown>"). Disabled when setting but no station resolves.
- **Hint** — accent footnote: keep rrradio running and enable keep-alive for the
  best chance of autoplay.

The wake target station chips show the armed time on the Now Playing wake button
while armed.

## States

| State | What shows | Actionable |
|---|---|---|
| Disarmed, station playing | Sheet pre-fills station + default/last time; SET enabled. | Set an alarm. |
| Disarmed, nothing playing | Station card shows "Play a station first"; SET disabled. | Pick time/toggles only; cannot set. |
| Armed | Header countdown capsule; button reads UNSET with `<time> · in <countdown>`; toggles locked. | Unset; edit (changing time/station/title flips to SET). |
| Editing an armed alarm | Button flips back to SET with the new time as subtitle; toggles re-enabled. | Re-arm with new values. |
| Notification permission denied | Denied-warning block under the notification toggle (only while toggle on). | Open Settings. |
| Fired (alarm reached) | Alarm disarms itself; if the app is alive it switches to the station; Now Playing surfaces shortly after. | Normal playback. |
| Missed (app was suspended/asleep) | The fired local notification is the cue; on next launch a stale alarm is cleared (see deviations). | Tap notification to start; or re-arm. |

There is at most **one** active wake intent at a time.

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
| Pause playback while armed (keep-alive off) | Armed, keep-alive off, warning not suppressed | One-time alert: alarm may not auto-play; offers "Don't show again" | Suppress flag persisted on dismiss-with-don't-show |
| Run "Play Station" / "Play Last Station" intent | App launchable by iOS | Queues a playback request; app foregrounds and plays | Independent of in-app alarm |

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
  are part of the cloud-sync snapshot (see Known deviations for the keep-alive gap).

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

- Wake button carries the localized "Wake to radio" label; armed state adds the
  time as a value.
- Close button has an explicit "Close" accessibility label.
- Toggles expose title + detail text; the denied warning is readable as a labeled
  block with an "Open Settings" action.
- Station name and title use `minimumScaleFactor` so they scale rather than
  truncate under large Dynamic Type.
- Countdown capsule updates on a 30s timeline; it is decorative relative to the
  primary time, which remains the source of truth.

## Localization

This surface owns these strings (English reference values):

- `wakeToRadio` — "Wake to radio"
- `wakeTime` — "Wake time"
- `defaultWake` — "Default wake time"
- `wakeHint` — autoplay/keep-alive guidance footnote
- `wakeNotification` — "Lock Screen notification"
- `wakeNotificationDetail` — "Shows a wake alert at the set time. Program alarms turn this on by default."
- `wakeNotificationsDeniedWarning` — denied-permission warning
- `wakeKeepAlive` — "Keep audio alive until wake"
- `wakeKeepAliveDetail` — near-silent-sound + battery explanation
- `wakePauseWarningTitle` / `wakePauseWarningMessage` — pause-while-armed alert
- `unsetWakeAlarm` — "Unset wake alarm"
- `playStationFirst` — "Play a station first"
- `set` / `unset`, `openSettings`, `dontShowAgain`, `close`, `ok` (shared)

Notification body interpolates station name and time; localization must keep the
station/time parameters. No plural forms required (countdown uses compact "Hh Mm"
formatting; "now"/"soon" are special-cased).

## Platform Matrix

| Behavior | Web | iOS | Android |
|---|---|---|---|
| In-app timer | Supported while tab/session remains alive. | Supported while app remains alive. | Planned while process/service remains alive. |
| Keep audio alive | Silent-bed audio workaround. | Near-silent local audio keep-alive (default on). | TBD, likely foreground service if allowed. |
| Local notification fallback | Browser support dependent. | Supported (one-shot, fixed identifier). | Planned. |
| Notification-tap → playback | Browser support dependent. | Supported (queued, consumed on next active pass — see W1). | Planned. |
| Pre-armed default time / prefs | Browser-local. | Supported (default time, notify, keep-alive). | Planned. |
| Program-schedule preset arming | Where schedules exist. | Supported. | Planned. |
| DST-safe next-fire resolution | Required. | Supported. | Required. |
| Pause-while-armed warning | TBD. | Supported (once per alarm, keep-alive off). | TBD. |
| Shortcuts/automation | Not applicable. | Supported through App Intents/Shortcuts. | Not applicable. |
| Exact alarm | Not available. | Not available to third-party app in this sense. | Open decision; may require permission. |
| Survives force quit | No. | No. | No reliable guarantee. |
| Preference cloud sync | Not planned. | Supported for time + notify (keep-alive gap, W6). | Not applicable. |

## Web

The web wake flow is browser-limited. It can work while the page and audio session
remain eligible, but it must not promise alarm-clock reliability. A silent-bed
audio workaround and the Media Session / Notifications APIs (where supported) are
the closest analogs to the iOS keep-alive and notification fallback.

## iOS

iOS is the current reference behavior:

- In-app wake alarm with a runloop-`.common` timer (survives scroll).
- Near-silent keep-alive option (default on).
- One-shot local notification fallback.
- App Intents / Shortcuts actions "Play Station" and "Play Last Station".

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

- `rrradio-ios/rrradio/Player/WakeAlarm.swift` — `WakeAlarm` (`arm`, `disarm`,
  `activate`, `fire`, `fireFromNotification`, `nextFireDate` DST-safe resolution,
  `formatCountdown`, keep-alive/notification preference `didSet`s, stale-grace
  restore in `init`, `shouldShowPauseWarning`/`suppressPauseWarning`,
  `requestNotificationAuthorizationIfNeeded`, `applyCloudSyncPreferences`);
  `WakeAlarmNotification` (payload, category, `requestPlayback`, pending-station id);
  `LocalWakeAlarmNotifier` (`UNCalendarNotificationTrigger`, authorization).
- `rrradio-ios/rrradio/Player/AudioPlayer.swift` — `startWakeKeepAlive`/
  `stopWakeKeepAlive`, `keepAliveWavData` (near-silent looped WAV), session
  configure/deactivate.
- `rrradio-ios/rrradio/Views/NowPlayingView.swift` — `WakeAlarmView` sheet,
  `WakeAlarmPreset`, wake button, station identity, countdown, pause warning trigger.
- `rrradio-ios/rrradio/Views/ContentView.swift` — `activate`, `syncWakeKeepAlive`,
  `playPendingWakeAlarmNotificationIfPossible`, pause-warning alert.
- `rrradio-ios/rrradio/Views/AppRouter.swift` — `consumePendingWakeNotification`,
  `WakeNotificationOutcome`.
- `rrradio-ios/rrradio/App.swift` — `AppDelegate` `UNUserNotificationCenterDelegate`
  (`willPresent`, `didReceive`), category registration.
- `rrradio-ios/rrradio/Shortcuts/PlayStationIntent.swift`,
  `IntentPlaybackRequest.swift` — "Play Station" / "Play Last Station" App Intents.
- `rrradio-ios/rrradio/CloudSync/CloudSyncSnapshot.swift` — `wakeDefaultTime`,
  `wakeNotificationsEnabled`, `wakeKeepAliveEnabled`.
- `rrradio-ios/rrradio/Views/SettingsView.swift` — default-time row, notification
  row, denied warning.

## Known deviations

These record shipped iOS code that does not match the intended behavior above; the
spec states intent, the audit owns the bug. See
`rrradio-ios/internal/audit/2026-05-25-ios-code-review-slice3.md`:

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
- **W5 (Medium):** a direct write to `notificationsEnabled` bypasses the cloud-sync
  push that the explicit setter performs.
- **W6 (Medium):** keep-alive-enabled is read into the snapshot but its direct setter
  is not consistently synced across devices.
- **W10 (Low):** the notification trigger is constructed without a pinned timezone;
  travel mid-arm fires at the new local time matching the original components.
- **W11 (Low):** when no notification preference is stored, the default splits on
  whether a stored wake exists (`stored → off`), an undocumented stale-migration
  branch.
- **W12 (Medium):** the denied-permission warning only renders while
  `isArmed && notificationsEnabled && notificationPermissionDenied`; denying after
  arming then disarming loses the warning surface.
- Related session/keep-alive teardown gap: see
  `rrradio-ios/internal/audit/2026-05-25-ios-code-review-slice5.md` (A2) — the audio
  session is not always deactivated when keep-alive stops and nothing follows.
