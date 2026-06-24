const BaseProvider = require('../BaseProvider');
const { normalizeStream } = require('../../utils/normalizer');
const logger = require('../../logger');

class AutoEmbedProvider extends BaseProvider {
  constructor() {
    super('autoembed');
  }

  async search(query) {
    return [];
  }

  async details(id, type) {
    return null;
  }

  async stream(id, type = 'movie', season = 1, episode = 1, variantId = null, clientIp = null) {
    logger.debug(`[AutoEmbed] stream() called for ID: ${id}, Type: ${type}, S${season}E${episode}`);
    
    const embedUrl = type === 'tv'
      ? `https://autoembed.cc/tv/${id}-${season}-${episode}`
      : `https://autoembed.cc/movie/${id}`;

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
  }

  async health() {
    const startTime = Date.now();
    try {
      const res = await fetch('https://autoembed.cc', { timeout: 3000 });
      const duration = Date.now() - startTime;
      return { 
        status: res.ok || res.status < 500 ? 'healthy' : 'unhealthy', 
        message: 'AutoEmbed reachable', 
        responseTimeMs: duration 
      };
    } catch (err) {
      const duration = Date.now() - startTime;
      return { 
        status: 'unhealthy', 
        message: `AutoEmbed unreachable: ${err.message}`, 
        responseTimeMs: duration 
      };
    }
  }
}

module.exports = AutoEmbedProvider;
