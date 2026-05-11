# Browse and play — happy-path playback

> Find a station via the list, start playback, verify mini-player and now-playing surface. Real-device preferred so audio output and metadata are real. ~10 minutes if testing across broadcasters.

## Preconditions

- [ ] Build under test: __________
- [ ] Test environment: real-device (preferred) or simulator
- [ ] Catalog loaded (run [`first-run.md`](first-run.md) first if this is a fresh install)
- [ ] Volume up; AirPods or speakers connected if you want to hear it
- [ ] Network: Wi-Fi or cellular OK

## Steps

1. From the **Stations** list, scroll until you find a station you can verify by ear (e.g. **BBC Radio 1**, **WDR 5**, **FM4 (ORF)**, **Radio Swiss Pop**) — expected: tile shows name, country flag/code, possibly tags.
2. Tap the tile — expected: **Now Playing** screen opens; large play button visible; metadata area shows station info; if the station has a `metadataUrl` the artist/title may load within a few seconds.
3. Tap **Play** — expected: button changes to pause icon within ~3 seconds; audio is audible at moderate volume; the mini-player will be visible after closing the sheet.
4. Tap **Pause**, then **Play** again — expected: audio stops then resumes within ~2 seconds; no buffering spinner forever.
5. Dismiss the Now-Playing sheet — expected: list returns; **mini-player** appears at the bottom showing station name + play/pause control.
6. Scroll the list while playback continues — expected: audio continues uninterrupted; mini-player stays at the bottom.
7. Tap the mini-player — expected: full Now-Playing sheet opens again; current station and metadata are correct.
8. Pick a station from a different **broadcaster family** (one of: ORF, BBC, SRG/SSR, AzuraCast, Laut.FM, raw ICY-only) — expected: switching takes < 5 seconds; old stream stops, new stream starts; metadata updates.
9. **For an ICY-only station** (catalog `status: icy-only`, e.g. some Shoutcast/Icecast streams) — expected: audio plays; track title appears within ~30 seconds if the stream embeds StreamTitle; absence is allowed but no crash.
10. Stop playback — expected: audio stops within 1 second; mini-player remains visible until the user navigates away or it auto-dismisses (project-decided behaviour — note current behaviour for the tester report).

## Acceptance

- [ ] All steps completed without error
- [ ] Audio audibly plays for at least three different stations from different broadcaster families
- [ ] Pause/resume responds within 2 seconds
- [ ] Switching stations completes within 5 seconds
- [ ] Metadata (artist/title) appears within 30 seconds for at least one station that supports it (ORF / BBC / Laut.FM / etc.)
- [ ] Mini-player is visible across list scrolling and persists between view changes

## Notes for the tester

- Playback latency over cellular can be a few seconds longer than Wi-Fi. The 5-second buffer above assumes Wi-Fi.
- If an HLS station never starts, check the HLS variant resolution — sometimes the highest-bitrate variant is unreachable; the fallback should still play.
- "Metadata never appears" is acceptable for stations marked `stream-only` in the catalog. It's a problem only for stations marked `working` or `icy-only`.
- Per-broadcaster fetcher quirks live in `ios/rrradio/Player/Metadata/` — if a specific broadcaster misbehaves, file the bug with the broadcaster name and station UUID.
