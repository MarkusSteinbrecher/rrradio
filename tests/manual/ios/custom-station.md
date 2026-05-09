# Custom station — add HTTPS stream

> Add a user-defined HTTPS stream, verify HTTPS-only validation, persistence, and playback. Simulator OK for the form; real-device or simulator for actual playback. ~7 minutes.

## Preconditions

- [ ] Build under test: __________
- [ ] Test environment: simulator or real-device
- [ ] Catalog loaded
- [ ] You have a known-good public HTTPS stream URL handy (e.g. an SomaFM `https://ice2.somafm.com/groovesalad-128-mp3`, an ORF FM4 HLS playlist, or any other HTTPS audio stream you trust)
- [ ] You also have an HTTP-only URL to test rejection (any old `http://...mp3` will do)

## Steps

1. Open the **Add Station** tab (or button) — expected: an empty form with fields: Name, Stream URL, optional Tags / Country.
2. Submit the form blank — expected: validation error (e.g. "Stream URL required"); no station added; no crash.
3. Enter a malformed URL like `not a url` — expected: validation rejects it; clear error message.
4. Enter an **HTTP** (not HTTPS) URL — expected: validation rejects it with a message about HTTPS-only ([`CustomStationBuilderTests.swift`](../../../ios/rrradioTests/CustomStationBuilderTests.swift) is the second source of truth).
5. Enter a valid **HTTPS** URL with an empty Name — expected: validation rejects it OR auto-fills a name from the URL (note current behaviour).
6. Enter a valid HTTPS URL plus a Name (e.g. **"Test SomaFM Groove"**) — expected: form accepts; toast/confirmation; redirected to the custom-stations list (or home).
7. Find the new custom station in the **Custom** list (or in the main list, depending on UX) — expected: it appears with the name and tags you entered.
8. Tap to play — expected: playback starts within 5 seconds, audible audio.
9. Force-quit and relaunch — expected: custom station persists; still playable.
10. Long-press / swipe the custom station — expected: option to delete; deletion removes it immediately.

## Acceptance

- [ ] Empty form is rejected with a clear error
- [ ] Malformed URL is rejected
- [ ] HTTP-only URL is rejected (HTTPS-only enforced)
- [ ] Valid HTTPS URL plus name persists and plays
- [ ] Custom station survives force-quit + relaunch
- [ ] Deletion removes it cleanly

## Notes for the tester

- HTTPS-only is a **hard rule** per the project's security model. If an HTTP URL is somehow accepted, that's a critical bug — file with `severity:critical`.
- If a stream times out on tap-to-play, this is usually a stream/server problem (broadcaster down, geo-blocked); use a different test URL before declaring an app bug.
- iCloud sync of custom stations is tested separately in [`icloud-sync.md`](icloud-sync.md).
