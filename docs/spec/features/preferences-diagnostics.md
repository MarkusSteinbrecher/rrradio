# Preferences And Diagnostics Specification

```yaml
status: review
platforms: [web, ios, android]
reconciled-against: d241aa9
```

## Purpose

Preferences make rrradio feel personal — theme, accent, language, where the app
opens, how the library is laid out, timer defaults, and which integrations are
offered. Diagnostics help debug playback without turning the app into a tracking
product: a local, opt-in, capped, redacted log the user can read and choose to
share. Both surfaces sit behind one Settings sheet and never require an account.

## Entry points

- Settings button in the app's top navigation chrome opens the Settings sheet.
- The sheet opens on the **Preferences** tab by default.
- A horizontal tab strip switches between four pages: **Preferences**, **About**,
  **Upload** (Add Station), **History** (Listening dashboard). Swiping the page
  horizontally lands on the same page the tab strip selects.
- The **Open History** row inside Listening History jumps to the History tab.
- A denied-wake-notification warning row deep-links to the OS Settings app.
- The cloud-sync **iPhone Settings** button deep-links to the OS iCloud settings.
- The diagnostics-preview **expand** corner button opens the full diagnostics log
  in a full-screen viewer. *(iOS.)*

## Layout

Settings sheet, top to bottom:

- **Sheet header** — title "Settings", dismiss control.
- **Tab strip** — Preferences · About · Upload · History (uppercase, mono).
- **Preferences page** (scrolling), sections in order:
  1. **Theme** — three-way segmented pill: System · Light · Dark (icon + label).
  2. **Color** — two-segment pill: **Standard** (swatch of the appearance's adaptive
     default) · **Custom** (filled swatch when set, dashed ring when not). Tapping
     Standard resets the accent for the current appearance; tapping Custom opens the
     color-picker overlay. Accent is scoped to the active appearance (light/dark
     edited independently).
  3. **iCloud Sync** — master sync toggle ("Sync with iCloud") with a live status
     detail line; **Sync now** + **iPhone Settings** buttons; a **Backup** / **Restore**
     local-file pair (export/import a JSON backup; works with sync off; history not
     included); destructive **Remove all iCloud data** row. *(iOS only.)*
  4. **Catalog** — station-catalog row (count + freshness/last-sync detail), optional
     inline refresh-error line, **Refresh** button.
  5. **Landing page** — radio list of launch targets: Browse, Favorites, a combined
     **Library** row (its trailing dropdown picks Home, any user station list, or
     Recents), and Play a station. Selecting "Play a station" reveals a station
     picker (use-current shortcut, search field, up to 8 matches).
  6. **Library views** — per-display-mode rows (List / Tiles / App): tap a visible
     row to make it the default (DEFAULT badge), up/down reorder buttons, and a
     show/hide toggle each. The former separate "Default Library view" section is
     folded in here.
  7. **Timer defaults** — default wake time (time picker), wake-notification toggle,
     optional notifications-denied warning row, default sleep duration (hh:mm dial).
  8. **Car mode** — single tri-state pill: **Auto** (activate on a car-like route) ·
     **Always** (manual override) · **Off**. *(iOS.)*
  9. **Music services** — one toggle per registered service (Apple Music, Spotify,
     YouTube Music) controlling whether its Now Playing deep-link is offered.
  10. **Listening History** — tri-state pill (Off · Stations · + Tracks) with a
      detail line; when tracking is on: **Open History** link and a **Keep history**
      retention dropdown (30 days / 90 days / 1 year / Forever).
  11. **Apple Intelligence** — AI station-blurbs toggle. *(iOS 26+ only.)*
  12. **Language** — single dropdown row showing the current choice; the menu lists
      System, English, Deutsch, Français, Español, Italiano, Русский.
  13. **Diagnostics** — Collect-Diagnostics toggle, redacted recent-events preview
      with an **expand** corner button (opens the full log full-screen), Copy /
      Share / Clear buttons.
