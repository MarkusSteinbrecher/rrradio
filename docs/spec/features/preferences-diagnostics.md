# Preferences And Diagnostics Specification

```yaml
status: draft
platforms: [web, ios, android]
reconciled-against: 9336321
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
- The **Open Listening dashboard** row inside Listening History jumps to the
  History tab.
- A denied-wake-notification warning row deep-links to the OS Settings app.
- The cloud-sync **iPhone Settings** button deep-links to the OS iCloud settings.

## Layout

Settings sheet, top to bottom:

- **Sheet header** — title "Settings", dismiss control.
- **Tab strip** — Preferences · About · Upload · History (uppercase, mono).
- **Preferences page** (scrolling), sections in order:
  1. **Theme** — three-way segmented pill: System · Light · Dark (icon + label).
  2. **Color** — accent row (palette icon, current hex or "Classic", color swatch,
     chevron → picker sheet) and a **Standard** reset row (checkmark when no custom
     accent; disabled when already standard).
  3. **iCloud Sync** — master sync toggle ("Sync library and settings with iCloud")
     with a live status detail line; **Sync now** + **iPhone Settings** buttons;
     destructive **Remove all iCloud data** row. *(iOS only.)*
  4. **Catalog** — station-catalog row (count + freshness detail), optional inline
     refresh-error line, **Refresh** button.
  5. **Landing page** — radio list of launch targets: Browse, Library, Favorites,
     each user station list, Recents, Play a station. Selecting "Play a station"
     reveals a station picker (use-current shortcut, search field, up to 8 matches).
  6. **Library views** — per-display-mode rows (List / Tiles / App) with up/down
     reorder buttons and a show/hide toggle each.
  7. **Default Library view** — radio list over the currently visible display modes.
  8. **Timer defaults** — default wake time (time picker), wake-notification toggle,
     optional notifications-denied warning row, default sleep duration (picker).
  9. **Car mode** — Automatic car mode toggle (shows current audio route), Manual
     car mode toggle (shows active/inactive). *(iOS.)*
  10. **Music services** — one toggle per registered service (Apple Music, Spotify,
      YouTube Music) controlling whether its Now Playing deep-link is offered.
  11. **Listening History** — tracking toggle; when on: dashboard link, granularity
      rows (Stations only / Stations + tracks), retention rows (30 days / 90 days /
      1 year / Forever).
  12. **Apple Intelligence** — AI station-blurbs toggle. *(iOS 26+ only.)*
  13. **Language** — radio list: System, English, Deutsch, Français, Español.
  14. **Diagnostics** — Collect-Diagnostics toggle, redacted recent-events preview,
      Copy / Share / Clear buttons.
- **About page** — app/privacy disclosure copy and links (owned by `about` surface).
- **Upload page** — Add Station (owned by [custom-stations](custom-stations.md)).
- **History page** — Listening dashboard (owned by [favorites](favorites.md) /
  listening-history surface).

## States

| State | What shows | Actionable |
|---|---|---|
| Loaded (default) | All preference sections rendered with current values; each selection shows a checkmark / filled control. | Every control. |
| Catalog idle/loaded | Detail: "N stations loaded. The app checks for updates occasionally." | Refresh. |
| Catalog loading / refreshing | Detail: "Refreshing station list…" / "Loading station list…"; Refresh button disabled. | — |
| Catalog failed | Inline error line ("Could not refresh: …") + Refresh button. | Refresh (retry). |
| Cloud sync off | Detail: "Off for this device. Existing iCloud data is kept for other devices."; Sync-now and Remove rows disabled. | Enable toggle. |
| Cloud sync checking | Detail: "Checking iCloud availability…". | Toggle (best effort). |
| Cloud sync available / synced / restored / pushed | Detail names the merged counts + last-sync time. | Sync now, Remove, toggle off. |
| Cloud sync unavailable | Detail carries the sanitized reason; toggle locked on when enabled-but-unavailable. | iPhone Settings. |
| Cloud sync removed / reset applied | Detail confirms removal/reset. | — |
| Diagnostics off | Preview: "Diagnostics collection is off."; Copy/Share disabled. | Enable toggle. |
| Diagnostics on, empty | Preview: "No diagnostic events yet."; Copy/Share/Clear disabled. | — |
| Diagnostics on, has events | Preview shows the last 6 redacted events. | Copy, Share, Clear. |
| Listening history off | Only the tracking toggle is shown. | Enable toggle. |
| Listening history on | Dashboard link + granularity + retention rows revealed. | All rows. |
| Offline | Preferences fully editable (local). Catalog refresh and Sync-now fail and surface their error/empty state; library data stays intact. | All local controls; network actions degrade. |

## Interactions

| Control / gesture | Precondition | Result | Side effects |
|---|---|---|---|
| Tap tab (Preferences/About/Upload/History) | — | Switches page | — |
| Swipe page horizontally | — | Switches page; tab strip follows | — |
| Tap Theme segment (System/Light/Dark) | — | Sets theme; app recolors live | Persists; pushes preference to cloud |
| Tap accent row | — | Opens accent picker sheet | Seeds picker with current accent |
| Pick color in picker / type hex / Accept | Hex valid | Applies accent; closes sheet | Persists; pushes to cloud |
| Type invalid hex + Accept | Hex invalid | No-op (accept blocked); error haptic; hex field refocused | Inline "Use #RRGGBB" hint shown |
| Tap Standard (reset accent) | Custom accent set | Resets to classic accent | Persists; pushes to cloud |
| Toggle iCloud Sync on/off | — | Enables/disables sync for this device | On: pull+merge+push; off: stops syncing, keeps remote data |
| Tap **Sync now** | Sync on, not already syncing | Pull + merge + push cycle | Detail updates with result |
| Tap **iPhone Settings** | — | Opens OS iCloud settings | Leaves app |
| Tap **Remove all iCloud data** → Remove | Sync on, not syncing | Confirmation alert → wipes the user's cloud snapshot via tombstone | Other devices honor the reset on next sync |
| Tap **Refresh** (catalog) | Not already refreshing | Re-fetches `stations.json` | Updates count/freshness or error line |
| Tap landing-page row | — | Sets launch target | Persists; pushes to cloud |
| Tap "Play a station" | — | Reveals station picker; pre-selects current/first preferred station | Persists choice; pushes to cloud |
| Type in landing-station search | Picker open | Filters station pool (debounced ~200 ms, off main thread); shows ≤8 matches | — |
| Tap "Use current station" | A station is playing | Pins the playing station as launch target | Persists; pushes to cloud |
| Tap a landing-station match | — | Pins that station; sets landing to "Play a station" | Persists; pushes to cloud |
| Tap library-view ▲/▼ | Not at edge | Reorders the display mode | Persists order + visible set; pushes to cloud |
| Toggle library-view visibility | ≥1 mode stays visible | Shows/hides that mode in Library | Persists; pushes to cloud; may renormalize default mode |
| Tap Default-Library-view row | Mode is visible | Sets the default display mode | Persists; pushes to cloud |
| Change default wake time | — | Sets wake default | Persists; pushes to cloud |
| Toggle wake notification | — | Opt in/out of wake notification | Persists; pushes to cloud; may request OS permission |
| Tap notifications-denied warning | Permission denied | Opens OS Settings | Leaves app |
| Change default sleep duration | — | Sets sleep default (from the timer cycle set) | Persists; pushes to cloud |
| Toggle Automatic car mode | — | Enables/disables route-based car mode | Persists; pushes to cloud |
| Toggle Manual car mode | — | Forces car mode on/off | Persists; pushes to cloud |
| Toggle a Music service | — | Shows/hides that service's Now Playing deep-link | Persists; pushes to cloud |
| Toggle Listening-history tracking | — | Enables/disables local history; reveals/hides sub-rows | Persists; pushes to cloud |
| Tap **Open Listening dashboard** | History on | Jumps to History tab | — |
| Tap granularity row | History on | Sets Stations-only or Stations+tracks | Persists; pushes to cloud |
| Tap retention row | History on | Sets 30d / 90d / 1y / Forever | Persists; pushes to cloud |
| Toggle AI station blurbs | iOS 26+ | Enables/disables AI blurbs | Persists; pushes to cloud |
| Tap language row | — | Sets language choice; UI re-renders | Persists; pushes to cloud |
| Toggle Collect Diagnostics | — | Enables/disables local diagnostics | Disable clears the local store immediately |
| Long-press recent-events preview → Copy | — | Copies the selected (redacted) preview text | See deviation D3/ST3 |
| Tap **Copy** (diagnostics) | On + events exist | Copies redacted export to clipboard | Button reads "Copied"; records a "copied" event |
| Tap **Share** (diagnostics) | On + events exist | Opens OS share sheet with redacted export | Records a "share opened" event |
| Tap **Clear** (diagnostics) | Events exist | Empties the local diagnostics store | Resets Copy/Share state |
| System: audio route change | Automatic car mode on | Re-evaluates car-like route → toggles active state | Updates route label |
| System: OS language change | Language choice = System | Recomputes resolved language; re-renders | Records a locale diagnostic note |
| System: remote cloud change | Sync on | Silent push wakes a pull+merge | Applies merged preferences live |

## Business rules

- **Theme** choices: `system` (default) · `light` · `dark`. Persisted as the
  choice token, re-applied on launch.
- **Accent** stored as a normalized 6-digit hex (`#RRGGBB`) or the sentinel
  `classic`. Classic resolves dynamically: yellow `#FFFF00` in dark, green
  `#00A040` in light. Legacy preset names (`blue`/`rose`/`violet`) migrate to hex.
  3-digit hex expands to 6; invalid input is rejected.
