# Sleep timer

> Verify sleep timer durations (off / 15 / 30 / 60 / 90 minutes), mid-playback set, and fire behaviour (pauses playback). Simulator works for non-fire steps; real device or patient simulator session for fire confirmation. ~15 minutes if fully tested; ~5 minutes if you accept that the 15-minute timer fires correctly and assume the rest are equivalent.

## Preconditions

- [ ] Build under test: __________
- [ ] Test environment: simulator or real-device
- [ ] You have ~15 minutes for the minimum test (waiting for the 15-minute timer to fire), OR you're prepared to inspect logs / use a debugger to confirm fire behaviour without waiting

## Steps

### UI / state

1. Start playback. Open the sleep-timer control (button, menu, or sheet — note the entry point) — expected: shows current state (off) and options off / 15 / 30 / 60 / 90.
2. Pick **15 min** — expected: UI confirms; control shows remaining time (e.g. "15:00") or "Sleeps in 15 min".
3. Cancel back to the playback screen — expected: timer indicator persists somewhere visible (mini-player, now-playing screen, or settings).
4. Open the sleep-timer control again — expected: it shows the remaining time, counting down. Pick **30 min** — expected: timer resets to 30 min; old 15-min timer is replaced.
5. Pick **off** — expected: timer is canceled; remaining-time indicator disappears.

### Cycle through all durations

6. Set **15 min**, observe display, cancel, set **30 min**, cancel, set **60 min**, cancel, set **90 min** — expected: every option behaves the same; UI updates correctly.

### Fire behaviour (15-minute test)

7. Start playback; set **15 min**.
8. Wait. (Real device: leave the device alone, screen can lock.) Optionally do other things on the phone — playback should continue throughout the 15 minutes.
9. At ~14:55 mark — expected: playback continues; timer indicator shows ~5 sec remaining.
10. At fire time — expected: **playback pauses** (audio stops); the timer indicator clears; the lock-screen card (if visible) shows paused state.
11. Manually press Play — expected: audio resumes within 2 seconds. (The timer is one-shot; resuming does not re-arm it.)

### Persistence

12. Start playback, set 30 min, force-quit the app — expected: on next launch, the timer is **not** restored (project decision; typical for sleep timers — confirm current behaviour and document).
13. Set sleep timer; switch to a different station mid-playback — expected: timer continues uninterrupted; firing pauses the new station.

## Acceptance

- [ ] All five options (off/15/30/60/90) selectable and visible
- [ ] Selecting a new duration replaces an existing one (not adds)
- [ ] **Off** cancels an active timer cleanly
- [ ] 15-minute timer fires within ±10 seconds of the expected mark
- [ ] Fire pauses playback (stop, not crash, not silent buffering)
- [ ] Timer does not persist across force-quit (or, if it does, it's intentional and documented)
- [ ] Switching stations during the timer keeps the timer running

## Notes for the tester

- `SleepTimerTests.swift` covers the duration cycle and state transitions in the unit tests; this script verifies the integration with `AudioPlayer`.
- The ±10 second tolerance on fire timing accounts for real-device timer drift. Anything > 30 seconds drift is a bug.
- If you don't want to wait the full 15 minutes, dropping the minimum option down to 1-min via debugger (or a temporary build with `[1, 2, 5, 10, 15]`) is fine — but verify with a real 15-min run before shipping.
- iCloud sync of the **default** sleep timer setting is part of [`icloud-sync.md`](icloud-sync.md), not this script.
