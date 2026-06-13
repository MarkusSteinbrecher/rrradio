# Listening History Specification
```yaml
status: review
platforms: [web, ios, android]
reconciled-against: d241aa9
```

## Purpose

Listening History gives the user a private, on-device record of what they
actually listened to — which stations, for how long, from which countries, and
(optionally) which tracks — surfaced as a personal stats dashboard: top stations,
a "most listened" animated race chart, minutes-by-day bars, country totals,
recent sessions, and recent tracks. It is opt-in, on-device, never sent to any
analytics endpoint, and exportable as CSV. Its records are kept locally and
(iOS, when iCloud sync is on) mirrored to the user's *own* private iCloud so the
history follows them across their devices — the data never leaves the user's
control. It is distinct from the community **Stats / Dashboard** sheet, which
shows aggregate *catalog-wide* listener/station numbers fetched from the rrradio
Worker.

This spec covers the user's **personal** listening history. The community Stats
sheet is described under [Preferences and diagnostics](preferences-diagnostics.md)
and its outbound fetches under [privacy-data-boundaries](../contracts/privacy-data-boundaries.md)
rows 2–3.

## Entry points

- **Settings → History tab.** Settings sheet has a horizontal tab strip; the
  History tab is the history dashboard. Reachable by tapping the tab or
  horizontal page-swipe.
- **Settings → Settings tab → "Listening history" section.** Holds the
  tracking control (a single tri-state: Off / Stations / + Tracks), and when on:
  an "Open History" link (jumps to the History tab) and the retention row.
- The dashboard surface is always reachable; when the feature is off it shows an
  enable card instead of the dashboard.

## Layout

Listening dashboard (History tab), top to bottom:

- **Title** "Listening history" with subtitle "Stored on your phone only".
- **Send/export button** (envelope icon), top-right. Opens a mail composer with a
  CSV attachment, or a share sheet if mail is unavailable.
- **Range segmented control**: `7 days` · `30 days` · `All`. Default `30 days`.
- **When enabled, with sessions in range:**
  - **Stat tiles row** (three): `Time` (total listening, e.g. `3h 12m`),
    `Sessions` (count), `Stations` (distinct count).
  - **"Most listened" section** — the animated race chart (see below).
  - **"Minutes by day" section** — bar chart across the range (see below).
  - **"Countries" section** — rows of country code + session count (`12x`) + total
    duration.
  - **"Recent sessions" section** — only when at least one qualifying session
    exists; rows of station name + when it started (`Jun 5, 18:52`) + that
    session's duration. Newest first.
  - **"Recent tracks" section** — only when granularity is Stations + tracks and
    tracks exist; rows of `Artist - Title` + station name + last-played date.
  - **"Clear listening history" button** (destructive, trash icon).
- **When enabled, no sessions in range:** an empty card "No listening sessions in
  this range yet." plus the Clear button. (A loading card — spinner +
  "Loading…" — shows briefly while the aggregation computes the first frame.)
- **When disabled:** an enable card (icon, "Listening history is off", explanatory
  detail, "Enable" button). No dashboard sections, no clear. The title, subtitle,
  export button, and range control still render above it.

Race chart (`Most listened`):

- Header row: first-snapshot date, **Play/Pause** pill, last-snapshot date.
- **Scrubber slider** spanning all daily snapshots (a flat line when only one).
- Center label: the currently displayed snapshot date.
- **Ranked bars** (up to 10): rank number, station favicon, a horizontal bar whose
  width is proportional to that station's cumulative seconds vs the leader, station
  name + country flag, and a trailing cumulative-minutes value (`12m`). Each station
  keeps one stable colour for the whole race; the rank-1 station carries a small
  crown badge on its favicon.
- Row count is the deepest any snapshot ever reaches, capped at 10 — short
  histories don't pad out empty rows.

"Minutes by day" chart:

- **Readout line** (top): the active bucket's date (or week range) and its total
  duration; a "Peak day" badge marks the busiest bucket. With no bucket active it
  shows the empty-range message.
- **Bars**: one bar per calendar day for short ranges; above ~7 weeks it groups
  into one bar per ISO week. The peak bucket is fully accented; the selected bucket
  is outlined; zero-listening buckets render as a muted stub.
- **First/last labels** under the bars mark the window's start and end.

Settings → Listening history section:

- **Tracking control** — one tri-state capsule group: `Off` · `Stations` ·
  `+ Tracks`, with a one-line detail describing the current choice. This single
  control replaces the former master toggle plus granularity rows; `Off` disables
  recording, `Stations` records station/country/time/duration, `+ Tracks` also
  records artist + title when published.
