const NAME_NOISE_TOKENS = new Set([
  'live', 'online', 'web', 'radio', 'fm', 'am', 'stream', 'streaming',
  'hd', 'hq', 'sd', 'stereo', 'mono', 'official',
  'hls', 'http', 'https', 'm3u8',
  'mp3', 'aac', 'aacp', 'flac', 'ogg', 'opus',
  '32', '48', '56', '64', '80', '96', '112', '128', '160', '192', '224', '256', '320',
  '32k', '48k', '56k', '64k', '80k', '96k', '112k', '128k', '160k', '192k', '224k', '256k', '320k',
  'kbps', 'kbit', 'kbits',
]);

export function nameSignature(name) {
  const normalised = String(name ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\b([a-z]+[a-z0-9]*\d[a-z0-9]*)live\b/g, '$1 live')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!normalised) return '';
  const tokens = normalised.split(' ').filter((t) => t && !NAME_NOISE_TOKENS.has(t));
  return tokens.sort().join(' ');
}
