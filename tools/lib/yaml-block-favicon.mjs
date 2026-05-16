/**
 * Shared YAML-editing helper used by flag-suspicious-favicons.mjs and
 * clear-dead-favicons.mjs. Both want the same primitive: "for these station
 * IDs, strip favicon-related lines from data/stations.yaml and insert
 * `faviconBlocked: true` right after the `- id:` header."
 *
 * Line-based, not structural — the project's stations.yaml has a strict
 * one-pair-per-line shape (validated by tools/validate-catalog.mjs), so a
 * line walk is safe and keeps the diff localised.
 */

const BLOCK_START_RX = /^- id: (.+)$/;
const FAVICON_LINE_RX = /^  (favicon|faviconSource|faviconSourceType|faviconSourceUrl|faviconLicense): /;
const FAVICON_BLOCKED_RX = /^  faviconBlocked: true$/;

/**
 * Block favicons for the given set of station IDs.
 *
 * @param {string}   yamlText  Current contents of data/stations.yaml.
 * @param {Set<string>|Iterable<string>} ids Station IDs whose favicons should be blocked.
 * @returns {{ text: string, inserted: number, alreadyBlocked: number }}
 *   `text` is the rewritten YAML (caller decides whether to write).
 *   `inserted` / `alreadyBlocked` are counts for logging.
 */
export function blockFavicons(yamlText, ids) {
  const flagged = ids instanceof Set ? ids : new Set(ids);
  const lines = yamlText.split('\n');

  // First pass: locate each flagged block's bounds and whether it already
  // has `faviconBlocked: true` (so we don't double-insert on repeated runs).
  const blockBounds = new Map(); // id → { start, end, hasBlocked }
  let curId = null;
  let curStart = -1;
  let curHasBlocked = false;
  for (let i = 0; i < lines.length; i++) {
    const m = BLOCK_START_RX.exec(lines[i]);
    if (m) {
      if (curId && flagged.has(curId)) {
        blockBounds.set(curId, { start: curStart, end: i - 1, hasBlocked: curHasBlocked });
      }
      curId = m[1].trim();
      curStart = i;
      curHasBlocked = false;
      continue;
    }
    if (curId && FAVICON_BLOCKED_RX.test(lines[i])) curHasBlocked = true;
  }
  if (curId && flagged.has(curId)) {
    blockBounds.set(curId, { start: curStart, end: lines.length - 1, hasBlocked: curHasBlocked });
  }

  // Second pass: rebuild the file. Strip favicon-related lines from flagged
  // blocks and insert `faviconBlocked: true` right after the `- id:` header.
  const idLineSet = new Map([...blockBounds.entries()].map(([id, b]) => [b.start, id]));
  const out = [];
  let stripping = false;
  let activeBounds = null;

  for (let i = 0; i < lines.length; i++) {
    const idAtThisLine = idLineSet.get(i);
    if (idAtThisLine !== undefined) {
      activeBounds = blockBounds.get(idAtThisLine);
      stripping = true;
      out.push(lines[i]);                       // the `- id:` line itself
      if (!activeBounds.hasBlocked) {
        out.push(`  faviconBlocked: true`);
      }
      continue;
    }

    if (stripping && activeBounds && i > activeBounds.end) {
      stripping = false;
      activeBounds = null;
    }

    if (stripping && FAVICON_LINE_RX.test(lines[i])) {
      continue; // drop the favicon-related line
    }
    out.push(lines[i]);
  }

  const alreadyBlocked = [...blockBounds.values()].filter((b) => b.hasBlocked).length;
  return {
    text: out.join('\n'),
    inserted: blockBounds.size - alreadyBlocked,
    alreadyBlocked,
  };
}