- **Language** choices: `system` (default) · `en` · `de` · `fr` · `es`. Resolution
  collapses regional variants by prefix; unrecognized → `en`. Full rules in
  [localization](../contracts/localization.md).
- **Landing page** targets: Browse (default) · Library · Favorites · a named
  station list · Recents · a pinned station. Station-list and pinned-station ids
  are stored separately; "Play a station" requires a resolvable station id.
- **Library views**: display modes are List / Tiles / App. At least one mode must
  stay visible; the default mode is renormalized to a visible mode when its
  current default is hidden. Order and visible-set are persisted as raw strings.
- **Sleep default** is chosen from the timer's positive cycle minutes. **Wake
  default** time is `HH:mm` (24h stored). See [sleep-timer](sleep-timer.md) and
  [wake-to-radio](wake-to-radio.md) for the timers themselves.
- **Car mode** is active when manual is on, or when automatic is on and a car-like
  audio route is detected (CarPlay/`carAudio` port, or a Bluetooth/USB output whose
  name matches a known car/brand hint). Automatic defaults **on**; manual **off**.
- **Music services**: each registered service has an offered/hidden toggle; all
  three ship default **on**. A new registry service automatically gets a toggle.
- **Listening history** is **off by default**, granularity defaults to
  Stations-only, retention defaults to 90 days. Track-level granularity stores
  artist/title only when the station publishes them. History never syncs.