- **When enabled** (a grouped panel below the control):
  - **"Open History"** link ("Review your local listening stats.") — jumps to the
    History tab.
  - **"Keep history" retention dropdown** — a menu of `30 days` · `90 days` ·
    `1 year` · `Forever`, with a detail line that changes for Forever.

## States

| State | What shows | Actionable |
|---|---|---|
| Disabled | Title/subtitle, export button, range control, then the Enable card | "Enable" button; export still works (CSV from any records on disk); range control inert |
| Enabled, loading | Loading card ("Loading…") with spinner | Range control |
| Enabled, empty (no sessions in range) | Empty card "No listening sessions in this range yet." | Range control, export, Clear |
| Enabled, loaded | Stat tiles + sections (race, minutes-by-day, countries, recent sessions, optional tracks) | Range control, race play/scrub, day-bar tap, export, Clear |
| Race: no snapshots in range | "No listening history in this range." inside the section | Range control |
| Offline | Fully functional — all data is local; no network needed | Everything (export/share use OS apps; favicon back-fill skips the network leg) |
| Error | No error state: persistence/back-fill failures are recorded as a local diagnostic and surface as missing/empty data, not an error screen | — |

The dashboard recomputes (shows loading, then loaded) whenever the range, the
record count, the enabled flag, or the granularity changes.

## Interactions

| Control / gesture | Precondition | Result | Side effects |
|---|---|---|---|
| Tap History tab / page-swipe to it | Settings open | Shows the dashboard or enable card | Triggers an aggregation pass and a station-artwork back-fill |
| Tap "Enable" (disabled card) | Disabled | Enables history; dashboard appears (empty until sessions accrue) | Persists opt-in; marks preferences dirty for sync |
| Set tracking control to `Off` (Settings) | Enabled | Disables recording | Closes the active session immediately at now; marks preferences dirty |
| Set tracking control to `Stations` | Any | Enables history at Stations-only | Switching down from + Tracks **strips** all stored artist/title from existing records and re-saves; marks preferences dirty |
| Set tracking control to `+ Tracks` | Any | Enables history at Stations + tracks | Marks preferences dirty |
| Tap "Open History" | Enabled | Switches Settings to the History tab | — |
| Pick a retention value (dropdown) | Enabled | Sets 30d / 90d / 1y / Forever | Immediately prunes closed records older than the window; re-saves; marks preferences dirty |
| Change range control | Always | Re-scopes tiles/race/day-bars/countries/sessions/tracks to 7d / 30d / All | Recomputes aggregation off the main thread |
| Race Play | ≥2 snapshots | Smoothly animates standings from first to last day, easing between snapshots; if at the end, restarts from day 0 | ~60 fps advance; total run scales with snapshot count, clamped to 14–36s |
| Race Pause | Playing | Freezes at current position | Cancels the advance task |
| Drag race scrubber | ≥2 snapshots | Jumps to that day's snapshot | Stops any running playback |
| Tap a day/week bar | ≥1 bar | Selects that bucket; readout shows its date (or week range) and total; tapping again deselects | — |
| Tap envelope (Send) | Always | Mail composer with CSV attachment, or share sheet if mail unavailable | Builds CSV from **all** records (ignores range), newest-first |
| Send mail / Share | Composer/sheet open | User-initiated CSV leaves device only if they Send/Share | CSV attachment named `rrradio-listening-history-<YYYY-MM-DD>.csv` |
| Tap "Clear listening history" | Enabled | Confirmation dialog | — |
| Confirm Clear | Dialog shown | Deletes **all** records (every range) | Clears active session; re-saves empty file; signals sync (empties the shared iCloud blob) |
| Start playing a station | History enabled | Opens a new session for that station | Closes any prior open session at now; appended record persisted |
| Resume same station | Open session, same station | Keeps the session; refreshes the lifecycle timestamp | No new record |
| Resume a different station / play new station | Enabled | Closes prior session, opens a new one | Closing the prior session signals sync |
| Pause / stop playback | Open session | Closes the session at now; computes duration | Prunes if under 5s; persists; signals sync |
| New track metadata arrives | Enabled, + Tracks, open session | Stores latest artist/title on the open session | Persisted only when artist/title actually change |
| App backgrounded while playing | Open session | Session stays open; a ~30s heartbeat refreshes the lifecycle timestamp **and persists the open record's elapsed duration** | — |
| App relaunch with an open (crashed/killed) session | On launch | The stale open session is closed at the furthest-reaching of its last-persisted progress and the lifecycle timestamp, clamped to launch | Pruned if under 5s; retention applied; persisted |
| iCloud sync delivers another device's sessions | iCloud sync on | Closed sessions from other devices are unioned into the local store | Additive only (never deletes local); de-duped; records older than retention skipped; no push echoed back |

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
    duration, and (for display + merging) the station's favicon and stream URL
    captured at play time.
  - Stations + tracks additionally stores the latest artist/title published while
    that session was open (one pair per session — last write wins).
  - Switching to Stations-only erases artist/title from history retroactively.
