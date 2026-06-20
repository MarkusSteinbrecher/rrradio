import { describe, expect, it } from 'vitest';
import { groupCatalog, collapseCatalog } from './catalog-dedupe.mjs';

// Minimal merged-record fixtures (the shape build-catalog.mjs feeds in).
const FM4_HQ = {
  id: 'builtin-fm4',
  name: 'FM4',
  streamUrl: 'https://orf-live.ors-shoutcast.at/fm4-q2a',
  bitrate: 192,
  codec: 'MP3',
  status: 'working',
  featured: true,
  metadataUrl: 'https://audioapi.orf.at/fm4/api/json/4.0/live',
  favicon: 'stations/fm4.png',
  homepage: 'https://fm4.orf.at/',
  country: 'AT',
};
const FM4_LQ = {
  id: 'at-fm4-orf',
  name: 'FM4 | ORF',
  streamUrl: 'https://orf-live.ors-shoutcast.at/fm4-q1a',
  bitrate: 128,
  codec: 'MP3',
  status: 'stream-only',
  favicon: 'https://fm4.orf.at/apple-touch-icon.png',
  homepage: 'https://fm4.orf.at/',
  country: 'AT',
};

describe('collapseCatalog — FM4 (the canonical case)', () => {
  it('collapses the two FM4 rows into one station with ranked variants', () => {
    const { stations, report } = collapseCatalog([FM4_HQ, FM4_LQ]);
    expect(stations).toHaveLength(1);
    const fm4 = stations[0];
    // Canonical = the working/featured/metadata-bearing 192k row, NOT the
    // stream-only 128k row (deliberately the opposite of dedupe-raw's
    // vote-driven canonical).
    expect(fm4.id).toBe('builtin-fm4');
    expect(fm4.metadataUrl).toBeTruthy();
    expect(fm4.featured).toBe(true);
    // streams ordered best→worst; streamUrl re-pointed at the best.
    expect(fm4.streams).toHaveLength(2);
    expect(fm4.streams[0]).toMatchObject({ bitrate: 192, tier: 'best' });
    expect(fm4.streams[1]).toMatchObject({ bitrate: 128, tier: 'data' });
    expect(fm4.streamUrl).toBe(fm4.streams[0].url);
    expect(fm4.streamUrl).toContain('fm4-q2a');
    // report records the merge for audit.
    expect(report.totals).toMatchObject({ inputRecords: 2, logicalStations: 1, collapsedRows: 1 });
    expect(report.groups[0].canonicalId).toBe('builtin-fm4');
    expect(report.groups[0].members.map((m) => m.id).sort()).toEqual(['at-fm4-orf', 'builtin-fm4']);
  });

  it('collapses FM4 via the stream fingerprint alone (the q<N>a suffix is stripped)', () => {
    // No overrides, no dedupe DB — only the country-scoped structural signals.
    const { stations } = collapseCatalog([FM4_HQ, FM4_LQ]);
    expect(stations).toHaveLength(1);
    expect(stations[0].id).toBe('builtin-fm4');
  });

  it('never merges across countries even with an identical stream URL', () => {
    // Real junk-data shape: one stream, two rows mislabeled to different
    // countries. Merging would wrongly hide one — keep them apart.
    const jp = {
      id: 'jp-free-fm-80',
      name: 'Free FM 80',
      streamUrl: 'https://freefm80.radioca.st/',
      status: 'stream-only',
      homepage: 'https://freefm80.radioca.st/',
      country: 'JP',
    };
    const us = { ...jp, id: 'us-free-fm-80s-sf', name: 'Free FM 80s San Francisco', country: 'US' };
    const { stations } = collapseCatalog([jp, us]);
    expect(stations).toHaveLength(2);
  });

  it('drops an http variant from the public catalog but keeps it when allowHttp', () => {
    const httpLow = { ...FM4_LQ, streamUrl: 'http://orf-live.ors-shoutcast.at/fm4-q1a' };
    const pub = collapseCatalog([FM4_HQ, httpLow]).stations[0];
    expect(pub.streams).toBeUndefined(); // only the https canonical survives → no variants
    expect(pub.streamUrl).toContain('https://');

    const ios = collapseCatalog([FM4_HQ, httpLow], { allowHttp: true }).stations[0];
    expect(ios.streams).toHaveLength(2);
    expect(ios.streams[1].url).toMatch(/^http:/);
  });
});

