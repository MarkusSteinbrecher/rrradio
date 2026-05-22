import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';
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

// rrradio is served from a custom domain root (https://rrradio.org), so
// the base path is '/' in both production and development.
export default defineConfig({
  base: '/',
  plugins: [localLogoPatchPlugin()],
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
      },
    },
  },
});
