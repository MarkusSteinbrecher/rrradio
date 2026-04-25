# Internet Radio

A static internet radio web app. Phase one of a two-phase plan; iOS app to follow.

See [`CLAUDE.md`](./CLAUDE.md) for full project context.

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
