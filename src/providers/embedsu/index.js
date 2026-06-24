const BaseProvider = require('../BaseProvider');
const { normalizeStream } = require('../../utils/normalizer');
const logger = require('../../logger');

class EmbedSuProvider extends BaseProvider {
  constructor() {
    super('embedsu');
  }

  async search(query) {
    return [];
  }

  async details(id, type) {
    return null;
  }

  async stream(id, type = 'movie', season = 1, episode = 1, variantId = null, clientIp = null) {
    logger.debug(`[EmbedSU] stream() called for ID: ${id}, Type: ${type}, S${season}E${episode}`);
    
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
  }

  async health() {
    const startTime = Date.now();
    try {
      const res = await fetch('https://embed.su', { timeout: 3000 });
      const duration = Date.now() - startTime;
      return { 
        status: res.ok || res.status < 500 ? 'healthy' : 'unhealthy', 
        message: 'EmbedSU reachable', 
        responseTimeMs: duration 
      };
    } catch (err) {
      const duration = Date.now() - startTime;
      return { 
        status: 'unhealthy', 
        message: `EmbedSU unreachable: ${err.message}`, 
        responseTimeMs: duration 
      };
    }
  }
}

module.exports = EmbedSuProvider;
