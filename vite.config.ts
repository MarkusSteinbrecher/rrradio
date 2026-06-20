import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

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

interface ManualLogoPatch {
  id: string;
  url: string;
  source: 'manual';
  license: 'broadcaster-implicit';
  faviconOk: true;
}

const manualLogoPatchPath = resolve(__dirname, '.local/manual-logo-patches.json');

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readRequestJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolveJson, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('error', reject);
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolveJson(text ? JSON.parse(text) : null);
      } catch (err) {
        reject(err);
      }
    });
  });
}

function sendJson(res: ServerResponse, status: number, payload: Record<string, unknown>): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload, null, 2));
}

function readManualLogoPatches(): ManualLogoPatch[] {
  if (!existsSync(manualLogoPatchPath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(manualLogoPatchPath, 'utf8'));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is ManualLogoPatch => {
      const row = asRecord(entry);
      return row?.source === 'manual'
        && row.license === 'broadcaster-implicit'
        && row.faviconOk === true
        && typeof row.id === 'string'
        && typeof row.url === 'string';
    });
  } catch {
    return [];
  }
}

function localLogoPatchPlugin(): Plugin {
  return {
    name: 'rrradio-local-logo-patches',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/local/logo-patches', async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
          return;
        }
        try {
          const body = asRecord(await readRequestJson(req));
          const id = typeof body?.id === 'string' ? body.id.trim() : '';
          const url = typeof body?.url === 'string' ? body.url.trim() : '';
          if (!id) {
            sendJson(res, 400, { ok: false, error: 'missing-id' });
            return;
          }
          if (!url.startsWith('https://') && !url.startsWith('stations/')) {
            sendJson(res, 400, { ok: false, error: 'logo-url-must-be-https-or-local' });
            return;
          }

          const next: ManualLogoPatch = {
            id,
            url,
            source: 'manual',
            license: 'broadcaster-implicit',
            faviconOk: true,
          };
          const patches = readManualLogoPatches().filter((entry) => entry.id !== id);
          patches.push(next);
          patches.sort((a, b) => a.id.localeCompare(b.id));
          mkdirSync(resolve(__dirname, '.local'), { recursive: true });
          writeFileSync(manualLogoPatchPath, JSON.stringify(patches, null, 2) + '\n');
          sendJson(res, 200, {
            ok: true,
            path: '.local/manual-logo-patches.json',
            count: patches.length,
            command: 'npm run apply-logos -- --in .local/manual-logo-patches.json --replace',
          });
        } catch (err) {
          sendJson(res, 500, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      });
    },
  };
}

function localRouteAliasPlugin(): Plugin {
  return {
    name: 'rrradio-local-route-alias',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/style') req.url = '/style/';
        // Mirror GitHub Pages' extensionless serving for the static App
        // Store pages (public/ios.html → /ios, public/support.html →
        // /support) so local dev matches production. The richer landing
        // keeps its own route at /rrradio-ios/.
        if (req.url === '/ios') req.url = '/ios.html';
        if (req.url === '/support') req.url = '/support.html';
        next();
      });
    },
  };
}

// Dev-only viewer for the product spec (docs/spec/) at /spec/. The static
// HTML is generated by tools/spec-site/generate.py into tools/spec-site/out/
// (gitignored) and regenerated lazily whenever a spec markdown file is newer
// than the generated index — so the rendered site tracks spec edits without a
// server restart. Never part of the production build (`apply: 'serve'`).
const specSiteDir = resolve(__dirname, 'tools/spec-site');
const specSiteOut = resolve(specSiteDir, 'out');
const specSourceDir = resolve(__dirname, 'docs/spec');

function newestSpecSourceMtimeMs(dir: string): number {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, newestSpecSourceMtimeMs(path));
    } else if (entry.name.endsWith('.md')) {
      newest = Math.max(newest, statSync(path).mtimeMs);
    }
  }
  return newest;
}

function regenerateSpecSiteIfStale(): void {
  try {
    const indexPath = join(specSiteOut, 'index.html');
    const builtAt = existsSync(indexPath) ? statSync(indexPath).mtimeMs : 0;
    const sourcesAt = Math.max(
      newestSpecSourceMtimeMs(specSourceDir),
      statSync(join(specSiteDir, 'generate.py')).mtimeMs,
    );
    if (sourcesAt <= builtAt) return;
    execSync('python3 tools/spec-site/generate.py', { cwd: __dirname, stdio: 'pipe' });
  } catch (err) {
    console.warn('[spec-site] generation failed:', err instanceof Error ? err.message : err);
  }
}

const specSiteContentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

function specSitePlugin(): Plugin {
  return {
    name: 'rrradio-spec-site',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/spec', (req, res) => {
        regenerateSpecSiteIfStale();
        // connect strips the '/spec' mount prefix from req.url.
        const rawPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
        let filePath = resolve(specSiteOut, `.${rawPath === '' ? '/' : rawPath}`);
        if (!filePath.startsWith(specSiteOut + sep) && filePath !== specSiteOut) {
          res.statusCode = 403;
          res.end('forbidden');
          return;
        }
        if (existsSync(filePath) && statSync(filePath).isDirectory()) {
          filePath = join(filePath, 'index.html');
        }
        if (!existsSync(filePath)) {
          res.statusCode = 404;
          res.setHeader('content-type', 'text/plain; charset=utf-8');
          res.end('not found — run `npm run spec-site` if the spec site has never been generated');
          return;
        }
        res.statusCode = 200;
        res.setHeader(
          'content-type',
          specSiteContentTypes[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
        );
        res.end(readFileSync(filePath));
      });
    },
  };
}

// rrradio is served from a custom domain root (https://rrradio.org), so
// the base path is '/' in both production and development.
export default defineConfig({
  base: '/',
  plugins: [localRouteAliasPlugin(), localLogoPatchPlugin(), specSitePlugin()],
  define: {
    __BUILD_VERSION__: JSON.stringify(buildVersion()),
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        stationTracker: resolve(__dirname, 'station-tracker.html'),
        style: resolve(__dirname, 'style/index.html'),
        rrradioIos: resolve(__dirname, 'rrradio-ios/index.html'),
      },
    },
  },
});