- **About page** — app/privacy disclosure copy and links (owned by `about` surface).
- **Upload page** — Add Station (owned by [custom-stations](custom-stations.md)).
- **History page** — Listening dashboard (owned by [favorites](favorites.md) /
  listening-history surface).

## States

| State | What shows | Actionable |
|---|---|---|
| Loaded (default) | All preference sections rendered with current values; each selection shows a checkmark / filled control. | Every control. |
| Catalog idle/loaded | Detail: "N stations loaded." + last-sync time; checked occasionally when the app becomes active. | Refresh. |
| Catalog loading / refreshing | Detail: "Refreshing station list…" / "Loading station list…"; Refresh button disabled. | — |
| Catalog failed | Inline error line ("Could not refresh: …") + Refresh button. | Refresh (retry). |
| Cloud sync off | Detail: "Off for this device. Existing iCloud data is kept for other devices."; Sync-now and Remove rows disabled. | Enable toggle. |
| Cloud sync checking | Detail: "Checking iCloud availability…". | Toggle (best effort). |
| Cloud sync available / synced / restored / pushed | Detail names the merged counts + last-sync time. | Sync now, Remove, toggle off. |
| Cloud sync unavailable | Detail carries the sanitized reason; toggle locked on when enabled-but-unavailable. | iPhone Settings. |
| Cloud sync removed / reset applied | Detail confirms removal/reset. | — |
| Diagnostics off | Preview: "Diagnostics collection is off."; Copy/Share disabled. | Enable toggle. |
| Diagnostics on, empty | Preview: "No diagnostic events yet."; Copy/Share/Clear disabled. | — |
| Diagnostics on, has events | Preview shows the last 6 redacted events; expand opens the full redacted log. | Copy, Share, Clear, Expand. |
| Listening history off | Only the tracking pill + its detail line are shown. | Tracking pill. |
| Listening history on | Open-History link + retention dropdown revealed. | Tracking pill, link, retention. |
| Offline | Preferences fully editable (local). Catalog refresh and Sync-now fail and surface their error/empty state; library data stays intact. | All local controls; network actions degrade. |

## Interactions

