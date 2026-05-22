#!/usr/bin/env node
/**
 * Browser audio probe.
 *
 * This intentionally uses Chromium + an HTMLAudioElement instead of
 * Node fetch. It mirrors the web player path closely enough for
 * curation checks: set the stream on an audio element, use hls.js for
 * non-native HLS, click a real play button, then wait for playback
 * time to advance.
 *
 * Usage:
 *   npm run probe:browser -- '<stream-url>'
 *   npm run probe:browser -- --json --timeout 30000 '<stream-url>'
 */

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const hlsPackageDir = dirname(require.resolve('hls.js/package.json'));
const HLS_SCRIPT_PATH = join(hlsPackageDir, 'dist', 'hls.light.min.js');

const args = process.argv.slice(2);

function flag(name) {
  return args.includes(name);
}

function value(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
}

function collectUrls() {
  const urls = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      if (['--timeout', '--advance'].includes(arg)) i++;
      continue;
    }
    urls.push(arg);
  }
  return urls;
}

const urls = collectUrls();
const timeoutMs = Math.max(1_000, Number(value('--timeout', '20000')) || 20_000);
const advanceSeconds = Math.max(0.1, Number(value('--advance', '1')) || 1);
const json = flag('--json');
const headed = flag('--headed');

if (urls.length === 0) {
  console.error('usage: node tools/browser-audio-probe.mjs [--json] [--headed] [--timeout MS] [--advance SECONDS] <stream-url> [...]');
  process.exit(1);
}

function exitCodeFor(results) {
  return results.every((r) => r.verdict === 'ok') ? 0 : 2;
}

function printText(result) {
  const head = result.verdict === 'ok' ? 'OK' : 'FAIL';
  const hls = result.hls?.used ? ' hls.js' : '';
  console.log(`${head.padEnd(5)} ${result.url}`);
  console.log(`      ${result.reason}${hls}`);
  console.log(
    `      currentTime=${result.currentTime.toFixed(2)}s ` +
    `readyState=${result.readyState} networkState=${result.networkState} ` +
    `elapsed=${result.elapsedMs}ms`,
  );
  if (result.events.length > 0) {
    const eventLine = result.events
      .slice(-12)
      .map((event) => `${event.name}@${event.t}ms`)
      .join(' ');
    console.log(`      events: ${eventLine}`);
  }
  if (result.hls?.errors?.length) {
    const errorLine = result.hls.errors
      .slice(-3)
      .map((err) => `${err.type}/${err.details}${err.fatal ? '/fatal' : ''}`)
      .join(' ');
    console.log(`      hls: ${errorLine}`);
  }
}

async function createPage(browser) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: false,
    viewport: { width: 900, height: 500 },
  });
  await context.route('https://rrradio-probe.local/**', (route) => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: `<!doctype html>
      <html>
        <body>
          <button id="play" type="button">Play</button>
          <div id="status"></div>
        </body>
      </html>`,
  }));
  const page = await context.newPage();
  await page.goto('https://rrradio-probe.local/probe');
  if (existsSync(HLS_SCRIPT_PATH)) {
    await page.addScriptTag({ path: HLS_SCRIPT_PATH });
  }
  return page;
}

