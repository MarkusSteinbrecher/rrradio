# rrradio — Internet Radio

A clean, fast internet radio web app deployed as a static site to GitHub Pages. Designed to feel native on mobile (PWA, Media Session API, Add to Home Screen). The web app is **phase one** of a two-phase plan — a future native iOS app (SwiftUI + AVFoundation) mirrors the same UX and station catalog logic. The web version is treated as a working spec: validate catalog integration, metadata strategy, and UX patterns here before writing any Swift.

## Stack

- **Vite + TypeScript**, vanilla DOM (no framework — keep dependencies minimal)
- **HTML5 `<audio>`** for playback (MP3, AAC); **hls.js** for HLS on non-Safari
- **Media Session API** for lock-screen + Bluetooth controls on mobile
- **localStorage** for favorites, recents, custom stations
- **Radio Browser API** (<https://api.radio-browser.info>) for the station catalog — free, community-maintained, multi-mirror
- **Cloudflare Worker** (`worker/`) — GoatCounter proxy, BBC proxy, allowlisted broadcaster CORS proxy
- **iOS** (`ios/`, Phase 2): SwiftUI + AVFoundation, xcodegen project
- **Tests:** Vitest (web + worker), XCTest (iOS), Playwright (e2e). See `docs/testing.md`.

## Deployment

GitHub Pages via `.github/workflows/deploy.yml`. Pushes to `main` build and publish automatically. **Update `vite.config.ts` `base`** to match the repo name (e.g. `/internet-radio/`) before the first deploy.

## Critical conventions

- **Catalog is YAML data** under `data/`, not code. `public/stations.json` is a build artifact (committed so Pages still serves on build failure). See `docs/operations.md`.
- **Stations may bind to a Radio Browser record** via `stationuuid` + `changeuuid` (drift signal) + `reviewedAt`. Per field: **local YAML wins → broadcaster fallback → RB baseline.** See `docs/operations.md`.
- **Strict TypeScript**, no `any` unless commented why. Small focused modules — each file fits on one screen. No premature abstraction.
- **DOM updates go through small render functions**, not scattered `innerHTML`. Refs-based render modules (`src/render-*.ts`) with a typed `*Refs` interface go through the harness in `src/render-test-harness.ts`. See `docs/testing.md`.
- **Repository is public.** Most operational docs (this file included) ship publicly. `AGENTS.md` is a symlink to this file so Codex and Claude read the same operating manual. Internal-only items remain gitignored: `session-log.md` (per-session log), `notes/` (scratch), `*.local.md`, `design_handoff_*/` (design exports), `.claude/` (agent settings). Verify with `git status` before committing; add new internal patterns to `.gitignore` in the same change.

## Constraints

- **Stream reconnection** is the #1 bug source. HTML5 audio doesn't auto-retry well — listen for `error`/`stalled`, rebuild the source. Design for this from Phase 1.
- **HTTPS-only catalog** (audit #71, CI-enforced via `tools/check-catalog.mjs`). Opt out per-station with `httpAllowed: true` + comment.
- **Strict CSP** via `<meta>` + per-page sha256 hashes (audit #75). Never `'unsafe-inline'` in built pages, never `'unsafe-eval'` anywhere. See `design/decisions/decisions-log.md`.
- **Privacy-preserving errors** (audit #76): all errors emit `error: <category>` events to GoatCounter; no stack traces, no PII. See `public/privacy.html`.
- **iOS Safari**: autoplay is blocked until user gesture. Audio-session interruptions (calls, other apps) need explicit handling. See the wake-to-radio architecture in `design/decisions/decisions-log.md`.
- **CORS**: many Shoutcast/Icecast streams omit CORS headers. `<audio>` playback works without CORS; `fetch` / Web Audio access needs them.
- **ICY metadata**: browsers don't expose inline ICY from raw Icecast streams. Prefer stations with separate metadata endpoints; fall back to RB fields.
- **Playlist files**: some stations 302-redirect or serve `.pls` / `.m3u` that need parsing to extract the actual stream URL.

## Status taxonomy (set on every station entry)

| Status | Meaning | Published? |
|---|---|---|
| `working` | stream + metadata + cover all flowing | yes |
| `icy-only` | stream OK, ICY-over-fetch supplies title (no broadcaster fetcher) | yes |
| `stream-only` | plays, no metadata source available | yes |
| `fetcher-todo` | broadcaster API known, fetcher not yet wired | no |
| `investigate` | not researched yet | no |
| `not-public` | auth/session/geo locked (Apple Music, Spotify, …) | no |
| `broken` | URL dead or stream consistently fails | no |

Only the first three publish into the bundled catalog.

## Design intent

- Mobile-first, single-column layout
- Dark theme by default (radios feel right at night)
- Big tap targets, minimal chrome
- Persistent mini-player at bottom of viewport once playback starts
- The "now playing" view should feel like a destination, not a modal

## Pointers

- **Architecture / file map:** `docs/architecture.md`
- **Operations** (catalog, RB linking, curation, telemetry, admin dashboard): `docs/operations.md`
- **Testing** (4 stacks, render harness, what's tested vs not): `docs/testing.md`
- **Decisions:** `design/decisions/decisions-log.md` — catalog format, no backend, HTTPS-only, CSP, privacy errors, wake-to-radio, render harness
- **Public station-adding guide:** `docs/adding-stations.md`
- **Curation playbook:** `docs/curation-checklist.md`
- **Live state:** `session-log.md` and GitHub issues
- **References:** Radio Browser API <https://api.radio-browser.info/>, Media Session API <https://developer.mozilla.org/en-US/docs/Web/API/Media_Session_API>, hls.js <https://github.com/video-dev/hls.js>

## Wiki

The LLM Wiki at `~/Code/HQ/wiki/` is the persistent cross-project knowledge surface. Read its `CLAUDE.md` for conventions. This project's wiki page is at `~/Code/HQ/wiki/projects/rrradio/`. HQ itself is public at <https://github.com/MarkusSteinbrecher/HQ>.

## Issue tracking and task discipline

This project follows the portfolio's spec-first stance per [HQ ADR 0003](https://github.com/MarkusSteinbrecher/HQ/blob/main/wiki/decisions/0003-spec-first-task-tracking.md) (and [ADR 0002 retire-beads](https://github.com/MarkusSteinbrecher/HQ/blob/main/wiki/decisions/0002-retire-beads.md)). **No `bd`, no `beads`, no graph-based task tracker.**

- **Decisions** → ADRs at `design/decisions/`.
- **Per-session work** → `session-log.md` at the project root (gitignored — local-only). Append-only.
- **Active work surface** → GitHub issues at <https://github.com/MarkusSteinbrecher/rrradio/issues>. Use `Closes #N` / `Blocks #N` keywords in PR bodies.
- **Within-session todos** → in-harness only (Claude `TaskCreate` / Codex equivalents). Not persisted across sessions.

Do not install `bd`, do not create `.beads/`, do not add markdown TODO blocks at the top of files. If you discover follow-up work mid-task, file a GitHub issue (or note it in the session log if it's small).

## Non-interactive shell commands

Some shell aliases on the workstation inject `-i` (interactive) into `cp` / `mv` / `rm`, which can hang an agent session waiting for `y/n` input. Always use the non-interactive forms:

```bash
cp -f source dest          # NOT: cp source dest
mv -f source dest          # NOT: mv source dest
rm -f file                 # NOT: rm file
rm -rf directory           # NOT: rm -r directory
cp -rf source dest         # NOT: cp -r source dest
```

Other commands that may prompt: `scp` and `ssh` take `-o BatchMode=yes`; `apt-get` takes `-y`; `brew` takes `HOMEBREW_NO_AUTO_UPDATE=1`.

## Session completion (Landing the Plane)

When ending a work session, complete every step. Work is **not done** until `git push` succeeds and the session log has an entry.

1. **Run quality gates** (if code changed) — typecheck, tests, build, the catalog gates from `tools/check-catalog.mjs`.
2. **Append a session-log entry** at `session-log.md` (root, gitignored). One paragraph: what was done, what's next, friction notes.
3. **File GitHub issues** for any follow-up work that should persist beyond the session.
4. **Push to remote**:
   ```bash
   git pull --rebase
   git push
   git status                  # MUST show "up to date with origin"
   ```
5. **Clean up** — clear stashes, prune merged remote branches.
6. **Verify** — every change committed and pushed; the session-log entry exists.

Never `--no-verify`, never `--no-gpg-sign`, never force-push to `main` without explicit sponsor instruction. If `git push` fails, resolve and retry until it succeeds — don't leave work stranded locally.
