# Design Language Specification

```yaml
status: draft
platforms: [web, ios, android]
reconciled-against: b36ac94
```

## Purpose

The visual and motion vocabulary every rrradio surface is built from: color
tokens, type roles, shape, spacing, elevation, motion, and iconography. Feature
specs describe *structure* (what shows, in what order); this spec owns the
*skin*, so a port can look and feel like the reference without transcribing
Swift. Values are extracted from the iOS reference implementation (`RrradioUI`
/ `RrradioTheme`); web keeps its own CSS realization of the same intent.

**Units:** sizes are given in iOS points. Android maps pt → dp (and pt → sp for
type) 1:1. Tracking is given in em; Android maps em → `letterSpacing` in em/sp.
iOS uses continuous (squircle) corners; plain rounded corners are the accepted
Android rendering.

## Color

All tokens are adaptive (light / dark). Ink variants are alpha layers of `ink`,
so they tint correctly over any surface. Hex values are sRGB.

| Token | Light | Dark | Role |
|---|---|---|---|
| `bg` | `#F8F8F6` | `#1E1D19` | Page background (warm cream / warm near-black — never pure white/black). |
| `bg2` | `#FFFEFF` | `#2F2E29` | Raised surfaces: cards, capsules, fields, panels, toasts. |
| `bg3` | `#C2C1BF` | `#62615C` | Muted fill; currently-playing row highlight; disabled fill. |
| `ink` | ≈`#0E0E0D` | ≈`#F4F4F2` | Primary text and glyphs. |
| `ink2` | ink @ 80% | ink @ 80% | Secondary text. |
| `ink3` | ink @ 62% | ink @ 62% | Tertiary text: eyebrows, subtitles, inactive tabs. |
| `ink4` | ink @ 40% | ink @ 40% | Least-prominent labels; idle heart outline. |
| `line` | ink @ 8% | ink @ 8% | Hairlines, strokes, dividers, control rings. |
| `artworkBorder` | ink @ 20% | ink @ 20% | Border on artwork and favicons. |
| `buttonFill` | ≈`#4E4E47` | ≈`#F4F4F2` | Selected capsule-choice fill; save badge. Text on it = `bg`. |
| `favoriteFill` | ≈`#6E6E64` | ink @ 72% | Filled (favorited) heart. |
| `errorTint` | ≈`#C7524D` | ≈`#ED8C85` | Errors and offline — a warm red, not the platform system red. |
| `filterIcon` | ≈`#8F8F85` | ≈`#C7C7BD` | Inactive filter glyph. |
| `geoAmber` | `#F0B85C` | `#F0B85C` | Geo-restriction tag text; chip fill = `#FFB84D` @ 16%. |

- **Accent** — the only saturated brand color. Classic (default) is adaptive:
  **green `#00A040` in light, yellow `#FFFF00` in dark**. User-customizable
  per-appearance (hex entry); preset swatches: blue `#0A84FF`, rose `#FF7AA3`,
  violet `#AD96FF`. Accent marks: active tab + its 2pt indicator, live/on-air
  glyphs, armed timer chips, selected filter state, links, the play button.
- **Card fill gradient** — station cards, tiles, and library cards use a
  subtle top→bottom linear gradient, not flat `bg2`: light `#FFFEFB → #FBFAF6`,
  dark `#292822 → #25241E`, plus a 1pt `line` stroke.
- Selection/highlight states derive from accent or ink alphas (e.g. accent
  @ ~10% row tint) — never platform default selection colors.

## Typography

System font only (SF Pro on iOS; Roboto/system on Android; system stack on
web). Two families: the default sans, and **monospaced** for data-flavored
text (tags, counts, times, eyebrows).

| Role | Size / weight | Family | Used for |
|---|---|---|---|
| `stationTitle` | ≈15 medium | sans | Row/tile station names. |
| `detail` | ≈12 regular | sans | Row detail lines. |
| `tag` | ≈11 regular, lowercase | mono | Tag lines, taglines. |
| `displayTitle` | 28 medium | sans | Now Playing station name; sheet headers. |
| `paneTitle` | 20 medium | sans | Now Playing track title. |
| `subtitle` | 13 regular | sans | Artist line; secondary sheet text. |
| `body` | 14 regular | sans | Lyrics, copy blocks, splash status. |
| `caption` | 11 medium | sans | Program line, compact status. |
| Section header | 19 heavy | sans | Discovery/browse section titles. |

