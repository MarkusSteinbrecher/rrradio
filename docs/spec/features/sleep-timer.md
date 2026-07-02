# Sleep Timer Specification

```yaml
status: review
platforms: [web, ios, android]
reconciled-against: d241aa9
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
- **Settings** — a "Default sleep timer" row (under "Timer defaults") sets the
  duration the sheet starts pre-filled with; it does not arm the timer.
- **Mini player** — read-only: shows a moon indicator when the timer is armed;
  tapping the mini player opens Now Playing (not the sheet directly).
- **Lock screen / system media surface** — read-only: the now-playing title
  carries a "Sleep in <n>m" suffix and the artwork carries a sleep badge while
  armed (see [playback-state-machine](../contracts/playback-state-machine.md)).

## Layout

### Now Playing moon control

- Round 44pt control in the secondary transport row (beside the wake-alarm
  control, next to previous / next).
- Glyph: `moon.zzz` (off) / `moon.zzz.fill` (armed), accent-tinted when armed.
- Chip badge (armed only): the armed duration as `H:MM` (e.g. `0:30`, `1:30`),
  monospaced, accent capsule, top-trailing.
- Disabled when no station is selected AND the timer is not already armed.

### Sleep-timer sheet (top to bottom)

1. **Header row** — centered moon glyph (`moon.zzz` off / `moon.zzz.fill` +
   accent armed) and the "Sleep timer" title (station-name size), closed by a
   hairline rule that runs edge to edge. When armed, an accent countdown capsule
   rides the trailing edge of the header (uppercased, monospaced `H:MM`),
   refreshing on a cadence; it sits in an overlay so it never pulls the centered
   title off-center.
2. **Duration wheel** — a two-component hours:minutes wheel (not a wall-clock
   time picker), floated to roughly mid-sheet. Bare numbers on the wheels with
   the unit labels ("h" / "min") fixed in the selection band. Pre-filled with the
   armed duration (when armed) or the default duration (when idle).
3. **Helper text "Play a station first"** — directly under the wheel; visible
   only when no station is selected and the timer is not armed (otherwise
   transparent, holding its layout space).
4. **Footer button pair** — centered group: an x-to-close button (left) and the
   confirm button (right), "Set" (idle) or "Unset" (armed). The confirm button
   is disabled (and dimmed) when idle AND no station is selected. There is no
   subtitle line and no separate top-trailing close.

### Settings default row

- Moon icon, "Default sleep timer" label, with the subtitle "Set the time to
  sleep in hh:mm" (the dial reads as a duration, not a time of day).
- Trailing compact time picker pinned to a 24-hour locale, covering any duration
  in `0:01`–`23:59`. Free-form — it is not limited to the cycle presets. `0:00`
  is clamped up to one minute.

## States

| State | What shows | Actionable |
|---|---|---|
| Off, station selected | Moon outline, no chip; sheet pre-fills default duration, "Set" enabled | Set a timer |
| Off, no station | Moon outline, control disabled; sheet shows "Play a station first" hint, "Set" disabled | Nothing until a station plays |
| Armed | Filled moon + duration chip; sheet header shows live countdown capsule + "Unset" | Unset (then re-open + Set to change duration) |
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
| Re-Set while armed | Armed | Tapping "Unset" while armed cancels; to change the duration, Unset then Set again with the new wheel value | Old pending pause cancelled; a fresh Set schedules a new fire time |
| Cycle to next preset | (code affordance only) | Steps off → 30 → 60 → 90 → off | iOS exposes no UI for this; the sheet uses the free-form wheel. Web parity affordance only — unwired on iOS |
| Timer reaches zero | Armed | Playback pauses; timer clears to off | Calls pause on the player; station, queue, metadata retained; lock screen suffix/badge cleared |
| Change default (Settings) | — | Persists the default duration (free-form, clamped ≥ 1 min); future sheet opens pre-fill to it | Synced to iCloud where available; does not arm or change an active timer |
| Close sheet without Set/Unset | Sheet open | Dismisses; no change to the timer | None |
| Tap mini-player moon | n/a (indicator only) | n/a — opening the mini player navigates to Now Playing | None |
| App backgrounded while armed | Armed | Countdown continues; fires while backgrounded if the session stays eligible | Lock-screen suffix refreshes on a cadence |

## Business rules

- **Preset cycle durations:** off, 30, 60, 90 minutes. The cycle is the model's
  `cycle()` step set; on iOS no UI invokes it (see Interactions). It never
  includes a 15-minute preset (see Open questions for web parity).
- **Settings default duration:** free-form. The Settings row accepts any
  `0:01`–`23:59` duration via a 24-hour time picker — it is *not* limited to the
  cycle presets. `0:00` is clamped up to one minute.
- **Default duration seed:** **30 minutes** on first run; persisted locally under
  `rrradio.sleep.defaultMinutes.v1` and synced via iCloud where available.
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
  selected; it pauses whatever is current when it fires. The pending pause is not
  bound to a specific station.
- **Re-arm during countdown:** any new `set(minutes:)` invalidates the prior
  timer atomically before scheduling the next, so exactly one pause is ever
  pending. (Via the iOS sheet, an armed timer's confirm button reads "Unset";
  changing the duration is Unset then Set, not a single in-place re-arm.)
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
- Footer buttons carry "Close" and "Set" / "Unset" accessibility labels.
- Countdown text is monospaced for stable width; should be exposed as remaining
  time to assistive tech, not just visually.
- Sheet content scales with Dynamic Type; the title scales down to fit; the
  duration wheel uses the system picker control (native VoiceOver support).
- Helper "Play a station first" hint communicates why "Set" is disabled.

## Localization

This surface owns:

- `sleepTimer` — "Sleep timer" (control + sheet title).
- `defaultSleep` — "Default sleep timer" (Settings row).
- `set` — "Set"; `unset` — "Unset" (confirm button).
- `close` — "Close" (footer x-to-close a11y label).
- `playStationFirst` — "Play a station first" (disabled hint under the wheel).
- `sleepTimerActive` — "Sleep timer active" (mini-player a11y label).
- `hoursShort` — "h"; `minutesShort` — "min" (duration-wheel unit labels).

Catalog strings present but **not currently rendered** by this surface (the
restructured sheet dropped its subtitle line):

- `sleepTimerMessage` — "Stop playback after a delay." (description copy).
- `sleepTimerForStation` — "Sleep timer for {name}" (parameterized by station
  name).

Hard-coded English copy (not yet localized keys):

- The Settings subtitle "Set the time to sleep in hh:mm".
- The lock-screen "Sleep in <n>m" title suffix.

Parameter/plural needs:

- `{name}` parameter in `sleepTimerForStation` (string defined; unused today).
- "Sleep in <n>m" lock-screen suffix and `H:MM` countdown are numeric-formatted,
  not full localized plural strings today (see Open questions).

## Platform Matrix

| Behavior | Web | iOS | Android |
|---|---|---|---|
| Timer cycle | Supported. | Model only (no UI invokes `cycle()`). | Supported. |
| Preset / free-form durations | Partial (web cycle is `[0, 15, 30, 60]`; the canonical set is `[0, 30, 60, 90]` — alignment pending); no free-form entry. | Free-form via wheel (sheet) and 24h picker (Settings default); cycle presets unwired. | Supported (cycle is the canonical `[0, 30, 60, 90]`, first tap jumps to the persisted default); no free-form sheet entry. |
| Visible remaining time | Partial (moon-control chip shows the *armed* duration as `<n>m`, fixed at arming; no live countdown, no sheet, no lock-screen suffix). | Supported (control chip + sheet countdown + lock screen). | Partial (the Sleep button shows the *armed* duration as `<n>m`, fixed at arming, in the transport row and mini player; no live countdown, no sheet, no media-notification suffix). |
| Background firing | Browser/OS dependent. | Supported while app/session remains eligible. | Partial (a ViewModel coroutine fires the pause via the foreground MediaSessionService, so it works while playback keeps the process alive; not yet backed by AlarmManager/exact-alarm, so it does not survive process death — Planned toward parity). |
| Wake interaction | Silent-bed behavior. | Keep-alive aware. | Planned — to be designed with the Android wake flow. |
| Persisted default duration | Not planned (no Settings row; the cycle resets to off on each load — there is no stored default). | Supported (synced via iCloud). | Supported (default in a Settings "Sleep timer" section, persisted via DataStore under `rrradio.sleep-default-minutes.v1`, seeded to 30, included in the SAF library backup; free-form hours:minutes entry, matching the iOS Settings picker). |
| Pause-not-stop on fire | Supported. | Reference. | Supported. |

## Android First-Port Requirement

Android implements the preset sleep-timer cycle (the canonical `[0, 30, 60, 90]`,
first tap from off jumping to the persisted default) with a default in Settings, and
pauses via the foreground MediaSessionService when the timer fires. Toward iOS
parity it still lacks the free-form duration wheel, the live countdown / sheet,
and a media-notification "Sleep in <n>m" suffix; these are Planned. Background
firing currently rides a ViewModel coroutine plus the foreground service rather
than `AlarmManager`/exact-alarm, so it does not survive process death — promoting
it to an AlarmManager-backed schedule (the Android analogue of the iOS keep-alive
session) is the parity step, and should be designed alongside the Android wake
flow (see [Wake to radio](wake-to-radio.md)).

## Open questions

- ~~**15-minute preset parity.**~~ **Resolved (sponsor, 2026-07-02):** the
  cycle set is a hard cross-platform contract — the iOS model set
  `[0, 30, 60, 90]` is canonical. Android aligned 2026-07-02; web drops its
  15-minute step when next touched.
- ~~**Free-form vs. preset entry.**~~ **Resolved (sponsor, 2026-07-02):**
  preset-tap cycling remains the web/Android entry; the free-form wheel sheet
  stays an iOS-only affordance and is not required for parity.
- **Dropped sheet subtitle copy.** The `sleepTimerForStation` ("Sleep timer for
  {name}") and `sleepTimerMessage` ("Stop playback after a delay.") strings are
  still in the catalog but no longer rendered after the sheet restructure (the
  subtitle line was removed). Decide whether to retire the strings or restore a
  description line.
- **Localized countdown formatting.** The "Sleep in <n>m" suffix and `H:MM`
  countdown are numeric formats, not full localized plural strings; promote to
  proper plural/format rules if a locale needs them.
- **Persistence across cold launch.** An armed timer is in-memory only and does
  not survive app termination. Whether to restore a pending pause on relaunch is
  undecided.

## Reference

- `rrradio-ios/rrradio/Player/SleepTimer.swift` — `cycleMinutes`
  `[0, 30, 60, 90]`, `defaultMinutesKey` (`rrradio.sleep.defaultMinutes.v1`,
  `fallbackDefaultMinutes` 30), `set(minutes:onFire:)`, `cycle(onFire:)` (no UI
  caller), `cancel()`, `fire(onFire:)` (pauses + clears), `setDefaultMinutes`,
  `applyCloudSyncDefaultMinutes`, `chipText` (armed `H:MM`),
  `countdownText(at:)` (live remaining; "now" at/after zero), `format`.
- `rrradio-ios/rrradio/Views/NowPlayingView.swift` — `sleepControlButton`,
  `roundControlButton` 44pt + chip rendering, `SleepTimerView` sheet:
  `sheetHeader` (centered moon + title, edge-to-edge hairline rule, trailing
  countdown capsule overlay, `TimelineView(.periodic by: 30)`), `durationWheel`
  (`DurationWheelPicker` + `DurationWheelUnitLabels`), `footerButtons`
  (x-to-close + Set/Unset, `max(1, …)` clamp), `canConfirm`.
- `rrradio-ios/rrradio/Views/MiniPlayerView.swift` — armed `moon.zzz.fill`
  indicator.
- `rrradio-ios/rrradio/Views/SettingsView.swift` — `sleepDefaultRow`
  (compact `DatePicker` pinned to `de_DE` 24h locale, ≥ 1 min clamp) under the
  "Timer defaults" section, `@AppStorage(SleepTimer.defaultMinutesKey)`.
- `rrradio-ios/rrradio/Player/AudioPlayer.swift` — `setLockScreenSleepTimer`,
  `lockScreenSleepTimerText` ("<n>m"), `lockScreenTitle` ("… - Sleep in <n>m"
  suffix), `scheduleLockScreenSleepTimerRefresh` (30s), `renderLockScreenArtwork`
  (`moon.zzz.fill` accent badge while armed).
- `rrradio-ios/rrradio/App.swift` — wiring of `sleepTimer.onStateChanged` →
  `player.setLockScreenSleepTimer(firesAt:)`, sheet `onFire` → `player.pause()`.
- `rrradio-ios/rrradio/CloudSync/*` — `sleepTimerDefaultMinutes` snapshot field
  (`CloudSyncSnapshot`, `SettingsBackup`, `CloudSyncStore`) and
  `applyCloudSyncDefaultMinutes` apply path in `CloudSyncController`.
- `rrradio-ios/rrradioTests/SleepTimerTests.swift` — starts-disarmed,
  cycle-uses-web-durations, set-zero-cancels, state-change-callback,
  fire-clears-and-pauses.

## Known deviations

- **`cycle()` skips presets after a custom default.** The intent is a stable
  off → 30 → 60 → 90 → off cycle. The shipped `cycle()` first jumps from off to
  the *current default* and then walks the array, so a non-30 default makes the
  30-minute step (and others) unreachable. Latent today — no iOS UI invokes
  `cycle()` — but documented at
  `rrradio-ios/internal/audit/2026-05-25-ios-code-review-slice4.md` (S2).
- **Armed-chip `H:MM` reads as a clock time.** The chip/countdown format
  (`0:30`, `1:30`) is duration-shaped but visually ambiguous with wall-clock
  time; flagged Medium at
  `rrradio-ios/internal/audit/2026-05-25-ios-code-review-slice4.md` (S1).
- If the audio session is not deactivated on a sleep-timer pause, that is
  governed by the playback session deviation in
  [playback-state-machine](../contracts/playback-state-machine.md) "Known
  deviations" — `rrradio-ios/internal/audit/2026-05-25-ios-code-review-slice5.md`
  — not a sleep-timer-specific bug.