| Control / gesture | Precondition | Result | Side effects |
|---|---|---|---|
| Tap tab (Preferences/About/Upload/History) | — | Switches page | — |
| Swipe page horizontally | — | Switches page; tab strip follows | — |
| Tap Theme segment (System/Light/Dark) | — | Sets theme; app recolors live | Persists; pushes preference to cloud |
| Tap **Custom** (accent) | — | Opens accent picker overlay for the current appearance | Seeds picker with the current appearance's accent |
| Pick color in picker / enter hex / Apply | Hex valid | Applies accent to the current appearance; closes overlay | Persists; pushes to cloud |
| Enter invalid hex + Apply | Hex invalid | No-op (Apply disabled/greyed); error haptic; hex field refocused | — |
| Tap **Standard** (accent) | Custom accent set for this appearance | Resets that appearance back to the adaptive default | Persists; pushes to cloud |
| Toggle iCloud Sync on/off | — | Enables/disables sync for this device | On: pull+merge+push; off: stops syncing, keeps remote data |
| Tap **Sync now** | Sync on, not already syncing | Pull + merge + push cycle | Detail updates with result |
| Tap **iPhone Settings** | — | Opens OS iCloud settings | Leaves app |
| Tap **Backup** | — | Encodes a JSON settings backup and opens the OS share sheet | Local-only; history excluded |
| Tap **Restore** → Choose file | — | Confirmation alert → file importer → replaces favorites, lists, custom stations, and preferences from the backup | Result alert reports success/failure |
| Tap **Remove all iCloud data** → Remove | Sync on, not syncing | Confirmation alert → wipes the user's cloud snapshot via tombstone | Other devices honor the reset on next sync |
| Tap **Refresh** (catalog) | Not already refreshing | Re-fetches `stations.json` | Updates count/freshness or inline error line |
| Tap landing-page row (Browse / Favorites / Play a station) | — | Sets launch target | Persists; pushes to cloud |
| Tap the **Library** landing row | — | Sets landing to whatever the row's dropdown shows | Persists; pushes to cloud |
| Pick from the Library landing dropdown | — | Sets landing to Home, a station list, or Recents | Persists; pushes to cloud |
| Tap "Play a station" | — | Reveals station picker; pre-selects current/first preferred station | Persists choice; pushes to cloud |
| Type in landing-station search | Picker open | Filters station pool (debounced ~200 ms, off main thread); shows ≤8 matches | — |
| Tap "Use current station" | A station is playing, none picked yet | Pins the playing station as launch target | Persists; pushes to cloud |
| Tap a landing-station match | — | Pins that station; sets landing to "Play a station"; collapses the suggestion list | Persists; pushes to cloud |
| Tap a visible library-view row | Mode is visible | Sets it as the default display mode (DEFAULT badge) | Persists; pushes to cloud |
| Tap library-view ▲/▼ | Not at edge | Reorders the display mode | Persists order + visible set; pushes to cloud |
| Toggle library-view visibility | ≥1 mode stays visible | Shows/hides that mode in Library | Persists; pushes to cloud; may renormalize default mode |
| Change default wake time | — | Sets wake default | Persists; pushes to cloud |
| Toggle wake notification | — | Opt in/out of wake notification | Persists; pushes to cloud; may request OS permission |
| Tap notifications-denied warning | Permission denied | Opens OS Settings | Leaves app |
| Change default sleep duration | — | Sets sleep default via the hh:mm dial (clamped to ≥1 min) | Persists; pushes to cloud |
| Tap Car-mode segment (Auto/Always/Off) | — | Sets route-based / forced-on / off | Persists; pushes to cloud |
| Toggle a Music service | — | Shows/hides that service's Now Playing deep-link | Persists; pushes to cloud |
| Tap History segment (Off/Stations/+Tracks) | — | Enables/disables history and sets its level; reveals/hides sub-rows | Persists; pushes to cloud |
| Tap **Open History** | History on | Jumps to History tab | — |
| Pick from the Keep-history dropdown | History on | Sets 30d / 90d / 1y / Forever | Persists; pushes to cloud |
| Toggle AI station blurbs | iOS 26+ | Enables/disables AI blurbs | Persists; pushes to cloud |
| Pick from the Language dropdown | — | Sets language choice; UI re-renders | Persists; pushes to cloud |
| Toggle Collect Diagnostics | — | Enables/disables local diagnostics | Disable clears the local store immediately |
| Long-press recent-events preview → Copy | — | Copies the selected (already redacted) preview text | Matches the redacted export |
| Tap diagnostics **expand** corner button | — | Opens the full redacted log full-screen | — |
| Tap **Copy** (diagnostics) | On + events exist | Copies redacted export to clipboard | Button reads "Copied"; records a "copied" event |
| Tap **Share** (diagnostics) | On + events exist | Opens OS share sheet with redacted export | Records a "share opened" event |
| Tap **Clear** (diagnostics) | Events exist | Confirmation alert → empties the local diagnostics store | Resets Copy/Share state |
| System: audio route change | Automatic car mode on | Re-evaluates car-like route → toggles active state | Updates the detected-route flag |
| System: OS language change | Language choice = System | Recomputes resolved language; re-renders | Records a locale diagnostic note |
| System: remote cloud change | Sync on | Silent push wakes a pull+merge | Applies merged preferences live |

## Business rules

- **Theme** choices: `system` (default) · `light` · `dark`. Persisted as the
  choice token, re-applied on launch.
- **Accent** is per-appearance: a light side and a dark side, each either a
  normalized 6-digit hex (`#RRGGBB`) or the sentinel `classic`. Stored as one token
  when both sides match, otherwise a `light/dark` composite. Classic resolves to
  green `#00A040` in light and yellow `#FFFF00` in dark. Editing in light/dark mode
  changes only that appearance's side; Standard resets only that side. Legacy preset
  names (`blue`/`rose`/`violet`) migrate to hex; 3-digit hex expands to 6; invalid
  input is rejected.
