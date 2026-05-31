# Listening History Specification
```yaml
status: draft
platforms: [web, ios, android]
reconciled-against: 9336321
```

## Purpose

Listening History gives the user a private, on-device record of what they
actually listened to — which stations, for how long, from which countries, and
(optionally) which tracks — surfaced as a personal stats dashboard: top stations,
a "most listened" animated race chart, minutes-by-day bars, country totals, and
recent tracks. It is opt-in, local-only, never synced and never sent anywhere,
and exportable as CSV. It is distinct from the community **Stats / Dashboard**
sheet, which shows aggregate *catalog-wide* listener/station numbers fetched from
the rrradio Worker.

This spec covers the user's **personal** listening history. The community Stats
sheet is described under [Preferences and diagnostics](preferences-diagnostics.md)
and its outbound fetches under [privacy-data-boundaries](../contracts/privacy-data-boundaries.md)
rows 2–3.

## Entry points

- **Settings → Listening tab.** Settings sheet has a horizontal tab strip
  (Settings · About · Add station · Listening); the Listening tab is the history
  dashboard. Reachable by tapping the tab or horizontal swipe.
- **Settings → Settings tab → "Listening history" section.** Holds the master
  toggle, and when on: an "Open Listening dashboard" link (jumps to the Listening
  tab), the granularity rows, and the retention rows.
- The dashboard surface is never reached if the feature is off — it instead shows
  an enable prompt.

## Layout

Listening dashboard (Listening tab), top to bottom:

- **Title** "Listening history" with subtitle "Stored on your phone only".
- **Send/export button** (envelope icon), top-right. Opens a mail composer with a
  CSV attachment, or a share sheet if mail is unavailable.
- **Range segmented control**: `7 days` · `30 days` · `All`. Default `30 days`.
- **When enabled, with data in range:**
  - **Stat tiles row** (three): `Time` (total listening, e.g. `3h 12m`),
    `Sessions` (count), `Stations` (distinct count).
  - **"Most listened" section** — the animated race chart (see below).
  - **"Minutes by day" section** — vertical day bars across the range, with first
    and last day labels.
  - **"Countries" section** — rows of country + session count (`12x`) + total
    duration.
  - **"Recent tracks" section** — only when granularity is Stations + tracks and
    tracks exist; rows of `Artist - Title` + station name + last-played date.
  - **"Clear listening history" button** (destructive, trash icon).
- **When enabled, no data in range:** an empty card "No listening sessions in this
  range yet." plus the Clear button.
- **When disabled:** an enable card (icon, "Listening history is off", explanatory
  detail, "Enable" button). No dashboard, no clear.

Race chart (`Most listened`):

- Header row: first-snapshot date, **Play/Pause** pill, last-snapshot date.
- **Scrubber slider** spanning all daily snapshots (a flat line when only one).
- Center label: the currently displayed snapshot date.
- **Ranked bars 1–10**: rank number, station favicon, a horizontal bar whose width
  is the station's cumulative share, station name + country flag + share %, and a
  trailing cumulative-minutes value. Empty ranks render as blank rows so the chart
  height is stable at 10 rows.

Settings → Listening history section (when enabled):

- **"Listening history" toggle** ("Record what you listen to" detail) — master
  opt-in.
- **"Open Listening dashboard"** link.
- **Granularity rows** (single-select): "Stations only" (station, country, start
  time, duration) · "Stations + tracks" (also artist + title when published).
- **Retention rows** (single-select): `30 days` · `90 days` · `1 year` · `Forever`.

## States

| State | What shows | Actionable |
|---|---|---|
| Disabled | Enable card | "Enable" button; range control + export are present but yield empty/no data |
| Enabled, loading | Loading card ("Loading…") with spinner | Range control |
| Enabled, empty (no sessions in range) | Empty card; zeroed implied | Range control, export (empty CSV header only), Clear |
| Enabled, loaded | Full dashboard (tiles, race, day bars, countries, optional tracks) | Range control, race play/scrub, export, Clear |
| Race: no snapshots in range | "No listening history in this range." inside the section | Range control |
| Offline | Fully functional — all data is local; no network needed | Everything (export/share use OS apps) |
| Error | No error state: persistence failures are recorded as a local diagnostic and surface as missing/empty data, not an error screen | — |

