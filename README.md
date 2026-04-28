<p align="center">
  <a href="https://rrradio.org">
    r r r a d i o . o r g
  </a>
</p>

<p align="center">
  A minimal, ad-free internet radio app. No cookies, no signup. Work in progress.
</p>

## Where the stations come from

There are two catalogs, with very different roles:

1. **Curated catalog** — `data/stations.yaml`, hand-edited and auto-grown
   via the catalog-watch workflow. Ships bundled with the deploy as
   `public/stations.json`. Stations here have been probed, get a logo,
   and (when relevant) a per-broadcaster metadata fetcher in
   `src/builtins.ts`. Rows for these stations show a small accent star
   in the UI as a quality mark.
2. **Long-tail** — fetched live from [Radio Browser]
   (https://api.radio-browser.info), a free, community-edited catalog
   with ~50,000 stations. CORS-enabled, no auth, multiple mirrors.
   Powers search results and tag filters. Nothing about this list is
   stored locally — every search hits the API.

The bridge between the two: when visitors press play on a long-tail
Radio Browser station, GoatCounter logs a `play: <name>` event. The
weekly catalog-watch workflow reads those, looks the popular ones up
on Radio Browser to harvest stream URL + tags + favicon, probes the
stream, and opens a PR adding YAML stubs at `status: stream-only`.
Merging the PR promotes them into the curated catalog.

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
