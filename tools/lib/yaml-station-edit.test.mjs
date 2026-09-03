import { describe, it, expect } from 'vitest';
import {
  serializeScalar,
  findStationBlock,
  setStationScalar,
  setStationTags,
  getStationScalar,
  removeStationScalar,
  locateStationBlock,
  editStationBlock,
} from './yaml-station-edit.mjs';

const SAMPLE = `- id: a-one
  broadcaster: independent
  name: One FM
  streamUrl: https://a.example/one.mp3
  bitrate: 128
  codec: MP3
  tags:
    - pop
    - rock
  favicon: stations/a-one.png
  country: GB
  status: working
  # trailing comment about a-one
- id: b-two
  broadcaster: independent
  name: Two FM
  streamUrl: http://b.example/two
  status: stream-only
`;

describe('serializeScalar', () => {
  it('renders plain strings and numbers without quotes', () => {
    expect(serializeScalar('working')).toBe('working');
    expect(serializeScalar('https://x.example/s.aac')).toBe('https://x.example/s.aac');
    expect(serializeScalar(128)).toBe('128');
  });
  it('quotes strings that need it (yaml-lib default = house style)', () => {
    // Double quotes by default; single only when the value contains a
    // double-quote — matches how build-catalog already serialized the file.
    expect(serializeScalar('Radio: FM')).toBe('"Radio: FM"');
    expect(serializeScalar(' leading')).toBe('" leading"');
    expect(serializeScalar('"The Mighty" 1290')).toBe('\'"The Mighty" 1290\'');
  });
  it('refuses multi-line values', () => {
    expect(() => serializeScalar('a\nb')).toThrow();
  });
});

describe('findStationBlock', () => {
  it('returns inclusive bounds up to the next id (comments included)', () => {
    const lines = SAMPLE.split('\n');
    const a = findStationBlock(lines, 'a-one');
    expect(lines[a.start]).toBe('- id: a-one');
    expect(lines[a.end]).toBe('  # trailing comment about a-one');
    const b = findStationBlock(lines, 'b-two');
    expect(lines[b.start]).toBe('- id: b-two');
  });
  it('returns null for unknown id', () => {
    expect(findStationBlock(SAMPLE.split('\n'), 'nope')).toBeNull();
  });
});

describe('setStationScalar', () => {
  it('replaces an existing field in place, touching nothing else', () => {
    const r = setStationScalar(SAMPLE, 'a-one', 'streamUrl', 'https://a.example/new.aac');
    expect(r.changed).toBe(true);
    expect(r.text).toContain('  streamUrl: https://a.example/new.aac');
    expect(r.text).not.toContain('one.mp3');
    // b-two untouched
    expect(r.text).toContain('  streamUrl: http://b.example/two');
    // comment preserved
    expect(r.text).toContain('  # trailing comment about a-one');
  });
  it('inserts an absent field right after the id header', () => {
    const r = setStationScalar(SAMPLE, 'b-two', 'country', 'IE');
    expect(r.changed).toBe(true);
    const lines = r.text.split('\n');
    const idx = lines.indexOf('- id: b-two');
    expect(lines[idx + 1]).toBe('  country: IE');
  });
  it('is a no-op when the value already matches', () => {
    const r = setStationScalar(SAMPLE, 'a-one', 'status', 'working');
    expect(r.changed).toBe(false);
    expect(r.text).toBe(SAMPLE);
  });
  it('flips status to broken on the right block only', () => {
    const r = setStationScalar(SAMPLE, 'b-two', 'status', 'broken');
    expect(r.text).toContain('- id: b-two\n  broadcaster: independent\n  name: Two FM\n  streamUrl: http://b.example/two\n  status: broken');
    expect(r.text).toContain('  status: working'); // a-one unchanged
  });
  it('reports found=false for unknown station', () => {
    const r = setStationScalar(SAMPLE, 'nope', 'status', 'broken');
    expect(r.found).toBe(false);
    expect(r.changed).toBe(false);
  });
});

