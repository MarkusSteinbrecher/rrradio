---
name: curate-logos
description: >
  Curate station logos in the rrradio catalog, one country at a time.
  Runs the wiki + scrape + suspicious-host pipeline, then uses LLM
  judgement for stations the deterministic tools couldn't resolve.
  Trigger when the user types /curate-logos [CC] or asks to "curate
  logos for X", "find logos for Y", "fix the missing favicons in Z".
  Project root: ~/Code/rrradio/. Sonnet-friendly — bounded loops,
  explicit stages, hard cap on LLM-research budget.
version: 1.0.0
---

You are running the rrradio logo-curation sweep. The repo is at
`~/Code/rrradio/`.

**`$ARGUMENTS`** is interpreted as:
- empty → propose the next country to work on and ask the sponsor to confirm
- a 2-letter ISO country code (e.g. `CH`, `DE`, `BR`) → run the full
  pipeline for that country
- `--featured` → cross-country sweep limited to `featured: true` stations

## What you are doing

The rrradio catalog has ~17,000 stations. Logo quality varies from
hand-curated PNGs (4 stations) through scraped broadcaster URLs (~10k)
to blocked-as-sketchy (~560) and outright missing (~1700). The matrix
view at `/station-tracker.html` shows the current state per station —
**Image quality** group columns: Source type, Provenance, License, Tier,
State, Action.

Your job: for a given country, move as many stations as possible from
`state: bad` / `state: warn` into curated, attributed logos with known
license. **You touch one country per session.** Then you stop.

## Hard rules — never violate

- Never modify a station whose `favicon` starts with `stations/` (curated
  local PNG — owned by humans).
- Never modify a station whose `faviconSource` is already one of
  `wiki`, `broadcaster`, `broadcaster-site`, `broadcaster-api` AND that
  also has a `faviconLicense:` set. Those are done; leave them alone.
- Never set `faviconLicense` more permissive than `broadcaster-implicit`
  without an explicit broadcaster grant in writing.
- Never edit `data/broadcasters.yaml`, `tools/*`, `src/*`, or any file
  outside `data/stations.yaml` and `THIRD_PARTY_NOTICES.md`.
- Never bypass `npm run check-catalog` / `check-duplicates` / `npm test`.
  If a gate fails, **fix forward in the YAML** or back out the offending
  row — never `--no-verify`.
- Cap PRs at **30 logo edits per session**. More becomes unreviewable
  and breaches the curate-stations precedent.
- Never run multiple country PRs in one session.

## Read first (every session, no shortcuts)

These are the authority:

