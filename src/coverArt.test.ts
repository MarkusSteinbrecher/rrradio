import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { lookupCover, searchITunes, verifyTrack } from './coverArt';

// Shared fixture: an iTunes Search hit with one usable artwork URL.
const HIT_RESPONSE = {
  resultCount: 1,
  results: [
    {
      artistName: 'Radiohead',
      trackName: 'Pyramid Song',
      artworkUrl100:
        'https://is3-ssl.mzstatic.com/image/thumb/Music/abc/100x100bb.jpg',
    },
  ],
};

const MISS_RESPONSE = { resultCount: 0, results: [] };

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('coverArt / searchITunes', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns hit:true and a 600x600 cover URL on iTunes match', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(HIT_RESPONSE));
    const result = await searchITunes(
      'Radiohead',
      'Pyramid Song',
      new AbortController().signal,
    );
    expect(result.hit).toBe(true);
    // /100x100bb.jpg → /600x600bb.jpg
    expect(result.cover).toContain('/600x600bb.jpg');
  });

  it('returns hit:false on resultCount === 0', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(MISS_RESPONSE));
    const result = await searchITunes(
      undefined,
      'BR24 Aktuell',
      new AbortController().signal,
    );
    expect(result.hit).toBe(false);
    expect(result.cover).toBeUndefined();
  });

  it('caches hit results across calls (no second fetch)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(HIT_RESPONSE));
    const signal = new AbortController().signal;
    const first = await searchITunes('Radiohead', 'Pyramid Song A', signal);
    const second = await searchITunes('Radiohead', 'Pyramid Song A', signal);
    expect(first).toEqual(second);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('caches miss results so news titles do not re-hit iTunes every poll', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(MISS_RESPONSE));
    const signal = new AbortController().signal;
    const first = await searchITunes(undefined, 'Nachrichten 12:00 B', signal);
    const second = await searchITunes(undefined, 'Nachrichten 12:00 B', signal);
    expect(first.hit).toBe(false);
    expect(second.hit).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('skips lookup for tracks under 3 characters', async () => {
    const result = await searchITunes(undefined, '—', new AbortController().signal);
    expect(result.hit).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does NOT cache aborted/network errors so the next poll can retry', async () => {
    fetchMock.mockRejectedValueOnce(new Error('aborted'));
    const signal = new AbortController().signal;
    const first = await searchITunes('Artist', 'Track Title C', signal);
    expect(first.hit).toBe(false);

    // Second call should hit fetch again, not return the cached miss.
    fetchMock.mockResolvedValueOnce(jsonResponse(HIT_RESPONSE));
    const second = await searchITunes('Artist', 'Track Title C', signal);
    expect(second.hit).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('coverArt / verifyTrack', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns true on hit and false on miss', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(HIT_RESPONSE))
      .mockResolvedValueOnce(jsonResponse(MISS_RESPONSE));
    const signal = new AbortController().signal;
    expect(await verifyTrack('Radiohead', 'Verify D', signal)).toBe(true);
    expect(await verifyTrack(undefined, 'Some news ID E', signal)).toBe(false);
  });
});

describe('coverArt / lookupCover (back-compat wrapper)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns cover on hit, undefined on miss', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(HIT_RESPONSE))
      .mockResolvedValueOnce(jsonResponse(MISS_RESPONSE));
    const signal = new AbortController().signal;
    const hit = await lookupCover('Radiohead', 'Cover F', signal);
    expect(hit).toContain('/600x600bb.jpg');
    const miss = await lookupCover(undefined, 'No match G', signal);
    expect(miss).toBeUndefined();
  });
});