describe('setStationTags', () => {
  it('replaces an existing tag list block', () => {
    const r = setStationTags(SAMPLE, 'a-one', ['jazz', 'soul']);
    expect(r.changed).toBe(true);
    expect(r.text).toContain('  tags:\n    - jazz\n    - soul\n  favicon: stations/a-one.png');
    expect(r.text).not.toContain('- pop');
  });
  it('inserts a tag list when absent', () => {
    const r = setStationTags(SAMPLE, 'b-two', ['news']);
    expect(r.changed).toBe(true);
    const lines = r.text.split('\n');
    const idx = lines.indexOf('- id: b-two');
    expect(lines[idx + 1]).toBe('  tags:');
    expect(lines[idx + 2]).toBe('    - news');
  });
  it('removes the tag list when given an empty array', () => {
    const r = setStationTags(SAMPLE, 'a-one', []);
    expect(r.changed).toBe(true);
    expect(r.text).not.toContain('  tags:');
    expect(r.text).not.toContain('    - pop');
    expect(r.text).toContain('  favicon: stations/a-one.png');
  });
  it('is a no-op when tags already match', () => {
    const r = setStationTags(SAMPLE, 'a-one', ['pop', 'rock']);
    expect(r.changed).toBe(false);
  });
});

describe('getStationScalar', () => {
  it('reads plain and quoted scalars through the YAML parser', () => {
    expect(getStationScalar(SAMPLE, 'a-one', 'status')).toEqual({ found: true, value: 'working' });
    expect(getStationScalar(SAMPLE, 'a-one', 'bitrate')).toEqual({ found: true, value: 128 });
    const quoted = SAMPLE.replace('  country: GB', '  country: "GB"');
    expect(getStationScalar(quoted, 'a-one', 'country').value).toBe('GB');
  });
  it('tells an absent field from an unknown station', () => {
    expect(getStationScalar(SAMPLE, 'b-two', 'country')).toEqual({ found: true, value: undefined });
    expect(getStationScalar(SAMPLE, 'nope', 'country')).toEqual({ found: false, value: undefined });
  });
  it('does not read a block list as a scalar', () => {
    expect(getStationScalar(SAMPLE, 'a-one', 'tags').value).toBeUndefined();
  });
});

describe('removeStationScalar', () => {
  it('removes exactly one line from the right block', () => {
    const r = removeStationScalar(SAMPLE, 'a-one', 'bitrate');
    expect(r).toMatchObject({ changed: true, found: true });
    expect(r.text).toBe(SAMPLE.replace('  bitrate: 128\n', ''));
  });
  it('is a no-op when the field is absent', () => {
    expect(removeStationScalar(SAMPLE, 'b-two', 'bitrate')).toEqual({ text: SAMPLE, changed: false, found: true });
  });
  it('refuses to remove a key with block-style children', () => {
    expect(removeStationScalar(SAMPLE, 'a-one', 'tags')).toEqual({ text: SAMPLE, changed: false, found: true });
  });
  it('reports found=false for an unknown station', () => {
    expect(removeStationScalar(SAMPLE, 'nope', 'status').found).toBe(false);
  });
  it('removes the last line of the last block cleanly', () => {
    const r = removeStationScalar(SAMPLE, 'b-two', 'status');
    expect(r.text).toBe(SAMPLE.replace('  status: stream-only\n', ''));
  });
});

describe('locateStationBlock / editStationBlock', () => {
  it('finds the same bounds as findStationBlock, first and last block alike', () => {
    const lines = SAMPLE.split('\n');
    for (const id of ['a-one', 'b-two']) {
      const { start, end } = locateStationBlock(SAMPLE, id);
      const block = findStationBlock(lines, id);
      expect(SAMPLE.slice(start, end)).toBe(lines.slice(block.start, block.end + 1).join('\n'));
    }
    expect(locateStationBlock(SAMPLE, 'a-one').start).toBe(0);
  });
  it('returns null for an unknown id and never matches an id prefix', () => {
    expect(locateStationBlock(SAMPLE, 'nope')).toBeNull();
    expect(locateStationBlock(SAMPLE, 'a-on')).toBeNull();
    expect(editStationBlock(SAMPLE, 'nope', () => 'x')).toEqual({ text: SAMPLE, found: false });
  });
  it('edits one block and equals the whole-document edit', () => {
    const viaBlock = editStationBlock(SAMPLE, 'a-one', (b) => setStationScalar(b, 'a-one', 'status', 'broken').text);
    expect(viaBlock.found).toBe(true);
    expect(viaBlock.text).toBe(setStationScalar(SAMPLE, 'a-one', 'status', 'broken').text);
    const last = editStationBlock(SAMPLE, 'b-two', (b) => removeStationScalar(b, 'b-two', 'status').text);
    expect(last.text).toBe(removeStationScalar(SAMPLE, 'b-two', 'status').text);
    expect(editStationBlock(SAMPLE, 'a-one', (b) => b).text).toBe(SAMPLE);
  });
});