- **Station merging.** For all dashboard aggregates (top stations, station count,
  countries, race chart), catalog duplicates of one broadcaster are merged:
  records group by case/diacritic-folded station name + country, and any groups
  that share a stream URL are further unioned into one station. Merging only ever
  combines, never splits — a missing or odd stream URL can't fragment a group. The
  merged row's favicon and concrete station id come from its most-listened variant.
- **Artwork back-fill.** Records that predate the stored favicon/stream-URL fields
  are back-filled on demand from local sources (catalog + favorites/recents/custom)
  first, then a bounded one-shot Radio Browser re-fetch for aged-out `rb-…`
  stations. Back-fill only fills nil values (never overwrites) and converges.
- **Retention** prunes *closed* records whose start is older than the window
  (30 / 90 / 365 days); Forever = no time prune. Open sessions are never pruned by
  retention. Default retention: **90 days**. Pruning runs on session start, session
  close, retention change, and launch.
- **Top stations:** ranked by total seconds desc, tie-break by case/diacritic-folded
  merged station name then id; top **12** kept in the summary.
- **Top countries:** ranked by total seconds desc, tie-break by country code; top
  **8** kept. Missing country normalizes to `??`. Country codes uppercased.
- **Recent sessions** (visible dashboard section): newest **20** sessions whose
  duration is **≥60s**, so a few-second channel-surf doesn't bury the sessions the
  user sat through. The ≥60s filter applies only to this list — every aggregate
  (tiles, race, day bars, countries) still counts all sessions ≥5s.
- **Recent tracks:** newest **20**, only sessions that carry a track title.
- **Race chart:** one cumulative snapshot per calendar day in range, top **10**
  stations per snapshot, capped to the most recent **366** days; pre-window days
  fold their totals into the starting baseline so cumulative shares stay correct.
  Bar length is the station's seconds ÷ the leader's seconds that day.
- **Day bars:** one bar per calendar day across the range, capped to **366** days;
  empty days render a small stub. Above ~7 weeks (49 days) of buckets the chart
  groups into one bar per ISO week. The busiest bucket is flagged as the peak.
- **Day boundaries** use the user's local Gregorian calendar (what the user calls
  "today").
- **Duration formatting** is compact and scales: `m` under an hour, `Hh Mm` under a
  day, and `Dd Hh` once a total crosses 24h (so cumulative totals stay legible).
  Per-session durations under a minute render as whole seconds (`42s`).
- **Lifecycle heartbeat:** a ~30-second periodic observer (while audio plays, and
  on scene transitions) refreshes the last-known lifecycle timestamp **and persists
  the open record's elapsed duration** (monotonic, `endedAt` stays nil), so a crash
  recovery can close the session near where playback actually stopped and an
  app-kill loses at most one tick.
- **Cross-device sync (iOS, iCloud on).** Closed sessions sync to the user's own
  private iCloud as one shared blob; merges are an additive union keyed by
  `station id + whole-second start` (local wins on a key collision). Open sessions
  are never shared. The upload is bounded — within the retention window, newest
  **2000** sessions, trimmed oldest-first to stay under the per-record byte cap —
  while local storage keeps everything. Records are **excluded from the
  backup/export file**. See [sync-merge](../contracts/sync-merge.md).
- **Export** serializes every record (CSV header `id, station_id, station_name,
  country, started_at, ended_at, duration_seconds, track_artist, track_title`),
  sorted newest-first, ISO-8601 timestamps, integer seconds.

## Data dependencies

- [privacy-data-boundaries](../contracts/privacy-data-boundaries.md) — listening
  history is the local, opt-in store; it is never sent to any analytics endpoint.
  The CSV export leaves the device only on explicit Send/Share. Track
  titles/artists in history never reach any counting endpoint. (iOS additionally
  mirrors closed records to the user's *own* private iCloud when sync is on — see
  below.)