- **Diagnostics** are **off by default**. Cap: **100 events / 14 days**, pruned
  oldest-first. Per-detail value capped at **120 chars**; URLs reduced to host at
  write time. Export prepends app version, device model/OS, locale, collection
  state, then redacted events. Disabling **immediately clears** the store. The
  recent-events preview shows the last **6** events.
- **Catalog refresh** re-fetches `https://rrradio.org/stations.json`; the catalog
  also loads on launch and is checked occasionally when the app becomes active.
- **Synced preferences** (iOS): theme, accent, locale, sleep default, landing page
  (+ station/list ids), favorites display mode/order/visible, wake default time,
  wake-notifications, wake keep-alive, car-mode auto/manual, listening-history
  enabled/level/retention, the three music-service toggles, and AI blurbs.
  **Not synced**: recents, listening-history records, diagnostics, active wake
  intent. Authoritative field list and merge rule in
  [sync-merge](../contracts/sync-merge.md).

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
- **Catalog refresh failure.** Surfaces as an inline error line; the "Refreshing"
  label can flip back to a stale count without an explicit error toast (deviation
  ST7).
- **Invalid hex entry.** Accept is blocked with an error haptic and inline hint;
  no accent change is committed.
- **Wake-notification permission denied.** A warning row appears linking to OS
  Settings; the toggle reflects the denied state.
