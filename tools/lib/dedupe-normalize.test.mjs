import { describe, expect, it } from 'vitest';
import {
  normalizeStreamUrl,
  streamHost,
  streamFingerprint,
  normalizeHomepage,
  unwrapProxyUrl,
} from './dedupe-normalize.mjs';

describe('normalizeStreamUrl', () => {
  it('treats http and https of the same host+path as one stream', () => {
    expect(normalizeStreamUrl('http://drive.uber.radio/uber/crbeethoven/icecast.audio'))
      .toBe(normalizeStreamUrl('https://drive.uber.radio/uber/crbeethoven/icecast.audio'));
  });

  it('drops www and trailing slash', () => {
    expect(normalizeStreamUrl('https://www.example.com/stream/'))
      .toBe(normalizeStreamUrl('http://example.com/stream'));
  });

  it('drops query noise by default', () => {
    expect(normalizeStreamUrl('https://h.com/s.mp3?ref=radiobrowser'))
      .toBe(normalizeStreamUrl('https://h.com/s.mp3'));
  });

  it('keeps query when dropQuery is false (channel selectors)', () => {
    const opts = { dropQuery: false };
    expect(normalizeStreamUrl('https://eilo.org/streamer.php?ch=techno', opts))
      .not.toBe(normalizeStreamUrl('https://eilo.org/streamer.php?ch=trance', opts));
  });

  it('falls back to a trimmed lowercase string for unparseable input', () => {
    expect(normalizeStreamUrl('  NOT A URL ')).toBe('not a url');
    expect(normalizeStreamUrl('')).toBe('');
  });

  it('unwraps proxy-wrapped streams so distinct channels stay distinct', () => {
    // The "LiSTNR 177" over-merge: 66 SCA channels behind one worldradio proxy.
    const a = 'http://worldradio.online/proxy/?q=http://wz0liw.scahw.com.au/live/rnb-chill.stream/playlist.m3u8';
    const b = 'http://worldradio.online/proxy/?q=http://wz0liw.scahw.com.au/live/fresh-folk.stream/playlist.m3u8';
    expect(normalizeStreamUrl(a)).not.toBe(normalizeStreamUrl(b));
    expect(normalizeStreamUrl(a)).toBe('//wz0liw.scahw.com.au/live/rnb-chill.stream/playlist.m3u8');
  });

  it('dedupes a proxied stream against its direct copy', () => {
    expect(normalizeStreamUrl('http://worldradio.online/proxy/?q=https://h.com/live/jazz.stream/playlist.m3u8'))
      .toBe(normalizeStreamUrl('https://h.com/live/jazz.stream/playlist.m3u8'));
  });
});

describe('unwrapProxyUrl', () => {
  it('returns the inner http(s) URL from a proxy query param', () => {
    expect(unwrapProxyUrl('http://worldradio.online/proxy/?q=https://h.com/live/x'))
      .toBe('https://h.com/live/x');
  });
  it('leaves a normal channel selector untouched', () => {
    expect(unwrapProxyUrl('https://eilo.org/streamer.php?ch=techno'))
      .toBe('https://eilo.org/streamer.php?ch=techno');
  });
  it('leaves a plain stream URL untouched', () => {
    expect(unwrapProxyUrl('https://h.com/stream.mp3')).toBe('https://h.com/stream.mp3');
  });
  it('is bounded against proxy-of-proxy loops', () => {
    const nested = 'http://p.x/?q=' + encodeURIComponent('http://p.y/?q=' + encodeURIComponent('https://real.fm/live'));
    expect(unwrapProxyUrl(nested)).toBe('https://real.fm/live');
  });
});

describe('streamHost', () => {
  it('returns the bare host', () => {
    expect(streamHost('https://www.Example.com:8000/x')).toBe('example.com:8000');
    expect(streamHost('garbage')).toBe('');
  });
});