- **Language** choices: `system` (default) · `en` · `de` · `fr` · `es` · `it` ·
  `ru`. Resolution collapses regional variants by prefix; unrecognized → `en`. Full
  rules in [localization](../contracts/localization.md).
- **Landing page** targets: Browse (default) · Library home · Favorites · a named
  station list · Recents · a pinned station. The Library home / station-list /
  Recents targets share one row whose dropdown picks among them. Station-list and
  pinned-station ids are stored separately; "Play a station" requires a resolvable
  station id.
- **Library views**: display modes are List / Tiles / App. At least one mode must
  stay visible; the default mode is renormalized to a visible mode when its current
  default is hidden. Order and visible-set are persisted as raw strings. The default
  mode is chosen by tapping a visible row in the same section.
- **Sleep default** is set with an `hh:mm` dial (any duration 0:01–23:59, clamped to
  a 1-minute floor), stored as minutes. **Wake default** time is `HH:mm` (24h
  stored). Both dials follow the device's 24-/12-hour setting where applicable. See
  [sleep-timer](sleep-timer.md) and [wake-to-radio](wake-to-radio.md) for the timers
  themselves.
- **Car mode** is active when manual is on, or when automatic is on and a car-like
  audio route is detected (CarPlay/`carAudio` port, or a Bluetooth/USB output whose
  name matches a known car/brand hint). Automatic defaults **on**; manual **off**.
  Surfaced as one tri-state control: Auto (automatic on) · Always (manual on) · Off.
- **Music services**: each registered service has an offered/hidden toggle; all
  three ship default **on**. A new registry service automatically gets a toggle.
- **Listening history** is **off by default**, level defaults to Stations-only,
  retention defaults to 90 days. Track-level granularity stores artist/title only
  when the station publishes them. The enabled/level/retention preferences sync, and
  closed history sessions **sync** across the user's devices as an additive union;
  the active/open session is never uploaded.
- **Diagnostics** are **off by default**. Cap: **100 events / 14 days**, pruned
  oldest-first. Per-detail value capped at **120 chars**; URLs reduced to host at
  write time. MetricKit crash/hang **reports** are captured separately (cap **6**,
  body ≤ **6000 chars**): they leave a one-line breadcrumb in the event stream and
  append their verbatim call stack to the export. Export prepends app version, device
  model/OS, locale, collection state, then redacted events, then any reports.
  Disabling **immediately clears** both stores. The recent-events preview shows the
  last **6** events, redacted (so selecting/copying it matches the export); an expand
  button opens the full redacted log.
- **Catalog refresh** re-fetches `https://rrradio.org/stations.json`; the catalog
  also loads on launch and is checked occasionally when the app becomes active. A
  failed refresh keeps any cached stations on screen and surfaces an inline error
  line; the last successful sync time is shown.
- **Settings backup** (iOS) writes/reads a local JSON file (share sheet / file
  importer) of favorites, station lists, custom stations, and preferences. It works
  with iCloud sync off and **excludes** listening history; restoring replaces those
  categories with the backup's contents.
- **Synced preferences** (iOS): theme, accent (per-appearance), locale, sleep
  default, landing page (+ station/list ids), favorites display mode/order/visible,
  wake default time, wake-notifications, wake keep-alive, car-mode auto/manual,
  listening-history enabled/level/retention (and closed listening-history records),
  the three music-service toggles, and AI blurbs. **Not synced**: recents,
  diagnostics, the active/open listening session, active wake intent. Authoritative
  field list and merge rule in [sync-merge](../contracts/sync-merge.md).

## Data dependencies

- [localization](../contracts/localization.md) — language choice, resolution,
  fallback, plural algebra, and the rule that every visible string flows through
  the key registry.
