# First Run & Offline Specification

```yaml
status: review
platforms: [web, ios, android]
reconciled-against: d241aa9
```

## Purpose

A fresh install — or any launch with no network — opens into a populated,
usable app, not an empty shell or a spinner that blocks on a round-trip. The
catalog resolves through a fixed fallback ladder (disk cache → bundled snapshot
→ network refresh) so the first paint always shows real stations; a brief
branded splash covers the hand-off; and the offline surface keeps browse, local
search, and playback of already-buffered audio working while clearly signposting
what needs a connection. The product value: rrradio feels instant and reliable
on the worst launch (cold install, airplane mode), not just the best one.

## Entry points

- **Cold launch after install / reinstall** — no disk cache yet; the bundled
  snapshot seeds the first paint.
- **Warm launch** — disk cache from a prior session rehydrates the catalog.
- **Launch while offline** — airplane mode / no service; the network step fails
  and the cache or bundled snapshot is what the user sees.
- **Going offline mid-session** — connectivity drops while the app is running.
- **Returning to foreground** — a foreground refresh re-attempts the catalog and
  cloud pulls.
- This surface has no manual entry point of its own: it is the launch path and
  the cross-app offline state, not a screen the user navigates to. The catalog
  refresh control lives in Preferences (see
  [preferences-diagnostics](preferences-diagnostics.md)).

## Layout

### Launch splash

A full-screen overlay shown over the (already-laid-out) app until the launch
hand-off completes, top to bottom:

- **Animated brand mark** — centered, an animated dot-matrix equalizer that
  spells the `rrr` logo (live-signal motion on a ~4.4 s loop), accent-tinted,
  ~150 × 99 pt. With Reduce Motion it renders the static fully-formed `rrr`
  instead of the animation. Decorative (hidden from assistive tech as an
  element; the group carries the label).
- **Progress indicator** — indeterminate spinner, accent-tinted.
- **Status line** — "Tuning…", medium-weight, muted ink.
- Background uses the resolved theme background; the whole group fades out as
  one element when the hand-off finishes.

### Offline surface (cross-app, not a dedicated screen)

When connectivity is lost, offline state is rendered inline in the playback
chrome rather than as a blocking modal:

- **Mini-player** — when nothing is playing and the device is offline, the
  leading slot shows a `wifi.slash` glyph (offline-tinted) instead of artwork,
  and the title line shows the short connectivity phrase ("No internet
  connection" / "Connection required"). Track + program detail lines are
  suppressed offline.
- **Now Playing** — the state/subtitle area shows the connectivity phrase;
  remote artwork and live metadata are suppressed while offline; controls for an
  already-loaded station stay present.
- **Catalog refresh feedback** — a failed network refresh while a cached catalog
  is already on screen surfaces out-of-band (a refresh-error channel consumed by
  Preferences), never by replacing the visible catalog.

There is no full-screen "you are offline" interstitial: the app stays on
whatever surface the user was on, with the cached catalog browsable underneath.

## States

| State | What shows | Actionable |
|---|---|---|
| **Loading (cold, splash up)** | Splash overlay over the app while the catalog resolves and the hand-off grace elapses. | Nothing until the splash fades; the UI behind it is already laid out. |
| **Loaded from disk cache (warm)** | Cached catalog renders instantly; splash dismisses fast (~120 ms grace). | Full app immediately. |
| **Loaded from bundled snapshot (cold install)** | Bundled catalog renders; splash held an extra grace (~1.5 s) so the first body cascade settles before fade. | Full app once splash fades. |
| **Network refresh in flight** | Whatever cache/bundled roster already rendered stays on screen; refresh runs silently. | Full app; no blocking. |
| **Partial (refresh failed, roster present)** | The cached/bundled catalog keeps rendering; a refresh-error string is recorded for Preferences. | Full app; browse + local search + cached playback work. |
| **Failed (nothing rendered)** | Only reached if disk cache is empty AND the bundled snapshot is missing/corrupt AND the network fails — the catalog enters a failed state with the error string. | Whatever surfaces handle an empty catalog (browse/library empty states). |
| **Offline** | Cached catalog browsable; offline phrase in player chrome; remote artwork/metadata and new-stream playback unavailable. | Browse cached catalog, local (bundled-index) search, play an already-buffered station, manage library; cannot start a new stream or refresh. |

## Interactions

| Control / gesture | Precondition | Result | Side effects |
|---|---|---|---|
| Launch app (cold, has cache) | Disk cache present | Cache rehydrates → catalog `loaded`; splash dismisses after ~120 ms grace | Diagnostic `catalog/cache loaded`; network refresh attempted in background |
| Launch app (cold, no cache) | First install / cleared cache | Bundled snapshot decodes → catalog `loaded` from bundle; splash held ~1.5 s | Diagnostics `catalog/bundled fallback loaded`; `loadedFromBundle = true`; network refresh attempted |
| Launch app while offline | No connectivity at launch | Cache or bundled snapshot renders; network step fails; catalog stays `loaded` (or `failed` only if nothing rendered) | Diagnostic `catalog/network failed`; `lastRefreshError` set |
| Splash hand-off completes | Catalog settled + grace elapsed | Splash crossfades out (0.28 s) revealing the app | `hasCompletedLaunchHandoff = true` |
| Return to foreground | App becomes active | Foreground refresh fires (catalog `refreshIfStale` + cloud pull + broken-report receipt sync), throttled ≥2 s between runs | Diagnostics; catalog refresh skipped if last network refresh < 6 h ago; `lastSync` persisted on a successful network refresh |
| Tap a cached station while offline | Station already in cached catalog | Playback attempt proceeds; a new stream needs network and surfaces a playback error (see [playback](../playback.md)) | — |
| Connectivity restored | Was offline; a stream had auto-stopped on the drop | If the player armed auto-resume on the drop, the current station reconnects automatically | Auto-resume fires once; offline flags cleared |
| Connectivity lost mid-stream | Playing | Stream stops; offline phrase shows; player may arm auto-resume-on-restore | `wasOffline = true` |
| Manual catalog refresh | Preferences refresh control | Forces a network reload regardless of staleness | On failure with roster present, `lastRefreshError` surfaces in Preferences; cached catalog stays |

## Business rules

- **Load-order ladder (fixed):** disk cache → bundled snapshot → network
  refresh. The first source yielding stations renders immediately; later sources
  upgrade in place. Authoritative definition: the
  [catalog-schema load-order ladder](../contracts/catalog-schema.md). This spec
  does not restate decode rules.
- **Bundled snapshot** is an LZFSE-compressed copy of `stations.json` shipped in
  the app (~2.7 MB compressed, ~17.7 MB raw, 24,320 stations at this commit).
  Used **only** when the disk cache is empty (first install / cold cache).
- **Network refresh is always attempted** on load, even after cache/bundled
  render. On HTTP 2xx it overwrites cache + in-memory roster; on failure the
  already-rendered roster stays and the catalog remains in a loaded state.
- **No-op refresh skip:** if the parsed network roster equals the current
  roster (the common first-install case where the bundled snapshot matches the
  live catalog), the in-memory roster is not reassigned — avoiding a re-render
  cascade.
- **Splash grace:** ~120 ms when the catalog loaded from disk cache (warm),
  ~1,500 ms when it loaded from the bundled snapshot (cold install), so the
  initial body cascade renders before the crossfade. Crossfade ≈0.28 s; the
  show/hide of the splash itself animates over ≈0.18 s.
- **Foreground-refresh throttle:** a foregrounding triggers a refresh at most
  once per 2 s; the catalog network refresh itself is additionally skipped if a
  successful network refresh happened within the last 6 h
  (`refreshIfStale`, 6-hour minimum interval).
- **Failed state is empty-only:** the catalog reports `failed` and surfaces the
  error only when there is nothing on screen; if any roster already rendered, a
  refresh failure stays `loaded` and routes the error out-of-band.
- **Bundled-snapshot corruption is non-fatal:** a missing or undecodable
  snapshot is skipped (with a diagnostic), falling through to the network step.
- **Offline ≠ catalog-empty:** offline status (from the OS path monitor) and
  catalog readiness are independent. An offline launch with a populated cache is
  fully browsable.
- **Refresh decode is atomic:** one malformed station rejects the whole network
  payload; the prior good source stays rendered. Owned by
  [catalog-schema](../contracts/catalog-schema.md).

## Data dependencies

- [catalog-schema](../contracts/catalog-schema.md) — the load-order ladder
  (cache → bundled snapshot → network refresh), the envelope/`Station` decode
  rules, atomic-decode failure handling, and the bundled-snapshot/FTS-index
  obligations. This feature consumes that ladder; it does not redefine it.
- [search](../contracts/search.md) — the bundled FTS5 index that makes search
  work offline, the divergence guard that disables it when it drifts > 10% from
  the live roster, and the substring fallback. The Radio Browser community tier
  (Tier 4) requires network and is unavailable offline.

## Edge cases

- **First install over a slow link:** disk cache empty, bundled snapshot decodes
  and renders, network refresh resolves later and upgrades in place. The splash
  rides the extended cold grace.
- **First install offline (no cache, no service):** bundled snapshot renders;
  network refresh fails; app is fully browsable from the bundled roster; local
  search uses the bundled FTS index.
- **Cache present but stale + offline:** cached roster renders; refresh fails;
  user browses possibly-stale stations until connectivity returns.
- **Bundled snapshot missing/corrupt + cache empty + offline:** catalog enters
  `failed`; empty states show. (Production normally never reaches this — the
  snapshot ships in the IPA.)
- **Network returns non-2xx / transport error after roster rendered:** roster
  stays; `lastRefreshError` set; state stays `loaded`.
- **Network payload byte-identical to current roster:** no reassignment, no
  re-render cascade; diagnostic `catalog/network unchanged`.
- **Connectivity drop mid-stream then restore:** stream stops on the drop; if
  auto-resume was armed, the station reconnects once on restore.
- **Rapid foreground/background flapping:** the 2 s foreground-refresh throttle
  and the 6 h catalog staleness gate prevent refresh storms.
- **FTS index diverged > 10% from the (possibly newer cached) catalog:** local
  search falls back to in-memory substring scan; no crash, results still return.
  See [search](../contracts/search.md).
- **Huge / corrupt LZFSE blob:** decompression caps the output buffer (≤64 MB)
  so a corrupted snapshot cannot allocate unbounded memory; on failure the
  snapshot is skipped.

## Accessibility

- **Splash:** the brand mark/spinner/text are combined into a single
  accessibility element labeled "Tuning…"; the animated brand mark is
  individually hidden so assistive tech announces one concise label, not three.
  The animation honors Reduce Motion (static `rrr`, no timeline).
- **Offline indicator:** the `wifi.slash` glyph is paired with a text phrase
  ("No internet connection" / "Connection required") so the state is not
  color/icon-only; assistive tech reads the phrase.
- **Dynamic Type:** the "Tuning…" line and offline phrases use the type system
  and scale with the user's text size; the splash logo/spinner are fixed-size
  brand elements.
- **Contrast:** offline-tinted chrome keeps text on theme-aware ink colors;
  status lines use muted-but-legible ink tokens.
- **Focus order:** the splash blocks interaction until dismissed; on dismissal,
  focus lands on the underlying app's normal first element.

## Localization

Strings owned by this surface (source language English; localized to de, es,
fr, it, ru):

| Key | English value | Used by |
|---|---|---|
| `tuning` | "Tuning…" | Splash status + accessibility label |
| `networkNoInternetConnection` | "No internet connection" | Offline short phrase |
| `networkConnectionRequired` | "Connection required" | "requires connection" short phrase |
| `networkLowDataMode` | "Low Data Mode" | Constrained-path short phrase |
| `networkStreamsOffline` | "Streams and catalog updates are offline." | Offline detail phrase |
| `networkOpenSettingsToConnect` | "Open Wi-Fi or cellular settings to finish connecting." | Connection-required detail |
| `networkReconnectingStopped` | "Stream stopped while the connection is unavailable." | Reconnect-stopped detail |
| `networkReducedArtworkAndMetadata` | "Artwork and metadata may update less often." | Constrained-path detail |

- No plurals or runtime parameters in this surface — all are static phrases.
- The connectivity phrase set is the product copy for the offline state;
  platforms SHOULD localize the same set rather than minting their own strings.

## Platform Matrix

| Behavior | Web | iOS | Android |
|---|---|---|---|
| Cold launch shows real stations without waiting on network | Runtime/cache dependent | Reference (disk cache → bundled snapshot → network) | Cache-backed load; bundled snapshot is porting work |
| Bundled catalog snapshot for first-run / cold cache | Not applicable (server-rendered/runtime cache) | Supported (`stations.json.lzfse`, 24,320 stations) | Planned (bundled snapshot porting work) |
| Persisted disk cache of last network payload | Browser/runtime cache | Supported (Caches dir) | Partial (cache-backed load) |
| Always-attempt network refresh after first paint, upgrade in place | Supported | Reference | Partial |
| Branded launch splash with hand-off grace | Not applicable | Supported | Platform-specific |
| Browse cached catalog offline | Supported where cached | Supported | Partial |
| Local search offline (bundled full-text index) | Runtime index | Reference (`stations.fts5.db` + divergence guard) | Optional index deferred → substring fallback |
| Community (Radio Browser) search requires network | Supported | Supported | Supported |
| Play already-buffered/cached station offline | Browser-limited | Supported (no new stream without network) | Partial |
| Auto-resume current stream on connectivity restore | Browser-limited | Supported | Planned |
| Inline offline phrase in player chrome (no blocking modal) | Supported where browser allows | Reference | Partial |
| Refresh-failure surfaced out-of-band (cached catalog stays) | Supported | Supported | Planned |

## Open questions

- **No user-visible "refresh failed" toast on launch.** A failed launch refresh
  with a stale cache is silent except for the Preferences refresh channel; should
  the offline/stale state be signposted more prominently at launch?
- **Splash cold-grace is a fixed ~1.5 s heuristic**, tuned to the first body
  cascade, not measured per device. Whether a render-completion signal should
  replace the fixed delay is undecided.
- **Bundled snapshot staleness is unbounded between app releases.** Until a
  refresh succeeds, a cold install can browse a roster as old as the shipped IPA;
  there is no in-app "snapshot age" signal.
- **Failed-state (cache empty + snapshot missing + offline) UX is undefined
  beyond empty states.** No dedicated retry affordance is specified for the
  fully-empty failed catalog.

## Reference

iOS source read for this spec:

- `rrradio/App.swift` — `AppRootView` launch hand-off (`.task` running
  `catalog.loadIfNeeded` then `completeLaunchHandoff`, `showsCatalogSplash`,
  grace selection on `catalog.loadedFromBundle`), `ForegroundRefreshCoordinator`
  (2 s throttle), scene-phase foreground refresh (catalog + cloud + broken-report
  receipts), `handleNetworkChange` auto-resume-on-restore.
- `rrradio/Models/Catalog.swift` — `load(force:)` ladder (disk cache → bundled
  `stations.json.lzfse` → network), `readCache`, `readBundledFallback`,
  `loadBundledStations`/`decompressLZFSE`, `refreshIfStale` (6 h interval),
  `lastRefreshError`, `loadedFromBundle`, `lastSync` (persisted last successful
  sync), atomic decode, no-op-refresh skip, search-index validation scheduling.
- `rrradio/Views/CatalogLoadingSplash.swift` — splash layout, "Tuning…" label,
  combined accessibility element, theme-background fill.
- `rrradio/Views/DotMatrixLogoView.swift` — the animated dot-matrix `rrr` brand
  mark on the splash (30 Hz `Canvas`, ~4.4 s seeded loop; static `rrr` under
  Reduce Motion).
- `rrradio/NetworkMonitor.swift` — `NetworkSnapshot` (`isOffline`, `shortPhrase`,
  `detailPhrase`), the connectivity `Phrase` set, `NWPathMonitor` wiring.
- `rrradio/Views/MiniPlayerView.swift`, `rrradio/Views/NowPlayingView.swift` —
  inline offline chrome (offline glyph, phrase rendering, suppressed
  artwork/metadata while offline).
- `rrradio/Views/LocaleController.swift` — phrase → localized-key mapping;
  `Localizable.xcstrings` carries the en/de/es/fr values.

## Known deviations

- **Atomic catalog decode → silent data-loss risk on a future required-field
  change** (Slice 11 M1) — one bad station rejects the whole payload; combined
  with the local-store decode paths this can cascade to a wipe. Tracked in
  `rrradio-ios/internal/audit/2026-05-25-ios-code-review-slice11.md`; see also
  [catalog-schema](../contracts/catalog-schema.md) Known deviations.
- **Radio Browser fetch errors fail silently** — a failed community search
  (used only when online) looks identical to "no more results," with no error UI
  or retry. `rrradio-ios/internal/audit/2026-05-25-ios-code-review-slice17.md`
  (B6); see [search](../contracts/search.md) Known deviations.
- **Region/telemetry endpoints on a developer-personal Worker subdomain** —
  adjacent network calls route to `*.markussteinbrecher.workers.dev`.
  `rrradio-ios/internal/audit/2026-05-25-ios-code-review-slice11.md` (M3/M4),
  `rrradio-ios/internal/audit/2026-05-25-audit-handover.md`.
