import {
  STYLE_MODES,
  STYLE_TOKEN_META,
  STYLE_TOKEN_NAMES,
  type OklchColor,
  type StyleMode,
  type StyleTokenState,
  buildContrastChecks,
  buildCssVariables,
  buildJsonPayload,
  buildSwiftSnippet,
  cloneStyleTokens,
  colorToHex,
  formatOklch,
  kebabTokenName,
  normalizeStyleTokenState,
  parseOklch,
} from './style-tokens';

const STORAGE_KEY = 'rrradio.style-tokens.v1';
const CHROMA_MAX = 0.4;

type ChannelKey = keyof OklchColor;

interface ChannelControl {
  number: HTMLInputElement;
  range: HTMLInputElement;
}

interface StylePageRefs {
  tokenEditors: HTMLElement;
  previewGrid: HTMLElement;
  contrastGrid: HTMLElement;
  cssExport: HTMLTextAreaElement;
  jsonExport: HTMLTextAreaElement;
  swiftExport: HTMLTextAreaElement;
  resetButton: HTMLButtonElement;
  copyButtons: NodeListOf<HTMLButtonElement>;
  savedStatus: HTMLElement;
}

let tokens = loadTokens();

document.addEventListener('DOMContentLoaded', () => {
  const refs = readRefs();
  renderEditors(refs);
  renderRuntime(refs);

  refs.resetButton.addEventListener('click', () => {
    tokens = cloneStyleTokens();
    clearSavedTokens();
    renderEditors(refs);
    renderRuntime(refs);
    setSavedStatus(refs, 'Reset');
  });

  refs.copyButtons.forEach((button) => {
    button.addEventListener('click', () => {
      void copyExport(refs, button);
    });
  });
});

function readRefs(): StylePageRefs {
  return {
    tokenEditors: mustGetElement('token-editors'),
    previewGrid: mustGetElement('preview-grid'),
    contrastGrid: mustGetElement('contrast-grid'),
    cssExport: mustGetElement('css-export', HTMLTextAreaElement),
    jsonExport: mustGetElement('json-export', HTMLTextAreaElement),
    swiftExport: mustGetElement('swift-export', HTMLTextAreaElement),
    resetButton: mustGetElement('reset-tokens', HTMLButtonElement),
    copyButtons: document.querySelectorAll<HTMLButtonElement>('[data-copy-target]'),
    savedStatus: mustGetElement('saved-status'),
  };
}

function renderEditors(refs: StylePageRefs): void {
  refs.tokenEditors.replaceChildren(...STYLE_TOKEN_META.map((meta) => {
    const row = el('div', 'token-row');

    const label = el('div', 'token-label');
    label.append(el('strong', undefined, meta.label));
    label.append(el('span', undefined, meta.role));
    row.append(label);

    for (const mode of STYLE_MODES) {
      const field = el('div', 'token-field');
      const header = el('div', 'token-field-header');
      header.append(el('span', 'token-mode', mode));

      const swatch = el('span', 'token-swatch');
      const hex = el('span', 'token-hex');
      header.append(hex);

      const color = parseOklch(tokens[mode][meta.name]) ?? parseOklch(tokens[mode].surface);
      if (!color) throw new Error(`Invalid default OKLCH token for ${mode} ${meta.name}`);

      const raw = el('code', 'token-oklch', formatOklch(color));
      const controls: Record<ChannelKey, ChannelControl> = {
        l: createChannelControl('L', color.l * 100, 0, 100, 0.1, `${meta.label} ${mode} lightness`),
        c: createChannelControl('C', color.c, 0, CHROMA_MAX, 0.001, `${meta.label} ${mode} chroma`),
        h: createChannelControl('H', color.h, 0, 360, 1, `${meta.label} ${mode} hue`),
      };

      const syncField = (changed: ChannelKey, normalizeChanged = false): void => {
        const next = readColorFromControls(controls);
        tokens[mode][meta.name] = formatOklch(next);
        syncControlValues(controls, next, changed, normalizeChanged);
        updateTokenField(tokens[mode][meta.name], swatch, hex, raw);
        saveTokens(tokens);
        renderRuntime(refs);
        setSavedStatus(refs, 'Saved locally');
      };

      const controlWrap = el('div', 'oklch-controls');
      for (const channel of ['l', 'c', 'h'] as const) {
        controls[channel].number.addEventListener('input', () => syncField(channel));
        controls[channel].number.addEventListener('change', () => syncField(channel, true));
        controls[channel].range.addEventListener('input', () => {
          controls[channel].number.value = controls[channel].range.value;
          syncField(channel, true);
        });
        controlWrap.append(controls[channel].number.closest('.token-channel') ?? controls[channel].number);
      }

      const footer = el('div', 'token-field-footer');
      footer.append(swatch, raw);
      updateTokenField(tokens[mode][meta.name], swatch, hex, raw);

      field.append(header, controlWrap, footer);
      row.append(field);
    }

    return row;
  }));
}