- [privacy-data-boundaries](../contracts/privacy-data-boundaries.md) — the
  diagnostics opt-in/cap/redaction rules, the "no analytics SDK / no account"
  invariant, and the outbound-call matrix (catalog refresh, broken-station report,
  CloudKit row).
- [sync-merge](../contracts/sync-merge.md) — which preferences sync, the
  `Preferences` record schema, the merge algebra, and the remove-all tombstone.

## Edge cases

- **iCloud unavailable / signed out / simulator build.** Sync ends `unavailable`;
  all preferences stay editable locally; no feature blocks on cloud.
- **Sync disabled mid-edit.** Local writes persist immediately; cross-device
  propagation simply stops; existing remote data is preserved for other devices.
- **Concurrent sync requests.** Coalesced; a pending pull/push/reset re-fires once
  the running cycle finishes (see [sync-merge](../contracts/sync-merge.md)).
- **Pending-preferences flag.** A queued local preference edit makes *all* local
  preference fields authoritative on the next merge (binary flag — see Known
  deviations C7).
- **Catalog refresh failure.** Cached stations stay on screen; the failure surfaces
  as an inline error line (the count detail can still read the stale total alongside
  it — deviation ST7).
- **Invalid hex entry.** The picker's Apply control is disabled/greyed; tapping it
  fires an error haptic and refocuses the hex field; no accent change is committed.
- **Wake-notification permission denied.** A warning row appears linking to OS
  Settings; the toggle reflects the denied state.
- **Diagnostics disabled.** `record(…)` becomes a no-op, both the event and report
  stores are removed, and export reports "collection off".
- **MetricKit report captured.** A crash/hang report adds a one-line breadcrumb to
  the events and stores the verbatim call stack (≤6000 chars) in a separate
  6-deep store; the call stack is exported verbatim (no host/URL redaction) since it
  carries only the user's own app frames.
- **Settings backup restore.** Reads a security-scoped file; a malformed or
  incompatible file fails with a "Backup failed" alert and no data change; a valid
  file replaces favorites, lists, custom stations, and preferences and reports the
  restored counts.
- **Huge landing-station search.** The pool includes the full catalog (~17k); the
  filter is debounced and run off the main thread, displaying ≤8 rows (historical
  main-thread/no-debounce shape flagged in ST2; current code debounces ~200 ms and
  detaches the work).
- **Backgrounding during sync.** Sync is best-effort; a silent remote-change push
  re-triggers a pull when the app next runs.
- **AI blurbs / Apple Intelligence section** is absent below iOS 26.

## Accessibility

- Theme, Color, Car-mode, and History segments expose label + selected/not-selected
  value + `isSelected` trait.
- Accent-picker Apply/Cancel carry explicit labels; the picker (Apple's system color
  picker) disables alpha and the eyedropper (iOS 26+).
- Landing rows show a checkmark for the active choice; the row is the tap target. The
  Library landing, language, and retention dropdowns expose an accessibility label +
  value (the current selection).
- Library-view rows expose the default choice as a label + selected value +
  `isSelected` trait; the per-mode visibility toggle reads only its pill state and
  lacks a spoken "what is toggled" context outside the visual row (gap ST16).
- The diagnostics expand button carries an explicit "Expand diagnostics log" label.
- Dynamic Type: segment labels shrink (min scale ~0.82); detail/title text uses
  fixed point sizes — large accessibility sizes can truncate multi-line detail copy
  (lineLimit caps of 2–8).
- Destructive **Remove all iCloud data** uses the system destructive role (red);
  the confirmation alert is the irreversible cross-device wipe gate.

## Localization