- [sync-merge](../contracts/sync-merge.md) — on iOS with iCloud sync on, **closed**
  history records DO sync, as one shared blob, union-merged across the user's
  devices and bounded for upload; open sessions never sync, and the records are
  excluded from the exported backup file. The three *preference* fields
  (`listeningHistoryEnabled`, `listeningHistoryLevel`, `listeningHistoryRetention`)
  sync separately as preferences.

## Edge cases

- **Crash / force-quit with an open session.** On next launch the open record is
  closed at the later of its last-persisted progress (heartbeat-written elapsed
  duration) and the global lifecycle timestamp, clamped to launch and floored at
  session start; then pruned if under 5s. The progress floor means a long session
  survives even if the heartbeat went stale. No phantom multi-day session.
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
  a local sync push (avoids a feedback loop).
- **Cloud sync delivers records from another device.** Closed sessions are unioned
  additively into the local store (never deleting a local record), de-duped by
  `station id + whole-second start`, and any older than the local retention window
  are skipped. The resulting save is suppressed from echoing a push back out, so
  repeated syncs converge without duplicates or churn. A missing or undecodable
  remote blob is treated as "no remote sessions", not a wipe.
- **Missing station artwork on old records.** Records written before favicon/stream
  fields existed render with initials until back-fill resolves a logo; the Radio
  Browser re-fetch is attempted once per station id per session, so a failure
  doesn't hammer the mirrors.

## Accessibility

- The Send/export button carries an explicit accessibility label
  ("Send listening history").
- Stat tiles, metric rows, and race rows use plain text labels read in reading
  order (rank, station name, share, minutes).
- Dynamic Type: tile and metric values use minimum-scale-factor down-scaling
  (~0.75) and single-line clamping so large text stays legible without truncation
  loss; titles down-scale to ~0.82.
- Day/week bars are decorative-over-text; each bar is an accessibility element
  labeled with its date and duration, and the numeric total accompanies the chart
  readout so meaning never relies on bar length alone. Race bars likewise carry a
  trailing minutes value.
- Race Play/Pause is a labeled control; scrubbing is a standard slider. The rank-1
  crown is decorative (rank is conveyed by row order and the leading rank number).

## Localization

The **dashboard surface** is fully localized and owns:

- Section/title strings: "Listening history", "Stored on your phone only",
  "Most listened", "Minutes by day", "Countries", "Recent sessions",
  "Recent tracks", "Peak day".
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
- Tab label: "History".

Parameter/plural needs:

- Mail subject takes a `date` parameter.
- Country rows show a session multiplier (`12x`) and durations (`3h 12m`, `45m`,
  `2d 3h`) — duration formatting composes seconds/minutes/hours/days; consider
  plural forms per locale.
- The **Settings listening-history section** strings are **not yet localized** —
  the tri-state labels ("Off", "Stations", "+ Tracks") and their detail lines,
  "Open History" + "Review your local listening stats.", "Keep history" + its
  detail lines, and the retention menu titles ("30 days" / "90 days" / "1 year" /
  "Forever") are hard-coded English literals (see Open questions).

## Platform Matrix

| Behavior | Web | iOS | Android |
|---|---|---|---|
| Personal listening history (opt-in, local) | Planned | Reference | Partial (opt-in local play-event log via DataStore, capped at 100 entries; no dashboard yet) |
| Session recording (start/stop/duration, ≥5s, one open) | Planned | Supported | Partial (records a play-event timestamp on each play; no start/stop session, no duration, no ≥5s or one-open rule yet) |
| Crash-recovery close at last lifecycle timestamp | Planned | Supported | Planned |
| Granularity: stations-only vs stations+tracks | Planned | Supported | Partial (tri-state Off/Stations/+Tracks preference exists and gates recording; track artist/title capture not yet wired, so +Tracks records nothing extra) |
| Retention windows (30d/90d/1y/Forever) | Planned | Supported | Planned (today a fixed 100-entry cap, no time-based retention) |
| Range scope (7d/30d/All) | Planned | Supported | Planned |
| Top stations / countries / recent tracks | Planned | Supported | Planned |
| Recent sessions list (≥60s, newest 20) | Planned | Supported | Planned |
| Station merge by name+country / stream URL | Planned | Supported | Planned |
| Race chart (animated, 366-day cap) | Planned | Supported | Planned |
| Minutes-by-day bars (weekly grouping, peak, tap-select) | Planned | Supported | Planned |
| CSV export (mail / share) | Planned (web has no listening history; its JSON backup export of favorites + custom stations per [data-sync.md](../data-sync.md) is a different feature) | Supported | Planned (no history CSV yet; would use SAF / the Android share sheet, the native counterpart to the iOS mail composer / share sheet — distinct from the existing JSON library backup) |
| Closed records synced to user's own iCloud (bounded, union-merge) | n/a | Supported | Not applicable (iCloud is Apple-only; no cross-device record sync on the first Android port — see [data-sync.md](../data-sync.md)) |
| Open sessions never synced; records excluded from backup-export | n/a | Supported | Not applicable (no record sync; the SAF library backup already carries only the history *preference*, not records) |
| History preferences synced (3 fields) | Not planned | Supported | Not planned (no cross-device sync; the single history-level preference rides along in the SAF library backup file, not a sync service) |
| Never sent to analytics endpoints | Supported | Supported | Supported (records persist only in local DataStore; nothing posted off-device) |

