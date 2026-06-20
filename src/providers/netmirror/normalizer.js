const { normalizeCatalogItem, normalizeStream } = require('../../provider-normalizer');
const config = require('../../config');

/**
 * Normalizes a catalog item from NetMirror
 */
function normalizeNetMirrorItem(item) {
  return normalizeCatalogItem(item, 'netmirror');
}

/**
 * Normalizes a stream result from NetMirror
 */
function normalizeNetMirrorStream(embedData) {
  if (!embedData) return null;

  const baseUrl = config.netmirror.baseUrl;

  // Fully qualify subtitle URLs if they are relative
  const rawSubtitles = embedData.captions || embedData.subtitles || [];
  const subtitles = rawSubtitles.map(sub => {
    let url = sub.url || '';
    if (url.startsWith('/')) {
      url = `${baseUrl}${url}`;
    }
    return {
      lang: sub.lang || 'en',
      name: sub.name || 'English',
      url
    };
  });

  // Extract qualities from streams array
  const rawStreams = embedData.streams || [];
  const qualities = rawStreams.map(stream => {
    let qStr = '1080p';
    if (stream.resolution) {
      const res = String(stream.resolution);
      qStr = res.endsWith('p') ? res : `${res}p`;
    }
    return {
      quality: qStr,
      url: stream.url || ''
    };
  });

  // Try to parse 'expires' from sign / token or query parameter t
  let expires = null;
  const testUrl = embedData.mp4 || (qualities[0] && qualities[0].url) || '';
  if (testUrl) {
    try {
      const urlObj = new URL(testUrl);
      const t = urlObj.searchParams.get('t');
      if (t) {
        // 't' is the generation timestamp. The secure token is valid for 1 hour (3600 seconds).
        // We use a 5-minute buffer so tokens are rejected before they actually expire.
        expires = parseInt(t, 10) + 3600 - 300;
      }
    } catch (e) {
      // Ignored
    }
  }

  // Create stream shape
  const baseNormalized = normalizeStream({
    drm: false,
    streamUrl: embedData.mp4 || embedData.url || '',
    subtitles,
    qualities,
    expires,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': `${baseUrl}/`
    }
  }, 'netmirror');

  return baseNormalized;
}

module.exports = {
  normalizeNetMirrorItem,
  normalizeNetMirrorStream
};