This surface owns its section titles and row copy: Theme/Color/iCloud Sync/Catalog/
Landing page/Library views/Timer defaults/Car mode/Music services/Listening History/
Apple Intelligence/Language/Diagnostics, plus all cloud-sync state sentences, catalog
state messages, the diagnostics labels (Collect/Copy/Copied/Share/Clear), accent
labels (Standard/Custom), the Remove-iCloud alert title/message/buttons, and the four
tab titles, plus the
settings-backup copy (Backup/Restore buttons, restore-confirm + result alerts) and
the diagnostics expand label. Language menu display names
(System/English/Deutsch/Français/Español/Italiano/Русский) are intentionally
self-localized. Count-bearing copy (favorites/lists/stations/retention) needs plural
keys, not hand-rolled `1 ? "x" : "xs"` strings. Many of these strings still ship raw
English (deviation ST4–ST6). Full rules and the registry in
[localization](../contracts/localization.md).

## Platform Matrix

### Preferences

| Preference | Web | iOS | Android |
|---|---|---|---|
| Theme | Supported; a three-way **System / Light / Dark** segmented control in the web Settings sheet (unset choice = follow the OS `prefers-color-scheme`). | Reference. | Supported for system/light/dark in a native Preferences sheet. |
| Accent color | Not planned; the web palette accent is a fixed design-system value (yellow dark / green light, matching `RrradioTheme`), not a user preference. | Supported. | Partial; native preset accent palette exists, custom color entry remains deferred. |
| Language | Not planned; the web UI ships English-only with no language switcher. | Supported. | Planned after localization scope. |
| Landing page | Partial; a **Browse / Favorites / Recents** launch-target control in the web Settings sheet (no Library-home, station-list, or pinned-station targets, and an inbound `?q=` search or station deep-link still wins). | Supported. | Supported for Lists, Browse, and Favorites startup targets. |
| Favorites display modes | Partial. | Reference. | Partial; the three modes (List/Tiles/App) and the chosen-mode persistence exist, but the per-mode reorder and show/hide controls remain. |
| Sleep default | Not planned; the web sleep timer cycles fixed durations with no default preference. | Supported. | Supported for the first sleep-timer tap. |
| Wake default/notifications | Partial; web remembers the last-used wake time but exposes no default-time or notification preference. | Supported. | Planned with the wake feature (no wake UI yet; would use AlarmManager exact-alarm + a foreground service as the CarPlay-less analogue to the iOS wake intent). |
| Music-service deep-link toggles | Supported; per-service **Apple Music / Spotify / YouTube Music** toggles in the web Settings sheet gate which Now Playing open-in deep-links are offered (all default on). | Supported (per-service offered/hidden). | Planned; no music-service deep-links or per-service toggles are built yet. |
| AI station blurbs | Not planned. | Supported on iOS 26+. | Planned toward parity; no on-device blurb generation yet (the iOS Apple-Intelligence path would map to an Android on-device GenAI mechanic). |
| Catalog manual refresh | Not planned; the web catalog loads from `stations.json` on every launch (no persistent cache to refresh), so a manual-refresh control is unnecessary. | Supported. | Supported. |

**Web Settings sheet.** The web app's settings-gear (top toolbar) opens a Settings
sheet carrying the web-applicable subset of the above: **Theme**
(System/Light/Dark), **Landing page** (Browse/Favorites/Recents), **Music
services** (the three per-service deep-link toggles), **Your data** (add custom
station + favorites/custom backup & restore — the JSON export/import covered in the
Cloud-sync table below), and **About** (About / Privacy / Listener stats). iCloud
sync, accent, language, library views, timer defaults, car mode, listening history,
Apple Intelligence, and local diagnostics are intentionally absent from the web
settings (see the per-row statuses above and the tables below).

### Listening History

| Behavior | Web | iOS | Android |
|---|---|---|---|
| Station history | Not planned; web keeps only a recents list, not an opt-in listening-history surface. | Supported as opt-in listening history. | Supported as local opt-in history. |
| Track-level history | Not planned for current web. | Supported only when user selects it. | Partial; the "Stations and tracks" opt-in level and the artist/title record fields exist, but no track metadata is recorded into history yet. |
| Retention controls | Not planned; web has no listening-history store to retain or prune. | Supported (30d/90d/1y/Forever; default 90d). | Planned; history is bounded only by a fixed 100-entry cap, with no time-based retention preference yet. |
| Sync | Not planned. | Supported (closed sessions union across devices via iCloud). | Not planned. |