1. `CLAUDE.md` in the repo root — catalog conventions, HTTPS-only rule.
2. `docs/curation-checklist.md` — per-activity decision tree.
3. `docs/operations.md` — how the catalog is built, RB binding rules.
4. `tools/wiki-logos.mjs` — header docs the wiki sweep (Phase A audit,
   Phase B article-summary lookup, Phase B fallback via File: namespace
   search on Commons + the country's native-language wiki).
5. `tools/scrape-logos.mjs` — header docs the broadcaster scrape.
6. `tools/flag-suspicious-favicons.mjs` — the quarantine deny-list.
7. `tools/clear-dead-favicons.mjs` — reads station-logo-quality.json and
   blocks favicons whose URL returns HTTP 404 (URL drift cleanup).
8. `tools/probe-logo-sizes.mjs` (`npm run probe-logos`) — measures real
   pixel size / format / bytes per favicon. Powers the NP-quality bucket
   and feeds `clear-dead-favicons`.
9. `THIRD_PARTY_NOTICES.md` — license notes for bundled assets.

## The work loop (per country)

### 1. Pick a country

If `$ARGUMENTS` doesn't include one, build a candidate list:

```bash
cd ~/Code/rrradio
node -e '
const cat = require("./public/stations.json").stations;
const log = require("./public/station-logo-status.json");
const byId = new Map(log.stations.map(s=>[s.id,s]));
const bucket = new Map();
for (const s of cat) {
  if (!s.country) continue;
  const st = byId.get(s.id)?.state;
  if (st !== "bad" && st !== "warn") continue;
  bucket.set(s.country, (bucket.get(s.country)||0)+1);
}
const ranked = [...bucket.entries()].sort((a,b)=>b[1]-a[1]).slice(0,15);
for (const [cc, n] of ranked) console.log(`  ${n.toString().padStart(5)} ${cc}`);
'
```

Show the top 10–15 countries by "stations needing logo work" count.
**Ask the sponsor to pick.** Do not decide unilaterally — they may want
to target a market for business reasons you can't see.

### 2. Scope

Once a country is picked, generate the in-scope list:

```bash
node -e '
const cat = require("./public/stations.json").stations.filter(s=>s.country==="<CC>");
const log = new Map(require("./public/station-logo-status.json").stations.map(s=>[s.id,s]));
const yaml = require("yaml").parse(require("fs").readFileSync("data/stations.yaml","utf8"));
const yamlById = new Map(yaml.map(s=>[s.id,s]));
const candidates = cat
  .filter(s => {
    const ymal = yamlById.get(s.id);
    // skip already-curated
    if (s.favicon && s.favicon.startsWith("stations/")) return false;
    if (["wiki","broadcaster","broadcaster-site","broadcaster-api"].includes(ymal?.faviconSource)
        && ymal?.faviconLicense) return false;
    // needs work
    const state = log.get(s.id)?.state;
    return state === "bad" || state === "warn";
  })
  .sort((a,b) => (b.votes||0) - (a.votes||0))
  .slice(0, 30);
console.log("scope:", candidates.length);
require("fs").writeFileSync("/tmp/curate-logos-scope.txt",
  candidates.map(s=>s.id).join("\n")+"\n");
require("fs").writeFileSync("/tmp/curate-logos-scope.csv",
  candidates.map(s=>s.id).join(","));
'
```

This gives you 30 IDs to work through, prioritised by RB votes. Anything
not in this list is out of scope for this session.

### 2.5. Clear known-dead URLs (do this before the sweeps)

Stations whose listed favicon now 404s (Mastodon avatar rotation, broken
broadcaster CDN paths, …) need their favicon cleared first — otherwise
the dashboard reports them as "has logo" and the curation queue misses
them. `probe-logos` records the HTTP status per favicon; the
`clear-dead-favicons` tool reads that report and blocks the dead ones.

```bash
npm run probe-logos -- --remote                # refresh size+error data
npm run clear-dead-favicons -- --dry-run       # confirm scope
npm run clear-dead-favicons                    # apply
npm run catalog                                # rebuild stations.json
```

Run this **before** the Wikipedia sweep — once the URLs are cleared,
those stations land in the wiki-logos candidate set automatically.

### 3. Wikipedia sweep

```bash
node tools/wiki-logos.mjs --country <CC> --skip-audit --concurrency 4
```

Phase B has two strategies, tried in order per candidate:
1. **Article summary** — looks up `<station name>` on en.wiki then the
   country's native wiki, validates that the article is about a radio
   broadcaster (description-text gate), grabs the lead infobox image.
   Works when the station has its own Wikipedia article.
2. **File: namespace search** — when the article-summary path returns
   nothing, search `commons.wikimedia.org` and the country's native
   wiki for files matching `"Logo <name>"`, `"<name> logo"`, `"<name>"`.
   Score by filename match + "logo" keyword + format (SVG > PNG). This
   is what catches ORF regional radios (`Datei:Logo_Radio_Wien.svg`)
   that don't have their own Wikipedia article. Strict filename gate
   plus a broadcaster-prefix strip (`ORF - Radio Salzburg` →
   `Radio Salzburg`) keep the false-positive rate near zero.

Concurrency 4 keeps Wikipedia happy — bumping it higher trips rate
limits within seconds. Hit rate typically 15–40% per country.

### 4. Broadcaster scrape

Re-derive the still-missing subset (some of the 30 may have been filled
by stage 3) and feed `scrape-logos.mjs`:

```bash
IDS=$(cat /tmp/curate-logos-scope.csv)
node tools/scrape-logos.mjs --id "$IDS" --concurrency 12
```

Hit rate ~25–40% for stations that have a homepage.

### 5. Quarantine

```bash
node tools/flag-suspicious-favicons.mjs
```

If stage 3 or 4 grabbed a fan-upload-host URL (`postimg.cc`, `*.fbcdn.net`,
`blogger.googleusercontent.com`, …), this blocks it. Pure safety net.

### 6. LLM-assisted research — the expensive stage

For stations **still without a usable favicon after stages 3–5**, you do
real research. **Budget: 10 stations per session, no more.**

For each candidate (highest-votes-first):
1. Look up the station name + country + homepage in the YAML.
2. Use `WebSearch` for `"<station name>" <country> radio logo press` — favour
   results on the broadcaster's homepage domain.
3. `WebFetch` the broadcaster's `/press`, `/media-kit`, `/about` pages, or
   the homepage itself. Look for `<meta property="og:image">`, JSON-LD
   `image`, web app manifest icons, apple-touch-icon. Prefer SVG / 500px+
   PNGs.
4. **Validate the candidate.** A logo passes if:
   - URL is `https://`
   - HEAD returns `image/*` content-type
   - Host is the broadcaster's own domain OR a clearly-broadcaster CDN
     (not `i.ibb.co`, `postimg.cc`, fbcdn, etc. — see deny-list in
     `tools/flag-suspicious-favicons.mjs`)
   - Image is roughly square (aspect ratio between 0.8 and 1.2) and
     at least 192×192. Use a hosted size-probe tool or fetch the first
     few KB and parse PNG/JPEG/SVG dimensions; if you can't tell, be
     conservative and skip.
5. If the candidate passes, write to YAML by hand:
   ```yaml
     favicon: <validated URL>
     faviconSource: broadcaster-site   # or wiki / broadcaster-api
     faviconLicense: broadcaster-implicit  # default for broadcaster-hosted
   ```
6. If you can't find a clean candidate, **leave it blocked**. A missing
   logo is better than a sketchy one.

### 7. Verify

```bash
npm run catalog
npm run check-catalog
npm run check-duplicates
npm test -- --run
npm run probe-logos -- --remote     # confirm new URLs probe clean
```

All five must pass. If any fail, fix forward (YAML edit) or back out the
offending row. **Do not bypass with `--no-verify`.** A row whose new
URL probes as `error: HTTP 404` should be backed out — the URL was bad
at write time.

### 8. Open the PR

Branch name: `curate-logos/<cc-lower>-<YYYY-MM-DD>`.

```bash
git checkout -b curate-logos/<cc>-2026-MM-DD
git add data/stations.yaml public/stations.json public/station-logo-status.json public/station-curation.json public/station-duplicates.json ios/rrradio/Resources/stations.fts5.db
git commit -m "curate-logos: <CC> sweep — N stations updated"
git push -u origin curate-logos/<cc>-2026-MM-DD
gh pr create --label catalog-curation --title "curate-logos: ..."  --body "..."
```

PR body must include:
- **Country + scope stats:** how many stations were in scope; how many
  ended in `state: ok`.
- **Per-stage breakdown:** wiki found N, scrape found N, quarantine
  blocked N, LLM research found N.
- **What you LLM-researched and skipped** — name the stations + the
  reason (no clean candidate, ambiguous, …). This is the audit trail.
- **Verification:** confirm all four gates passed.

Stop after opening the PR. **Do not merge.** The sponsor reviews.

## Stop conditions

- Stop if scrape hit rate is <5% on >50 attempts — signals the country's
  broadcasters mostly don't have homepages, or your network is blocked.
- Stop if LLM research finds <2 valid candidates in the first 5 — you're
  burning tokens for nothing; flag the country as "needs manual research"
  in the PR and move on.
- Stop if the YAML diff is >2000 lines — runaway change, probably a bug
  in the tooling. Don't commit.
- Stop and ask if `npm run check-duplicates` reports new collisions —
  could mean you grabbed the same logo for two stations.

## When you're done

Report to the sponsor:
- PR URL
- One-line summary table:

  | stage  | inserted |
  |--------|----------|
  | wiki   | …        |
  | scrape | …        |
  | LLM    | …        |
  | total  | …        |

- One line per still-missing station (5 max) — names + the reason the
  agent couldn't find a logo.
- Suggested next country, sorted by attention count.

Do not start the next country yourself.

## Cost note

Per-country session, Sonnet:
- Stages 1–5 (deterministic): ~3–5 min wall clock, ~$0.10 in LLM tokens
  (orchestration + reading verdict JSON).
- Stage 6 (LLM research): ~$0.05 per station × 10 = $0.50.
- Total per country: **~$0.60–$1.00**, well under the curate-stations
  cost per country.

If a country has >500 in-scope stations and stage 5 still leaves dozens
missing, do not try to LLM-research them all in one session. Open the
PR with the top 10 results, note the residual count, and move on.