- **Diagnostics disabled.** `record(…)` becomes a no-op, the store is removed, and
  export reports "collection off".
- **Huge landing-station search.** The pool includes the full catalog (~17k); the
  filter is debounced and run off the main thread, displaying ≤8 rows (historical
  main-thread/no-debounce shape flagged in ST2; current code debounces ~200 ms and
  detaches the work).
- **Backgrounding during sync.** Sync is best-effort; a silent remote-change push
  re-triggers a pull when the app next runs.
- **AI blurbs / Apple Intelligence section** is absent below iOS 26.

## Accessibility

- Theme segments expose label + selected/not-selected value + `isSelected` trait.
- Accent-picker Accept/Cancel carry explicit labels; the picker disables alpha and
  the eyedropper (iOS 26+).
- Radio rows (landing, language, granularity, retention, default view) show a
  checkmark for the active choice; the row is the tap target.
- Library-view visibility toggles read only their pill state and lack a spoken
  "what is toggled" context outside the visual row (gap ST16).
- Dynamic Type: theme-segment labels shrink (min scale ~0.82); detail/title text
  uses fixed point sizes — large accessibility sizes can truncate multi-line
  detail copy (lineLimit caps of 2–8).
- Destructive **Remove all iCloud data** uses the system destructive role (red);
  the confirmation alert is the irreversible cross-device wipe gate.

## Localization

This surface owns its section titles and row copy: Theme/Color/iCloud Sync/Catalog/
Landing page/Library views/Default Library view/Timer defaults/Car mode/Music
services/Listening History/Apple Intelligence/Language/Diagnostics, plus all
cloud-sync state sentences, catalog state messages, the diagnostics labels
(Collect/Copy/Copied/Share/Clear), accent labels (Accent/Classic/Standard/Hex),
the Remove-iCloud alert title/message/buttons, and the four tab titles. Language
row display names (System/English/Deutsch/Français/Español) are intentionally
self-localized. Count-bearing copy (favorites/lists/stations/retention) needs
plural keys, not hand-rolled `1 ? "x" : "xs"` strings. Full rules and the registry
in [localization](../contracts/localization.md).

## Platform Matrix

### Preferences

| Preference | Web | iOS | Android |
|---|---|---|---|
| Theme | Supported. | Reference. | Supported for system/light/dark in a native Preferences sheet. |
| Accent color | Supported/partial by web theme design. | Supported. | Partial; native preset accent palette exists, custom color entry remains deferred. |
| Language | Browser/content dependent. | Supported. | Planned after localization scope. |
| Landing page | Not a primary web contract. | Supported. | Supported for Lists, Browse, and Favorites startup targets. |
| Favorites display modes | Partial. | Reference. | Partial; modes exist, preference persistence/order controls remain. |
| Sleep default | Supported where exposed. | Supported. | Supported for the first sleep-timer tap. |
| Wake default/notifications | Supported where exposed. | Supported. | Planned with wake feature. |
| Music-service deep-link toggles | Partial; web shows service links per design. | Supported (per-service offered/hidden). | Partial; deep-link set TBD. |
| AI station blurbs | Not planned. | Supported on iOS 26+. | Not planned for first port. |
| Catalog manual refresh | Supported (reload). | Supported. | Supported. |

### Listening History

| Behavior | Web | iOS | Android |
|---|---|---|---|
| Station history | Not part of current web contract beyond recents. | Supported as opt-in listening history. | Supported as local opt-in history. |
| Track-level history | Not planned for current web. | Supported only when user selects it. | Gated behind explicit opt-in; metadata-recording expansion remains future polish. |
| Retention controls | Supported where exposed. | Supported (30d/90d/1y/Forever; default 90d). | Partial; bounded default, controls TBD. |
| Sync | Not planned. | Not synced. | Not planned. |

### Diagnostics

