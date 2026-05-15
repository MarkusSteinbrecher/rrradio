# Data And Sync Specification

rrradio has no cross-platform account system today. Each platform owns its
local user data. The web app supports user-initiated backup export/import as a
manual sync/transfer mechanism for selected library data. iOS additionally
offers private iCloud/CloudKit sync between the user's Apple devices.

## Data Classes

| Data | Description | Privacy level |
|---|---|---|
| Favorites | User-selected stations and order. | Private user library. |
| Recents | Recently played stations, capped. | Private local activity. |
| Station lists | Named station collections. | Private user library. |
| Custom stations | User-entered streams and labels. | Private user content. |
| Preferences | Theme, language, landing page, display modes, timer defaults. | Private settings. |
| Wake state | One armed wake-to-radio intent. | Private local intent. |
| Listening history | Optional playback history. | Private local activity. |
| Diagnostics | Optional operational events. | Private support data. |
| Catalog cache | Published station catalog. | Public app data. |
| Backup file | User-exported snapshot for manual transfer. | Private user library. |

## Platform Behavior

| Data | Web | iOS | Android |
|---|---|---|---|
| Favorites | `localStorage`, export/import supported. | Local UserDefaults plus optional CloudKit sync. | Local DataStore. |
| Recents | `localStorage`, capped. | Local-only, capped. | Local DataStore, capped. |
| Station lists | Not planned for current web. | Local plus optional CloudKit sync. | Planned local-only. |
| Custom stations | `localStorage`, export/import supported. | Local plus optional CloudKit sync. | Local DataStore. |
| Preferences | Local browser preferences. | Local plus optional CloudKit sync for selected preferences. | Local-only for first port. |
| Wake state | Local-only, one armed wake. | Local-only for active wake; selected wake preferences may sync. | Local-only. |
| Listening history | Not part of current web storage contract. | Local-only, opt-in, retention-controlled. | Planned local-only, opt-in. |
| Diagnostics | Anonymous production events only. | Local opt-in diagnostic log. | Planned local opt-in diagnostic log. |
| Catalog cache | Browser/runtime cache. | Disk cache and bundled index fallback. | Planned disk cache and optional search index. |
| Backup file | Manual export/import for favorites and custom stations. | Planned/optional import path if needed. | Planned/optional import path if needed. |

## iCloud And CloudKit

iCloud/CloudKit is an iOS-only feature.

The iOS app may sync:

- Favorites.
- Favorite order.
- Station lists.
- Custom stations.
- Theme and accent preferences.
- Language preference.
- Landing page preference.
- Favorites display mode preferences.
- Sleep timer default.
- Wake default-time and notification preferences.
- Car mode preferences.
- Listening-history preferences.

The iOS app must not sync:

- Recents.
- Listening-history records.
- Diagnostics.
- One-shot active wake intents.
- Raw playback errors.
- Search queries.
- Track titles or artist names from listening history unless a future explicit
  user-facing sync feature is approved.

When CloudKit is unavailable, iOS stays local-only. No user-facing feature may
require iCloud to function.

## Web

The web app has no account or cloud sync, but it does support manual file
export/import:

- No account.
- No CloudKit.
- No automatic cross-device sync.
- Export writes a user-readable backup file.
- Import merges the backup with the current browser library.
- The backup file is the user-controlled sync/transfer mechanism.
- Current backup scope is favorites and custom stations.
- Clearing site data clears the local library.

## Android

The Android app is local-only:

- No CloudKit.
- No iCloud compatibility layer.
- No account requirement.
- No shared backend.
- Manual backup import/export can be added as a user-controlled transfer path,
  but it is not a substitute for a shared sync backend.
- Data should be structured so a future sync backend can be added without
  rewriting feature logic.

Android storage should use stable schema versions for user data. Prefer a
simple local model first; introduce Room only when the feature set needs
queryable history, station lists, or catalog search.

## Future Cross-Platform Sync

Cross-platform sync requires a new product and architecture decision. It should
not be implied by the Android port.

A future sync ADR must decide:

- Whether rrradio remains accountless.
- Whether sync is optional or required.
- Where user data is stored.
- How conflicts merge across web, iOS, and Android.
- What data classes are excluded for privacy.
- How users can delete all remote data.
- Whether iCloud remains iOS-only or becomes a migration source.

Until that ADR exists, web and Android have no automatic account/cloud sync.
Web still has manual file export/import, and iOS CloudKit sync remains
Apple-device-only.
