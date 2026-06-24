const BaseProvider = require('../BaseProvider');
const { normalizeStream } = require('../../utils/normalizer');
const logger = require('../../logger');

class VidSrcProvider extends BaseProvider {
  constructor() {
    super('vidsrc');
  }

  async search(query) {
    return [];
  }

  async details(id, type) {
    return null;
  }

  async stream(id, type = 'movie', season = 1, episode = 1, variantId = null, clientIp = null) {
    logger.debug(`[VidSrc] stream() called for ID: ${id}, Type: ${type}, S${season}E${episode}`);
    
    const embedUrl = type === 'tv'
      ? `https://vidsrc.to/embed/tv/${id}/${season}/${episode}`
      : `https://vidsrc.to/embed/movie/${id}`;

    return normalizeStream({
      provider: 'vidsrc',
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
    }, 'vidsrc');
  }

  async health() {
    const startTime = Date.now();
    try {
      const res = await fetch('https://vidsrc.to', { timeout: 3000 });
      const duration = Date.now() - startTime;
      return { 
        status: res.ok || res.status < 500 ? 'healthy' : 'unhealthy', 
        message: 'VidSrc reachable', 
        responseTimeMs: duration 
      };
    } catch (err) {
      const duration = Date.now() - startTime;
      return { 
        status: 'unhealthy', 
        message: `VidSrc unreachable: ${err.message}`, 
        responseTimeMs: duration 
      };
    }
  }
}

module.exports = VidSrcProvider;