### Diagnostics

| Behavior | Web | iOS | Android |
|---|---|---|---|
| Anonymous aggregate telemetry | Supported through GoatCounter (events + privacy-preserving `error: <category>` reports). | Not the native support surface. | Not planned for first port. |
| Local diagnostics | Not planned; web has no on-device opt-in diagnostics store or viewer. | Supported, opt-in, capped, exportable, with full-log viewer. | Supported, opt-in (default off), capped (200 events), URL-redacted at write time, and exported as JSON via the Storage Access Framework (SAF). No in-app full-log viewer yet (the sheet shows a count + Clear). |
| MetricKit crash/hang reports | Not applicable. | Supported (capped, call stack exported verbatim). | Planned toward parity; no crash/hang capture is built yet (MetricKit is iOS-only; an Android uncaught-exception/ANR handler would be the analogue). |
| Redacted export / clear-on-disable | Not applicable; web has no local diagnostics store to export or clear (telemetry is fire-and-forget). | Supported (preview also redacted). | Partial; the export is URL-redacted, but disabling diagnostics does **not** clear the local store — only the explicit Clear action wipes it (diverges from the iOS clear-on-disable rule). |
| Broken-station report | Supported (manual report POSTed to the shared anonymous endpoint). | Supported where implemented. | Supported through the shared anonymous report endpoint. |

### Cloud sync & car mode

| Behavior | Web | iOS | Android |
|---|---|---|---|
| iCloud/CloudKit library+preferences sync | Not planned. | Supported (own private DB). | Not applicable. |
| Sync status / Sync now / Remove all | Not applicable. | Supported. | Not applicable. |
| Local settings backup file (export/import) | Partial; web exports/imports a JSON backup of favorites and custom stations only (no preferences, no history; import merges, never wipes). | Supported (JSON; works with sync off; excludes history). | Supported via SAF (export/import a JSON backup of favorites, custom stations, lists, and preferences; excludes listening-history records). Unlike the iOS restore, the Android import **merges** into existing data rather than replacing it. |
| Car mode preferences | Not planned; web has no car-mode preference (CarPlay/Bluetooth control is media-session passthrough, not a setting). | Supported (tri-state: auto route detect / always / off). | Planned; no car-mode preference and no Android Auto MediaBrowserService integration exist yet. Media-session controls already reach car head units over Bluetooth; full Android Auto support (the CarPlay analogue) is the parity target. |

## Open questions

- **C7 — binary pending-preferences flag.** One queued preference edit makes every
  local preference field authoritative on the next merge; per-field dirty-tracking
  is proposed. See [sync-merge](../contracts/sync-merge.md) Open questions.
- **Device-local vs synced clarity.** No preference is silently device-local now,
  and closed listening-history sessions sync too; confirm this is the intended end
  state versus an explicit "(this device)" affordance, given the History UI still
  frames history as "stays on this device."
- **Catalog-refresh error surfacing.** Whether a failed refresh should raise an
  explicit toast rather than only an inline line that a stale count can mask (ST7).

## Reference

- `rrradio/Views/SettingsView.swift` — the Settings sheet, all preference sections,
  cloud-sync/backup/catalog/diagnostics blocks, accent-picker overlay, the
  Library/language/retention dropdowns, the tri-state car-mode/history controls, the
  landing-station picker, and the full-screen diagnostics-log viewer.
- `rrradio/Views/ThemeController.swift` — theme choice + per-appearance accent
  (light/dark side tokens, composite storage), classic-accent resolution,
  legacy-preset migration, hex parsing.
- `rrradio/Views/LocaleController.swift` — language choice (incl. it/ru), resolution,
  the `L10nKey`/`L10nPluralKey` registries and `L10n` lookup engine.
