import { describe, expect, it } from 'vitest';

/**
 * Mirrors the bash decision in `.github/workflows/catalog-watch.yml`'s
 * "Combine validation + duplicates outcome" step:
 *
 *     if [ "$VALIDATE" = "true" ] || [ "$DUPLICATES" = "true" ]; then
 *       echo "has_issues=true" >> "$GITHUB_OUTPUT"
 *     fi
 *
 * The YAML is the source of truth. This pure mirror exists only as a
 * spec / regression check — keep it in sync if the workflow's logic
 * changes, and the truth-table tests below will catch obvious bugs.
 */
function shouldOpenIssue(
  validateHasIssues: string,
  duplicatesHasIssues: string,
): boolean {
  return validateHasIssues === 'true' || duplicatesHasIssues === 'true';
}

describe('catalog-watch issue decision matrix', () => {
  it('opens the tracking issue when only validate-catalog fails', () => {
    expect(shouldOpenIssue('true', '')).toBe(true);
  });

  it('opens the tracking issue when only check-duplicates fails (regression case)', () => {
    // This is the bug the issue (#67) fixed — previously the workflow
    // ignored duplicates and would close the issue here.
    expect(shouldOpenIssue('', 'true')).toBe(true);
  });

  it('opens the tracking issue when both fail', () => {
    expect(shouldOpenIssue('true', 'true')).toBe(true);
  });

  it('closes the tracking issue when both pass', () => {
    expect(shouldOpenIssue('', '')).toBe(false);
  });

  it('treats anything other than the literal string "true" as a pass', () => {
    // GitHub Actions' if-expressions compare strings; only the literal
    // "true" should trigger the issue. Anything else (empty, "false",
    // accidentally-stringified booleans) must read as no-issue.
    expect(shouldOpenIssue('false', 'false')).toBe(false);
    expect(shouldOpenIssue('TRUE', 'TRUE')).toBe(false);
    expect(shouldOpenIssue(' true ', ' true ')).toBe(false);
  });
});
