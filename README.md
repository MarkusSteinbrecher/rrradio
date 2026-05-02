<p align="center">
  <a href="https://rrradio.org">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="docs/wordmark-dark.svg">
      <img alt="rrradio.org" src="docs/wordmark-light.svg" width="480">
    </picture>
  </a>
</p>

<p align="center">
  Minimal, ad-free internet radio in your browser.
</p>

## Play

A simple player for live radio streams from around the world.
Designed to feel native on mobile — works on the lock screen,
survives backgrounding, supports bluetooth controls.

## Features

- 🔎 **Browse & search** — curated stations (FM4, BBC 1–6, Ö1, FIP, RAI, Bayern, Grrif…) plus thousands more from [Radio Browser](https://www.radio-browser.info/), filterable by genre, country, or map.
- 🔒 **Lock-screen controls** — play, pause, and skip stations from the iOS / Android Now Playing widget, bluetooth headphones, AirPods squeeze, and CarPlay. Skip cycles through your favorites.
- ❤️ **Favorites & recents** — heart anything to save it. Drag favorites into your preferred dial order. Recently-played fills in automatically.
- ⏰ **Wake to radio** — pick a station + time, leave the phone by the bed. A silent bed keeps the tab alive on lock; at wake time it plays your station at the phone's hardware volume.
- 🌙 **Sleep timer** — auto-stop after 15, 30, 60, or 90 minutes.
- 🎵 **Now-playing track** — current artist and title from station metadata, plus lyrics from [LRCLIB](https://lrclib.net/) / [Lyrics.ovh](https://lyrics.ovh/) when available.
- 📅 **On-air schedule** — show name and the day's grid for major broadcasters (BBC, BR, ORF, HR).
- 🌍 **Map view** — a world globe of curated stations; tap a marker to play.
- 🎨 **Three color themes**, each in light or dark.
- ➕ **Add custom streams** — paste a stream URL and it's saved to this browser.

## Free, no ads

- No signup. Nothing to log into.
- No ads, no tracking pixels, no cookie banners.
- Anonymous pageview counts only — no user IDs.
- No app to install. It's a website.

## Catalog

Curated stations are hand-picked. Each one shows up to three small
stars next to its tags:

⭐ we've verified the stream plays.

⭐⭐ we also surface the current track.

⭐⭐⭐ we also show the on-air program and a day's schedule.

The wider catalog comes from [Radio Browser](https://www.radio-browser.info/),
a community-maintained directory of internet radio stations around
the world. Thank you to the contributors there 🙏. You can add your
own stream via the + button — your private list lives in this browser
only.

## Program

For some broadcasters (BBC, BR, ORF, HR) we fetch the on-air schedule
alongside the stream. The current show name appears next to the live
cover; tap the calendar icon to flip into the day's full grid — what's
on now, what's coming up, and what just finished.

Adding a new broadcaster's schedule means writing a small fetcher in
the source. The four wired today cover most of the English- and
German-language curated catalog.

## Lyrics

When a station broadcasts proper artist + track metadata, we look up
lyrics from [LRCLIB](https://lrclib.net/) first, then
[Lyrics.ovh](https://lyrics.ovh/) as a fallback. Both are free,
community-maintained, and don't require signup. Thank you to the
contributors there 🙏. Tap the lyrics icon next to the live cover to
flip into the lyrics view; it appears only when something matches.
Coverage skews mainstream pop / rock — the lyrics tab quietly
disappears when there's nothing to show.

## Privacy

No cookies. Your favorites, theme choice, and recently-played
stations are stored on your device only (browser `localStorage`) —
they never leave your machine.

Anonymous pageview analytics provided by
[GoatCounter](https://www.goatcounter.com/). No user IDs, no
cross-site tracking, IPs are hashed and discarded within hours.

## Source

Built with HTML, CSS, TypeScript and a healthy distrust of
dependencies. Released under the [MIT License](./LICENSE).

## Imprint

rrradio.org is a non-commercial side project.

## Quick start

Node version is pinned in `.nvmrc` (currently 20). With nvm:

```bash
nvm use         # pick the version from .nvmrc
npm install
npm run dev
```

Open http://localhost:5173.

## Tests

```bash
npm test           # one-shot run
npm run test:watch # interactive
```

## Build

```bash
npm run build      # tsc + vite build + per-station HTML pages
npm run preview    # preview the production build locally
```

The build does **not** regenerate the catalog. It consumes the
already-committed `public/stations.json` so a routine deploy
(CSS tweak, bug fix) doesn't depend on Radio Browser being up.

## Catalog refresh

`public/stations.json` is the build artifact derived from
`data/stations.yaml` + `data/broadcasters.yaml` + the live Radio
Browser API. Regenerate it explicitly when you edit the YAML or when
upstream RB data has drifted:

```bash
npm run catalog          # fetches RB, rewrites public/stations.json
npm run check-catalog    # verifies YAML ↔ JSON are in sync
npm run check-duplicates # verifies no uuid / stream / name collisions
git add public/stations.json && git commit -m "..."
```

A weekly GitHub Action (`catalog-watch.yml`) runs the same refresh
and commits any RB drift back to `main` automatically. Deploy CI
runs `check-catalog` + `check-duplicates` on every PR so a missed
local regen blocks the merge.

## Deploy to GitHub Pages

1. Set the `base` in `vite.config.ts` to `/<your-repo-name>/`.
2. Push to `main`. The GitHub Actions workflow builds and publishes to the
   `gh-pages` branch automatically.
3. In repo settings → Pages, point the source at the `gh-pages` branch.