async function probeInPage(page, url) {
  await page.evaluate(({ streamUrl, timeout, advance }) => {
    window.__probeResult = null;
    window.__probePromise = null;
    const button = document.getElementById('play');
    const status = document.getElementById('status');
    button.onclick = () => {
      window.__probePromise = new Promise((resolve) => {
        const startedAt = performance.now();
        const events = [];
        const hlsErrors = [];
        const audio = document.createElement('audio');
        let hls = null;
        let settled = false;
        let maxCurrentTime = 0;
        let interval = 0;
        let timer = 0;

        audio.controls = true;
        audio.preload = 'auto';
        document.body.append(audio);

        const record = (name, extra = {}) => {
          if (events.length >= 80) return;
          events.push({
            name,
            t: Math.round(performance.now() - startedAt),
            currentTime: Number(audio.currentTime.toFixed(3)),
            readyState: audio.readyState,
            networkState: audio.networkState,
            ...extra,
          });
        };

        const mediaErrorMessage = () => {
          const err = audio.error;
          if (!err) return 'media element error';
          const labels = {
            1: 'playback aborted',
            2: 'network error',
            3: 'decode error',
            4: 'source not supported',
          };
          return labels[err.code] || `media error ${err.code}`;
        };

        const finish = (verdict, reason) => {
          if (settled) return;
          settled = true;
          window.clearInterval(interval);
          window.clearTimeout(timer);
          try { audio.pause(); } catch {}
          try { hls?.destroy(); } catch {}
          const result = {
            url: streamUrl,
            verdict,
            reason,
            elapsedMs: Math.round(performance.now() - startedAt),
            currentTime: maxCurrentTime,
            readyState: audio.readyState,
            networkState: audio.networkState,
            paused: audio.paused,
            ended: audio.ended,
            hls: {
              used: !!hls,
              supported: !!window.Hls?.isSupported?.(),
              errors: hlsErrors,
            },
            events,
          };
          window.__probeResult = result;
          if (status) status.textContent = `${verdict}: ${reason}`;
          resolve(result);
        };

        for (const eventName of [
          'loadstart',
          'loadedmetadata',
          'loadeddata',
          'canplay',
          'canplaythrough',
          'playing',
          'waiting',
          'stalled',
          'suspend',
          'timeupdate',
          'pause',
          'ended',
          'error',
        ]) {
          audio.addEventListener(eventName, () => {
            record(eventName, eventName === 'error' ? { error: mediaErrorMessage() } : {});
            if (eventName === 'error') finish('error', mediaErrorMessage());
          });
        }

        const isHls = /\.m3u8(?:[?#]|$)/i.test(streamUrl);
        const hasNativeHls = !!audio.canPlayType('application/vnd.apple.mpegurl');
        if (isHls && !hasNativeHls && window.Hls?.isSupported?.()) {
          hls = new window.Hls({ enableWorker: false });
          hls.on(window.Hls.Events.MEDIA_ATTACHED, () => {
            record('hls-media-attached');
            hls.loadSource(streamUrl);
          });
          hls.on(window.Hls.Events.MANIFEST_PARSED, () => record('hls-manifest-parsed'));
          hls.on(window.Hls.Events.FRAG_LOADED, () => record('hls-frag-loaded'));
          hls.on(window.Hls.Events.ERROR, (_event, data) => {
            hlsErrors.push({
              type: data?.type,
              details: data?.details,
              fatal: !!data?.fatal,
            });
            record('hls-error', {
              type: data?.type,
              details: data?.details,
              fatal: !!data?.fatal,
            });
            if (data?.fatal) finish('error', `fatal hls.js error: ${data.details || data.type || 'unknown'}`);
          });
          hls.attachMedia(audio);
        } else {
          audio.src = streamUrl;
        }

        interval = window.setInterval(() => {
          maxCurrentTime = Math.max(maxCurrentTime, audio.currentTime || 0);
          if (maxCurrentTime >= advance) {
            finish('ok', `audio clock advanced ${maxCurrentTime.toFixed(2)}s`);
          }
        }, 250);

        timer = window.setTimeout(() => {
          maxCurrentTime = Math.max(maxCurrentTime, audio.currentTime || 0);
          const reason =
            `timed out after ${timeout}ms before ${advance}s of playback ` +
            `(currentTime=${maxCurrentTime.toFixed(2)}s, readyState=${audio.readyState})`;
          finish('timeout', reason);
        }, timeout);

        audio.play()
          .then(() => record('play-resolved'))
          .catch((err) => finish('play-rejected', `${err?.name || 'Error'}: ${err?.message || String(err)}`));
      });
    };
  }, { streamUrl: url, timeout: timeoutMs, advance: advanceSeconds });

  await page.click('#play');
  return page.evaluate(() => window.__probePromise);
}

let browser;
try {
  browser = await chromium.launch({ headless: !headed });
} catch (err) {
  const msg = String(err);
  const hint = /Permission denied|bootstrap_check_in|MachPortRendezvous/i.test(msg)
    ? 'Chromium launch was blocked by the local sandbox. Run the same command with local execution approval.'
    : 'Run `npm run test:e2e:install` if Playwright browsers are not installed.';
  console.error(`browser-audio-probe: failed to launch Chromium. ${hint}`);
  console.error(msg);
  process.exit(1);
}

const results = [];
try {
  const page = await createPage(browser);
  for (const url of urls) {
    results.push(await probeInPage(page, url));
  }
} finally {
  await browser.close();
}

if (json) {
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
} else {
  for (const result of results) printText(result);
}

process.exit(exitCodeFor(results));
