# Logo-fill judge — runbook for the scheduled session

The catalog quality loop finds logos for stations that have none
(`docs/station-health.md`, "fill-logo (rule 9)"). Finding and guarding is
done by CI every morning. The last step — *is this picture really this
station's logo?* — is done by a scheduled Claude session following this
page. It uses no API key: the session looks at contact sheets and writes
verdicts; the next morning's CI run applies every `yes`.

The session judges. It does not search for logos, edit the catalog, open
pull requests or touch `main`.

## Schedule

A Claude Code routine named "rrradio logo-fill judge" runs this page daily
at 20:00 UTC on the always-on Mac mini (bridge environment, its own
checkout and git credentials), well after the morning `station-probe` and
`catalog-actions` runs. It works in scratch worktrees of `origin/main` and
`origin/health-data` and leaves the mini's checkout alone. Manage it at
<https://claude.ai/code/routines>. It stops with "not merged yet" while this
page is missing from `main`.

## Steps

Run from a checkout of this repository on an up-to-date `main`
(`git pull --ff-only`; `npm ci` if `node_modules` is missing).

1. Get today's queue. Use a scratch directory outside the repository:

   ```bash
   WORK="$(mktemp -d)"
   git fetch origin health-data
   git worktree add --detach "$WORK/hd" origin/health-data
   node tools/logo-fill-judge.mjs sheets --data "$WORK/hd" --out "$WORK/judge"
   ```

   If it prints "nothing awaits a verdict", go to step 5.

2. Look at every `sheet-NN.png` it wrote (20 numbered tiles each, on the
   app's dark background) next to the number → station list it printed
   (also in `batch.json`).

3. Write a verdict for every number into `$WORK/judge/answers.json` — the
   file is pre-filled with `n` and `id`; set `verdict` and a short `why`.
   Rubric below. Never change `n` or `id`.

4. Record and publish the verdicts:

   ```bash
   node tools/logo-fill-judge.mjs record --data "$WORK/hd" --out "$WORK/judge"
   git -C "$WORK/hd" add logo-fill/verdicts.json
   git -C "$WORK/hd" commit -m "logo-fill: verdicts $(date -u +%Y-%m-%d)"
   git -C "$WORK/hd" pull --rebase origin health-data
   git -C "$WORK/hd" push origin HEAD:health-data
   ```

   If the push is rejected, pull `--rebase` and push again (up to three
   times). `record` refuses the whole file when an answer is invalid — fix
   `answers.json` and run it again. Commit nothing but
   `logo-fill/verdicts.json`.

5. Clean up: `git worktree remove --force "$WORK/hd"`. Report how many were
   yes / no / unsure and anything odd (a sheet that would not render, a
   push that failed).

## Rubric

Each tile is one image taken from that station's own website. Decide
whether it is that station's logo or brand mark.

- **yes** — a designed brand mark that fits the station: it shows the
  station's name, initials, frequency or call sign, or it is a distinctive
  emblem a station of that name would plausibly use. The mark of the parent
  broadcaster or network also counts (a sub-channel often has none of its
  own; a rebrand shows the new name on the station's own site).
- **no** — something else: generic clip-art (a plain microphone,
  headphones, a play button, audio bars, a globe), a photograph, a banner
  or advert, a cropped or blank image, a "hotlinking not allowed" picture,
  or the brand of a different organisation. Add `"generic": true` when it
  is the default icon of a website builder, framework, hosting panel or
  streaming platform (a Vite or WordPress logo, a platform's own mark):
  that picture is then rejected automatically wherever it turns up.
- **unsure** — you cannot tell. A wrong logo in the catalog is worse than a
  missing one, so do not guess; an abstract shape with no name on it is
  `unsure` unless you recognise the brand.

Shape and size are not reasons for `no`: a wide wordmark that is the right
brand is a `yes`. Whether it fits the app's round frame is a display
matter.

## What happens next

- `yes` → the next `catalog-actions` run proposes `fill-logo`: automatic for
  long-tail stations, a review PR for curated ones.
- `no` / `unsure` → the station is left with its placeholder and not looked
  at again for 30 days.
- Not answered → stays in the queue. Unjudged candidates expire after 21
  days; the finder stops queueing at 400 waiting.

The public dashboard (`/catalog-health`, under "Logo issues") shows how many
candidates are waiting and since when — a number that only grows means this
session is not running.