- `rrradio/Views/LandingPreference.swift` — `LandingPage` enum + storage keys.
- `rrradio/Player/CarModeController.swift` — auto/manual car mode, route detection,
  car-like-output heuristics.
- `rrradio/Library/ListeningHistory.swift` — enabled/level/retention, record store,
  retention pruning, and `syncableRecords()` / `mergeSyncedRecords()` for the
  cross-device record union.
- `rrradio/CloudSync/CloudSyncController.swift`, `CloudSyncSnapshot.swift`,
  `SettingsBackup.swift` — the synced-preferences snapshot, merge wiring, and the
  local settings-backup encode/restore.
- `rrradio/Diagnostics.swift` — local ring buffer (100/14d) plus a separate MetricKit
  report store (6 / 6000 chars), write-time host reduction, redacted export with
  sensitive-key allow-list, share/copy draft, and `BrokenStationReporter`.

## Known deviations

- **ST1 — music-service + AI-blurbs toggles did not sync (RESOLVED).** Four
  `@AppStorage` toggles wrote locally with no cloud push and were absent from the
  sync snapshot. Now wired through a cloud-synced binding and present in the
  `Preferences` record. Historical finding:
  `rrradio-ios/internal/audit/2026-05-25-ios-code-review-slice25.md` (ST1).
- **ST3 / D3 — diagnostics preview text-selection bypassed redaction (RESOLVED).**
  The on-screen recent-events preview is still selectable, but it now renders the
  redacted variant, so anything copied out of it matches the redacted export — the
  contract intent. Historical findings:
  `rrradio-ios/internal/audit/2026-05-25-ios-code-review-slice20.md` (D3),
  `…-slice25.md` (ST3); also referenced in
  [privacy-data-boundaries](../contracts/privacy-data-boundaries.md) Known deviations.
- **ST4–ST6 / LC3 — untranslated Settings strings + hand-rolled plurals.** ~50
  Settings strings ship raw English even where keys exist (section titles, all
  cloud-sync state sentences, catalog state messages, the diagnostics labels, the
  "Default Library view" title, "Sync library and settings with iCloud", "iPhone
  Settings", "Open Listening dashboard", the Remove-iCloud alert + button), and the
  cloud-sync summary / station-list-count / retention copy hand-roll English
  plurals. `rrradio-ios/internal/audit/2026-05-25-ios-code-review-slice25.md`
  (ST4–ST6), `…-slice26.md` (LC3); cross-referenced in
  [localization](../contracts/localization.md) Known deviations.
- **ST7 — catalog refresh errors could go stale (partially mitigated).** A failed
  refresh now keeps cached stations on screen and surfaces a dedicated inline error
  line (`lastRefreshError`), but the count detail can still read a stale "N stations
  loaded" alongside it rather than an explicit error toast.
  `rrradio-ios/internal/audit/2026-05-25-ios-code-review-slice25.md` (ST7).
- **ST2 — landing-station search filtered ~17k catalog on the main thread (largely
  mitigated).** Original finding had no debounce and ran on the main thread; current
  code debounces ~200 ms and detaches the filter.
  `rrradio-ios/internal/audit/2026-05-25-ios-code-review-slice25.md` (ST2).
- **ST10 / ST16 — accent Apply on invalid hex; labeled-but-empty visibility toggle
  lacks VoiceOver context.** On invalid hex the Apply control is disabled/greyed and
  tapping it fires an error haptic + refocuses the field, but there is no inline
  textual hint near the control. The library-view visibility toggle still reads only
  its pill state.
  `rrradio-ios/internal/audit/2026-05-25-ios-code-review-slice25.md` (ST10, ST16).
- **C7 — binary pending-preferences flag locks all preferences on merge.**
  `rrradio-ios/internal/audit/2026-05-25-ios-code-review-slice10.md` (C7); see
  [sync-merge](../contracts/sync-merge.md) Known deviations.
