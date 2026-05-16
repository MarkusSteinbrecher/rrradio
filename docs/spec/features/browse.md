# Browse Specification

Browse is the main catalog discovery surface. It combines curated stations,
the generated catalog, search, filters, and map exploration.

## Shared Behavior

- Browse lists publishable catalog stations.
- Search matches station name, tags, country, and known normalized forms.
- Search should tolerate whitespace differences such as `WDR5` and `WDR 5`.
- Country and genre/tag filters narrow results.
- The visible count reflects the active query and filters.
- Empty states explain whether no catalog result exists or whether the user is
  looking in a narrower local scope.
- Station rows expose enough signal to choose a stream: name, country/tag
  context, logo when available, and playback/favorite affordances.
- The current station remains identifiable when the user moves between Browse,
  Favorites, Recents, station lists, and Now Playing.

## Platform Matrix

| Behavior | Web | iOS | Android |
|---|---|---|---|
| Curated catalog | Supported. | Supported. | Supported. |
| Large Radio Browser-backed catalog | Supported. | Supported with bundled index/cache behavior. | Supported with cache-backed loading. |
| Search normalization | Supported. | Reference native behavior. | Supported. |
| Country filter | Supported. | Supported with native picker rows. | Supported. |
| Genre/tag filter | Supported. | Supported. | Supported. |
| Map browse | Supported with web map asset. | Supported with MapKit. | Planned with native map, provider TBD. |
| Add several stations to a station list | Not planned for current web. | Supported from Browse. | Supported. |
| Sort controls | Supported. | Reference native behavior. | Partial; name, quality, and favorite-state sorting exist, map/preview refinements remain. |

## Android First-Port Requirement

Android currently includes the first-port basics:

- Catalog load from published `stations.json`.
- Disk cache for offline boot.
- Search across name, tags, and country.
- Country and genre/tag filters.
- Favorite/unfavorite from rows.
- Play from rows.
- Local recents update on play.
- Batch selection from Browse into station lists.
- Name, stream-quality, and favorite-state sorting.

Remaining Android alignment work:

- Map browse.
- Station info preview and native Browse presentation refinements.
- Additional sort/display refinements after real-device testing.
- Bundled full-text index, unless in-memory search is too slow on target
  devices.
