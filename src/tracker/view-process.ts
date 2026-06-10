/**
 * Process — how the station catalog is built and quality-checked, step by
 * step. This page is the operational summary; the precise reference lives in
 * the repo docs it links to (docs/operations.md, docs/curation-checklist.md,
 * docs/station-health.md). Keep the two in sync when the pipeline changes.
 */

import { el, badge, sectionHeader } from './ui';

const REPO = 'https://github.com/MarkusSteinbrecher/rrradio/blob/main';

type Cadence = 'weekly CI' | 'per-commit CI' | 'manual' | 'dev chain';

interface Step {
  title: string;
  cadence: Cadence[];
  what: string[];
  io: [string, string][];
}

const STEPS: Step[] = [
  {
    title: 'Source ingest — snapshot the upstream catalogs',
    cadence: ['manual'],
    what: [
      'npm run fetch-rb-raw downloads the Radio Browser catalog (~55k stations) into per-country snapshots; snapshots younger than 7 days are reused.',
      'Manually maintained sources (data/sources.yaml) are normalised by npm run extract-manual-source.',
    ],
    io: [
      ['input', 'Radio Browser API (api.radio-browser.info), data/sources.yaml'],
      ['output', 'data/sources/radio-browser/by-country/<CC>.json'],
    ],
  },
  {
    title: 'Dedupe — decide what counts as the same station',
    cadence: ['dev chain'],
    what: [
      'npm run dedupe-raw groups raw candidates with the FEED → FAMILY → DISTINCT identity model: identical streams collapse (FEED), regional/sub-brand siblings group (FAMILY), everything else stays separate (DISTINCT).',
      'Identity signals are tried strongest-first: stationuuid → exact stream URL → normalised stream fingerprint → name+host signature → family tag.',
    ],
    io: [
      ['input', 'data/sources/radio-browser/by-country/*.json'],
      ['output', 'data/sources/radio-browser/dedupe.json (+ overrides in overrides.yaml)'],
    ],
  },
  {
    title: 'Playability analysis — can a browser actually play it?',
    cadence: ['manual'],
    what: [
      'npm run analyze-rb -- <CC> probes every candidate stream in a country: HTTP fetch with browser headers, byte-signature check (npm run probe:bytes), playlist parsing, mixed-content detection.',
      'Suspicious verdicts escalate to a real Chromium playback probe (npm run probe:browser) — the strongest evidence we collect.',
      'Verdicts: ok / ok-hls / needs-playlist / redirect-downgrade / broken-url / broken-mixed / broken-network / broken-format / probe-inconclusive.',
    ],
    io: [
      ['input', 'dedupe.json + country snapshots'],
      ['output', 'public/rb-analysis-<CC>.json (re-probe skipped under 14 days)'],
    ],
  },
  {
    title: 'Import — promote candidates into the catalog YAML',
    cadence: ['weekly CI', 'manual'],
    what: [
      'The weekly auto-curate step takes GoatCounter top-played stations that are not yet curated, looks them up in Radio Browser, probes the stream, and opens a PR with status: stream-only stubs.',
      'Bulk imports of playable candidates go through npm run import-playable (curator-reviewed).',
      'Every entry binds to its Radio Browser record via stationuuid + changeuuid (the drift baseline) + reviewedAt.',
    ],
    io: [
      ['input', 'GoatCounter top-plays, rb-analysis verdicts'],
      ['output', 'data/stations.yaml entries (via PR, label auto-curate)'],
    ],
  },
  {
    title: 'Curation — graduate a station toward `working`',
    cadence: ['manual'],
    what: [
      'Per-station promotion follows docs/curation-checklist.md: confirm the stream, enforce HTTPS, check ICY titles, wire a metadata API (npm run wire-metadata auto-derives known broadcasters), match a fetcher key in src/builtins.ts, settle the logo, verify tags.',
      'Status graduates stream-only → icy-only (ICY titles flow) → working (broadcaster API + curated logo).',
      'Per field, the merge rule is: local YAML wins → broadcaster fallback → Radio Browser baseline.',
    ],
    io: [
      ['input', 'data/stations.yaml, data/broadcasters.yaml'],
      ['output', 'updated YAML entries with bumped reviewedAt'],
    ],
  },
  {
    title: 'Logos — find, license-check, and bundle station art',
    cadence: ['weekly CI', 'manual'],
    what: [
      'npm run logo-status classifies every favicon (curated local / good remote / weak / generic / non-free wiki / missing) and queues the next action per station; it runs weekly in CI and feeds the logo facet.',
      'Improvement batches run the scrapers: scrape-logos (broadcaster homepages), wiki-logos (Wikimedia Commons), harvest-logos (broadcaster APIs), migrate-nonfree-logos (off the non-free wikipedia namespace).',
      'Provenance and license are recorded per station (faviconSource, faviconSourceUrl, faviconLicense; THIRD_PARTY_NOTICES.md); npm run favicon-variants pre-sizes 76/128/152px WebP bundles.',
    ],
    io: [
      ['input', 'catalog favicons, homepages, Wikimedia, broadcaster APIs'],
      ['output', 'public/station-logo-status.json, public/stations/ + public/favicons/, YAML favicon fields'],
    ],
  },
  {
    title: 'Publish — build the artifact the apps consume',
    cadence: ['per-commit CI', 'weekly CI'],
    what: [
      'npm run catalog merges data/stations.yaml with the cached Radio Browser baseline and writes public/stations.json (committed, so Pages keeps serving even if a build fails). Only working / icy-only / stream-only entries publish.',
      'Per-commit gates block bad merges: check-catalog (YAML ↔ JSON sync, HTTPS-only), check-highlights, check-duplicates (uuid / stream collisions fail CI).',
      'Pushes to main deploy the site via GitHub Pages (deploy.yml).',
    ],
    io: [
      ['input', 'data/*.yaml + RB snapshots'],
      ['output', 'public/stations.json, public/highlights.json, station pages + sitemap'],
    ],
  },
  {
    title: 'Monitor — keep the published catalog honest',
    cadence: ['weekly CI', 'manual'],
    what: [
      'The weekly catalog-watch sweep (Mon 07:00 UTC) refreshes the catalog from Radio Browser, probes every published stream + metadata URL (npm run health), checks RB drift and duplicates, refreshes logo status and the curation backlog, and commits all report artifacts in one push.',
      'Every check writes per-station verdicts into public/station-health.json — the unified health record this console reads. Verdicts carry the date they last changed; per-facet last-run lives in the record’s runs header (the freshness chips on Overview).',
      'Homepage liveness (npm run check-homepages, ~18.5k URLs) stays curator-paced; results land in the record when it runs.',
      'When something needs attention the sweep opens a single tracking issue labelled catalog-watch and closes it when clean. Runtime errors stream into the daily error-watch digest from GoatCounter.',
    ],
    io: [
      ['input', 'public/stations.json, Radio Browser, station streams'],
      ['output', 'public/station-health.json + station-status/-drift/-duplicates/-logo-status/-backlog.json, tracking issue'],
    ],
  },
];

