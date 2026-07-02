# Metadata And Artwork Specification

```yaml
status: review
platforms: [web, ios, android]
reconciled-against: d241aa9
```

## Purpose

Metadata turns a live stream into a useful radio experience: the user sees the
current artist and title, an album cover (or a brand/station placeholder when no
cover is known), the current program and its day schedule for wired broadcasters,
lyrics when a match is found, and one-tap links to the song on Apple Music /
Spotify / YouTube Music. The product contract is the catalog's broadcaster metadata fields
and capability hints, not any one platform's implementation. The fetcher routing,
per-broadcaster request/parse rules, cover-art fallback chain, lyrics lookup, and
program-schedule fetch are pinned formally in
[metadata-fetchers](../contracts/metadata-fetchers.md); this feature spec
describes what the user sees and when it updates, and links to that contract for
the mechanics.

## Entry points

- **Now Playing** ([now-playing](now-playing.md)) — the primary surface: artwork,
  artist/title, program name, the `Schedule` and `Lyrics` panes, and the
  music-service rail all render here. Reached from the mini-player, station rows,
  and platform launch surfaces.
- **System media surface** — lock screen / Control Center / CarPlay receive the
  same now-playing text and a downscaled cover (or station logo) via the
  now-playing-info mapping in
  [playback-state-machine](../contracts/playback-state-machine.md).
- **Station rows / headers** — the station logo (favicon) renders wherever a
  station appears (Browse, Favorites, lists, mini-player); see
  [browse](browse.md).
- **Car mode** — a large-artwork variant of Now Playing
  ([preferences-diagnostics](preferences-diagnostics.md)).

## Layout

Top to bottom on Now Playing (portrait); the landscape/iPad split moves the same
elements into an artwork column + program/lyrics column.

- **Station header** — the station logo (favicon) chip plus the station name; the
  favorite and close controls. The favicon chip falls back to the station's
  initials plate.
- **Header / page title** — `Now Playing`.
- **Artwork** — square cover image. Shows the resolved track cover when known;
  otherwise an animated brand placeholder (the dot-matrix "rrr" mark — animated
  while playing, static otherwise). The in-app Now Playing artwork does **not**
  fall back to the favicon; the favicon is the station-header chip, the
  station-row/mini-player art, and the lock-screen artwork fallback (see *Business
  rules*).
- **Track title** — the current track title, or a state phrase (`Connecting`,
  `Playback error`, `Live stream`) when no title, or an offline phrase when the
  network is down.
- **Track subtitle** — the artist when known; else the station name; else an
  error message.
- **Program name** — a small uppercased caption under the track block when the
  broadcaster reports a current program (talk/news stations and wired
  broadcasters).
- **Pane tabs** — `Album` / `Schedule` / `Lyrics`. The `Schedule` and `Lyrics`
  tabs are present only when their pane has data (see *States*). The active tab
  carries an accent underline that slides between tabs.
- **Album pane** — the artwork + track block (described above).
- **Schedule pane** — current program name + subtitle, then a "Today" schedule list
  of broadcasts with start time, title, subtitle, and a "Live" badge on the
  on-air row. Each row is tappable to set a wake alarm.
- **Lyrics pane** — scrollable, selectable lyrics text plus a "Lyrics source:
  {provider}" attribution link.
- **Music-service rail** — Apple Music / Spotify / YouTube Music buttons, shown
  only after the track is verified as a real song (see *Business rules*). Reserves
  a steady height (caption + button row) so switching to the Lyrics pane — where
  the rail is hidden — does not shift the transport below it.
- **Stream-info strip / details** — expandable codec, bitrate, country, stream
  URL, metadata source, and a report-broken-station action.

## States

