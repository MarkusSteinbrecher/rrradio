# Custom Stations Specification

```yaml
status: draft
platforms: [web, ios, android]
reconciled-against: 9336321
```

## Purpose

Custom stations let a user add a private internet-radio stream that is not in
the published catalog. The user pastes a stream URL, gives it a name, the app
verifies the stream is reachable and audio-like, and on save the station joins
the user's library (auto-favorited) like any catalog station — playable,
displayed, and editable. Custom stations are private user-entered data; their
URLs never leave the device except via the user's own iCloud sync or an
explicit catalog-submission email.

## Entry points

- **Add Station surface** — reached from the Settings sheet (opened from the
  feed brand row's settings/gear control). The Settings sheet hosts a tab strip;
  the **"Add Station"** tab is the custom-station surface.
- A custom station, once saved, also appears in the user's library (Favorites,
  Browse "added" surfacing) and is reachable from anywhere a station row is —
  but those are consumption surfaces, not editors. Editing/removing happens only
  from the Add Station surface's "Added stations" list.

## Layout

Top to bottom, the Add Station surface is a form:

1. **Name field** — single-line text input, placeholder "Name". Auto-capitalizes
   words.
2. **Stream URL field** — single-line text input, placeholder "https://". URL
   keyboard, no autocapitalization, no autocorrect.
3. **Stream-check status line** — appears only while checking or on failure:
   - Checking: a spinner + "Checking stream..."
   - Failed: the failure reason in red (e.g. "Stream URL must use https://.",
     "This URL does not look like a live audio stream.",
     "Use a public HTTPS stream URL.", "Could not reach this stream.").
   - Idle / playable: hidden.
4. **Controls row** — shown only once the user has entered name or URL text:
   - **CLEAR** button — resets the form.
   - **Test-stream button** — a large circular play/pause control; enabled only
     when the stream check has passed. Plays the entered stream through the main
     player so the user can hear it before saving.
   - **SAVE / SAVED** button — enabled only when the stream check has passed and
     the current form differs from the last save; label flips to "Saved" after a
     successful save.
5. **"Already in catalog" section** — appears when the entered URL matches one or
   more published catalog stations. Lists up to 4 matching catalog station rows,
   each playable and favoritable in place (so the user adds the catalog station
   instead of a private duplicate).
6. **"Send to rrradio.org catalog" section** — appears when the stream check has
   passed and the URL is *not* already in the catalog. A "Send to rrradio.org
   catalog" button (paperplane icon) with footer: "Opens Mail with a prefilled
   catalog request. Your configured Mail account sends it; rrradio cannot read
   your iCloud email address."
7. **"Already added" section** — appears when the URL matches a station already
   in the user's own library (custom / favorites / recents) but no catalog
   match exists. Lists up to 4 matching entries (name + monospaced URL).