function renderRuntime(refs: StylePageRefs): void {
  refs.previewGrid.replaceChildren(...STYLE_MODES.map((mode) => renderPreview(mode)));
  refs.contrastGrid.replaceChildren(...STYLE_MODES.map((mode) => renderContrast(mode)));
  refs.cssExport.value = buildCssVariables(tokens);
  refs.jsonExport.value = buildJsonPayload(tokens);
  refs.swiftExport.value = buildSwiftSnippet(tokens);
}

function updateTokenField(value: string, swatch: HTMLElement, hexLabel: HTMLElement, rawLabel: HTMLElement): void {
  const hex = colorToHex(value);
  swatch.style.background = hex ? value : 'repeating-linear-gradient(45deg, #222 0 4px, #777 4px 8px)';
  hexLabel.textContent = hex ?? 'Invalid';
  rawLabel.textContent = value;
}

function createChannelControl(
  labelText: string,
  value: number,
  min: number,
  max: number,
  step: number,
  ariaLabel: string,
): ChannelControl {
  const row = el('label', 'token-channel');
  row.append(el('span', undefined, labelText));

  const number = document.createElement('input');
  number.type = 'number';
  number.min = String(min);
  number.max = String(max);
  number.step = String(step);
  number.value = channelValue(value, step);
  number.setAttribute('aria-label', ariaLabel);

  const range = document.createElement('input');
  range.type = 'range';
  range.min = String(min);
  range.max = String(max);
  range.step = String(step);
  range.value = channelValue(value, step);
  range.setAttribute('aria-label', `${ariaLabel} slider`);

  row.append(number, range);
  return { number, range };
}

function readColorFromControls(controls: Record<ChannelKey, ChannelControl>): OklchColor {
  return {
    l: readChannel(controls.l.number, 0, 100) / 100,
    c: readChannel(controls.c.number, 0, CHROMA_MAX),
    h: readChannel(controls.h.number, 0, 360),
  };
}

function syncControlValues(
  controls: Record<ChannelKey, ChannelControl>,
  color: OklchColor,
  changed: ChannelKey,
  normalizeChanged: boolean,
): void {
  const values: Record<ChannelKey, string> = {
    l: channelValue(color.l * 100, 0.1),
    c: channelValue(color.c, 0.001),
    h: channelValue(color.h, 1),
  };

  for (const channel of ['l', 'c', 'h'] as const) {
    controls[channel].range.value = values[channel];
    if (channel !== changed || normalizeChanged) controls[channel].number.value = values[channel];
  }
}