const STATUSES: [string, string, string][] = [
  ['working', 'stream + metadata + cover all flowing', 'published'],
  ['icy-only', 'stream OK, ICY-over-fetch supplies the title (no broadcaster fetcher)', 'published'],
  ['stream-only', 'plays, no metadata source available', 'published'],
  ['fetcher-todo', 'broadcaster API known, fetcher not yet wired', 'not published'],
  ['investigate', 'not researched yet', 'not published'],
  ['not-public', 'auth/session/geo locked (Apple Music, Spotify, …)', 'not published'],
  ['broken', 'URL dead or stream consistently fails', 'not published'],
];

const FACET_DOCS: [string, string, string][] = [
  ['stream', 'health-probe', 'ok = 2xx + audio-like content-type · warn = unexpected content-type · bad = HTTP ≥400 / network failure'],
  ['https', 'health-probe', 'ok = https stream URL · bad = http (mixed content)'],
  ['icy', 'health-probe', 'ok = StreamTitle seen in 64 KB · warn = metaint advertised but no title · bad = none · na = HLS'],
  ['metadata', 'health-probe', 'metadataUrl / built-in fetcher reachability'],
  ['fetcher', 'health-probe', 'ok = known fetcher key · bad = unknown key · na = generic ICY'],
  ['program', 'health-probe', 'ok = fetcher exposes programme info · warn = fetcher without it · na = no fetcher'],
  ['logo', 'logo-status', 'URL heuristics + real-pixel probe merge; tier in the detail view'],
  ['homepage', 'check-homepages', 'ok · warn = blocked (401/403/429) · bad = dead / server error / network'],
  ['drift', 'check-drift', 'ok = changeuuid matches upstream · warn = upstream changed / no baseline · bad = record gone · na = not RB-bound'],
  ['duplicate', 'check-duplicates', 'ok = clean · warn = review-tier group · bad = blocking collision (also fails CI)'],
];

