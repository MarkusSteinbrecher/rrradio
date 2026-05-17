# Preferences And Diagnostics Specification

Preferences make rrradio feel personal. Diagnostics help debug playback without
turning the app into a tracking product.

## Preferences

Shared preference areas:

- Theme: system, light, dark where the platform supports them.
- Accent/theme color where the platform supports it.
- Language where localized strings exist.
- Landing page or startup behavior where native launch state makes sense.
- Favorites display mode and visible mode order where the platform supports
  multiple favorites views.
- Sleep timer defaults.
- Wake default time and notification preference where wake exists.

Platform matrix:

| Preference | Web | iOS | Android |
|---|---|---|---|
| Theme | Supported. | Reference. | Supported for system/light/dark in a native Preferences sheet. |
| Accent color | Supported/partial by web theme design. | Supported. | Partial; native preset accent palette exists, custom color entry remains deferred. |
| Language | Browser/content dependent. | Supported. | Planned after localization scope. |
| Landing page | Not a primary web contract. | Supported. | Supported for Lists, Browse, and Favorites startup targets. |
| Favorites display modes | Partial. | Reference. | Partial; modes exist, preference persistence/order controls remain. |
| Sleep default | Supported where exposed. | Supported. | Supported for the first sleep-timer tap. |
| Wake default/notifications | Supported where exposed. | Supported. | Planned with wake feature. |

## Listening History

Listening history is private local activity data.

- It must be off by default unless a platform spec explicitly changes that.
- The user chooses whether station-only or track-level history is stored.
- Retention must be bounded by default.
- The user can clear history.
- History records do not sync in the current product.

Platform matrix:

| Behavior | Web | iOS | Android |
|---|---|---|---|
| Station history | Not part of current web contract beyond recents. | Supported as opt-in listening history. | Supported as local opt-in history. |
| Track-level history | Not planned for current web. | Supported only when user selects it. | Gated behind explicit opt-in; metadata-recording expansion remains future polish. |
| Sync | Not planned. | Not synced. | Not planned. |

## Diagnostics

Diagnostics must be opt-in and user-visible.

Allowed diagnostic categories:

- Playback lifecycle.
- Stream retry category.
- Network availability state.
- Metadata fetch category.
- Cloud sync availability category on iOS.
- Local persistence category.

Diagnostics must avoid:

- Stack traces.
- Search queries.
- Full stream URLs.
- User-entered custom station URLs.
- Track titles and artist names.
- Long-lived unique user identifiers.

Platform matrix:

| Behavior | Web | iOS | Android |
|---|---|---|---|
| Anonymous aggregate telemetry | Supported through GoatCounter. | Not the native support surface. | Not planned for first port. |
| Local diagnostics | Not primary web contract. | Supported, opt-in, capped, exportable. | Supported, opt-in, capped, exportable. |
| Broken-station report | Supported. | Supported where implemented. | Supported through the shared anonymous report endpoint. |

## Car Mode And Vehicle Surfaces

- iOS has in-app car mode preferences and system media controls.
- Web relies on browser and OS media surfaces.
- Android should start with media notification controls; Android Auto is a
  separate scope decision.
