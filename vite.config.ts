import { defineConfig } from 'vite';

// rrradio is served from a custom domain root (https://rrradio.org), so
// the base path is '/' in both production and development.
export default defineConfig({
  base: '/',
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
