export type StyleMode = 'dark' | 'light';

export const STYLE_MODES: readonly StyleMode[] = ['dark', 'light'] as const;

export const STYLE_TOKEN_NAMES = [
  'surface',
  'surfaceRaised',
  'surfaceMuted',
  'textPrimary',
  'textSecondary',
  'textTertiary',
  'separator',
  'controlFill',
  'controlFillSelected',
  'accent',
  'accentOnFill',
  'warning',
  'destructive',
] as const;

export type StyleTokenName = typeof STYLE_TOKEN_NAMES[number];

export interface StyleTokenMeta {
  name: StyleTokenName;
  label: string;
  role: string;
}

export type StyleTokenSet = Record<StyleTokenName, string>;
export type StyleTokenState = Record<StyleMode, StyleTokenSet>;

export interface OklchColor {
  l: number;
  c: number;
  h: number;
}

export interface SrgbColor {
  r: number;
  g: number;
  b: number;
}

export interface ContrastCheck {
  label: string;
  foreground: StyleTokenName;
  background: StyleTokenName;
  ratio: number | null;
  passes: boolean | null;
}

export const STYLE_TOKEN_META: readonly StyleTokenMeta[] = [
  { name: 'surface', label: 'Surface', role: 'Page and app background.' },
  { name: 'surfaceRaised', label: 'Surface raised', role: 'Rows, cards, tab bars.' },
  { name: 'surfaceMuted', label: 'Surface muted', role: 'Recessed controls and secondary areas.' },
  { name: 'textPrimary', label: 'Text primary', role: 'Station names and main labels.' },
  { name: 'textSecondary', label: 'Text secondary', role: 'Station metadata and supporting copy.' },
  { name: 'textTertiary', label: 'Text tertiary', role: 'Captions, hints, quiet values.' },
  { name: 'separator', label: 'Separator', role: 'Hairlines, dividers, subtle borders.' },
  { name: 'controlFill', label: 'Control fill', role: 'Inactive buttons, chips, input fields.' },
  { name: 'controlFillSelected', label: 'Control selected', role: 'Selected controls and active pills.' },
  { name: 'accent', label: 'Accent', role: 'Live state, focus, primary action.' },
  { name: 'accentOnFill', label: 'Accent on fill', role: 'Text and icons placed on accent.' },
  { name: 'warning', label: 'Warning', role: 'Risky or recoverable status.' },
  { name: 'destructive', label: 'Destructive', role: 'Remove, broken, irreversible status.' },
] as const;

export const DEFAULT_STYLE_TOKENS: StyleTokenState = {
  dark: {
    surface: 'oklch(35.4% 0.008 95)',
    surfaceRaised: 'oklch(42.2% 0.009 95)',
    surfaceMuted: 'oklch(49.2% 0.010 95)',
    textPrimary: 'oklch(96.8% 0.004 95)',
    textSecondary: 'oklch(84.0% 0.004 95)',
    textTertiary: 'oklch(70.0% 0.004 95)',
    separator: 'oklch(54.0% 0.006 95)',
    controlFill: 'oklch(44.0% 0.009 95)',
    controlFillSelected: 'oklch(96.8% 0.004 95)',
    accent: 'oklch(96.8% 0.210 110)',
    accentOnFill: 'oklch(22.0% 0.008 95)',
    warning: 'oklch(78.0% 0.150 75)',
    destructive: 'oklch(62.0% 0.200 29)',
  },
  light: {
    surface: 'oklch(97.8% 0.008 95)',
    surfaceRaised: 'oklch(99.5% 0.003 95)',
    surfaceMuted: 'oklch(92.7% 0.010 95)',
    textPrimary: 'oklch(17.0% 0.006 95)',
    textSecondary: 'oklch(36.0% 0.006 95)',
    textTertiary: 'oklch(50.0% 0.006 95)',
    separator: 'oklch(78.0% 0.008 95)',
    controlFill: 'oklch(99.5% 0.003 95)',
    controlFillSelected: 'oklch(35.4% 0.008 95)',
    accent: 'oklch(58.0% 0.180 145)',
    accentOnFill: 'oklch(99.0% 0.003 95)',
    warning: 'oklch(76.0% 0.150 75)',
    destructive: 'oklch(58.0% 0.200 29)',
  },
};

export const CONTRAST_PAIRS: readonly Omit<ContrastCheck, 'ratio' | 'passes'>[] = [
  { label: 'Text primary on surface', foreground: 'textPrimary', background: 'surface' },
  { label: 'Text secondary on surface', foreground: 'textSecondary', background: 'surface' },
  { label: 'Text tertiary on surface raised', foreground: 'textTertiary', background: 'surfaceRaised' },
  { label: 'Accent text on accent', foreground: 'accentOnFill', background: 'accent' },
  { label: 'Primary text on controls', foreground: 'textPrimary', background: 'controlFill' },
  { label: 'Selected controls on raised surface', foreground: 'controlFillSelected', background: 'surfaceRaised' },
] as const;

export function cloneStyleTokens(source: StyleTokenState = DEFAULT_STYLE_TOKENS): StyleTokenState {
  return {
    dark: { ...source.dark },
    light: { ...source.light },
  };
}

