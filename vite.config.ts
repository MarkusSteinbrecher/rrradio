import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

// Build version stamp — short git SHA + ISO date. Audit #76: surfaces
// in runtime error events so a regression can be tied back to a commit
// without leaving a stack trace in the wire. Falls back to "dev" when
// git isn't available (e.g. building from a tarball).
function buildVersion(): string {
  try {
    const sha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    const date = new Date().toISOString().slice(0, 10);
    return `${sha}@${date}`;
  } catch {
    return 'dev';
  }
}

// rrradio is served from a custom domain root (https://rrradio.org), so
// the base path is '/' in both production and development.
export default defineConfig({
  base: '/',
  define: {
    __BUILD_VERSION__: JSON.stringify(buildVersion()),
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
