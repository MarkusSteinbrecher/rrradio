# UI anatomy — rrradio (web)

The names for the web app's screens, regions, components and parts, and how its tokens map to the shared roles. The shared words are defined in HQ (`~/Code/hq/ui/vocabulary.md`); this page only adds what is specific to the web app. The iOS app has its own page (`rrradio-ios/docs/ui-anatomy.md`); where both apps have the same thing, this page uses the same name.

Use it to phrase and to read change requests: `<screen> › <region> › <component> › <part>: <property> → <role or step>`.

Behaviour lives in the spec (`docs/spec/features/*.md`, "Layout" sections). Written 2026-11-27 from the code on `feat/browse-cards`. The app is one page: markup in `index.html`, behaviour in `src/main.ts`, styles in `src/style.css`. When a screen is restructured, update its table in the same change.

## Root

| Name | What it is | Code |
|---|---|---|
| top nav | The bar at the top: wordmark, section nav (desktop only), search field, toolbar | `header.topnav` |
| wordmark | The logo button; goes home | `#wordmark` |
| section nav | Browse / Favorites / Library links in the top nav, from 1024px up | `nav.topnav-nav` |
| search field | Text field with clear button | `#search-wrap`, `#search` |
| toolbar | Surprise me pill (desktop), filter button with its dot, iOS app link, Ko-fi link, settings button | `.toolbar-btn`, `#filter-btn`, `#settings-btn` |
| content | The scrolling area that shows the active screen | `main#content`, `renderContent()` |
| mini player | Pinned bar above the tab bar while a station is loaded; opens Now Playing | `#mini`, `src/render-mini.ts` |
| tab bar | Bottom switcher between Browse, Favorites and Library, below 1024px | `nav#tabbar`, `renderTabBar()` |
| Now Playing | The player screen; covers the content on a phone, sits beside it on desktop | `section#np`, `src/render-np.ts` |

Screens are tabs of one page, not routes: `browse`, `fav`, `library` (`Tab` in `src/main.ts`). From 1024px the layout changes: the tab bar goes, the section nav appears in the top nav, and Now Playing opens next to the content.

## Browse

| Region | What it is | Code |
|---|---|---|
| discovery landing | What the content shows with no search and no filter: the four sections below | `renderDiscovery()` |
| genre rail | Section "Browse by genre": one rail of genre cards | `.disc-rail`, `genreCard()` in `src/discovery-cards.ts` |
| country rail | Section "Browse by country": one rail of country cards | `.disc-rail`, `countryCard()` |
| featured rail | Section "Featured": one rail of highlight cards | `.feat-rail`, `highlightCard()` |
| browse-all section | Last on the page: header row with the catalog count, over a rail of station logos | `browseAllSection()`, `.disc-browse-all`, `.disc-browse-all-rail` |
| sort row | Above the results: back-to-discovery button, sort button, result count, shuffle | `resultsRow()`, `.results-row`, `.results-row__back`, `.results-row__sort`, `.results-row__count` |
| station list | Search or filter results as station rows | `renderRows()`, `buildRow()` |
| filter sheet | Genre / Country / Quality sections and the news toggle; a sheet on a phone, a popover by the filter button on desktop | `#filter-sheet`, `renderFilterSheet()` |

Discovery components and their parts:

| Component | Parts | Type and space |
|---|---|---|
| section header | title, trailing control ("Surprise me" on the genre header, below 1024px) | title: 17px bold · inset: 18 top, 20 leading and trailing, 8 bottom · `.disc-section-label`, `.disc-section-head` |
| genre card | fill (page colour, hairline border, soft shadow), artwork (three circles: hero in front, leading and trailing ones cropped by the card edges), title inside the card at the bottom leading corner; no label | title: 15% of the card side, extra bold · `.disc-genre` |
| country card | artwork (the card surface with a 2×2 collage of logo tiles; one tile with fewer than four logos; the flag with none), label under it: flag glyph + name | label: 13px semibold, emphasis one level down · gap artwork to label: space 2 · `.disc-mix` |
| highlight card | artwork panel (three album covers edge to edge, logo tile on its bottom leading corner), badge (accent dot + mono caps), title + flag glyph, blurb (two lines) | title: 17px extra bold, one line · blurb: 13px medium, emphasis two levels down · seam between covers and around the logo tile: 2px · logo tile inset: space 2 · `.feat-card` |
| logo tile | A station logo on a white plate with rounded corners; initials when there is no logo or it fails | `.disc-tile`, `logoTile()` |
| browse-all logo | A station logo in a circle, 38px | `.disc-browse-all-logo` |

Page margin on the discovery landing is space 5 (20px); the gap between cards in a rail is space 3. The genre and country cards share one side, `--disc-card`: about 2.2 cards across a phone, 140 to 190px. Everything inside those cards is a proportion of that side.

## Station row

The one row used by Browse results, Favorites and list pages (`buildRow()`).

| Part | What it is | Code |
|---|---|---|
| artwork | The station logo in a circle, 38px; initials when there is none | `.fav`, `buildFavicon()` |
| title | Station name, with a flag glyph | `.row-name`, `.row-flag` |
| detail | Tags; a geo note when the stream is limited to a country | `.row-tags`, `.row-geo` |
| now line | The current track, where the row shows one | `.row-now` |
| trailing accessories | Equaliser while playing, add-to-list button, heart; a tick while picking stations for a list | `.eq`, `.row-addlist`, `.heart`, `.row-tick` |

