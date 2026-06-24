const logger = require('../../logger');
const { normalizeStream } = require('../../utils/normalizer');
const { getEmbedUrl } = require('./player');
const { scrapeDirectStream } = require('./utils');

module.exports = async function stream(id, type = 'movie', season = 1, episode = 1, variantId = null, clientIp = null) {
  logger.debug(`[Peachify Stream] stream() called for ID: ${id}, Type: ${type}, S${season}E${episode}`);
  
  // Check if the stream actually exists on Peachify
  const directData = await scrapeDirectStream(id, type, season, episode);
  if (!directData) {
    throw new Error(`Media not found on Peachify.`);
  }

  const embedInfo = getEmbedUrl(id, type, season, episode);

  return normalizeStream({
    provider: 'peachify',
    drm: false,
    streamUrl: '',
    embedUrl: embedInfo.embedUrl,
    embedFallbacks: embedInfo.embedFallbacks,
    streamType: 'embed',
    subtitles: [],
    headers: {},
    qualities: [],
    variants: [],
    expires: null
  }, 'peachify');
};