export function kebabTokenName(name: StyleTokenName): string {
  return name.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

export function parseOklch(input: string): OklchColor | null {
  const trimmed = input.trim();
  const match = /^oklch\(\s*([+-]?\d*\.?\d+)(%)?\s+([+-]?\d*\.?\d+)\s+([+-]?\d*\.?\d+)(?:deg)?\s*\)$/i.exec(trimmed);
  if (!match) return null;

  const rawL = Number(match[1]);
  const c = Number(match[3]);
  const h = Number(match[4]);
  const l = match[2] ? rawL / 100 : rawL;
  if (![l, c, h].every(Number.isFinite)) return null;
  if (l < 0 || l > 1 || c < 0) return null;
  return { l, c, h: normalizeHue(h) };
}

export function formatOklch(color: OklchColor): string {
  const lightness = trimNumber(clamp01(color.l) * 100, 1);
  const chroma = trimNumber(Math.max(0, color.c), 3);
  const hue = trimNumber(normalizeHue(color.h), 1);
  return `oklch(${lightness}% ${chroma} ${hue})`;
}

export function oklchToSrgb(input: string | OklchColor): SrgbColor | null {
  const color = typeof input === 'string' ? parseOklch(input) : input;
  if (!color) return null;

  const hueRadians = (color.h / 180) * Math.PI;
  const a = color.c * Math.cos(hueRadians);
  const b = color.c * Math.sin(hueRadians);

  const lPrime = color.l + 0.3963377774 * a + 0.2158037573 * b;
  const mPrime = color.l - 0.1055613458 * a - 0.0638541728 * b;
  const sPrime = color.l - 0.0894841775 * a - 1.2914855480 * b;

  const l = lPrime ** 3;
  const m = mPrime ** 3;
  const s = sPrime ** 3;

  return {
    r: clamp01(linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
    g: clamp01(linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
    b: clamp01(linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)),
  };
}

export function srgbToHex(color: SrgbColor): string {
  const toHex = (channel: number): string => Math.round(clamp01(channel) * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`;
}

export function colorToHex(input: string): string | null {
  const rgb = oklchToSrgb(input);
  return rgb ? srgbToHex(rgb) : null;
}

export function contrastRatio(foreground: string, background: string): number | null {
  const fg = oklchToSrgb(foreground);
  const bg = oklchToSrgb(background);
  if (!fg || !bg) return null;

  const lighter = Math.max(relativeLuminance(fg), relativeLuminance(bg));
  const darker = Math.min(relativeLuminance(fg), relativeLuminance(bg));
  return (lighter + 0.05) / (darker + 0.05);
}

export function buildContrastChecks(tokens: StyleTokenSet): ContrastCheck[] {
  return CONTRAST_PAIRS.map((pair) => {
    const ratio = contrastRatio(tokens[pair.foreground], tokens[pair.background]);
    return {
      ...pair,
      ratio,
      passes: ratio === null ? null : ratio >= 4.5,
    };
  });
}

export function normalizeStyleTokenState(value: unknown): StyleTokenState {
  const result = cloneStyleTokens();
  const record = asRecord(value);
  if (!record) return result;

  for (const mode of STYLE_MODES) {
    const modeRecord = asRecord(record[mode]);
    if (!modeRecord) continue;
    for (const token of STYLE_TOKEN_NAMES) {
      const candidate = modeRecord[token];
      if (typeof candidate === 'string' && parseOklch(candidate)) {
        result[mode][token] = candidate.trim();
      }
    }
  }

  return result;
}

export function buildCssVariables(state: StyleTokenState): string {
  const blocks = STYLE_MODES.map((mode) => {
    const selector = mode === 'dark'
      ? ':root, [data-theme="dark"]'
      : '[data-theme="light"]';
    const lines = STYLE_TOKEN_NAMES.map((token) => {
      const value = state[mode][token];
      const hex = colorToHex(value);
      const comment = hex ? ` /* ${hex} */` : '';
      return `  --rr-${kebabTokenName(token)}: ${value};${comment}`;
    });
    return `${selector} {\n${lines.join('\n')}\n}`;
  });
  return `${blocks.join('\n\n')}\n`;
}

export function buildJsonPayload(state: StyleTokenState): string {
  return `${JSON.stringify({
    version: 1,
    colorSpace: 'oklch',
    tokens: state,
  }, null, 2)}\n`;
}

export function buildSwiftSnippet(state: StyleTokenState): string {
  const lines = [
    'import SwiftUI',
    'import UIKit',
    '',
    'enum RrradioStyleTokens {',
  ];

  for (const mode of STYLE_MODES) {
    const modeName = capitalize(mode);
    for (const token of STYLE_TOKEN_NAMES) {
      const rgb = oklchToSrgb(state[mode][token]);
      if (!rgb) continue;
      const name = `${mode}${capitalize(token)}`;
      const channels = swiftChannels(rgb);
      lines.push(`  static let ${name} = Color(red: ${channels.r}, green: ${channels.g}, blue: ${channels.b})`);
      lines.push(`  static let ui${modeName}${capitalize(token)} = UIColor(red: ${channels.r}, green: ${channels.g}, blue: ${channels.b}, alpha: 1)`);
    }
    if (mode !== STYLE_MODES[STYLE_MODES.length - 1]) lines.push('');
  }

  lines.push('}');
  return `${lines.join('\n')}\n`;
}

function normalizeHue(hue: number): number {
  return ((hue % 360) + 360) % 360;
}

function linearToSrgb(channel: number): number {
  return channel <= 0.0031308
    ? 12.92 * channel
    : 1.055 * Math.abs(channel) ** (1 / 2.4) * Math.sign(channel) - 0.055;
}

function relativeLuminance(color: SrgbColor): number {
  const linear = [color.r, color.g, color.b].map((channel) => {
    const clamped = clamp01(channel);
    return clamped <= 0.04045
      ? clamped / 12.92
      : ((clamped + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function trimNumber(value: number, fractionDigits: number): string {
  const fixed = value.toFixed(fractionDigits);
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function swiftChannels(color: SrgbColor): Record<'r' | 'g' | 'b', string> {
  return {
    r: color.r.toFixed(4),
    g: color.g.toFixed(4),
    b: color.b.toFixed(4),
  };
}