The dashboard recomputes (shows loading, then loaded) whenever the range, the
record count, the enabled flag, or the granularity changes.

## Interactions

| Control / gesture | Precondition | Result | Side effects |
|---|---|---|---|
| Tap Listening tab / swipe to it | Settings open | Shows the dashboard or enable card | Triggers an aggregation pass |
| Tap "Enable" (disabled card) | Disabled | Enables history; dashboard appears (empty until sessions accrue) | Persists opt-in; marks preferences dirty for sync; closes any active session if just disabled |
| Toggle "Listening history" off (Settings) | Enabled | Disables recording | Closes the active session immediately at now; marks preferences dirty |
| Tap "Open Listening dashboard" | Enabled | Switches Settings to the Listening tab | — |
| Tap a granularity row | Enabled | Sets Stations-only or Stations+tracks | Switching to Stations-only **strips** all stored artist/title from existing records and re-saves; marks preferences dirty |
| Tap a retention row | Enabled | Sets 30d / 90d / 1y / Forever | Immediately prunes closed records older than the window; re-saves; marks preferences dirty |
| Change range control | Always | Re-scopes tiles/race/day-bars/countries/tracks to 7d / 30d / All | Recomputes aggregation off the main thread |
| Race Play | ≥2 snapshots | Animates rank bars from first to last day; if at end, restarts from day 0 | Periodic advance (~80ms tick) |
| Race Pause | Playing | Freezes at current snapshot | Cancels the advance task |
| Drag race scrubber | ≥2 snapshots | Jumps to that day's snapshot | Stops any running playback |
| Tap envelope (Send) | Always | Mail composer with CSV attachment, or share sheet if mail unavailable | Builds CSV from **all** records (ignores range), newest-first |
| Send mail / Share | Composer/sheet open | User-initiated CSV leaves device only if they Send/Share | CSV attachment named `rrradio-listening-history-<YYYY-MM-DD>.csv` |
| Tap "Clear listening history" | Enabled | Confirmation dialog | — |
| Confirm Clear | Dialog shown | Deletes **all** records (every range) | Clears active session; re-saves empty file |
| Start playing a station | History enabled | Opens a new session for that station | Closes any prior open session at now; appended record persisted |
| Resume same station | Open session, same station | Keeps the session; refreshes the lifecycle timestamp | No new record |
| Resume a different station / play new station | Enabled | Closes prior session, opens a new one | — |
| Pause / stop playback | Open session | Closes the session at now; computes duration | Prunes if under 5s; persists |
| New track metadata arrives | Enabled, Stations+tracks, open session | Stores latest artist/title on the open session | Persisted only when artist/title actually change |
| App backgrounded while playing | Open session | Session stays open; a 30s heartbeat keeps the lifecycle timestamp fresh | — |
| App relaunch with an open (crashed/killed) session | On launch | The stale open session is closed at the last-known lifecycle timestamp (or session start if none) | Pruned if under 5s; retention applied; persisted |

## Business rules

- **Opt-in.** History is OFF by default; no sessions recorded until enabled.
- **One open session at a time.** Starting/resuming a session closes the prior one.
- **Minimum stored duration: 5 seconds.** Closed sessions shorter than 5s are
  pruned and never counted; open sessions are only counted once they pass 5s in
  aggregation.
- **Duration** = `endedAt − startedAt`, clamped to ≥0. An open session's live
  duration in aggregation = `now − startedAt`.
- **Granularity.**
  - Stations-only stores: station id, station name, country, start time, end time,
    duration.
  - Stations+tracks additionally stores the latest artist/title published while
    that session was open (one pair per session — last write wins).
  - Switching to Stations-only erases artist/title from history retroactively.
- **Retention** prunes *closed* records whose start is older than the window
  (30 / 90 / 365 days); Forever = no time prune. Open sessions are never pruned by
  retention. Default retention: **90 days**. Pruning runs on session start, session
  close, retention change, and launch.
- **Top stations:** ranked by total seconds desc, tie-break by case/diacritic-folded
  station name then id; top **12** kept in the summary.
- **Top countries:** ranked by total seconds desc, tie-break by country code; top
  **8** kept. Missing country normalizes to `??`. Country codes uppercased.
