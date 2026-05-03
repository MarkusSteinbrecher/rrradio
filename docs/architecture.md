# rrradio — Architecture and File Map

## Source layout

```
src/
  main.ts             — boot wiring + glue. Shrinks over time as DOM
                        renders get extracted into refs-based modules.
  player.ts           — AudioPlayer class (HTMLAudioElement, hls.js,
                        MediaSession, prime() sidecar for wake handoff,
                        swap() for in-place src swap, setStation() for
                        context-only updates).
  stations.ts         — catalog + browse-filter helpers
                        (composeBrowseFilter etc.).
  storage.ts          — safe localStorage wrappers (privacy-mode safe)
                        + favorites / recents / wake-to / custom-stations.
  url.ts              — safeUrl + urlDisplay (http/https allowlist, used
                        anywhere catalog data becomes <a href>).
  config.ts           — STATS_WORKER_BASE / STATS_PROXY / STATS_BBC_PROXY
                        single source of truth. `VITE_STATS_WORKER_BASE`
                        env override for `wrangler dev`.
  errors.ts           — privacy-preserving runtime error reporter (audit
                        #76). Emits `error: <category>` events to the
                        existing GoatCounter telemetry.
  empty.ts            — statusLine + emptyState (textContent-safe DOM
                        helpers for "Off air · <message>" etc).
  format.ts           — pure helpers: titleCase, parseLooseJSON,
                        normalizeForSearch (whitespace-insensitive,
                        German diacritics), fmtSharePct.
  wake.ts             — WakeScheduler + nextFireTime/classifyStoredWake +
                        formatCountdown + fadeVolume.
  metadata.ts         — generic ICY-over-fetch fetcher + types.
  icyMetadata.ts      — ICY StreamTitle parsers.
  radioBrowser.ts     — runtime Radio Browser client (mirror selection +
                        polite UA + dedup/cache).
  builtins.ts         — fetcher registry + per-broadcaster fetcher impls
                        + the bundled-catalog loader.
  fetchers.json       — fetcher manifest (single source of truth shared
                        between TS runtime and Node tooling, audit #68).
  telemetry.ts        — track() wrapper around GoatCounter's count API.
  types.ts            — shared TypeScript types.

  Render layer (audit #77 follow-ups, refs-based for testability):
  render-test-harness.ts — mountFragment + getById + setup helpers +
                           HTML fragments (MINI_FRAGMENT, NP_FRAGMENT).
  render-mini.ts      — refs-based renderMiniPlayer + setMiniArt.
  render-np.ts        — refs-based renderNowPlaying (the big one —
                        25-element refs interface).
  np-labels.ts        — pure miniMetaText, npLiveText, npFormatText.
  np-display.ts       — pure displayStation, isWakeBedActive (wake
                        masquerade reducer).
  station-display.ts  — pure stationInitials, faviconClass.
  country.ts          — countryName (curated table + Intl.DisplayNames).
  dashboard.ts        — DashboardData, aggregateDashboard, activeCountryMap.
  icons.ts            — SVG constant registry + svg() factory.
  theme.ts            — light/dark persistence + DOM application.
  style.css           — mobile-first styles.

worker/
  src/index.ts        — Cloudflare Worker (GoatCounter proxy + BBC
                        proxy + broadcaster CORS proxy with allowlist).
  src/index.test.ts   — 32 vitest cases (CORS / auth / allowlist / etc).

ios/                  — SwiftUI + AVFoundation app (Phase 2).
  rrradio/{App,Models,Player,Search,Views}/
  rrradioTests/       — XCTest target (catalog decoding, cache fallback,
                        search normalization, AudioPlayer state contract).
  project.yml         — xcodegen project definition.

e2e/
  smoke.spec.ts       — Playwright cold-boot UI tests against `vite preview`.

index.html            — single-page shell with PWA meta tags +
                        meta-CSP + meta Permissions-Policy +
                        the .np-wake-pane (inline wake editor).
public/               — static assets (icons, OG image, world map,
                        privacy.html, dashboard.html, stations.json,
                        analytics.js, silence.m4a).
```

## Catalog data

```
data/
  broadcasters.yaml    — one entry per organisation (BR, ORF, BBC, …).
                         Holds name, country, family, homepage, fetcher
                         key. Stations inherit from these.
  stations.yaml        — one entry per station. References a broadcaster.
                         Stream URL, codec, bitrate, channel-specific
                         metadataUrl, favicon, status, featured flag.
```

## Tooling

