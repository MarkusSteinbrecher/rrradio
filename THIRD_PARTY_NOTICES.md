# Third-Party Asset Notices

Last reviewed: 2026-05-12

This file tracks shipped assets and the licensing/provenance assumptions for
rrradio. It is an engineering notice, not legal advice. The MIT license in
`LICENSE` covers this repository's own code, configuration, and documentation;
third-party assets and broadcaster content remain subject to their own terms.

## Project-owned assets

The following assets were created for this project and are distributed with the
repository under the project license unless a future notice says otherwise:

- `docs/wordmark-dark.svg`
- `docs/wordmark-light.svg`
- `design/rrradio_logo_app_dark.svg`
- `design/rrradio_logo_app_light.svg`
- `public/rrradio-logo*.svg`
- `public/favicon.svg`
- `public/og-image.svg`
- `public/og-image.png`
- `ios/LogoSources/rrradio_logo_app_dark.svg`
- `ios/LogoSources/rrradio_logo_app_light.svg`
- `ios/rrradio/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon.png`
- `ios/rrradio/Resources/Assets.xcassets/RrradioLogo.imageset/*`

## System and dependency icons

- iOS uses Apple SF Symbols through `Image(systemName:)` and
  `UIImage(systemName:)`. These are system-provided interface symbols, not
  bundled repo assets. Apple permits them for app UI, but the SF Symbols terms
  prohibit app-icon, logo, and other trademark-like use. Reference:
  <https://developer.apple.com/design/human-interface-guidelines/sf-symbols>
- The Android prototype uses `androidx.compose.material:material-icons-extended`
  through Gradle. Material Symbols/Icons are documented by Google as
  Apache-2.0 licensed. References:
  <https://developer.android.com/jetpack/androidx/releases/compose-material>,
  <https://developers.google.com/fonts/docs/material_symbols>
- Web inline UI icons in `src/icons.ts` and `index.html` are project-authored
  simple SVGs for common interface actions.

## Music service links

The app links current track searches to Apple Music, Spotify, and YouTube
Music. The Now Playing "Open in" row shows each service with its **official,
unmodified** brand mark — we do not hand-recreate these marks.

The marks are vector assets bundled at `public/brand/`:

| File | Mark | Source | Added |
|---|---|---|---|
| `public/brand/apple-music.svg` | Apple Music icon | Official brand asset, taken unmodified from the rrradio-ios app's vetted asset catalog (`rrradio/Resources/Assets.xcassets/AppleMusicIcon.imageset`). | 2026-06-22 |
| `public/brand/spotify.svg` | Spotify icon | Official brand asset, same provenance (`SpotifyIcon.imageset`). | 2026-06-22 |
| `public/brand/youtube-music.svg` | YouTube Music icon | Official brand asset, same provenance (`YouTubeMusicIcon.imageset`). | 2026-06-22 |

These marks are owned by their respective brands, are not covered by the MIT
license, and must be used only to identify the linked service, kept unmodified,
per each brand's guidelines. If a mark is updated, replace it with the official
asset (do not redraw) and keep this record current:

- Apple Music marketing and identity guidelines:
  <https://artists.apple.com/support/1117-apple-music-marketing-tools>,
  <https://marketing.services.apple/apple-music-identity-guidelines>
- Spotify design and branding guidelines:
  <https://developer.spotify.com/documentation/design>
- YouTube brand resources and API branding guidelines:
  <https://www.brand.youtube/>,
  <https://developers.google.com/youtube/terms/branding-guidelines>

## Radio Browser data

Radio Browser is the community directory used for upstream station metadata.
The API docs describe the service as free and open source, including use in
free and non-free software and mirroring of its data. rrradio stores selected
Radio Browser identifiers and may ingest station names, stream URLs, tags,
homepage URLs, favicon URLs, codec, bitrate, and geo fields.

Radio Browser metadata can point at broadcaster-owned or user-submitted assets.
A Radio Browser `favicon` URL is provenance for where the URL came from, not a
license grant from the broadcaster.

References:

- <https://api.radio-browser.info/>
- <https://docs.radio-browser.info/>

## Bundled station logos

Files under `public/stations/` are broadcaster or station brand assets bundled
for display inside the app. They are not owned by rrradio and are not covered by
the MIT license. Use them only to identify the station they represent.

Current bundled logo provenance, reconstructed from commit history:

| File | Station(s) | Known source note | Added |
|---|---|---|---|
| `public/stations/grrif.png` | Grrif | Broadcaster logo; exact source URL not captured in the original commit. | `8082120` |
| `public/stations/fm4.png` | FM4 | ORF/FM4 `touch-icon-android.png` on tubestatic, upgraded from 120px to 192px. | `44e1202`, upgraded in `49faa90` |
| `public/stations/br-bayern1.png` | Bayern 1 | Broadcaster native source found on the BR site; exact source URL not captured in the original commit. | `44e1202` |
| `public/stations/frisky.png` | Frisky channels | Frisky S3-hosted favicon, 212 x 222 PNG. | `261a60a` |

Before adding a new bundled station logo:

1. Prefer an official broadcaster/station page, press kit, media kit, or web app
   manifest over generic image search results.
2. Record the source URL, retrieval date, station ID, and any transform applied
   in the PR body or in this file.
3. Keep the image factual and unmodified except for resizing/cropping needed for
   app display. Do not redraw station marks.
4. If the source terms are unclear, keep the remote `favicon` URL from Radio
   Browser or leave the station logo unset instead of bundling a copy.
5. Do not add third-party platform marks, music-service marks, or app-store
   badges as station logos.

## Remote station favicons

`data/stations.yaml`, generated `public/stations.json`, and Radio Browser
fallbacks can reference remote station `favicon` URLs. Those images are loaded
from the broadcaster or third-party host at runtime; they are not copied into
this repository unless a curator explicitly adds a file under `public/stations/`.

## World map

`public/world-map.svg` is derived from Wikimedia Commons file
`World map - low resolution.svg` by Al MacDonald / @F1LT3R. It is used for the
Browse map view. The repo copy has been stripped/minified for runtime size.

License: Creative Commons Attribution-Share Alike 3.0 Unported.

Attribution:

> World map - low resolution.svg by Al MacDonald / @F1LT3R, via Wikimedia
> Commons, CC BY-SA 3.0. Modified for rrradio by stripping editor metadata and
> minifying the SVG.

References:

- <https://commons.wikimedia.org/wiki/File:World_map_-_low_resolution.svg>
- <https://creativecommons.org/licenses/by-sa/3.0/>

## Audio placeholder

`public/silence.m4a` is an app utility asset used to keep the wake-to-radio
audio session alive. It is generated silence and contains no third-party audio
content.