describe('collapseCatalog — guards against false merges', () => {
  it('keeps FIP and FIP Jazz as distinct stations', () => {
    const fip = {
      id: 'fip',
      name: 'FIP',
      streamUrl: 'https://icecast.radiofrance.fr/fip-hifi.aac',
      bitrate: 192,
      codec: 'AAC',
      status: 'working',
      homepage: 'https://www.radiofrance.fr/fip',
      country: 'FR',
    };
    const fipJazz = {
      id: 'fip-jazz',
      name: 'FIP Jazz',
      streamUrl: 'https://icecast.radiofrance.fr/fipjazz-hifi.aac',
      bitrate: 192,
      codec: 'AAC',
      status: 'working',
      homepage: 'https://www.radiofrance.fr/fip',
      country: 'FR',
    };
    const { stations } = collapseCatalog([fip, fipJazz]);
    expect(stations).toHaveLength(2);
    expect(stations.every((s) => !s.streams)).toBe(true);
  });

  it('does NOT auto-merge same-name same-homepage rows with different stream paths (conservative)', () => {
    // GBH-style format feeds OR Radio-Minor-style sub-channels: same brand name
    // + homepage, distinct stream paths. Conservative mode leaves them separate
    // (a curator opts in via force-merge if they are truly one station).
    const jazz = {
      id: 'x-jazz', name: 'Radio X', streamUrl: 'https://h.example/x_jazz.mp3',
      status: 'stream-only', homepage: 'https://h.example/', country: 'DE', bitrate: 128, codec: 'MP3',
    };
    const rock = { ...jazz, id: 'x-rock', streamUrl: 'https://h.example/x_rock.mp3' };
    const { stations } = collapseCatalog([jazz, rock]);
    expect(stations).toHaveLength(2);
    expect(stations.every((s) => !s.streams)).toBe(true);
  });

  it('honors a not-duplicate override (pulls the id out as a singleton)', () => {
    const out = collapseCatalog([FM4_HQ, FM4_LQ], {
      overrides: { notDuplicate: new Set(['at-fm4-orf']) },
    }).stations;
    expect(out).toHaveLength(2);
    expect(out.every((s) => !s.streams)).toBe(true);
  });

  it('honors a force-merge override across otherwise-unrelated rows', () => {
    const a = {
      id: 'a-fm',
      name: 'Alpha',
      streamUrl: 'https://a.example/alpha.mp3',
      bitrate: 128,
      codec: 'MP3',
      status: 'working',
      homepage: 'https://a.example/',
      country: 'XX',
    };
    const b = {
      id: 'b-fm',
      name: 'Beta',
      streamUrl: 'https://b.example/beta.mp3',
      bitrate: 64,
      codec: 'MP3',
      status: 'stream-only',
      homepage: 'https://b.example/',
      country: 'YY',
    };
    const { stations } = collapseCatalog([a, b], {
      overrides: { forceMerge: [['a-fm', 'b-fm']] },
    });
    expect(stations).toHaveLength(1);
    expect(stations[0].id).toBe('a-fm'); // working beats stream-only
    expect(stations[0].streams).toHaveLength(2);
  });

  it('leaves single-stream stations untouched (no streams emitted)', () => {
    const lone = {
      id: 'lone',
      name: 'Lonely FM',
      streamUrl: 'https://lone.example/stream.aac',
      bitrate: 128,
      codec: 'AAC',
      status: 'working',
      homepage: 'https://lone.example/',
      country: 'ZZ',
    };
    const { stations } = collapseCatalog([lone]);
    expect(stations).toEqual([lone]);
    expect(stations[0].streams).toBeUndefined();
  });
});

describe('groupCatalog — determinism', () => {
  it('is order-independent (same partition regardless of input order)', () => {
    const recs = [FM4_HQ, FM4_LQ];
    const fwd = groupCatalog(recs).groups.map((g) => g.map((r) => r.id).sort());
    const rev = groupCatalog([...recs].reverse()).groups.map((g) => g.map((r) => r.id).sort());
    expect(fwd).toEqual(rev);
  });
});