```
tools/
  probe-station.mjs    — runs CORS preflight + GET with Icy-MetaData on
                         a stream URL. Reports headers + first
                         StreamTitle. `npm run probe -- <url>`.
  build-catalog.mjs    — reads YAML, validates, writes
                         public/stations.json. For entries carrying a
                         `stationuuid` it fetches the Radio Browser
                         record (cached at .cache/rb-byuuid.json) and
                         uses it as the baseline; local YAML fields
                         override field-by-field. `npm run catalog`,
                         or `RRRADIO_OFFLINE=1 npm run catalog` to
                         skip the network and use cache only.
  rb-client.mjs        — shared build-side Radio Browser client
                         (mirror selection + chunked byuuid fetch +
                         disk cache). Used by build-catalog and
                         check-drift. Not shipped to the browser —
                         that's src/radioBrowser.ts.
  check-drift.mjs      — re-fetches every station with a stationuuid,
                         compares the stored changeuuid to what's
                         live, writes public/station-drift.json with
                         per-field diffs. Read-only on YAML — curator
                         decides what to absorb. Exits 2 when drift
                         or missing-upstream entries are found, so
                         catalog-watch can branch and open a PR.
                         `npm run check-drift`.
  check-duplicates.mjs — scans data/stations.yaml for collisions on
                         stationuuid, streamUrl (incl. query string),
                         and normalised name. Writes
                         public/station-duplicates.json. Exits 2 on
                         any collision so catalog-watch can surface
                         it in the tracking issue.
                         `npm run check-duplicates`.
  candidates.mjs       — diffs GoatCounter top-played station names
                         against data/stations.yaml — surfaces what
                         visitors play that we haven't curated yet.
                         `npm run candidates [days] [limit]`.
  validate-catalog.mjs — probes every publishable station's stream
                         (and metadataUrl, when set) and reports
                         OK/META?/CHANGED/BROKEN. Read-only — does
                         not modify YAML. `npm run validate-catalog`.
  auto-curate.mjs      — promotes top-played non-curated names from
                         GoatCounter into stations.yaml at status:
                         stream-only after a Radio Browser lookup +
                         stream probe. `npm run auto-curate`. Runs
                         weekly via .github/workflows/catalog-watch.yml
                         which opens a labelled PR with the additions.
  analyze.mjs          — per-station diagnostic: stream / https / icy /
                         meta-API / fetcher / program / logo. Writes
                         public/station-status.json (admin dashboard
                         reads it) + prints colored table to stdout.
                         `npm run analyze`.
  backlog.mjs          — analyzed view of every played station with
                         RB lookup + verdict (auto-curate-ready,
                         needs-https, stream-broken, no-rb-match,
                         already-curated). Writes
                         public/station-backlog.json. Refreshed
                         weekly by catalog-watch. `npm run backlog`.
  import-ard.mjs       — bulk-imports ARD canonical channels from
                         Radio Browser per a hand-curated channel
                         list per broadcaster (BR, WDR, NDR, MDR, SWR,
                         HR, RBB, SR, RB, DLF). `npm run import-ard`.
  backfill-geo.mjs     — adds geo: [lat, lon] to every station via
                         Radio Browser → broadcaster-HQ centroid
                         fallback. `npm run backfill-geo`.
  wire-metadata.mjs    — auto-discovers per-station metadataUrl for
                         broadcasters with known patterns (br, orf,
                         bbc, hr). For BR scrapes the channel page;
                         for BBC matches against a known service list
                         and verifies via the worker proxy; for HR
                         scrapes each subdomain. `npm run wire-metadata`.
```

## Other

```
worker/                — Cloudflare Worker that proxies broadcaster
                         APIs lacking CORS or with origin-gated access.
                         Public endpoints (no auth):
                           /api/public/top-stations
                           /api/public/bbc/{schedule,play}/<service>
                           /api/public/proxy?url=<encoded> (allowlisted)
                         Adding a new CORS-blocked broadcaster: extend
                         the allowlist in /api/public/proxy.

public/world-map.svg   — Wikimedia "low resolution" world map (~75KB,
                         stripped of inkscape metadata). Equirectangular
                         viewBox; pins on the Browse globe view use
                         simple lat/lon → x/y projection.

public/stations/       — bundled station logos. Path in YAML is
                         relative (e.g. "stations/grrif.png").

public/stations.json       — generated. DO NOT hand-edit.
public/station-status.json — generated by analyze. Read by dashboard.
public/station-backlog.json — generated by backlog. Read by dashboard.
```
