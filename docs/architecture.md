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
  style-tokens.ts     — OKLCH semantic design-token model, contrast checks,
                        and CSS / JSON / Swift export helpers.
  style-page.ts       — local editable style-token page wiring.
  style-page.css      — standalone style-token page UI.
  style.css           — mobile-first styles.

worker/
  src/index.ts        — Cloudflare Worker (GoatCounter proxy + BBC
                        proxy + broadcaster CORS proxy with allowlist +
                        anonymous broken-station reports).
  src/index.test.ts   — vitest cases (CORS / auth / allowlist / etc).
  src/probe.ts        — GET /api/admin/probe: edge second opinion on a
                        stream URL for the catalog quality loop (ADR 002).

Native iOS lives in https://github.com/MarkusSteinbrecher/rrradio-ios.

e2e/
  smoke.spec.ts       — Playwright cold-boot UI tests against `vite preview`.

index.html            — single-page shell with PWA meta tags +
                        meta-CSP + meta Permissions-Policy +
                        the .np-wake-pane (inline wake editor).
style/index.html      — local design-token editor at /style/.
ios/                  — static iOS app landing page at /ios (the
                        "vintage tuner" App Store Marketing page;
                        old /rrradio-ios/ redirects here).
public/               — static assets (icons, OG image, world map,
                        privacy.html, dashboard.html, stations.json,
                        analytics.js, silence.m4a). Third-party asset
                        provenance lives in THIRD_PARTY_NOTICES.md.
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
  health-probe.mjs     — canonical stream + metadata probe. Concurrent,
                         scopable (--cc / --only / --limit). Writes the
                         stream/https/icy/metadata/fetcher/program facets
                         into public/station-health.json plus a
                         problems-only public/station-status.json for
                         the dashboard. In CI it runs sharded off a plan
                         (--plan / --shard / --observations / --no-record)
                         and emits NDJSON observation rows instead.
                         `npm run health` (aliases: validate-catalog,
                         analyze). Spec: docs/station-health.md.
  plan-probe.mjs       — picks the day's probe targets (curated tier +
                         hot set daily, 1/7 of the long tail on
                         rotation) and splits them into balanced
                         shards. Writes plan.json. `npm run plan-probe`.
  derive-health.mjs    — folds the append-only observation rows on the
                         health-data branch into the health record
                         (through tools/lib/health-record.mjs), plus
                         streaks.json / metrics.json /
                         metrics-history.ndjson. Prunes stations that
                         left the catalog and observations older than
                         90 days. `npm run derive-health`.
  health-digest.mjs    — decision-shaped weekly markdown from the
  decide-actions.mjs   — streaks → actions.json (tools/lib/health-policy.mjs,
                         tools/lib/edge-probe.mjs). ADR 002 phase 2.
  apply-actions.mjs    — actions.json → stations.yaml + stations.json diff
                         + health-data snapshots (tools/lib/catalog-actions.mjs);
                         runs check-catalog before returning.
                         health-data branch: metrics with deltas, newly
                         failing, recovered, hot-set failures. Body of
                         the `catalog-quality` issue.
                         `npm run health-digest`.
  auto-curate.mjs      — promotes top-played non-curated names from
                         GoatCounter into stations.yaml at status:
                         stream-only after a Radio Browser lookup +
                         stream probe. `npm run auto-curate`. Runs via
                         .github/workflows/catalog-watch.yml (manual
                         dispatch), which opens a labelled PR with the
                         additions.
  health-import.mjs    — one-shot bootstrap of the health record from
                         pre-existing report artifacts, keeping each
                         source's own generatedAt as that facet's
                         lastRun. `npm run health-import`.
  build-station-capabilities.mjs
                       — deterministic native-client metadata capability
                         manifest builder. Reads an existing station catalog
                         plus src/fetchers.json and writes
                         public/station-capabilities.json. Network-free;
                         also used by the local iOS catalog builder.
                         `npm run station-capabilities`.
  backlog.mjs          — analyzed view of every played station with
                         RB lookup + verdict (auto-curate-ready,
                         needs-https, stream-broken, no-rb-match,
                         already-curated). Writes
                         public/station-backlog.json. Refreshed
                         by catalog-watch. `npm run backlog`.
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
.github/workflows/
  deploy.yml           — CI + GitHub Pages publish. The web job also
                         overlays station-health.json from the
                         health-data branch into dist/ (never fatal).
  station-probe.yml    — daily 05:00 UTC catalog quality loop:
                         plan → probe (sharded matrix) → merge (commit
                         observations + derived record to the orphan
                         health-data branch) → digest (weekly
                         `catalog-quality` issue). ADR 002.
  catalog-actions.yml  — daily 06:00 UTC, the act half of ADR 002:
                         decide-actions (streaks + Worker edge second
                         opinion + RB replacement lookup) → apply-actions
                         → `catalog-actions` PR (long tail, auto-merge via
                         the rrradio-bot App) and `catalog-review` PR
                         (curated tier, human decision).
  catalog-watch.yml    — "Catalog refresh (manual)". Dispatch-only
                         Radio Browser refresh + duplicates +
                         candidates + backlog + auto-curate. No longer
                         probes health (that moved to station-probe).
  propose-fixes.yml    — daily broken-station fix PRs off the open
                         `broken-station` issues.

health-data branch     — orphan, bot-only, unprotected. Holds
                         observations/YYYY-MM-DD.ndjson,
                         station-health.json, streaks.json,
                         metrics.json, metrics-history.ndjson,
                         plan.json. Written only by station-probe.yml;
                         read by deploy.yml. Never merged into main.
                         See docs/station-health.md.

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
                         simple lat/lon → x/y projection. Attribution and
                         CC BY-SA notice: THIRD_PARTY_NOTICES.md.

public/stations/       — bundled station logos. Path in YAML is
                         relative (e.g. "stations/grrif.png"). These are
                         broadcaster assets; source/terms are tracked in
                         THIRD_PARTY_NOTICES.md.

public/stations.json       — generated. DO NOT hand-edit.
public/station-capabilities.json — generated by catalog. Native clients read it to choose metadata polling strategy.
public/station-capabilities-ios-local.json — generated by catalog:ios-local. Local-only native testing companion to stations-ios-local.json.
public/station-health.json — the unified per-station health record (docs/station-health.md). Written only via tools/lib/health-record.mjs by derive-health, health-probe, logo-status, check-drift, check-duplicates, check-homepages. The committed copy is the bootstrap/local one; the live record is derived daily onto the health-data branch and overlaid into dist/ at deploy time. Read by the tracker Health tab.
public/station-status.json — generated by health-probe (problems-only). Read by dashboard.
public/station-backlog.json — generated by backlog. Read by dashboard.
```