Inset: 14px top and bottom, space 5 leading and trailing; gap between parts 14px; a hairline rule above each row.

## Favorites

| Region | What it is | Code |
|---|---|---|
| station list | The favourite stations as station rows, with the trailing cover-art slot | `renderContent()` (`activeTab === 'fav'`) |
| empty state | Icon, title and one line of help when there are no favourites | `emptyState()` in `src/empty.ts` |

## Library

| Region | What it is | Code |
|---|---|---|
| library home | The index of lists | `renderLibraryHome()`, `renderLibraryIndex()`, `.lists-index` |
| list row | One list: name, a strip of its stations' logos, play button, more button. Recents is a system list in the same form | `buildListIndexRow()`, `buildRecentsRow()`, `.list-item`, `.list-item__strip` |
| list page | One list's stations as station rows, under a pinned section label; an editing state removes stations | `renderListDetail()`, `.section-label--list-detail` |
| add-list sheet | Choose or create a list, in two steps when starting from a list | `#list-sheet`, `renderAddList()`, `buildStepStrip()` |

## Now Playing

| Region | What it is | Code |
|---|---|---|
| station head | Back button (phone), station logo (opens station info), station name, add-to-list and favourite buttons, then a hairline | `.np-station`, `.np-head-btn` |
| pane tabs | Album / Schedule / Lyrics switcher | `#np-pane-tabs`, `.np-pane-tab` |
| track pane | Cover, track title, artist, programme, status line, error block with "Try again" and "Report", and the open-in links | `.np-track`, `.np-error`, `.np-openin` |
| schedule pane | The station's programme list | `#np-program-pane`, `renderProgramPane()` |
| lyrics pane | Lyrics of the current track, with their source | `#np-lyrics-pane`, `renderLyricsPane()` |
| controls | Volume (desktop), previous / play / next, sleep timer with its chip | `.np-controls`, `#np-play`, `#np-sleep` |
| station info popup | Bitrate, origin, listeners, stream quality choice, stream and homepage links, "Broken station" | `#np-info` |
| report popup | Broken-station report form | `#np-report` |

## Sheets

| Sheet | What it is | Code |
|---|---|---|
| settings sheet | Three tabs: Preferences (theme, accent colour, landing page, music services, your data, more), About, Add Station | `#settings-sheet`, `.settings-section`, `.settings-row`, `.seg` |
| filter sheet | See Browse | `#filter-sheet` |
| add-list sheet | See Library | `#list-sheet` |
| stats sheet | Listener statistics: hero figure, plays per day, top stations, map | `#dashboard-sheet`, `renderDashboard()` |

Shared sheet parts: `.sheet-head` (title or tabs, close button), `.sheet-body`, `.sheet-foot`, `.sheet-title`, `.sheet-lede`, `.sheet-tab`. A **segmented control** is `.seg` with `.seg__btn`.

## Other pages

Separate HTML pages with their own stylesheets, not part of the app shell: the station tracker (`station-tracker.html`, `src/tracker/`), the catalog health dashboard (`catalog-health.html`, `src/health/`), the static station and genre pages (`tools/build-station-pages.mjs`), and `public/privacy.html`.

## Token mapping

The web app has its own established look, not SteinerDesign. Its tokens are the custom properties at the top of `src/style.css`; they mirror the iOS `RrradioTheme` values, and each has a dark and a light value.

| Shared role | Web token |
|---|---|
| background page | `--bg` |
| background raised | `--bg-2` |
| fill hover / active | `--bg-3` |
| foreground default | `--ink` |
| foreground, lower emphasis | `--ink-2` (80%) · `--ink-3` (62%) · `--ink-4` (40%): four levels, one more than the shared three |
| border subtle | `--line` |
| border default | `--line-2` |
| accent | `--accent` (yellow in dark, green in light; user-selectable) |

`--card-fill`, `--card-shadow`, `--row-glow`, `--dial-overlay`, `--live-on` have no shared role. Faces: `--sans` (IBM Plex Sans) and `--mono` (IBM Plex Mono).

**Type.** There are no type-role tokens: sizes are raw pixel values in the stylesheet. The sizes in use, mapped to the nearest role:

| Role | Size and weight in use | Where |
|---|---|---|
| title | 17px bold | Discovery section headers, "Browse all stations" |
| headline (app's own) | 17px extra bold | Highlight card title |
| label | 13px to 15px | Row titles, control text, country card label |
| caption | 11px to 12px | Tags, helper text |
| code | 9px to 11px, mono | Counts, figures |
| eyebrow (app's own) | 9px to 10px, mono caps, tracked | `.section-label`, highlight card badge |

**Space.** There are no space tokens. The values follow the 4px scale in most places (page margin 20, card gap 12), with 14px in the station row and other odd values elsewhere.

**Radius.** No radius tokens. In use: pill (999px) for buttons and chips, 12px for logo tiles and panels, 4px for discovery cards (as on iOS).

## Where the app stands (2026-11-27)

- The discovery landing is written against this page's names and the iOS card designs. Its values are still raw pixels, since the stylesheet has no role tokens to use.
- Nothing lints the stylesheet for raw sizes. `src/style.css` uses about twenty different font sizes, several of them half pixels (9.5, 10.5, 11.5, 12.5).
- Not ported from iOS: the browse-all honeycomb, and the "All ›" action in the section headers.
- A type and space token layer, as iOS has in `RrradioTextRole` and `RrradioSpace`, would be the next step before moving more screens onto roles.