- **Recent tracks:** newest **20**, only sessions that carry a track title.
- **Recent sessions:** newest **12** (in the summary model).
- **Race chart:** one cumulative snapshot per calendar day in range, top **10**
  stations per snapshot, capped to the most recent **366** days; pre-window days
  fold their totals into the starting baseline so cumulative shares stay correct.
  Share = station seconds ÷ all-station seconds that day.
- **Day bars:** one bar per calendar day across the range, capped to **366** days;
  empty days render a 3pt stub.
- **Day boundaries** use the user's local Gregorian calendar (what the user calls
  "today").
- **Lifecycle heartbeat:** a 30-second periodic observer refreshes the last-known
  lifecycle timestamp while audio plays, so a crash recovery can close the session
  near where playback actually stopped.
- **Export** serializes every record (CSV header `id, station_id, station_name,
  country, started_at, ended_at, duration_seconds, track_artist, track_title`),
  sorted newest-first, ISO-8601 timestamps, integer seconds.

## Data dependencies

- [privacy-data-boundaries](../contracts/privacy-data-boundaries.md) — listening
  history is the local, opt-in, never-auto-uploaded store (matrix "Listening
  history" row; boundary rule 2). The CSV export (row 13-style user-initiated
  hand-off) leaves the device only on explicit Send/Share. Track titles/artists
  in history never reach any counting endpoint.
- [sync-merge](../contracts/sync-merge.md) — history **records are excluded from
  the sync snapshot entirely** (never synced, enforced structurally). Only the
  three *preference* fields sync: `listeningHistoryEnabled`,
  `listeningHistoryLevel`, `listeningHistoryRetention`.

## Edge cases

- **Crash / force-quit with an open session.** On next launch the open record is
  closed at `min(last-known-lifecycle-timestamp, launch)`, floored at session
  start; then pruned if under 5s. No phantom multi-day session.
- **Clock skew / `endedAt < startedAt`.** Duration clamps to 0 → pruned by the 5s
  rule.
- **Corrupt history file.** On decode failure the file is quarantined to
  `*.corrupt-<timestamp>` and a fresh empty store starts; a diagnostic is recorded;
  no crash, no overwrite of the original bytes.
- **Persistence write failure.** Recorded as a local diagnostic; the in-memory
  records still update; no user-facing error.
- **Disable while playing.** The active session is closed immediately, not left
  dangling.
- **Granularity downgrade with tracks present.** All stored artist/title are wiped
  retroactively and the file re-saved (privacy-forward).
- **Huge history (years, Forever retention).** Race chart and day bars cap at 366
  days; older days fold into the baseline so totals stay correct without unbounded
  rows. Aggregation runs off the main thread.
- **Empty week.** Loaded-but-empty card; export yields a header-only CSV.
- **Old on-disk layout (newest-first).** Sorted ascending on read; self-heals on
  next save.
- **Cloud sync flips a history preference remotely.** Applied without re-triggering
  a local sync push (avoids a feedback loop); records themselves never arrive over
  sync.

## Accessibility

- The Send/export button carries an explicit accessibility label
  ("Send listening history").
- Stat tiles, metric rows, and race rows use plain text labels read in reading
  order (rank, station name, share, minutes).
- Dynamic Type: tile and metric values use minimum-scale-factor down-scaling
  (~0.75) and single-line clamping so large text stays legible without truncation
  loss; titles down-scale to ~0.82.
- Day bars and race bars are decorative-over-text; the numeric values
  (minutes/percent) accompany each bar so meaning does not rely on bar length
  alone.
- Race Play/Pause is a labeled control; scrubbing is a standard slider.

## Localization

This surface owns:

- Section/title strings: "Listening history", "Stored on your phone only",
  "Most listened", "Minutes by day", "Countries", "Recent tracks".
- Stat tile labels: "Time", "Sessions", "Stations".
- Range labels: "7 days", "30 days", "All".
- Enable/disabled card: "Listening history is off" + enable detail + "Enable".
- Empty/loading: "No listening sessions in this range yet.", "Loading…",
  "No listening history in this range."
- Clear flow: "Clear listening history" (button + dialog title), the local-only
  clear message, "Clear", "Cancel".
- Export flow: mail subject (parameterized with current date), exported-history
  body message, "Share listening history", "Export history", send-history a11y
  label.
