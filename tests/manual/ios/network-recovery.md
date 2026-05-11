# Network recovery — Wi-Fi drop, airplane mode

> Verify that the stream survives network transitions: Wi-Fi → cellular → no network → recovery. **Real device strongly preferred** (simulator's network controls are unreliable). ~10 minutes.

## Preconditions

- [ ] Build under test: __________
- [ ] Test environment: **real device** with both Wi-Fi and cellular available
- [ ] Wi-Fi network you can disconnect from on demand
- [ ] Cellular plan with data
- [ ] A station playing reliably to start the test

## Steps

### Wi-Fi → cellular transition

1. Start playing a station on Wi-Fi — expected: audio audible.
2. Walk out of Wi-Fi range (or disable Wi-Fi in Settings → Wi-Fi) — expected: audio briefly stutters or pauses, then recovers within 10 seconds **on cellular**; status icon flips from Wi-Fi to cellular.
3. Continue playing for 30 seconds — expected: continuous audio; no recurring re-buffering.

### Cellular → Wi-Fi transition

4. Re-enable Wi-Fi (or walk back into range) — expected: audio either continues uninterrupted or has a brief stutter; eventually network status returns to Wi-Fi.

### Airplane mode mid-playback

5. Start playback on Wi-Fi.
6. Toggle **airplane mode ON** — expected: audio stops (no network); error toast or status indicator shows offline state; **no infinite buffering spinner**; user-facing message is friendly ("Network unavailable" or similar).
7. Wait 10 seconds with airplane on — expected: app does not crash; tapping play during airplane mode either does nothing or shows a clear error.
8. Toggle airplane mode **OFF** — expected: network returns; user can manually press Play and audio recovers within 10 seconds.

### Brief network blip (1–2 seconds)

9. Start playback.
10. Toggle airplane on, wait 2 seconds, toggle off — expected: AVPlayer's built-in retry handles this; audio resumes automatically without user intervention within 10 seconds.

### Stream-server failure (simulated)

11. Start a station whose URL we know we can break (e.g. a custom station pointing to a URL that returns 404 after a delay — easiest to set up by adding a custom station with a deliberately wrong URL like `https://rrradio.org/does-not-exist.mp3`).
12. Tap play — expected: clear failure within 10 seconds; toast or error message; no silent buffering forever.

### Catalog vs stream

13. Force-quit the app, enable airplane mode, relaunch — expected: catalog loads from disk cache; the list is fully usable for browsing/favoriting; tapping a station shows a network-unavailable error rather than infinite buffering.

## Acceptance

- [ ] Wi-Fi → cellular transition recovers within 10 seconds
- [ ] Airplane-mode-on stops audio cleanly with friendly messaging
- [ ] Airplane-mode-off + manual Play recovers within 10 seconds
- [ ] Brief blip (1–2s offline) recovers automatically without manual intervention
- [ ] Bad stream URL fails clearly within 10 seconds; no infinite spinner
- [ ] Offline launch loads cached catalog and stays usable for browsing

## Notes for the tester

- Stream reconnection is the #1 bug source for radio apps (per [`docs/architecture.md`](../../../docs/architecture.md)). If you find recovery taking longer than 10 seconds, file with detail about which transition.
- The 10-second recovery target is generous — many transitions complete in 2–3 seconds. Document the actual time observed.
- "Infinite buffering spinner with no error" is the worst failure mode. A clear error within 10 seconds is preferable to silent buffering.
- For step 11 (forced failure), if you don't want to set up a bad custom URL, find a station marked `status: stream-only` in the catalog that you suspect is currently broken — same effect.
