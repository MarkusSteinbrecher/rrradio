import { defineConfig } from 'vite';

// '/<repo-name>/' for GitHub Pages project sites, '/' for local dev.
const base = process.env.GITHUB_PAGES === 'true' ? '/rrradio/' : '/';

export default defineConfig({
  base,
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
