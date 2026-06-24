const logger = require('../../logger');
const { normalizeStream } = require('../../utils/normalizer');

module.exports = async function stream(id, type = 'movie', season = 1, episode = 1, variantId = null, clientIp = null) {
  logger.debug(`[EmbedSU Stream] stream() called for ID: ${id}, Type: ${type}, S${season}E${episode}`);
  
  const embedUrl = type === 'tv'
    ? `https://embed.su/embed/tv/${id}/${season}/${episode}`
    : `https://embed.su/embed/movie/${id}`;

  return normalizeStream({
    provider: 'embedsu',
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
  }, 'embedsu');
};