**Mono-caps label idiom** — the signature chrome style: monospaced +
UPPERCASE + wide tracking. Tracking levels: tight 0.07em, standard 0.12em,
wide 0.16em. Uses: section headers in Settings (12, `ink3`), Now Playing mode
tabs (12 bold, wide), eyebrows (10, wide, e.g. "OPEN IN", "TODAY · N
BROADCASTS"), tab-bar labels, status labels, chip counts (11 bold mono).
Initials fallback plates render in monospaced semibold.

Type scales with the platform's dynamic type / font-scale setting; layouts must
tolerate one step up without truncating primary labels.

## Shape

Corner-radius scale (pt):

| Token | Radius | Used for |
|---|---|---|
| `tag` | 4 | Mini chips, tag capsules. |
| `card` | 6 | Station cards, tiles, buttons, Now Playing artwork. |
| `panel` | 8 | Popups, toasts, settings panels, sheets' inner cards. |
| `hero` | 12 | Station-info card, About tile, accent picker. |
| App-icon tile | 15 | Favorites "app" grid icons. |
| Highlight card | 18 | Featured rail cards (artwork inside at 16). |

Favicons/avatars are **circular** everywhere; cover art and app-grid tiles are
rounded squares.

## Metrics

| Constant | Value | Notes |
|---|---|---|
| Station row height | **88** | The system row: browse results, favorites list, library cards, mini-player. (64 min content + 12/12 vertical padding.) |
| Card outer margin | 10 | List edge → card. |
| Card inner padding | 14 h / 12 v | |
| Row/list gap | 8 | Tile grid gap 10. |
| Row favicon | 38 | 46 in favorites-metadata rows and the mini-player. |
| Album thumb | 64 | Mini-player and favorites list trailing art. |
| Now Playing cover | 220 phone / 390 tablet | Car mode 250. |
| App-grid icon | 64 | 4 columns, cell height 105. |
| Tap target | ≥ 44 | Minimum for all controls. |
| Tab bar | 54 tall | 22 icon + mono-caps label; 2pt accent indicator (≤ 64 wide) under the active tab; 1pt `line` hairline on top. |
| Chrome rows | 44 | Brand row, status bars, sort row. |
| Chips | 42 tall | Capsule, 16 side padding, 15 semibold label + 11 bold mono count. |
| Filter sheet | 320 wide, ≤ 420 tall | Centered card, `panel` radius. |

## Elevation & materials

Scheme-aware shadows (opacity differs by mode):

| Shadow | Blur / offset | Dark | Light |
|---|---|---|---|
| Card | r 5, y 2 | black 40% | black 10% |
| Overlay (popups, toasts) | r 18, y 8 | black 50% | black 22% |
| Artwork | light: r 3, y 1 · dark: r 6, y 0 | **white glow 12%** | black 16% |

- Modal/popup backdrops: blurred translucent scrim (iOS `.ultraThinMaterial`).
  Android: a `bg`-tinted scrim (~60–70% alpha) is the accepted stand-in; blur
  optional.
- Scroll-edge seam: a 24pt gradient-masked frosted band where content meets
  chrome — light uses material blur, dark uses flat black @ 40% (blur clashes
  with the warm dark palette).
- Icon chrome (search/filter/settings buttons) is **flat**: `bg2` or
  transparent fill with a 1pt `line` ring — no glass, no elevation.

## Motion

| Motion | Value |
|---|---|
| Standard chrome/toggle animation | snappy spring, 0.16–0.24s. |
| Tab switch / pager settle | 0.24s. |
| Splash fade-out | 0.28s crossfade; chrome show/hide 0.18s. |
| Mode-tab underline | slides between tabs (shared-element style). |
| Icon state change (heart, play/pause, alarm) | glyph replace transition, not a hard swap. |
| Edit-mode jiggle | ±2.4° rotation, 1px translate, 280–340ms period, per-tile jitter. |
| Dot-matrix logo | 4.4s loop, seeded animation (see Component idioms). |
| Toasts | slide from bottom + fade; centered cards scale 0.96 + fade. |
| Loading play button | 3 pulsing dots replace the glyph. |

**Reduce Motion / animations-off:** the dot-matrix renders static `rrr`; the
jiggle and decorative transitions stop; functional fades may remain.

**Haptics:** selection tick on drag-reorder; impact feedback on mini-player
swipe stages (arm / rest / close). Android uses the equivalent
`HapticFeedbackConstants`; web has none.

## Iconography

SF Symbols on iOS; the Material Symbols set is the Android mapping (filled
style for filled variants). Custom glyphs (equalizer, dot-matrix) are drawn,
not fonts.

| Meaning | iOS (SF Symbol) | Android (Material) |
|---|---|---|
| Play / pause | `play.fill` / `pause.fill` | `play_arrow` / `pause` |
| Station prev / next | `backward.end.fill` / `forward.end.fill` | `skip_previous` / `skip_next` |
| Favorite | `heart` / `heart.fill` | `favorite` outline / filled |
| Sleep timer | `moon.zzz` / `.fill` | `bedtime` outline / filled |
| Wake alarm | `alarm` / `.fill` | `alarm` outline / filled |
| Tab: Browse | `globe.desk` | `public` |
| Tab: Favorites | `heart` | `favorite` |
| Tab: Library | `folder` | `folder` |
| Display modes list / tiles / app | `list.bullet` / `rectangle.grid.2x2` / `square.grid.3x3` | `list` / `grid_view` / `apps` |
| Settings | `gearshape` | `settings` |
| Search | `magnifyingglass` | `search` |
| Filter | `line.3.horizontal.decrease` | `filter_list` |
| Add | `plus` | `add` |
| Back | `chevron.left` | `chevron_left` (back affordance) |
| Dismiss (player) | `chevron.down` | `keyboard_arrow_down` |
| Close | `xmark` | `close` |
| Sort | `arrow.up.arrow.down` | `swap_vert` |
| On-air | `waveform.mid` (accent) | custom equalizer glyph (accent) |
| Custom station art | `house.fill` | `home` filled |
| Offline | `wifi.slash` | `wifi_off` |
| Car mode | `car.fill` | `directions_car` |
| Playing-from-list badge | `list.bullet` | `list` |
| Delete / rename badges | `minus.circle.fill` / `pencil.circle.fill` | `remove_circle` / `edit` in a circle plate |
| Report states | `checkmark.seal.fill` · `exclamationmark.triangle` · `wrench.and.screwdriver` · `clock` | `verified` · `warning` · `build` · `schedule` |

## Component idioms

- **Station row card** — the 88pt unit: card-fill gradient, `card` radius, 1pt
  `line` stroke, card shadow; circular favicon left, `stationTitle` +
  detail/tag lines, trailing action (heart / equalizer / badge). The playing
  row swaps its trailing glyph for the accent equalizer.
- **Capsule choice group** — the segmented-control grammar: a `bg2` capsule
  containing equal capsule buttons; the selected one fills `buttonFill` with
  `bg` text (≥ 34 tall). Used for theme, display modes, car mode, history level.
- **Panel** — `bg2`, `panel` radius, `line` stroke: settings sections, popup
  cards, toasts.
- **Toasts** — bottom-anchored `bg2` panels (~48 tall) above the tab bar:
  undo-removal ("Removed *name* · **Undo**", accent action, ~5s) and
  broken-report resolution. One toast slot; newest wins.
- **Dot-matrix `rrr` logo** — the brand mark: a 10×7 grid of accent rounded
  tiles (cell 14, gaps 8/7, radius 3) animating "signal → three r's" on a
  seeded 4.4s loop. Serves as launch splash (150×99) and the no-cover artwork
  fallback on Now Playing; static when paused or animations are off.
- **Equalizer glyph** — small accent bars marking the playing station in rows,
  cards, and grids.
- **Initials plate** — circular fallback avatar: `bg3`-tinted fill, mono
  semibold initials, `artworkBorder` ring.

## Android adaptation rules

- **Behavior parity is non-negotiable; pixel parity is not.** Match structure,
  order, states, and interactions from the feature specs exactly; render with
  this spec's tokens.
- **Stock-first for structure and chrome:** where a stock Material 3 component
  delivers the same product behavior with comparable feel, use it —
  `ModalBottomSheet` for sheets, M3 chips/pickers/`Snackbar`/`Switch`, M3 time
  picker for wake. Restyle stock components with these tokens rather than
  rebuilding them.
- **Hand-roll only where visual identity is the product:** Now Playing, mini
  player, station cards, favorites grids, dot-matrix logo, equalizer,
  capsule-choice groups, the tab bar's 2pt-indicator look.
- **No dynamic color (Material You), no platform default type scale for
  branded surfaces** — the palette above is the brand.
- System UI: edge-to-edge with `bg`-matched system bars; predictive
  back/gesture back dismisses overlays before leaving the app; ripple is
  acceptable on stock components, custom cards may use plain press states.
- iOS-only materials (Liquid Glass, Live Activities) map to their Android
  analogues (solid `bg2`; ongoing notification) — never blocked on parity.

## Accessibility

- Contrast: `ink` on `bg`/`bg2` meets WCAG AA in both schemes; never rely on
  accent color alone to mark state (pair with a glyph, underline, or label).
- All controls ≥ 44pt targets; type respects platform font scaling.
- Animations honor the platform reduce-motion setting (see Motion).
- Screen readers get the semantic label, not the visual one (e.g. the mono-caps
  "OPEN IN" eyebrow reads "Open in music services").

## Platform Matrix

| Behavior | Web | iOS | Android |
|---|---|---|---|
| Token palette (bg/ink/line/accent, warm neutrals) | Partial (own CSS realization, same intent) | Reference | Partial (palette landed; token audit pending) |
| Card-fill gradient + scheme-aware shadows | Partial | Reference | Partial |
| Type roles + mono-caps idiom | Partial | Reference | Supported (inline styles, no central scale) |
| Radius scale (4/6/8/12/15/18) | Partial | Reference | Partial |
| 88pt row system + metric table | Partial | Reference | Partial |
| Motion standards + reduce-motion | Partial | Reference | Partial |
| Iconography mapping | Partial (own set) | Reference | Supported (Material Symbols) |
| Dot-matrix logo (splash + artwork fallback) | Supported (web variant) | Reference | Partial (artwork fallback landed; no splash) |
| Haptics | Not applicable | Reference | Planned |

## Open questions

1. Whether web adopts these tokens formally (its CSS predates this doc) or
   stays an intentional variant.
2. Whether a central Compose type scale / design-token file should replace
   Android's inline styles (implementation choice; the values above are the
   contract either way).

## Reference

iOS source (the only place iOS mechanics are named):

- `rrradio/Views/RrradioUI.swift` — radii (`RrradioRadius`), fonts/labels
  (`RrradioFont`, `rrradioLabel`), shadows, control chrome, 44pt target.
- `rrradio/Views/StationKit.swift:6–119` — `RrradioTheme` color tokens +
  `cardFill` gradient; row/tile/grid components; jiggle; delete badges.
- `rrradio/Views/ThemeController.swift` — accent system, presets, per-appearance
  custom hex; `Resources/Assets.xcassets/AccentColor.colorset`.
- `rrradio/Views/DotMatrixLogoView.swift` — dot-matrix grid + timeline.
- `rrradio/Views/ScrollEdgeBlur.swift` — scroll-edge seam treatment.
- `rrradio/Views/NowPlayingView.swift:549–573` — Now Playing type scale.
- `rrradio/Views/MiniPlayerView.swift`, `Views/ContentView.swift` — mini-player
  bar, tab bar metrics, root pager motion.

## Known deviations

None recorded. File new mismatches under `rrradio-ios/internal/audit/` and link
them here.