- Race controls: "Play", "Pause".
- Settings rows: "Record what you listen to" + detail; "Stations only" /
  "Stations + tracks" + details; retention titles/details.

Parameter/plural needs:

- Mail subject takes a `date` parameter.
- Retention detail interpolates the window phrase ("Keep local history for …").
- Country rows show a session multiplier (`12x`) and durations (`3h 12m`, `45m`) —
  duration formatting needs hour/minute composition; consider plural forms per
  locale.
- Several Settings strings (dashboard link, granularity rows, retention phrasing)
  are currently hard-coded English literals (see Open questions / Known
  deviations).

## Platform Matrix

| Behavior | Web | iOS | Android |
|---|---|---|---|
| Personal listening history (opt-in, local) | Planned | Reference | Planned |
| Session recording (start/stop/duration, ≥5s, one open) | Planned | Supported | Planned |
| Crash-recovery close at last lifecycle timestamp | Planned | Supported | Planned |
| Granularity: stations-only vs stations+tracks | Planned | Supported | Planned |
| Retention windows (30d/90d/1y/Forever) | Planned | Supported | Planned |
| Range scope (7d/30d/All) | Planned | Supported | Planned |
| Top stations / countries / recent tracks | Planned | Supported | Planned |
| Race chart (animated, 366-day cap) | Planned | Supported | Planned |
| Minutes-by-day bars | Planned | Supported | Planned |
| CSV export (mail / share) | Supported (export per [data-sync.md](../data-sync.md)) | Supported | Planned |
| Records excluded from cloud sync | n/a (local-only) | Supported | n/a (local-only) |
| History preferences synced (3 fields) | Not planned | Supported | Not planned |
| Never auto-uploaded / no analytics | Supported | Supported | Planned |

## Open questions

- **DH5 privacy-claim mismatch:** the dashboard asserts "Stored on your phone
  only" while the *separate* community Stats sheet silently fetches three Worker
  endpoints on open. The two surfaces are different, but the juxtaposition is
  confusing — reconcile the in-screen privacy copy (see
  [privacy-data-boundaries](../contracts/privacy-data-boundaries.md) Open
  question 3). Tracked under Known deviations.
- Should the CSV export honor the selected range instead of always exporting all
  records?
- Several Settings/dashboard strings are hard-coded English (not localized).
- Cross-platform: define whether web/Android persist history at all, or only ship
  the export/backup-merge path defined in [data-sync.md](../data-sync.md).

## Reference

iOS source read for this spec:

- `rrradio/Library/ListeningHistory.swift` — record model, session lifecycle
  (start/resume/close), track update, retention/pruning, crash-recovery close,
  CSV export, corrupt-file quarantine; `ListeningHistoryAggregation` (summary,
  race snapshots, scoping, day boundaries, caps).
- `rrradio/Views/ListeningHistoryView.swift` — the Listening dashboard: range
  control, stat tiles, sections, day bars, clear flow, mail/share export.
- `rrradio/Views/ListeningRaceChart.swift` — the animated race chart, play/scrub,
  interpolation, top-10 rows.
- `rrradio/Views/DashboardView.swift` — the *community* Stats sheet (Worker
  fetches); referenced to distinguish it from personal history.
- `rrradio/Views/SettingsView.swift` — Listening tab plumbing, the Settings
  history section (toggle, dashboard link, granularity, retention).
- `rrradio/Player/AudioPlayer.swift` — wires play/resume/pause/stop and metadata
  to session start/resume/close/track-update; 30s lifecycle heartbeat observer.
- `rrradio/App.swift` — owns the `ListeningHistory` instance; injects it into the
  player.

## Known deviations

- **DH5 — privacy-posture inconsistency ("nothing is sent" vs. silent stats
  fetch).** The personal dashboard's "Stored on your phone only" copy sits beside
  the community Stats sheet, which fires silent Worker GETs on open. Personal
  history genuinely sends nothing; the Stats sheet does. See
  `rrradio-ios/internal/audit/2026-05-25-ios-code-review-slice23.md` (DH5) and
  [privacy-data-boundaries](../contracts/privacy-data-boundaries.md) Known
  deviations / Open question 3. The spec states the intended boundary (history is
  local-only); the audit owns the copy-vs-behavior mismatch.