## Open questions

- **DH5 privacy-claim mismatch:** the dashboard asserts "Stored on your phone
  only" while the *separate* community Stats sheet silently fetches three Worker
  endpoints on open. The two surfaces are different, but the juxtaposition is
  confusing — reconcile the in-screen privacy copy (see
  [privacy-data-boundaries](../contracts/privacy-data-boundaries.md) Open
  question 3). Tracked under Known deviations.
- Should the CSV export honor the selected range instead of always exporting all
  records?
- The **Settings** listening-history section strings (tri-state labels + details,
  "Open History", retention row) are still hard-coded English while the dashboard
  is fully localized — finish localizing the Settings rows.
- **Privacy boundary wording:** history records now sync to the user's own private
  iCloud, yet the dashboard subtitle says "Stored on your phone only" and the
  disabled-card copy says "Nothing is sent to rrradio.org." Both are technically
  true (the data stays user-owned; nothing reaches rrradio servers) but the
  "your phone only" phrasing predates cross-device sync — reconcile with
  [privacy-data-boundaries](../contracts/privacy-data-boundaries.md) Open
  question 4.
- Cross-platform: define whether web/Android persist history at all, or only ship
  the export/backup-merge path defined in [data-sync.md](../data-sync.md).

## Reference

iOS source read for this spec:

- `rrradio/Library/ListeningHistory.swift` — record model (incl. favicon/stream
  fields), session lifecycle (start/resume/close), track update, heartbeat
  (`tickActiveSession`), retention/pruning, crash-recovery close, artwork
  back-fill, CSV export, corrupt-file quarantine; `ListeningHistoryAggregation`
  (summary, race snapshots, station merging, scoping, day boundaries, caps);
  `ListeningHistorySyncCoding` (cross-device dedup/encoding).
- `rrradio/Views/ListeningHistoryView.swift` — the History dashboard
  (`ListeningHistoryPageView`): range control, stat tiles, sections, recent
  sessions, mail/share export, artwork back-fill; `MinutesByDayChart` (day/week
  bars, peak, tap-select); `ListeningDashboardData` (recent-sessions ≥60s filter).
- `rrradio/Views/ListeningRaceChart.swift` — the animated race chart, play/scrub,
  eased interpolation, stable per-station colours, crown, up-to-10 rows.
- `rrradio/Views/DashboardView.swift` — the *community* Stats sheet (Worker
  fetches); referenced to distinguish it from personal history.
- `rrradio/Views/SettingsView.swift` — History tab plumbing, the Settings
  listening-history section (tri-state tracking control, "Open History" link,
  retention dropdown).
- `rrradio/Player/AudioPlayer.swift` — wires play/resume/pause/stop and metadata
  to session start/resume/close/track-update; ~30s lifecycle heartbeat observer.
- `rrradio/App.swift` — owns the `ListeningHistory` instance; injects it into the
  player; fires `tickActiveSession` on scene transitions.
- `rrradio/CloudSync/CloudSyncSnapshot.swift`, `CloudSyncController.swift` —
  cross-device record sync: `syncableRecords`, `mergeSyncedRecords`,
  `boundingListeningHistoryForUpload`, `ListeningHistorySyncBounds` (issue #58).

## Known deviations

- **DH5 — privacy-posture inconsistency ("nothing is sent" vs. silent stats
  fetch).** The personal dashboard's "Stored on your phone only" copy sits beside
  the community Stats sheet, which fires silent Worker GETs on open. Personal
  history sends nothing to rrradio/analytics (its only off-device path is the
  user's own private iCloud); the Stats sheet hits the developer Worker. See
  `rrradio-ios/internal/audit/2026-05-25-ios-code-review-slice23.md` (DH5) and
  [privacy-data-boundaries](../contracts/privacy-data-boundaries.md) Known
  deviations / Open question 3. The spec states the intended boundary (history is
  local-only); the audit owns the copy-vs-behavior mismatch.