| State | What shows | Actionable |
|---|---|---|
| **No track yet (loaded, talk/instrumental)** | Dot-matrix placeholder as artwork; title = `Live stream`; subtitle = station name. No music-service rail. | Playback, favorite, sleep/wake controls. |
| **Loading metadata** | Prior values retained (poller keeps last good value); title shows `Connecting` only when there is no title and the player is connecting. | All transport controls. |
| **Loaded (track known)** | Cover (track) or placeholder, title, artist; `Schedule` tab if program/schedule present; `Lyrics` tab if lyrics found; music-service rail once verified. | All panes; music-service links; schedule rows tappable. |
| **Cover resolving** | Placeholder shown immediately; upgrades in place to the track cover when the lookup returns (no spinner over the art). | — |
| **Schedule loading** | `Schedule` tab appears as soon as a schedule load starts; the pane shows a spinner while the day grid loads; program name/subtitle may already be shown. | Pane is visible. |
| **No schedule** | Schedule pane shows `No schedule available` (when a program name exists but no grid, or the grid load failed). | — |
| **Lyrics not found / instrumental** | `Lyrics` tab is absent (pane only appears on a non-empty hit). | — |
| **Verification miss (news/talk/station ID)** | Music-service rail hidden; cover stays on the placeholder. | — |
| **Error** | Title = `Playback error`; subtitle = the error message; artwork = placeholder. | Retry via play/pause; report-broken. |
| **Offline** | Title = network phrase (e.g. "No internet connection"); subtitle = station name; offline tint. No fetches issued. | Controls reflect offline. |

## Interactions

| Control / gesture | Precondition | Result | Side effects |
|---|---|---|---|
| Open Now Playing | A station is current | Metadata, artwork, program, lyrics surfaces render with the latest polled values | Schedule load begins for ORF/FM4 |
| Swipe / tap pane tab → `Schedule` | Program data present (program name, a loaded grid, or a load in flight) | Shows program name + Today schedule; auto-scrolls to the live broadcast | Recomputes live-row highlight on a 30 s tick |
| Swipe / tap pane tab → `Lyrics` | Lyrics found for the track | Shows lyrics text + source link | — |
| Tap a music-service button | Track verified (iTunes confirms it is a real song) and that service enabled | Opens the song in Apple Music (deep link to the exact song via the iTunes `trackViewUrl` when present, else an Apple Music search) / a Spotify search / a YouTube Music search | No track text sent to telemetry |
| Tap a schedule row | ORF/FM4 schedule loaded | Opens the wake-alarm sheet pre-filled with that broadcast's start time and title | — |
| Tap "Lyrics source: …" link | Lyrics loaded with a source | Opens the lyrics provider's site | — |
| Track changes (new now-playing) | Poll or in-band metadata returns a different title | Title/artist/cover/program update; lyrics + verification + cover lookups re-run for the new track | History updates current track; lock screen refreshes |
| Station changes | User switches station | All track/program/schedule/lyrics/verification fields clear immediately, then re-poll | In-flight fetches cancelled |
| 30 s poll tick | Playing, station has a fetcher | Re-fetches now-playing; updates only if the station is still current | Coarse diagnostic on failure |
| Background / foreground | App backgrounded | Poll cadence continues per `backgroundPollPriority`; foreground in-band (timed) metadata path is iOS-only | — |
| Sleep timer armed | Lock screen visible | Lock-screen title appends "Sleep in {N}m" and the system artwork gains a yellow moon badge in its lower corner; both refresh every 30 s | — |

## Business rules

- **Poll cadence:** now-playing is re-fetched every **30 s** while a fetcher
  exists for the current station; one in-flight fetch at a time (a new tick is
  skipped if the prior is still running). See
  [metadata-fetchers](../contracts/metadata-fetchers.md).
