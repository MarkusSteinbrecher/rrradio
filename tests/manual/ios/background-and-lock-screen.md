# Background audio and lock-screen controls

> Verify audio continues in the background, lock-screen card appears with metadata, and remote controls (lock-screen, Control Center, AirPods) work. **Real device required** — the simulator does not render the lock-screen card. ~8 minutes.

## Preconditions

- [ ] Build under test: __________
- [ ] Test environment: **real device** (iPhone running iOS 17+)
- [ ] AirPods or other Bluetooth headphones if you want to test pair-controls (optional but recommended)
- [ ] App has Background Modes → Audio capability enabled (verify in Xcode → Signing & Capabilities, or Info.plist `UIBackgroundModes: [audio]`)
- [ ] You're holding the phone unlocked, ready to lock it on cue

## Steps

1. Start playing a station with metadata support (e.g. **BBC Radio 1**, **FM4**, or **Radio Swiss Pop**) — expected: audio audible; metadata appears within ~30 seconds.
2. Press the side button to **lock the device** — expected: audio continues uninterrupted.
3. Wake the screen (lift to wake or tap) — expected: a **now-playing card** is visible on the lock screen showing station name, current track (if available), play/pause, and (optionally) artwork.
4. Tap **Pause** on the lock-screen card — expected: audio stops within 1 second; card updates to show play icon.
5. Tap **Play** again — expected: audio resumes within ~2 seconds.
6. Open **Control Center** (swipe down from top-right on iOS 17+) — expected: media-control widget shows rrradio with the same metadata; play/pause works.
7. Unlock the phone, swipe up or press Home — expected: rrradio's mini-player still visible; audio still playing.
8. Open another app (e.g. Notes, Safari) — expected: rrradio audio continues; lock-screen card still works.
9. **AirPods test** (if available): tap the AirPod stem (or use the press control configured for play/pause) — expected: audio pauses; tap again — resumes.
10. **AirPods skip-track test** (if your AirPods support it): try forward/back — expected: rrradio either ignores skip (no track concept for live radio) **or** uses skip as next/previous favorite (note current behaviour, neither is wrong).
11. While playing, swipe up or hit Home to background the app — expected: audio continues; the lock-screen card remains responsive.
12. Force-quit the app from the app switcher while audio is playing — expected: audio stops; lock-screen card is dismissed.

## Acceptance

- [ ] Audio continues uninterrupted across screen lock
- [ ] Lock-screen now-playing card appears with the correct station
- [ ] Lock-screen play/pause controls audio
- [ ] Control Center widget mirrors the lock-screen card and controls correctly
- [ ] Audio continues when other apps are foregrounded
- [ ] AirPods stem-press play/pause works (if AirPods available)
- [ ] Force-quit cleanly stops audio and dismisses the card

## Notes for the tester

- The lock-screen card is wired via `MPNowPlayingInfoCenter` + `MPRemoteCommandCenter` in `ios/rrradio/Player/AudioPlayer.swift`. If it never appears, that's a wiring bug — file with `severity:high`.
- Track artwork on the lock-screen card is **not yet implemented** for live radio — only station name + current track (if metadata supplies it). Missing artwork is expected, not a bug.
- AirPods next/prev behaviour for live radio is project-decided. Neither "ignore" nor "skip favorite" is wrong; document whichever ships.
- If audio cuts on lock, check Info.plist `UIBackgroundModes: [audio]`. This is the most common cause.