const DOC_LINKS: [string, string][] = [
  ['docs/operations.md — catalog workflow, RB linking, telemetry', `${REPO}/docs/operations.md`],
  ['docs/curation-checklist.md — the per-station promotion playbook', `${REPO}/docs/curation-checklist.md`],
  ['docs/station-health.md — the unified health record spec', `${REPO}/docs/station-health.md`],
  ['docs/adding-stations.md — public guide for proposing stations', `${REPO}/docs/adding-stations.md`],
  ['docs/logo-extraction.md — scraper batches and review rules', `${REPO}/docs/logo-extraction.md`],
];

function cadenceBadge(c: Cadence): HTMLElement {
  const kind = c === 'weekly CI' ? 'info' : c === 'per-commit CI' ? 'success' : c === 'manual' ? 'muted' : 'warning';
  return badge(c, kind);
}

function table(headers: string[], rows: (Node | string)[][]): HTMLElement {
  return el(
    'table',
    { class: 'data' },
    el('thead', {}, el('tr', {}, ...headers.map((h) => el('th', {}, h)))),
    el('tbody', {}, ...rows.map((cells) => el('tr', {}, ...cells.map((c) => el('td', {}, c))))),
  );
}

export async function renderProcess(root: HTMLElement): Promise<void> {
  const wrap = el('div', { class: 'process' });

  wrap.append(
    el('h2', {}, 'How the catalog is made'),
    el(
      'p',
      {},
      'The catalog is ',
      el('strong', {}, 'data, not code'),
      ': YAML under data/, built into the public/stations.json artifact the apps consume. ',
      'Quality is enforced by a pipeline of deterministic checks whose verdicts all land in one record — public/station-health.json — which this console reads. ',
      'Each step below names the tool, what it does, and when it runs.',
    ),
  );

  STEPS.forEach((step, i) => {
    const head = el('div', { class: 'step-head' });
    head.append(el('span', { class: 'step-num' }, String(i + 1).padStart(2, '0')));
    head.append(el('span', { class: 'step-title' }, step.title));
    const cadences = el('span', { class: 'step-cadence' });
    for (const c of step.cadence) cadences.append(cadenceBadge(c), document.createTextNode(' '));
    head.append(cadences);

    const body = el('div', { class: 'step-body' });
    for (const w of step.what) body.append(renderRichText(w));
    const io = el('dl', { class: 'step-io' });
    for (const [k, v] of step.io) io.append(el('dt', {}, k), el('dd', {}, v));
    body.append(io);

    wrap.append(el('section', { class: 'step' }, head, body));
  });

  wrap.append(
    sectionHeader('Status taxonomy', 'set on every YAML entry — only the first three publish'),
    table(
      ['status', 'meaning', 'published?'],
      STATUSES.map(([s, m, p]) => [el('code', {}, s), m, p]),
    ),
  );

  wrap.append(
    sectionHeader('Health facets', 'verdicts are ok · warn · bad · na; "since" dates mark the last change'),
    table(
      ['facet', 'written by', 'semantics'],
      FACET_DOCS.map(([f, tool, sem]) => [el('code', {}, f), el('code', {}, tool), sem]),
    ),
  );

  const links = el('ul', { class: 'plain-list' });
  for (const [label, href] of DOC_LINKS) {
    links.append(el('li', {}, el('a', { href, target: '_blank', rel: 'noopener noreferrer' }, label)));
  }
  wrap.append(sectionHeader('Reference docs', 'the precise versions of everything above'), links);

  root.replaceChildren(wrap);
}

/** Wrap `npm run …` / path-ish tokens in <code> for readability. */
function renderRichText(text: string): HTMLElement {
  const p = el('p', {});
  const parts = text.split(/(npm run [a-z0-9:-]+(?: -- [^\s,;.]+)?|[a-zA-Z0-9_./-]+\.(?:yaml|json|md|yml|ts|mjs)|src\/[a-z.-]+|data\/[a-z./-]+)/g);
  parts.forEach((part, i) => {
    if (!part) return;
    p.append(i % 2 === 1 ? el('code', {}, part) : document.createTextNode(part));
  });
  return p;
}
