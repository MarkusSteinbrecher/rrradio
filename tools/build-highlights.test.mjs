import { describe, expect, it } from 'vitest';
import {
  validateHighlights,
  buildHighlightsPayload,
  contentVersion,
  serializePayload,
} from './build-highlights.mjs';

const PUBLISHED = new Set(['builtin-grrif', 'byte-fm', 'builtin-fip']);

describe('validateHighlights', () => {
  it('maps station → stationId and keeps only the fields that are present', () => {
    const { highlights, errors } = validateHighlights(
      {
        highlights: [
          {
            station: 'builtin-grrif',
            badge: { label: 'Station of the week', accent: '#0F8A40' },
            blurb: '  Indie outpost  ',
          },
        ],
      },
      PUBLISHED,
    );
    expect(errors).toEqual([]);
    expect(highlights).toEqual([
      {
        stationId: 'builtin-grrif',
        badge: { label: 'Station of the week', accent: '#0f8a40' }, // lowercased
        blurb: 'Indie outpost', // trimmed
      },
    ]);
  });

  it('accepts a bare list as well as a { highlights } map', () => {
    const list = [{ station: 'byte-fm', badge: { label: 'New' } }];
    const fromList = validateHighlights(list, PUBLISHED);
    const fromMap = validateHighlights({ highlights: list }, PUBLISHED);
    expect(fromList.errors).toEqual([]);
    expect(fromList.highlights).toEqual(fromMap.highlights);
  });

  it('accepts `stationId` as an alias for `station`', () => {
    const { highlights, errors } = validateHighlights(
      [{ stationId: 'byte-fm', badge: { label: 'New' } }],
      PUBLISHED,
    );
    expect(errors).toEqual([]);
    expect(highlights[0].stationId).toBe('byte-fm');
  });

  it('omits an absent or empty accent / blurb rather than emitting null', () => {
    const { highlights } = validateHighlights(
      [{ station: 'byte-fm', badge: { label: 'New' }, blurb: '   ' }],
      PUBLISHED,
    );
    expect(highlights[0]).toEqual({ stationId: 'byte-fm', badge: { label: 'New' } });
    expect('accent' in highlights[0].badge).toBe(false);
    expect('blurb' in highlights[0]).toBe(false);
  });

  it('rejects a station id that is not in the published catalog', () => {
    const { errors } = validateHighlights(
      [{ station: 'not-a-real-station', badge: { label: 'X' } }],
      PUBLISHED,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/not a published catalog station/);
  });

  it('skips station-id validation when no published set is supplied', () => {
    const { errors } = validateHighlights(
      [{ station: 'anything', badge: { label: 'X' } }],
      new Set(),
    );
    expect(errors).toEqual([]);
  });

  it('requires a badge with a non-empty label', () => {
    expect(validateHighlights([{ station: 'byte-fm' }], PUBLISHED).errors[0]).toMatch(
      /missing `badge`/,
    );
    expect(
      validateHighlights([{ station: 'byte-fm', badge: { label: '  ' } }], PUBLISHED).errors[0],
    ).toMatch(/badge.label/);
  });

  it('rejects a malformed accent hex', () => {
    for (const accent of ['#fff', '0f8a40', '#0f8a4z', 'red']) {
      const { errors } = validateHighlights(
        [{ station: 'byte-fm', badge: { label: 'X', accent } }],
        PUBLISHED,
      );
      expect(errors[0], accent).toMatch(/badge.accent must be a #rrggbb/);
    }
  });

  it('rejects malformed and impossible dates', () => {
    expect(
      validateHighlights(
        [{ station: 'byte-fm', badge: { label: 'X' }, startsOn: '2026-6-1' }],
        PUBLISHED,
      ).errors[0],
    ).toMatch(/startsOn must be a valid YYYY-MM-DD/);
    expect(
      validateHighlights(
        [{ station: 'byte-fm', badge: { label: 'X' }, endsOn: '2026-02-30' }],
        PUBLISHED,
      ).errors[0],
    ).toMatch(/endsOn must be a valid YYYY-MM-DD/);
  });

  it('accepts a valid scheduling window and rejects an inverted one', () => {
    const ok = validateHighlights(
      [
        {
          station: 'byte-fm',
          badge: { label: 'X' },
          startsOn: '2026-06-01',
          endsOn: '2026-06-30',
        },
      ],
      PUBLISHED,
    );
    expect(ok.errors).toEqual([]);
    expect(ok.highlights[0]).toMatchObject({ startsOn: '2026-06-01', endsOn: '2026-06-30' });

    const inverted = validateHighlights(
      [
        {
          station: 'byte-fm',
          badge: { label: 'X' },
          startsOn: '2026-06-30',
          endsOn: '2026-06-01',
        },
      ],
      PUBLISHED,
    );
    expect(inverted.errors[0]).toMatch(/startsOn .* is after endsOn/);
  });

  it('rejects a duplicate station + badge pair (the client identity collides)', () => {
    const { errors } = validateHighlights(
      [
        { station: 'byte-fm', badge: { label: 'New' } },
        { station: 'byte-fm', badge: { label: 'New' } },
      ],
      PUBLISHED,
    );
    expect(errors[0]).toMatch(/duplicate station \+ badge/);
  });

  it('allows the same station under two different badges', () => {
    const { errors, highlights } = validateHighlights(
      [
        { station: 'byte-fm', badge: { label: 'New' } },
        { station: 'byte-fm', badge: { label: 'Editor’s pick' } },
      ],
      PUBLISHED,
    );
    expect(errors).toEqual([]);
    expect(highlights).toHaveLength(2);
  });

  it('flags a non-list document', () => {
    expect(validateHighlights({ nope: true }, PUBLISHED).errors[0]).toMatch(/expected a list/);
    expect(validateHighlights('string', PUBLISHED).errors[0]).toMatch(/expected a list/);
  });
});

describe('buildHighlightsPayload', () => {
  const doc = {
    highlights: [{ station: 'builtin-grrif', badge: { label: 'Station of the week' } }],
  };

  it('returns a null payload when there are validation errors', () => {
    const { payload, errors } = buildHighlightsPayload(
      [{ station: 'unknown', badge: { label: 'X' } }],
      PUBLISHED,
    );
    expect(payload).toBeNull();
    expect(errors.length).toBeGreaterThan(0);
  });

  it('derives a deterministic content-hash version', () => {
    const a = buildHighlightsPayload(doc, PUBLISHED);
    const b = buildHighlightsPayload(doc, PUBLISHED);
    expect(a.payload.version).toBe(b.payload.version);
    expect(a.payload.version).toBe(contentVersion(a.payload.highlights));
    expect(a.payload.version).toMatch(/^[0-9a-f]{12}$/);
  });

  it('changes the version when content changes', () => {
    const v1 = buildHighlightsPayload(doc, PUBLISHED).payload.version;
    const v2 = buildHighlightsPayload(
      { highlights: [{ station: 'builtin-grrif', badge: { label: 'Different' } }] },
      PUBLISHED,
    ).payload.version;
    expect(v1).not.toBe(v2);
  });

  it('honours an explicit top-level version', () => {
    const { payload } = buildHighlightsPayload({ version: '2026-06-05', ...doc }, PUBLISHED);
    expect(payload.version).toBe('2026-06-05');
  });

  it('serializes as pretty JSON with a trailing newline', () => {
    const { payload } = buildHighlightsPayload(doc, PUBLISHED);
    const text = serializePayload(payload);
    expect(text.endsWith('\n')).toBe(true);
    expect(JSON.parse(text)).toEqual(payload);
  });
});
