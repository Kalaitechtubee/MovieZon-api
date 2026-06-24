const logger = require('../../logger');
const { normalizeStream } = require('../../utils/normalizer');

module.exports = async function stream(id, type = 'movie', season = 1, episode = 1, variantId = null, clientIp = null) {
  logger.debug(`[AutoEmbed Stream] stream() called for ID: ${id}, Type: ${type}, S${season}E${episode}`);
  
  const embedUrl = type === 'tv'
    ? `https://autoembed.co/tv/tmdb/${id}-${season}-${episode}`
    : `https://autoembed.co/movie/tmdb/${id}`;

  return normalizeStream({
    provider: 'autoembed',
    drm: false,
    streamUrl: '',
    embedUrl,
    embedFallbacks: [embedUrl],
    streamType: 'embed',
    subtitles: [],
    headers: {},
    qualities: [],
    variants: [],
    expires: null
  }, 'autoembed');
};
