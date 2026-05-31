# Sleep Timer Specification

```yaml
status: draft
platforms: [web, ios, android]
reconciled-against: 9336321
```

## Purpose

The sleep timer lets a listener fall asleep to the radio without leaving it
playing all night. The user picks a delay; when it elapses, playback pauses
automatically while the station stays selected. The pending stop is visible
near the playback controls and on the lock screen, and can be changed or
cancelled at any time.

## Entry points

- **Now Playing** — a moon control in the secondary transport row opens the
  sleep-timer sheet. Icon is `moon.zzz` when off, `moon.zzz.fill` when armed; a
  small chip on the icon shows the armed duration.
- **Sleep-timer sheet** — the surface where the timer is set, changed, or
  cancelled.
- **Settings** — a "Default sleep timer" row sets the duration the sheet starts
  pre-filled with; it does not arm the timer.
- **Mini player** — read-only: shows a moon indicator when the timer is armed;
  tapping the mini player opens Now Playing (not the sheet directly).
- **Lock screen / system media surface** — read-only: the now-playing title
  carries a "Sleep in <n>m" suffix and the artwork carries a sleep badge while
  armed (see [playback-state-machine](../contracts/playback-state-machine.md)).

## Layout

### Now Playing moon control

- Round 44pt control in the secondary transport row.
- Glyph: `moon.zzz` (off) / `moon.zzz.fill` (armed), accent-tinted when armed.
- Chip badge (armed only): the remaining-time-at-arming as `H:MM` (e.g. `0:30`,
  `1:30`), monospaced, accent capsule, top-trailing.
- Disabled when no station is selected AND the timer is not already armed.

### Sleep-timer sheet (top to bottom)

1. Moon icon, large; filled + accent when armed.
2. Title "Sleep timer". When armed, an accent countdown capsule next to it shows
   remaining time as `H:MM` (uppercased, monospaced), refreshing on a cadence.
3. Subtitle line:
   - Armed → "Playback pauses when the timer ends".
   - Idle with a station → "Set a sleep timer for &lt;station name&gt;".
   - Idle with no station → "Play a station first".
4. Duration picker — a wheel hour:minute picker, pre-filled with the armed
   duration (when armed) or the default duration (when idle).
5. Action button — "Set" (idle) or "Unset" (armed). Disabled when idle AND no
   station is selected.
6. Helper text "Play a station first" — shown only when no station is selected
   and the timer is not armed.
7. Close affordance (top-trailing).

### Settings default row

- Moon icon, "Default sleep timer" label, current default shown as `H:MM`.
- Trailing picker offering the preset durations (30, 60, 90 minutes).

## States

| State | What shows | Actionable |
|---|---|---|
| Off, station selected | Moon outline, no chip; sheet shows default duration, "Set" enabled | Set a timer |
| Off, no station | Moon outline, control disabled; sheet shows "Play a station first", "Set" disabled | Nothing until a station plays |
| Armed | Filled moon + duration chip; sheet shows countdown + "Unset" | Change duration (re-Set) or Unset |
| Counting down | Countdown decreases on the lock screen and in the open sheet | Change or cancel |
| Fired (zero reached) | Timer clears to off; playback is paused; station stays selected | Re-arm; resume playback manually |

There is no loading / partial / error / offline state for the timer itself — it
is a local countdown with no network dependency. Its *effect* (pausing) obeys
the [playback-state-machine](../contracts/playback-state-machine.md); see Edge
cases for how an already-paused or error state interacts.

## Interactions

| Control / gesture | Precondition | Result | Side effects |
|---|---|---|---|
| Tap moon control (Now Playing) | — | Opens the sleep-timer sheet | None |
| Open sheet | — | Picker pre-fills: armed duration if armed, else the saved default | Reads default from storage |
| Adjust wheel picker | Sheet open | Stages a new duration (hours:minutes) | None until "Set" |
| Tap "Set" | Idle AND station selected | Arms the timer for the staged minutes (min 1); schedules the pause; closes sheet | Computes fire time; publishes "Sleep in <n>m" to lock screen; shows chip + filled moon |
| Tap "Set" | Idle AND no station | No-op (button disabled) | None |
| Tap "Unset" | Armed | Cancels the pending pause; closes sheet | Clears fire time; clears lock-screen suffix/badge; chip + filled moon removed |
| Re-Set while armed | Armed | Replaces the previous timer with the new duration | Old pending pause cancelled; new fire time scheduled |
| Cycle to next preset | (code affordance, web parity) | Steps off → 30 → 60 → 90 → off | Re-arms / cancels accordingly |
| Timer reaches zero | Armed | Playback pauses; timer clears to off | Calls pause on the player; station, queue, metadata retained; lock screen suffix/badge cleared |
| Change default (Settings) | — | Persists the default duration; future sheet opens pre-fill to it | Synced to iCloud where available; does not arm or change an active timer |
| Close sheet without Set/Unset | Sheet open | Dismisses; no change to the timer | None |
| Tap mini-player moon | n/a (indicator only) | n/a — opening the mini player navigates to Now Playing | None |
| App backgrounded while armed | Armed | Countdown continues; fires while backgrounded if the session stays eligible | Lock-screen suffix refreshes on a cadence |