8. **Error line** — a red message row for save/test errors (e.g. "Could not save
   this station.").
9. **"Added stations" section** — the user's existing custom stations. Each row
   shows a local artwork glyph, the station name, the stream host (monospaced),
   an **edit** (pencil) button, and a **delete** (trash) button.

## States

| State | What shows | Actionable |
|---|---|---|
| **Empty (no input)** | Name + URL fields only; controls row hidden; no sections. | Type into either field. |
| **Typing / loading** | "Checking stream..." spinner after a 450 ms debounce. CLEAR + disabled test/save controls visible. | CLEAR. |
| **Loaded / playable** | Status line hidden; test button + SAVE enabled; "Send to catalog" or "Already in catalog" / "Already added" sections per the match result. | Test, Save, Send, play/favorite a catalog match, CLEAR. |
| **Invalid / failed** | Red failure reason; test + save disabled. | Edit the fields; CLEAR. |
| **Saved** | SAVE label shows "Saved"; the station appears in "Added stations"; SAVE stays disabled until the form changes again. | Edit again, Clear, add another. |
| **Offline / unreachable** | Stream check fails with "Could not reach this stream." (treated as a failed state). | Retry by editing the URL; CLEAR. |
| **Has custom stations (any time)** | "Added stations" list with edit/delete per row, regardless of current form contents. | Edit, Delete (with confirmation). |

The form has no separate "saving" spinner — save is synchronous after the
prior async stream check; the label flip to "Saved" is the only saved-state cue.

## Interactions

| Control / gesture | Precondition | Result | Side effects |
|---|---|---|---|
| Type in Name field | — | Clears the saved-state cue (SAVE re-enables if stream is playable); clears the name-required red highlight once non-empty. | None. |
| Type in Stream URL field | — | Clears saved-state cue; schedules a debounced stream check (450 ms) and a debounced catalog-duplicate check (200 ms). | Cancels any in-flight check. |
| Stream-URL normalization | URL entered without scheme, or with stacked `https://https://…`, or `http://` after `https://` | Field is rewritten to a single canonical `https://host…`. Bare host gets `https://` prepended; a leading `http://` is left as-is (so it later fails the https-only guard with a clear message). | Re-triggers the check after the writeback (adds latency — see Known deviations). |
| CLEAR | Form has name or URL text | Empties both fields, resets error/highlight/edit-target, sets check state to idle, cancels the in-flight check. | Does **not** stop a running test-stream playback. |
| Tap test-stream (play) | Stream check passed; not already testing this URL | Plays the entered stream through the main player under a synthetic `custom-test-<uuid>` station id named by the entered name (or "Test station"). | Starts audio; mini-player shows the test station. |
| Tap test-stream (pause) | The entered URL is the currently-playing test stream | Toggles/stops the test playback. | Stops/pauses audio. |
| Tap SAVE | Stream check passed and form differs from last save | Builds a `custom-` station (or updates the one being edited) and adds it to the library auto-favorited; replaces any existing copies of that id across player/library; marks the form "Saved". | Persists custom + favorites stores; syncs to iCloud if enabled. |
| Tap SAVE with empty/blank name | Stream check passed, name blank | Save aborts; the Name placeholder turns red (required-field highlight); no error row. | None. |
| Tap "Send to rrradio.org catalog" | Stream check passed, URL not a catalog duplicate | Opens the OS Mail composer prefilled to `feedback@rrradio.org` with the station name + canonical URL in the body. Sent only if the user taps Send in Mail. | Hands off to Mail; nothing sent in-app. |
| Tap a play control on an "Already in catalog" row | A catalog match is shown | Plays that catalog station. | Becomes the current station. |
| Tap favorite on an "Already in catalog" row | A catalog match is shown | Adds that catalog station to favorites (the intended alternative to creating a duplicate). | Persists favorites; iCloud sync if enabled. |
| Tap edit (pencil) on an Added-stations row | Row is a saved custom station | Loads that station into the form (name + URL), sets the edit target, marks the check state playable **without re-probing**. | Cancels in-flight check. |
| Tap delete (trash) on an Added-stations row | Row is a saved custom station | Opens a destructive confirmation dialog "Delete added station?" / "Remove {name} from added stations and favorites?". | None until confirmed. |
| Confirm Delete | Confirmation shown | Removes the station from custom, favorites, recents, and any station lists; removes it from the active player queue. | Persists affected stores; iCloud sync if enabled. |
| Cancel Delete | Confirmation shown | Dismisses the dialog; nothing removed. | None. |
| Cancel (toolbar) | Add Station presented as its own sheet | Dismisses the surface. | A running test stream keeps playing (see Known deviations). |
| Leave the surface (tab switch / sheet dismiss) | — | Cancels the in-flight stream check and catalog-duplicate check. | A running test stream is **not** stopped. |

## Business rules

- **HTTPS only.** A custom stream URL must use the `https://` scheme. `http://`,
  other schemes, schemeless-after-normalization-failures, or a missing host are
  rejected with a clear message; no http exception ships.
- **Public host only (DNS-rebind / SSRF guard).** The host must resolve to a
  public address. Rejected: `localhost`, `*.localhost`, `*.local`, IP literals in
  any private/loopback/link-local/CGNAT/multicast/reserved range, IPv6
  unique-local / link-local / mapped / 6to4 / documentation ranges, and
  non-canonical IPv4 literals (octal `0…`, hex `0x…`, or fewer than 4 dotted
  parts). A hostname is resolved via DNS and rejected unless **every** resolved
  address is public — closing the rebind hole where a name resolves to a private
  IP. Redirects are re-validated against the same guard at each hop.
- **Stream-probe shape.** The probe is a ranged request (`Range: bytes=0-1`,
  `Icy-MetaData: 1`) with an 8 s timeout, on an ephemeral no-cache session,
  following at most **3** redirects (each Location re-validated). The response is
  "audio-like" if it carries an ICY header (`icy-name` / `icy-metaint` /
  `icy-br`) or a content type that is `audio/*` or one of a small allow-list
  (`application/ogg`, `application/octet-stream`, `binary/octet-stream`,
  `video/mp2t`, `application/vnd.apple.mpegurl`, `application/x-mpegurl`,
  `audio/x-mpegurl`). Anything else, or a non-2xx final status, fails the check.
- **Debounce.** Stream check waits 450 ms after the last keystroke; the
  catalog-duplicate scan waits 200 ms.
- **Catalog-duplicate detection.** A URL matching a published catalog station
  surfaces that catalog row (up to 4) and suppresses the "Send to catalog"
  option — the product steers the user to favorite the catalog station instead of
  minting a private duplicate. Matching is by **canonical** stream URL.
- **Canonical URL matching.** Two stream URLs match when their canonical forms
  are equal: scheme forced to `https`, host lower-cased, fragment dropped, and
  query items sorted with volatile cache-buster params removed (`_*`,
  `cachebuster`, `cachebust`, `cb`, `nocache`, `t`, `ts`, `timestamp`).
- **Library-duplicate detection.** When there is no catalog match, a URL already
  present in the user's custom/favorites/recents surfaces an "Already added" list
  (up to 4); the station being edited is excluded from its own match.
- **`custom-` id prefix.** Saved custom stations get id `custom-<uuid>`, minted
  with `status: "stream-only"`. The `custom-` prefix is reserved and namespaced
  away from catalog slugs and the `rb-` Radio Browser prefix. Test playback uses a
  throwaway `custom-test-<uuid>` id (never persisted). See
  [catalog-schema](../contracts/catalog-schema.md) for the id-prefix reservation
  and the `stream-only` taxonomy.
- **Save eligibility.** SAVE is enabled only when the check is `playable` and the
  current form (edit-target id + trimmed name + canonical URL) differs from the
  last saved signature; re-pressing without a change is a no-op ("Saved").
- **Auto-favorite on save.** Saving a custom station inserts it at the top of
  favorites; custom stations are kept as favorites.
- **Optional metadata on build.** The builder also accepts optional homepage
  (must be valid `http`/`https`), 2-letter uppercase country code, and
  comma-separated lowercase tags — validated and rejected with specific messages
  when malformed. The Add Station UI currently exposes only name + URL.

## Data dependencies

- [catalog-schema](../contracts/catalog-schema.md) — the `Station` shape custom
  stations occupy, the reserved `custom-`/`rb-` id prefixes, and the
  `stream-only` status taxonomy (custom stations are minted `stream-only`).
- [sync-merge](../contracts/sync-merge.md) — custom stations sync to the user's
  iCloud private database as `CustomStation` records under a
  `CustomStationsIndex`; merge is remote-wins on id collision (authoritative-index
  branch) with keep-local for unresolved ids.
- [privacy-data-boundaries](../contracts/privacy-data-boundaries.md) — custom
  stream URLs are private user-entered data: never sent to analytics/telemetry,
  excluded from diagnostics export, and leave the device only via the user's own
  iCloud (row 14) or the explicit catalog-submission `mailto:feedback@rrradio.org`
  (row 13).

## Edge cases

- **No scheme typed** ("example.org/stream") → normalized to `https://…`, then
  probed.
- **`http://` typed** → kept as-is by normalization, then rejected by the
  https-only guard with "Stream URL must use https://.".
- **Unparseable URL** → "Stream URL must be a valid URL.".
- **Private / loopback / `.local` target** → "Use a public HTTPS stream URL.";
  blocked both by the synchronous host-safety check and the DNS resolution check.
- **DNS rebind** (hostname resolves to a private IP) → rejected: all resolved
  addresses must be public.
- **Reachable but not audio** (HTML page, JSON, image) → "This URL does not look
  like a live audio stream.".
- **Redirect chain > 3 hops** → treated as unreachable.
- **Network down / host unreachable / timeout (8 s)** → "Could not reach this
  stream.".
- **Empty name on save** → red name highlight, no save, no error row.
- **Duplicate of a catalog station** → "Already in catalog" rows shown; "Send to
  catalog" hidden; user steered to favorite the catalog station.
- **Duplicate of an own library entry** → "Already added" list shown.
- **Edit then save unchanged** → SAVE shows "Saved" / disabled; no duplicate row.
- **Editing a station whose stream went offline** → form pre-fills as playable
  without re-probing, so a stale-but-broken station can be re-saved without a new
  warning (see Known deviations).
- **Leaving with a test stream playing** → playback continues; only the mini-player
  can stop it (see Known deviations).
- **Backgrounding mid-check** → the in-flight check is cancelled on disappear;
  re-entry re-runs it.
- **Delete a currently-playing custom station** → removed everywhere and pulled
  from the active player queue.
- **iCloud unavailable** → all of the above works locally; sync is best-effort.

## Accessibility

- Test-stream button has a VoiceOver label of "Play" / "Pause" reflecting its
  current toggle role (it does not yet announce the underlying check state —
  checking / failed / playable).
- Added-stations edit/delete buttons are labeled "Edit {name}" / "Delete {name}".
- The stream-check status line conveys state in text; the failure message is the
  programmatic label.
- Form fields, buttons, and section headers use system controls and scale with
  Dynamic Type; the monospaced URL/host text and pill labels follow the app's
  type ramp.
- Color is not the sole signal for the required-name state in spirit, but the
  current cue is a red placeholder color — see Open questions.

## Localization

Owned strings on this surface (English reference values):

| Key | English |
|---|---|
| `addStation` | "Add station" (nav title) |
| `upload` | "Add Station" (tab title) |
| `nameLabel` | "Name" |
| `streamURLLabel` | "Stream URL" |
| `checkingStream` | "Checking stream..." |
| `couldNotReachStream` | "Could not reach this stream." |
| `checkStreamBeforeSaving` | "Check the stream URL before saving." |
| `checkStreamBeforeTesting` | "Check the stream URL before testing." |
| `alreadyInCatalog` | "Already in catalog" |
| `alreadyAdded` | "Already added" |
| `addedStationsSection` | "Added stations" |
| `sendToRrradioCatalog` | "Send to rrradio.org catalog" |
| `catalogSubmissionFooter` | "Opens Mail with a prefilled catalog request. Your configured Mail account sends it; rrradio cannot read your iCloud email address." |
| `deleteAddedStationTitle` | "Delete added station?" |
| `removeAddedStationMessage` | "Remove {name} from added stations and favorites?" |
| `saved` / `save` | "Saved" / "Save" |
| `clear` | "Clear" |
| `couldNotSaveStation` | "Could not save this station." |
| `couldNotTestStation` | "Could not test this station." |
| `testStation` | "Test station" |
| `enterValidStreamURL` | "Enter a valid stream URL before sending." |
| `editStationNamed` / `deleteStationNamed` | "Edit {name}" / "Delete {name}" |
| `catalogSubmissionEmailSubject` / `catalogSubmissionEmailBody` / `notProvided` | catalog-request email subject/body template + "(not provided)" |

- Parameterized strings: `removeAddedStationMessage`, `editStationNamed`,
  `deleteStationNamed` take a `{name}`; the email body template takes `{name}`
  and `{streamURL}`.
- The validation error messages (`CustomStationValidationError`,
  `StreamProbeError`) are surfaced verbatim and should be localized.
- No plural forms required (the lists are capped at 4 and labeled by a section
  header, not a count).

## Platform Matrix

| Behavior | Web | iOS | Android |
|---|---|---|---|
| Add custom stream | Supported. | Reference. | Supported. |
| HTTPS-only enforcement | Supported. | Reference. | Supported. |
| Probe before save | Partial. | Reference. | Supported. |
| Private/local-network (DNS-rebind/SSRF) guard | Supported where implemented. | Reference. | Supported. |
| Catalog-duplicate detection | Supported where implemented. | Reference. | Supported. |
| Library-duplicate detection ("already added") | Supported where implemented. | Reference. | Supported. |
| Test-stream playback before save | Browser-dependent. | Supported. | Supported. |
| Auto-favorite on save | Product-preferred behavior. | Supported. | Supported. |
| Edit existing custom station | Supported. | Supported. | Supported. |
| Destructive delete confirmation | Supported. | Reference. | Supported. |
| `custom-` id prefix reservation | Supported. | Supported. | Supported. |
| Submit to catalog (email) | Supported. | Supported via Mail composer. | Supported via mail intent. |
| Local persistence | `localStorage`. | UserDefaults. | DataStore. |
| Manual file export/import | Supported. | Planned/optional. | Supported through Android library backup. |
| Cloud/account sync | Not planned. | Optional CloudKit sync. | Not planned for first port. |

## Android First-Port Requirement

Android includes custom stations. The first aligned implementation probes
streams before save, rejects duplicate stream URLs, auto-favorites saved custom
stations, confirms deletion, and rejects private/local network targets unless a
separate local-network feature is approved.

## Open questions

- **Optional metadata fields in the UI.** The builder validates homepage,
  country, and tags, but the Add Station form exposes only name + URL. Whether to
  surface these inputs (and how) is an open product decision.
- **Required-name cue relies on color.** The blank-name signal is a red
  placeholder color with no text/error row; consider an explicit message for
  contrast/clarity.
- **Edit-without-reprobe.** Editing pre-marks the stream playable without a fresh
  reachability check; whether edit should re-probe is unresolved (see Known
  deviations AS7).
- **Test-stream lifecycle on dismiss.** Whether leaving the surface should stop a
  running test stream (it currently does not) is an open UX decision.

## Reference

iOS source read for this spec:

- `rrradio/Views/AddStationView.swift` — the Add Station form, field validation,
  debounced stream check + catalog-duplicate scan, save/test/clear/edit/delete
  flows, `StreamCheckState`, `normalizedHTTPSStreamURLString`,
  `catalogSubmissionMailURL`.
- `rrradio/Library/StreamProbe.swift` — `probeStreamURL` (ranged HEAD-like probe,
  3-redirect cap, 8 s timeout), `responseLooksLikeAudioStream` (ICY +
  content-type allow-list), `isPublicHTTPSStreamURL` and the SSRF/DNS-rebind
  guard (`validatePublicHTTPSStreamURL`, `StreamProbeIPAddress`,
  private/local-range tables, non-canonical IPv4 detection), `StreamProbeError`.
- `rrradio/Library/CustomStationBuilder.swift` — `makeCustomStation` (HTTPS-only,
  public-host, optional homepage/country/tags validation, `stream-only` mint),
  `CustomStationValidationError`, `canonicalStreamURL` / `streamURLsMatch` /
  `stationsMatchingStreamURL`, volatile-query-param stripping.
- `Shared/Station.swift` — `Station.IDPrefix.custom` (`custom-`) reservation,
  `isUserCreated`.
- `rrradio/Library/Library.swift` — `addCustom` (auto-favorite, replace copies),
  `removeCustom` (purge from custom/favorites/recents/lists),
  `replaceStationEverywhere`, `customStations`, `isCustom`.
- `rrradio/Views/SettingsView.swift` — the Settings tab strip hosting the
  `AddStationContentView` "Add Station" tab.

## Known deviations

Shipped iOS code that diverges from the intent above is tracked in
`rrradio-ios/internal/audit/`:

- **AS1 — catalog-duplicate scan on the main thread per keystroke.**
  `catalogDuplicateStations` walked the full ~17k-station catalog on every body
  render via a computed property; the intended shape is the off-main
  `Task.detached` debounced scan (now used) or an O(1) prebuilt URL index.
  (`internal/audit/2026-05-25-ios-code-review-slice22.md` §AS1)
- **AS4 — test-stream playback survives surface dismissal.** Leaving the Add
  Station surface cancels the check tasks but does not stop a running
  `custom-test-<uuid>` test stream; only the mini-player can stop it.
  (`internal/audit/2026-05-25-ios-code-review-slice22.md` §AS4)
- **AS5 — URL-normalization writeback adds ~450 ms latency.** When the URL needs
  normalization, the async check writes the field back and returns, re-triggering
  the debounce (~900 ms total) before the probe starts; normalizing synchronously
  at write time would avoid the round-trip.
  (`internal/audit/2026-05-25-ios-code-review-slice22.md` §AS5)
- **AS7 — edit pre-marks playable without re-probing.** Editing a saved custom
  station sets the check state to `playable` unconditionally, so a stream that
  has since gone offline can be re-saved without a fresh reachability warning.
  (`internal/audit/2026-05-25-ios-code-review-slice22.md` §AS7)
- **AS2 — catalog-submission `mailto:` (RESOLVED at `9336321`).** The submission
  destination previously hardcoded a developer-personal Gmail address; migrated
  to `feedback@rrradio.org`. Intent is the first-party inbox (see
  [privacy-data-boundaries](../contracts/privacy-data-boundaries.md) row 13).
  (`internal/audit/2026-05-25-ios-code-review-slice22.md` §AS2)
