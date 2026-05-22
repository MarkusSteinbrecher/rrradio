import { describe, expect, it } from 'vitest';

import {
  DEFAULT_STYLE_TOKENS,
  buildContrastChecks,
  buildCssVariables,
  buildJsonPayload,
  buildSwiftSnippet,
  colorToHex,
  formatOklch,
  normalizeStyleTokenState,
  parseOklch,
} from './style-tokens';

describe('style tokens', () => {
  it('parses OKLCH token strings', () => {
    expect(parseOklch('oklch(58% 0.180 145)')).toEqual({
      l: 0.58,
      c: 0.18,
      h: 145,
    });
    expect(parseOklch('oklch(0.58 0.180 505deg)')).toEqual({
      l: 0.58,
      c: 0.18,
      h: 145,
    });
    expect(parseOklch('#00a040')).toBeNull();
  });

  it('formats OKLCH channel values for editor output', () => {
    expect(formatOklch({ l: 0.584, c: 0.18, h: 505 })).toBe('oklch(58.4% 0.18 145)');
    expect(formatOklch({ l: 1.2, c: -0.1, h: -10 })).toBe('oklch(100% 0 350)');
  });

  it('converts neutral OKLCH values to sRGB hex', () => {
    expect(colorToHex('oklch(100% 0 0)')).toBe('#ffffff');
    expect(colorToHex('oklch(0% 0 0)')).toBe('#000000');
  });

  it('keeps defaults when persisted state is partial or invalid', () => {
    const state = normalizeStyleTokenState({
      dark: {
        surface: 'oklch(30% 0.01 95)',
        accent: 'not-a-color',
      },
    });

    expect(state.dark.surface).toBe('oklch(30% 0.01 95)');
    expect(state.dark.accent).toBe(DEFAULT_STYLE_TOKENS.dark.accent);
    expect(state.light.surface).toBe(DEFAULT_STYLE_TOKENS.light.surface);
  });

  it('builds contrast checks from semantic token pairs', () => {
    const checks = buildContrastChecks(DEFAULT_STYLE_TOKENS.dark);
    expect(checks).toContainEqual(expect.objectContaining({
      label: 'Text primary on surface',
      passes: true,
    }));
    expect(checks.every((check) => check.ratio !== null)).toBe(true);
  });

  it('exports CSS, JSON, and Swift representations', () => {
    const css = buildCssVariables(DEFAULT_STYLE_TOKENS);
    const json = buildJsonPayload(DEFAULT_STYLE_TOKENS);
    const swift = buildSwiftSnippet(DEFAULT_STYLE_TOKENS);

    expect(css).toContain('--rr-surface: oklch(');
    expect(css).toContain('[data-theme="light"]');
    expect(JSON.parse(json)).toMatchObject({
      version: 1,
      colorSpace: 'oklch',
    });
    expect(swift).toContain('enum RrradioStyleTokens');
    expect(swift).toContain('static let darkSurface = Color(');
    expect(swift).toContain('static let uiLightAccent = UIColor(');
  });
});