describe('streamFingerprint', () => {
  it('collapses SRF 4 News bitrate/codec variants on one CDN path', () => {
    // Real raw-RB URLs for "Radio SRF 4 News".
    const fp = streamFingerprint('https://stream.srg-ssr.ch/m/drs4news/mp3_128');
    expect(fp).toBe('//stream.srg-ssr.ch/m/drs4news');
    expect(streamFingerprint('https://stream.srg-ssr.ch/m/drs4news/aacp_96')).toBe(fp);
    expect(streamFingerprint('https://stream.srg-ssr.ch/m/drs4news/aacp_32')).toBe(fp);
  });

  it('collapses Bayern 1 Oberbayern HLS bitrate variants', () => {
    const fp = streamFingerprint('https://br-radio.ard-mcdn.de/br/radio/b1obb/hls/96/seglist.m3u8');
    expect(fp).toBe('//br-radio.ard-mcdn.de/br/radio/b1obb');
    expect(streamFingerprint('https://br-radio.ard-mcdn.de/br/radio/b1obb/hls/192/seglist.m3u8'))
      .toBe(fp);
  });

  it('collapses ORS/ORF q<N>a quality-variant suffixes (FM4 192k vs 128k)', () => {
    const fp = streamFingerprint('https://orf-live.ors-shoutcast.at/fm4-q2a');
    expect(fp).toBe('//orf-live.ors-shoutcast.at/fm4');
    expect(streamFingerprint('https://orf-live.ors-shoutcast.at/fm4-q1a')).toBe(fp);
    // bare q1/q2 too
    expect(streamFingerprint('https://h.com/oe1-q1')).toBe(streamFingerprint('https://h.com/oe1-q2'));
    // …but a different channel prefix stays distinct.
    expect(streamFingerprint('https://orf-live.ors-shoutcast.at/oe3-q2a'))
      .not.toBe(streamFingerprint('https://orf-live.ors-shoutcast.at/fm4-q2a'));
  });

  it('keeps genuinely different regional feeds apart', () => {
    // Bayern 1 Franken vs Schwaben — distinct local programmes, distinct path.
    expect(streamFingerprint('https://dispatcher.rndfnk.com/br/br1/franken/mp3/mid'))
      .not.toBe(streamFingerprint('https://dispatcher.rndfnk.com/br/br1/schwaben/mp3/mid'));
  });

  it('does NOT bridge the same feed across different CDNs (left for family/override)', () => {
    // Bayern 1 Oberbayern is on two CDNs with different path encodings; the
    // fingerprint is intentionally URL-bound and must not merge them.
    expect(streamFingerprint('https://dispatcher.rndfnk.com/br/br1/obb/mp3/mid'))
      .not.toBe(streamFingerprint('https://br-radio.ard-mcdn.de/br/radio/b1obb/hls/96/seglist.m3u8'));
  });

  it('is protocol- and www-insensitive like normalizeStreamUrl', () => {
    expect(streamFingerprint('http://www.h.com/jazz/stream/128'))
      .toBe(streamFingerprint('https://h.com/jazz/stream/64'));
  });

  it('preserves numeric station IDs (only known bitrates are stripped)', () => {
    // qingting: id 1278 must survive; 64k is the bitrate.
    expect(streamFingerprint('https://lhttp.qingting.fm/live/1278/64k.mp3'))
      .toBe('//lhttp.qingting.fm/live/1278');
    // Two different qingting stations stay distinct (the over-merge bug).
    expect(streamFingerprint('https://lhttp.qingting.fm/live/1278/64k.mp3'))
      .not.toBe(streamFingerprint('https://lhttp.qingting.fm/live/273/64k.mp3'));
    // radioking + servicioswebmx numeric ids survive too.
    expect(streamFingerprint('https://listen.radioking.com/radio/623812/stream/685903'))
      .not.toBe(streamFingerprint('https://listen.radioking.com/radio/453221/stream/508076'));
    expect(streamFingerprint('https://streaming.servicioswebmx.com/8266/stream'))
      .not.toBe(streamFingerprint('https://streaming.servicioswebmx.com/8142/stream'));
  });

  it('refuses to fingerprint generic-only paths (proxy wrappers, id-in-query)', () => {
    // worldradio proxy: identity is in ?q=, path is just /proxy.
    expect(streamFingerprint('http://worldradio.online/proxy/?q=http://x.au/live/a.stream/playlist.m3u8'))
      .toBe('');
    expect(streamFingerprint('https://h.com/radio/stream')).toBe('');
    expect(streamFingerprint('https://h.com/live')).toBe('');
  });

  it('refuses to fingerprint a shared web-script entrypoint (channel is in the query)', () => {
    // Sweden's Bauer feeds put the real channel in `?i=…` over a shared
    // `/http_live.php` entrypoint. The query is dropped and `http`/`live`/`php`
    // are all generic, so the path carries no identity → '' → Mix Megapol /
    // NRJ / Rockklassiker never fuse on a fingerprint match.
    expect(streamFingerprint('https://tx-bauerse.sharp-stream.com/http_live.php?i=mixmegapol_instream_se_mp3')).toBe('');
    expect(streamFingerprint('https://tx-bauerse.sharp-stream.com/http_live.php?i=nrj_instreamtest_se_mp3')).toBe('');
    // A real per-channel path on the same family of CDN still fingerprints.
    expect(streamFingerprint('https://live-bauerse-fm.sharp-stream.com/nostalgi_aacp'))
      .toBe(streamFingerprint('https://live-bauerse-fm.sharp-stream.com/nostalgi_mp3'));
  });

  it('returns empty when only the host would survive (too weak to group on)', () => {
    expect(streamFingerprint('http://1.2.3.4:8000/')).toBe('');
    expect(streamFingerprint('https://h.com/128/mp3')).toBe('');
    expect(streamFingerprint('not a url')).toBe('');
    expect(streamFingerprint('')).toBe('');
  });

  it('keeps the port — distinct Shoutcast mounts stay distinct', () => {
    expect(streamFingerprint('http://h.com:8000/jazz'))
      .not.toBe(streamFingerprint('http://h.com:8001/jazz'));
  });
});

describe('normalizeHomepage', () => {
  it('host-only by default', () => {
    expect(normalizeHomepage('https://www.br.de/radio/index.html')).toBe('br.de');
  });

  it('includes path and strips index pages when asked', () => {
    expect(normalizeHomepage('https://www.br.de/radio/index.html', { includePath: true }))
      .toBe('br.de/radio');
    expect(normalizeHomepage('https://br.de/radio/', { includePath: true })).toBe('br.de/radio');
  });

  it('empty for no host', () => {
    expect(normalizeHomepage('not-a-url')).toBe('');
  });
});
