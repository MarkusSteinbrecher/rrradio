/**
 * Surgical, line-based field editor for a single station block in
 * data/stations.yaml. Companion to yaml-block-favicon.mjs (which handles
 * favicon stripping); this one sets scalar fields and the `tags` list.
 *
 * Why line-based and not structural: stations.yaml is hand-maintained,
 * carries comments, and has a strict one-pair-per-line shape (enforced by
 * the catalog gates). Round-tripping the whole document through a YAML
 * serializer would reflow 31k unrelated rows and blow up the diff. A line
 * walk keeps the change to exactly the field(s) we touch.
 *
 * Used by tools/propose-station-fix.mjs (issue #507, P3) to write a
 * broken-station fix (stream swap, status: broken, metadata correction)
 * before opening the catalog-fix PR.
 */

import { stringify } from 'yaml';

const BLOCK_START_RX = /^- id: (.+)$/;

/** Serialize one scalar (string/number/boolean) the way the catalog
 *  would, so quoting matches the rest of the file. Rejects values that
 *  don't fit on one line — none of the fields we edit are multi-line. */
export function serializeScalar(value) {
  const out = stringify(value).replace(/\n+$/, '');
  if (out.includes('\n')) {
    throw new Error(`refusing to write a multi-line scalar: ${JSON.stringify(value)}`);
  }
  return out;
}

/** Locate a station's block bounds by id. Returns { start, end } line
 *  indices (inclusive) or null. `end` is the last line before the next
 *  `- id:` header (or EOF). */
export function findStationBlock(lines, stationId) {
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = BLOCK_START_RX.exec(lines[i]);
    if (!m) continue;
    if (m[1].trim() === stationId) {
      start = i;
      // Find the end: the line before the next `- id:` (or EOF).
      let end = lines.length - 1;
      for (let j = i + 1; j < lines.length; j++) {
        if (BLOCK_START_RX.test(lines[j])) {
          end = j - 1;
          break;
        }
      }
      return { start, end };
    }
  }
  return null;
}

/**
 * Set a scalar field on one station. Replaces the existing `  field: …`
 * line in the block, or inserts it right after the `- id:` header when
 * absent. Returns { text, changed, found } — `found` is whether the
 * station block exists, `changed` whether the text actually moved.
 */
export function setStationScalar(yamlText, stationId, field, value) {
  const lines = yamlText.split('\n');
  const block = findStationBlock(lines, stationId);
  if (!block) return { text: yamlText, changed: false, found: false };

  const fieldRx = new RegExp(`^  ${field}:( |$)`);
  const newLine = `  ${field}: ${serializeScalar(value)}`;

  for (let i = block.start + 1; i <= block.end; i++) {
    if (fieldRx.test(lines[i])) {
      if (lines[i] === newLine) return { text: yamlText, changed: false, found: true };
      lines[i] = newLine;
      return { text: lines.join('\n'), changed: true, found: true };
    }
  }
  // Absent — insert right after the `- id:` header.
  lines.splice(block.start + 1, 0, newLine);
  return { text: lines.join('\n'), changed: true, found: true };
}

/**
 * Replace (or insert) the `tags:` block-style list on one station.
 * Drops the existing `  tags:` line and its `    - item` children, then
 * writes the new list. Empty `tags` removes the field entirely.
 */
export function setStationTags(yamlText, stationId, tags) {
  const lines = yamlText.split('\n');
  const block = findStationBlock(lines, stationId);
  if (!block) return { text: yamlText, changed: false, found: false };

  // Find the existing tags region: the `  tags:` line plus any
  // immediately-following 4-space list items.
  let tagsAt = -1;
  for (let i = block.start + 1; i <= block.end; i++) {
    if (/^  tags:( |$)/.test(lines[i])) {
      tagsAt = i;
      break;
    }
  }
  let removeStart = tagsAt;
  let removeCount = 0;
  if (tagsAt >= 0) {
    removeCount = 1;
    for (let j = tagsAt + 1; j <= block.end; j++) {
      if (/^    - /.test(lines[j])) removeCount++;
      else break;
    }
  }

  const cleaned = (tags ?? []).map((t) => String(t).trim()).filter(Boolean);
  const newLines = cleaned.length
    ? ['  tags:', ...cleaned.map((t) => `    - ${serializeScalar(t)}`)]
    : [];

  if (tagsAt >= 0) {
    const existing = lines.slice(removeStart, removeStart + removeCount).join('\n');
    if (existing === newLines.join('\n')) return { text: yamlText, changed: false, found: true };
    lines.splice(removeStart, removeCount, ...newLines);
  } else {
    if (!newLines.length) return { text: yamlText, changed: false, found: true };
    lines.splice(block.start + 1, 0, ...newLines);
  }
  return { text: lines.join('\n'), changed: true, found: true };
}