function readChannel(input: HTMLInputElement, min: number, max: number): number {
  const value = Number(input.value);
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function channelValue(value: number, step: number): string {
  const precision = step >= 1 ? 0 : String(step).split('.')[1]?.length ?? 0;
  const fixed = value.toFixed(precision);
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
}

function renderPreview(mode: StyleMode): HTMLElement {
  const panel = el('section', 'preview-mode');
  panel.dataset.mode = mode;
  applyPreviewTokens(panel, mode);

  const header = el('div', 'preview-header');
  header.append(el('h2', undefined, `${capitalize(mode)} preview`));
  header.append(el('span', 'live-pill', 'LIVE'));

  const stationRow = el('div', 'preview-station-row');
  stationRow.append(el('span', 'preview-logo', 'rr'));
  const rowCopy = el('div', 'preview-copy');
  rowCopy.append(el('strong', undefined, 'Radio Mars'));
  rowCopy.append(el('span', undefined, 'Casablanca - sports - 128 MP3'));
  stationRow.append(rowCopy);
  stationRow.append(el('button', 'preview-icon-button', '♪'));

  const tile = el('div', 'preview-tile');
  tile.append(el('div', 'preview-tile-art', 'FM'));
  const tileCopy = el('div', 'preview-copy');
  tileCopy.append(el('strong', undefined, 'FM4'));
  tileCopy.append(el('span', undefined, 'Alternative - Vienna'));
  tile.append(tileCopy);

  const controls = el('div', 'preview-controls');
  controls.append(el('button', 'preview-pill preview-pill--selected', 'All'));
  controls.append(el('button', 'preview-pill', 'Europe'));
  controls.append(el('button', 'preview-pill', 'Search'));
  controls.append(el('button', 'preview-primary', 'Play'));

  const states = el('div', 'preview-states');
  states.append(el('span', 'state state--empty', 'No stations'));
  states.append(el('span', 'state state--warning', 'Review'));
  states.append(el('span', 'state state--destructive', 'Broken'));

  const nav = el('div', 'preview-nav');
  nav.append(el('button', 'is-active', 'Browse'));
  nav.append(el('button', undefined, 'Lists'));
  nav.append(el('button', undefined, 'Now'));

  panel.append(header, stationRow, tile, controls, states, nav);
  return panel;
}

function renderContrast(mode: StyleMode): HTMLElement {
  const panel = el('section', 'contrast-mode');
  const heading = el('h2', undefined, `${capitalize(mode)} contrast`);
  const list = el('div', 'contrast-list');

  for (const check of buildContrastChecks(tokens[mode])) {
    const row = el('div', 'contrast-row');
    const label = el('span', undefined, check.label);
    const ratio = el('strong', undefined, check.ratio === null ? 'Invalid' : `${check.ratio.toFixed(2)}:1`);
    const status = el('span', `contrast-status ${check.passes ? 'is-pass' : 'is-fail'}`, check.passes ? 'AA' : 'Check');
    if (check.passes === null) status.textContent = 'Invalid';
    row.append(label, ratio, status);
    list.append(row);
  }

  panel.append(heading, list);
  return panel;
}

function applyPreviewTokens(element: HTMLElement, mode: StyleMode): void {
  for (const token of STYLE_TOKEN_NAMES) {
    element.style.setProperty(`--${kebabTokenName(token)}`, tokens[mode][token]);
  }
}

function loadTokens(): StyleTokenState {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return cloneStyleTokens();
    return normalizeStyleTokenState(JSON.parse(stored));
  } catch {
    return cloneStyleTokens();
  }
}

function saveTokens(nextTokens: StyleTokenState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextTokens));
  } catch {
    // Ignore storage failures; editing remains usable for the active session.
  }
}

function clearSavedTokens(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage failures; reset still applies in memory.
  }
}

async function copyExport(refs: StylePageRefs, button: HTMLButtonElement): Promise<void> {
  const targetId = button.dataset.copyTarget;
  if (!targetId) return;
  const textarea = document.getElementById(targetId);
  if (!(textarea instanceof HTMLTextAreaElement)) return;

  try {
    await navigator.clipboard.writeText(textarea.value);
  } catch {
    textarea.select();
    document.execCommand('copy');
  }

  setSavedStatus(refs, `Copied ${button.dataset.copyLabel ?? 'export'}`);
}

function setSavedStatus(refs: StylePageRefs, text: string): void {
  refs.savedStatus.textContent = text;
  window.setTimeout(() => {
    if (refs.savedStatus.textContent === text) refs.savedStatus.textContent = 'Local only';
  }, 1800);
}

function mustGetElement<T extends HTMLElement>(
  id: string,
  constructor?: { new (...args: never[]): T },
): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  if (constructor && !(element instanceof constructor)) {
    throw new Error(`#${id} has the wrong element type`);
  }
  return element as T;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
