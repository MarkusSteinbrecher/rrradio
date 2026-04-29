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

## Privacy

No cookies. Your favorites, theme choice, and recently-played
stations are stored on your device only (browser `localStorage`) —
they never leave your machine.

Anonymous pageview analytics provided by
[GoatCounter](https://www.goatcounter.com/). No user IDs, no
cross-site tracking, IPs are hashed and discarded within hours.

## Source

Built with HTML, CSS, TypeScript and a healthy distrust of
dependencies.

## Imprint

rrradio.org is a non-commercial side project.

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:5173.

## Build

```bash
npm run build
npm run preview   # preview the production build locally
```

## Deploy to GitHub Pages

1. Set the `base` in `vite.config.ts` to `/<your-repo-name>/`.
2. Push to `main`. The GitHub Actions workflow builds and publishes to the
   `gh-pages` branch automatically.
3. In repo settings → Pages, point the source at the `gh-pages` branch.