- **In-app Now Playing artwork (observable):** resolved track cover → animated
  dot-matrix "rrr" placeholder. The in-app surface does **not** substitute the
  favicon for missing cover art (the favicon is the station-header chip and the
  station-row/mini-player art). The cover only *upgrades* the placeholder when a
  non-nil, non-low-res result arrives; a good provider cover is never downgraded.
  Full provider chain (provider → iTunes → …, including the favicon step the web
  client uses) is in
  [metadata-fetchers](../contracts/metadata-fetchers.md#cover-art-fallback-chain).
- **iTunes cover upgrade resolution:** a 100×100 iTunes artwork URL is rewritten to
  600×600 before it becomes the in-app cover.
- **Cover never blocks:** the placeholder renders immediately; the cover swaps in
  when resolved. No spinner over the artwork.
- **Music-service rail gating:** buttons appear **only** when iTunes Search
  confirms the title resolves to a real song (`hit`). While the lookup is
  in-flight, or after a confirmed miss, the rail stays hidden — this suppresses
  links to empty search pages for station IDs and news headlines
  (e.g. "Nachrichten 12:00 Uhr"). Each of Apple Music / Spotify / YouTube Music
  has its own enable toggle (default ON); see
  [preferences-diagnostics](preferences-diagnostics.md).
- **Last-good retention:** a poll that returns "no metadata" (`nil`) or fails is
  not treated as a track change; the prior now-playing value is kept (cleared only
  on station change). Distinction between `nil` and error is in
  [metadata-fetchers](../contracts/metadata-fetchers.md#null-vs-error-uniform-across-all-fetchers).
- **Program schedule scope:** the day schedule is wired for **ORF/FM4 only** today;
  other broadcasters may report a current *program name* without a grid. The
  `Schedule` tab appears as soon as a schedule load begins (not only once a grid
  has arrived).
- **Lock-screen text mapping:** the system surface does **not** mirror the in-app
  layout. The lock-screen *title* is the station name (with `— {program}` appended
  when a program is known, and `— Sleep in {N}m` when the sleep timer is armed); the
  lock-screen *artist/subtitle* carries the track (`{artist} — {title}`, or the
  title alone, or a state phrase like `Live`/`Paused`/`Loading`/`Error`/country when
  no track is known). Mapping detail is in
  [playback-state-machine](../contracts/playback-state-machine.md).
- **Lock-screen artwork cap:** the lock-screen source image is fetched bounded to
  **≤512 px** on its longest side and **≤5 MB** (never the multi-MB original), and
  is sourced from the resolved track cover when present, else the station favicon.
  The in-app artwork is driven separately by the 600×600 cover URL.
- **Lyrics lookup:** runs only when both artist and title are non-empty; result
  (including "not found") is cached so the same track does not re-query. Order and
  caches in [metadata-fetchers](../contracts/metadata-fetchers.md#lyrics-lookup).
- **Station-row now-playing previews (iOS):** Browse/Favorites rows show a live
  now-playing line for stations that have a fetcher, on a separate **~60 s** poll
  scoped to the **visible rows plus a prefetch margin** (never the whole feed).
  Fetch attempts are debounced past a scroll fling, negative results are cached so a
  station that returned nothing is not re-tapped within the interval, and ICY rows
  open the audio stream to read metadata — so the visible-row scope is a
  privacy/bandwidth bound, not just an optimization.

## Data dependencies

- [metadata-fetchers](../contracts/metadata-fetchers.md) — fetcher registry,
  routing order, per-source field mapping, ICY/HLS fallbacks, cover-art chain,
  iTunes dual role (cover + verification), lyrics lookup, program-schedule fetch,
  null-vs-error, music-service link URLs.
- [catalog-schema](../contracts/catalog-schema.md) — `metadata`, `metadataUrl`,
  `status`, `broadcaster`, `favicon`, `hasScheduleData` fields the router keys off.
- [playback-state-machine](../contracts/playback-state-machine.md) — how the
  resolved metadata maps onto the system media surface.
- [privacy-data-boundaries](../contracts/privacy-data-boundaries.md) — the privacy
  matrix for the iTunes / lyrics request shapes and the coarse-only failure rule.

## Shared Contract (catalog & capability hints)

- `metadataUrl` identifies a broadcaster-specific now-playing endpoint when one
  exists.
- Broadcaster fetcher keys are stable contracts across platforms.
- Fetcher behavior should match across web, iOS, and Android: same JSON paths,
  same HTML/XML parsing intent, same null-vs-error semantics.
- ICY-over-fetch is a fallback for stations marked `icy-only`.
- `public/station-capabilities.json` is the native-client hint layer. It maps
  each station id to `metadataStrategy` (`api`, `icy`, `hls`, `none`),
  `backgroundPollPriority` (`normal`, `low`, `never`), and the provider
  capability booleans `hasProgram`, `hasSchedule`, and `hasProviderCover`.
- Native station-heavy views should not open streams for entries with
  `metadataStrategy: none` or `backgroundPollPriority: never`.
- Track metadata should be normalized into artist, title, raw label, and any
  program/schedule fields the platform supports.
- Station favicon is the first station-art source.
- Track cover art may fall back to public music metadata APIs only when privacy
  rules allow it.

## Edge cases

- **Stale result after station change:** an in-flight fetch that returns after the
  user has switched stations is discarded (the result is dropped unless the
  station is still current).
- **Provider returns a low-res cover:** the low-res provider cover is skipped and
  the chain continues to iTunes; the in-app placeholder holds meanwhile. Low-res
  detection patterns are in
  [metadata-fetchers](../contracts/metadata-fetchers.md#cover-art-fallback-chain).
- **Talk/news titles:** verification miss → no music-service rail, no lyrics tab;
  program name still shows for wired broadcasters.
- **Backgrounding:** poll continues subject to `backgroundPollPriority`; the
  foreground in-band timed-metadata path is iOS-only and is layered alongside the
  poller, not a substitute.
- **Offline:** no fetches; the surface shows network phrasing and an offline tint,
  retaining the last station identity.
- **Schedule fetch failure:** the Schedule pane falls back to `No schedule
  available`; a current program name (if any) still shows.
- **Lyrics provider down / instrumental track:** the Lyrics tab is simply absent;
  an instrumental result is cached as a definitive "no lyrics".
- **Huge schedule:** the Today grid lists every broadcast for the live day and
  auto-scrolls to the on-air row; the live highlight recomputes only on a
  broadcast boundary, not on every tick.

## Accessibility

- Pane tabs expose labels `Album` / `Schedule` / `Lyrics`; the selected tab is
  emphasized (carries the `.isSelected` trait).
- Music-service buttons expose per-service accessibility labels — "Listen on Apple
  Music", "Listen on Spotify", "Search on YouTube Music"; the brand mark image is
  hidden from VoiceOver so the label is not duplicated.
- Lyrics text is selectable (copy) and read as body text; the source link is a
  focusable link.
- Track title/subtitle scale down (minimum scale factor) rather than truncating so
  long titles stay legible at large Dynamic Type.
- Artwork is decorative relative to the title/subtitle text, which carry the track
  identity.
- Offline state uses a distinct tint **and** a text phrase (not color alone).

## Localization

This surface owns the following user-visible strings:

- Pane labels: `Album`, `Schedule`, `Lyrics`; header `Now Playing`.
- State phrases: `Connecting`, `Live stream`, `Playback error`, `No schedule
  available`.
- Schedule chrome: `Today` day label and the broadcast-count caption.
- Plural/parameter needs: the schedule broadcast count needs a plural rule; the
  lock-screen "Sleep in {N}m" and the "Lyrics source: {provider}" attribution
  (intended key `Lyrics by {source}`) are parameterized.
- Track artist/title/program text is **provider data**, never localized.

`Now Playing`, `Album`, `Schedule`, `Lyrics`, `Today`, `Program`, `Open in`, and
`No schedule available` are keyed in `Localizable.xcstrings` today. Known
un-localized literals still hard-coded in shipped iOS: the schedule "Live" badge,
the "{n} broadcasts" caption, the "Lyrics source:" attribution prefix (despite the
keyed `Lyrics by {source}` string existing — see *Known deviations*), the
`trackTitle` state phrases `Connecting`/`Live stream`/`Playback error`, the
lock-screen subtitle phrases `Standby`/`Loading`/`Live`/`Paused`/`Error` and the
`"Sleep in …"` text, and the schedule `Untitled` placeholder (see *Known
deviations* M12). These are localization gaps, not intended behavior.

## Platform Matrix

| Behavior | Web | iOS | Android |
|---|---|---|---|
| Broadcaster fetchers | Reference proving ground. | Native parity for wired fetchers. | Partial; Grrif and ORF/FM4 are native. |
| ICY metadata | Supported via fetch where CORS/proxy allows. | Supported through AV metadata and bounded fetch fallback. | Partial; basic ICY parser/fetcher exists. |
| Program schedule | Supported for wired broadcasters. | Supported for wired broadcasters. | Partial; ORF current-program metadata exists, full schedule grids remain planned. |
| Station logos | Supported. | Supported. | Partial; row/header rendering exists, full policy parity remains. |
| Track cover art | Supported. | Supported. | Partial; broadcaster covers plus iTunes cover fallback are supported for fetched tracks. |
| Lyrics lookup | Supported. | Planned/partial native parity. | Planned. |
| Music-service links (verified-gated) | Supported. | Supported (Apple Music deep link, Spotify/YT Music search). | Planned; the iTunes verification signal (`trackVerified`) and the Apple Music deep link (`appleMusicUrl`) are already resolved per track, but no music-service rail is rendered yet. |
| Lock-screen / media-surface cover (downscaled) | Supported where browser allows. | Supported (≤512 px / ≤5 MB cap; sleep-timer moon badge). | Planned; a foreground MediaSessionService (media3 — the Android counterpart to iOS background audio + lock-screen controls) supplies station-name media controls, but no resolved track cover/favicon is pushed to the media surface and there is no downscale cap or sleep-timer moon badge yet. |
| Last-good retention on poll miss/fail | Partial; a fetch error stops the poller without clobbering the displayed track, but a `null` "no-metadata" poll clears the track title. | Supported. | Supported; a `null` or failed poll is dropped (the service ignores `null` results) and the prior now-playing value is retained, cleared only on station change. |

## Privacy Rules

- Do not send track titles, artist names, user-entered URLs, or search queries
  to analytics.
- Metadata fetch failures should record coarse categories only.
- User-visible diagnostics may include operational detail only when the user
  explicitly enables and exports diagnostics.

## Porting Rule

When a new web fetcher is added, add or update the corresponding native fetcher
before marking the station as fully parity-supported on native platforms.

## Open questions

- **MusicBrainz / Cover Art Archive step** in the shared cover chain is not
  implemented on any platform today — the shipped web cover chain is iTunes-only
  (`src/coverArt.ts`), and iOS does not implement it either. Required obligation or
  a future enhancement? (Tracked in
  [metadata-fetchers](../contracts/metadata-fetchers.md#open-questions).)
- **Schedule capability source of truth:** schedule is still ORF/FM4-hardcoded;
  the `hasScheduleData` catalog field is the forward path once populated.
- **Lyrics on native:** iOS lyrics lookup and the Lyrics pane are implemented, yet
  the lyrics surface is still marked planned/partial parity in the cross-platform
  matrix — confirm the intended native rollout / update the matrix.
- **In-app artwork fallback parity — settled by practice (2026-07):** the
  dot-matrix brand mark (see [design-language](../design-language.md)) is the
  intended no-cover fallback on the in-app Now Playing surface; the favicon
  remains the station-art source for rows and the lock screen. iOS and Android
  both ship this split; web should follow when its Now Playing surface deepens.
- **Localization of schedule/lock-screen literals** (see *Localization*) — when do
  the remaining hard-coded English strings (`Live` badge, "{n} broadcasts",
  state phrases, `Untitled`, the `Lyrics source:` prefix) get keyed?

## Reference

iOS source (the only place iOS mechanics are named):

- `rrradio/Player/Metadata/NowPlayingMetadata.swift` — `NowPlayingMetadata` output
  struct + `metadataFetcher(for:)` registry router (keyed on `station.metadata` /
  `metadataUrl`, with an `icy-only` fallback).
- `rrradio/Player/Metadata/MetadataPoller.swift` — 30 s poll loop, single in-flight
  fetch, generation guard, coarse failure diagnostics (`onUpdate` is not called on
  error or on a `nil` result, so the last good value is retained).
- `rrradio/Player/Metadata/CoverArtFetcher.swift` — iTunes Search
  (`searchITunes`/`lookupCoverArt`/`verifyTrack`), `pickBestCoverArtMatch` genuine
  artist/title match, low-res detection, 100×100→600×600 high-res upgrade, 64-entry
  LRU cache, `appleMusicUrl` deep link, music-service verification signal.
- `rrradio/Player/Metadata/LyricsFetcher.swift` — LRCLIB → Lyrics.ovh, LRC parse,
  instrumental short-circuit, 256-entry FIFO cache.
- `rrradio/Player/Metadata/ScheduleFetcher.swift` — `scheduleFetcher(for:)` (ORF/FM4
  only), ORF `/broadcasts` day grid, `cleanScheduleTitle` (`Untitled` fallback).
- `rrradio/Player/Metadata/MusicServiceLinks.swift` — Apple Music / Spotify /
  YouTube Music registry + link builder, badge-lockup vs icon, per-service enable
  keys (default ON), accessibility labels.
- `rrradio/Player/Metadata/FavoriteNowPlayingStore.swift` — station-row now-playing
  previews; ~60 s visible-row poll with debounce, negative caching, and a 400-entry
  cap.
- `rrradio/Player/Metadata/DirectMetadataFetchers.swift`,
  `OrfMetadataFetcher.swift`, `IcyMetadataFetcher.swift`, `MetadataHelpers.swift` —
  the broadcaster-specific fetchers and shared JSON/HTML helpers (`bestOrfImage`,
  `metadataStripHTML`).
- `rrradio/Player/AudioPlayer.swift` — applies polled + in-band timed metadata
  (`applyTimedMetadataTitle` splits `Artist - Title`), drives
  lyrics/verification/cover lookups per track, schedule load, lock-screen
  title/subtitle mapping, and the ≤512 px / ≤5 MB lock-screen artwork
  (`makeLockScreenArtwork` + sleep-timer moon badge).
- `rrradio/Views/NowPlayingView.swift` — `Album`/`Schedule`/`Lyrics` panes,
  `ArtworkView` (cover → `DotMatrixLogoView` placeholder, no favicon fallback),
  program schedule list + live badge, music-service rail gate
  (`nowPlayingTrackVerified == true`, hidden on the Lyrics pane), offline phrasing.
- `rrradio/Views/StationKit.swift` — `FaviconView` / station-row art and the
  initials-plate favicon fallback.
- Contract: [metadata-fetchers](../contracts/metadata-fetchers.md) (full fetcher,
  cover, lyrics, schedule, and music-link mechanics).

## Known deviations

Shipped iOS code that diverges from this intent — the spec states intent, the
audit owns the bug. The fetcher-level deviations (title-casing, HTML entities,
ORF timeouts, oversized ORF image, Lyrics.ovh `+` encoding, cover-match substring,
ICY injectability, `Untitled` literal) are catalogued in
[metadata-fetchers](../contracts/metadata-fetchers.md#known-deviations) (M4, M6–M12)
under `rrradio-ios/internal/audit/2026-05-25-ios-code-review-slice6.md`.

Behavior-surface notes from those:

- **M8** — the oversized-ORF-image bug (`bestOrfImage` picks the largest available
  version) can fetch a multi-MB asset on the lock-screen artwork path before it is
  downsampled to the ≤512 px / ≤5 MB cap — wasted bandwidth against the "cover never
  blocks" intent.
- **M12** — blank schedule titles render the English literal `Untitled` rather than
  a localized placeholder, contradicting *Localization*.

Additional behavior-surface localization gap (not yet in the audit; flagged for a
human, see *Open questions*): the Lyrics-pane attribution renders the hard-coded
`Lyrics source: {name}` even though a localized `Lyrics by {source}` string is
already keyed in `Localizable.xcstrings`. The intent is the localized string.