## Business rules

- **Preset cycle durations:** off, 30, 60, 90 minutes. The cycle never includes
  a 15-minute preset on iOS (see Open questions for web parity).
- **Settings default presets:** 30, 60, 90 minutes (the nonzero cycle values).
- **Default duration:** seeded to **30 minutes** on first run; persisted locally
  and synced via iCloud where available.
- **Free-form duration (iOS sheet):** the wheel picker accepts any hours:minutes
  value; the armed duration is clamped to a **minimum of 1 minute**.
- **Changing the timer replaces the previous timer** — there is never more than
  one pending pause.
- **Turning the timer off cancels the pending pause.**
- **Firing pauses playback; it does not stop it.** The active station, queue,
  metadata, and now-playing context are preserved (a `playing`→`paused`
  transition, not `stop`/`idle`) — see
  [playback-state-machine](../contracts/playback-state-machine.md).
- **Arming requires a selected station** (or an already-armed timer to cancel).
- **Countdown display granularity:** minutes, rounded up; shown as `H:MM`.
  Sub-minute remainder reads as the next whole minute; at/after zero it reads
  "now".
- **Refresh cadence:** the in-sheet countdown and the lock-screen "Sleep in
  <n>m" suffix both refresh about every **30 seconds**.
- **Chip vs. countdown:** the moon-control chip shows the *armed* duration
  (`H:MM`, fixed at arming); the sheet capsule shows the *live remaining* time.
- **Wake-to-radio coexistence:** firing the sleep timer must preserve any
  platform wake keep-alive contract (see [Wake to radio](wake-to-radio.md)); a
  sleep pause is silent-bed compatible and must not tear down an armed wake.

## Data dependencies

- [playback-state-machine](../contracts/playback-state-machine.md) — the
  pause transition the timer triggers, the preserved station/queue context, and
  the now-playing fields (the "Sleep in <n>m" title suffix and armed-badge
  artwork) the system media surface publishes while armed.

## Edge cases

- **Fire while already paused:** pausing an already-paused player is a no-op for
  audio; the timer still clears to off.
- **Fire while in `error`:** the player is not playing; the timer clears
  regardless. No retry is triggered by the sleep timer.
- **No station when "Set" is reached:** prevented — the action is disabled and a
  "Play a station first" hint shows.
- **Station changed after arming:** the timer is independent of which station is
  selected; it pauses whatever is current when it fires. (The arming subtitle
  named a station, but the pending pause is not bound to it.)
- **Re-arm during countdown:** the prior pending pause is cancelled atomically;
  exactly one pause is scheduled.
- **Backgrounding / lock:** countdown continues; firing while backgrounded
  depends on the OS keeping the audio session eligible (iOS: supported while the
  session remains active; web/Android: OS/browser dependent — see Matrix).
- **App terminated before fire:** an armed timer does not survive a cold kill; it
  is in-memory only and is not restored on relaunch.
- **Sub-minute arming:** a duration below 1 minute is clamped up to 1 minute.
- **Interruption (call) while armed:** playback pauses for the interruption per
  the playback state machine; the sleep timer keeps counting and will still
  clear at zero (pausing an already-paused player is harmless).

## Accessibility

- Moon control carries the localized "Sleep timer" label; armed/off state is
  conveyed by the filled/outline glyph and the duration chip.
- Mini-player armed indicator carries the "Sleep timer active" label.
- Action button reads "Set" / "Unset"; subtitle text is plain readable copy.
- Countdown text is monospaced for stable width; should be exposed as remaining
  time to assistive tech, not just visually.
- Sheet content scales with Dynamic Type; the wheel picker uses the system
  picker (native VoiceOver support).
- Helper "Play a station first" hint communicates why "Set" is disabled.

## Localization

This surface owns:

- `sleepTimer` — "Sleep timer" (control + sheet title).
- `defaultSleep` — "Default sleep timer" (Settings row).
- `set` — "Set"; `unset` — "Unset" (action button).
- `playStationFirst` — "Play a station first" (disabled hint + subtitle).
- `sleepTimerActive` — "Sleep timer active" (mini-player a11y label).
- `sleepTimerMessage` — "Stop playback after a delay." (description).
- `sleepTimerForStation` — "Sleep timer for {name}" (parameterized by station
  name).

Parameter/plural needs:

- `{name}` parameter in `sleepTimerForStation`.
- "Sleep in <n>m" lock-screen suffix and `H:MM` countdown are numeric-formatted,
  not full localized plural strings today (see Open questions).

## Platform Matrix

| Behavior | Web | iOS | Android |
|---|---|---|---|
| Timer cycle | Supported. | Reference. | Supported. |
| Preset durations | 15/30/60/90 (web). | 30/60/90 cycle; free-form via picker. | 30/60/90. |
| Visible remaining time | Supported where UI exposes it. | Supported (control chip + sheet countdown + lock screen). | Partial. |
| Background firing | Browser/OS dependent. | Supported while app/session remains eligible. | Planned through service/alarm design. |
| Wake interaction | Silent-bed behavior. | Keep-alive aware. | To be designed with Android wake flow. |
| Persisted default duration | Supported where settings exist. | Supported (synced via iCloud). | Partial. |
| Pause-not-stop on fire | Supported. | Reference. | Supported. |

## Android First-Port Requirement

Android includes the sleep timer cycle. Alignment work should verify background
behavior with the app backgrounded and the media notification active.

## Open questions

- **15-minute preset parity.** The web app offers a 15-minute cycle option; the
  iOS cycle is 30/60/90 only. iOS users can still reach 15 minutes via the
  free-form wheel picker, but the *preset cycle* differs. Decide whether the
  cycle set is a hard cross-platform contract.
- **Free-form vs. preset entry.** iOS surfaces an arbitrary hours:minutes picker
  in the sheet, while web/Android lean on preset taps. Should arbitrary
  durations be a shared capability or an iOS-only affordance?
- **Localized countdown formatting.** The "Sleep in <n>m" suffix and `H:MM`
  countdown are numeric formats, not full localized plural strings; promote to
  proper plural/format rules if a locale needs them.
- **Persistence across cold launch.** An armed timer is in-memory only and does
  not survive app termination. Whether to restore a pending pause on relaunch is
  undecided.

## Reference

- `rrradio-ios/rrradio/Player/SleepTimer.swift` — `cycleMinutes`
  `[0, 30, 60, 90]`, `defaultMinutesKey` (`rrradio.sleep.defaultMinutes.v1`,
  fallback 30), `set(minutes:onFire:)`, `cycle(onFire:)`, `cancel()`,
  `fire(onFire:)` (pauses + clears), `chipText`, `countdownText(at:)`,
  `applyCloudSyncDefaultMinutes`.
- `rrradio-ios/rrradio/Views/NowPlayingView.swift` — `sleepControlButton`,
  `roundControlButton` chip rendering, `SleepTimerView` sheet (wheel
  `DatePicker`, Set/Unset, `TimelineView` 30s countdown, `targetLine`,
  `minutes(from:)` clamp).
- `rrradio-ios/rrradio/Views/MiniPlayerView.swift` — armed moon indicator.
- `rrradio-ios/rrradio/Views/SettingsView.swift` — `sleepDefaultRow` default
  picker, `@AppStorage(SleepTimer.defaultMinutesKey)`.
- `rrradio-ios/rrradio/Player/AudioPlayer.swift` — `setLockScreenSleepTimer`,
  `lockScreenSleepTimerText` ("<n>m"), `scheduleLockScreenSleepTimerRefresh`
  (30s), now-playing title suffix and artwork sleep badge.
- `rrradio-ios/rrradio/App.swift` — wiring of `onStateChanged` →
  `setLockScreenSleepTimer`, sheet `onFire` → `player.pause()`.
- `rrradio-ios/rrradio/CloudSync/*` — `sleepTimerDefaultMinutes` snapshot field
  and `applyCloudSyncDefaultMinutes` sync.
- `rrradio-ios/rrradioTests/SleepTimerTests.swift` — cycle, set-zero-cancels,
  fire-clears-and-pauses behavior.

## Known deviations

- None recorded. (If the audio session is not deactivated on a sleep-timer
  pause, that is governed by the playback session deviation in
  [playback-state-machine](../contracts/playback-state-machine.md) "Known
  deviations" — `rrradio-ios/internal/audit/2026-05-25-ios-code-review-slice5.md`
  — not a sleep-timer-specific bug.)