| Behavior | Web | iOS | Android |
|---|---|---|---|
| Anonymous aggregate telemetry | Supported through GoatCounter. | Not the native support surface. | Not planned for first port. |
| Local diagnostics | Not primary web contract. | Supported, opt-in, capped, exportable. | Supported, opt-in, capped, exportable. |
| Redacted export / clear-on-disable | Supported where exposed. | Supported. | Supported. |
| Broken-station report | Supported. | Supported where implemented. | Supported through the shared anonymous report endpoint. |

### Cloud sync & car mode

| Behavior | Web | iOS | Android |
|---|---|---|---|
| iCloud/CloudKit library+preferences sync | Not planned. | Supported (own private DB). | Not applicable. |
| Sync status / Sync now / Remove all | Not applicable. | Supported. | Not applicable. |
| Car mode preferences | Browser/OS dependent. | Supported (auto route detect + manual). | Partial media controls; Android Auto TBD. |

## Open questions

- **C7 — binary pending-preferences flag.** One queued preference edit makes every
  local preference field authoritative on the next merge; per-field dirty-tracking
  is proposed. See [sync-merge](../contracts/sync-merge.md) Open questions.
- **Device-local vs synced clarity.** Now that the music-service and AI-blurbs
  toggles do sync, no preference is silently device-local; confirm this is the
  intended end state versus an explicit "(this device)" affordance for any future
  device-local toggle.
- **Catalog-refresh error surfacing.** Whether a failed refresh should raise an
  explicit toast rather than only an inline line that a stale count can mask (ST7).

## Reference

- `rrradio/Views/SettingsView.swift` — the Settings sheet, all preference sections,
  cloud-sync/catalog/diagnostics blocks, accent picker, landing-station picker.
- `rrradio/Views/ThemeController.swift` — theme choice + accent normalization,
  classic-accent resolution, legacy-preset migration, hex parsing.
- `rrradio/Views/LocaleController.swift` — language choice, resolution, the
  `L10nKey`/`L10nPluralKey` registries and `L10n` lookup engine.
- `rrradio/Views/LandingPreference.swift` — `LandingPage` enum + storage keys.
- `rrradio/Player/CarModeController.swift` — auto/manual car mode, route detection,
  car-like-output heuristics.
- `rrradio/Diagnostics.swift` — local ring buffer (100/14d), write-time host
  reduction, redacted export with sensitive-key allow-list, share/copy draft, and
  `BrokenStationReporter`.

## Known deviations

- **ST1 — music-service + AI-blurbs toggles did not sync (RESOLVED).** Four
  `@AppStorage` toggles wrote locally with no cloud push and were absent from the
  sync snapshot. Now wired through a cloud-synced binding and present in the
  `Preferences` record. Historical finding:
  `rrradio-ios/internal/audit/2026-05-25-ios-code-review-slice25.md` (ST1).
- **ST3 / D3 — diagnostics preview text-selection bypasses redaction.** The
  on-screen recent-events preview is selectable; the contract intent is that
  anything copyable matches the redacted export.
  `rrradio-ios/internal/audit/2026-05-25-ios-code-review-slice20.md` (D3),
  `…-slice25.md` (ST3); also flagged in
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
- **ST7 — catalog refresh errors silently disappear.** A failed refresh can flip
  back to a stale "N stations loaded" without an explicit error indication.
  `rrradio-ios/internal/audit/2026-05-25-ios-code-review-slice25.md` (ST7).
- **ST2 — landing-station search filtered ~17k catalog on the main thread (largely
  mitigated).** Original finding had no debounce and ran on the main thread; current
  code debounces ~200 ms and detaches the filter.
  `rrradio-ios/internal/audit/2026-05-25-ios-code-review-slice25.md` (ST2).
- **ST10 / ST16 — accent-accept silent no-op on invalid hex; labeled-but-empty
  visibility toggle lacks VoiceOver context.**
  `rrradio-ios/internal/audit/2026-05-25-ios-code-review-slice25.md` (ST10, ST16).
- **C7 — binary pending-preferences flag locks all preferences on merge.**
  `rrradio-ios/internal/audit/2026-05-25-ios-code-review-slice10.md` (C7); see
  [sync-merge](../contracts/sync-merge.md) Known deviations.
