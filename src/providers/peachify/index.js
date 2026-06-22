const BaseProvider = require('../BaseProvider');
const logger = require('../../logger');
const { normalizeCatalogItem, normalizeStream } = require('../../utils/normalizer');
const { getEmbedUrl } = require('./player');
const { peachifyGet } = require('./utils');

class PeachifyProvider extends BaseProvider {
  constructor() {
    super('peachify');
  }

  /**
   * Search - not directly supported by Peachify; always returns empty.
   */
  async search(query) {
    return [];
  }

  /**
   * Details - stub implementation (enriched by TMDB details later in provider manager)
   */
  async details(id, type) {
    return normalizeCatalogItem({
      tmdbId: id,
      id: String(id),
      title: '',
      type: type || 'movie'
    }, 'peachify');
  }

  /**
   * Fast existence check. Peachify supports embed player if title has metadata.
   */
  async exists(id, type) {
    return true;
  }

  /**
   * Stream - returns the Peachify embed iframe video player
   */
  async stream(id, type = 'movie', season = 1, episode = 1, variantId = null, clientIp = null) {
    logger.debug(`[Peachify] stream() called for ID: ${id}, Type: ${type}, S${season}E${episode}`);
    
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
  }

  /**
   * Peachify is embed-only, so this returns available: false and throws error if resolved.
   */
  async download(id, type, season = 1, episode = 1, variantId = null) {
    throw new Error(`Provider ${this.displayName} does not support direct downloads.`);
  }

  /**
   * Health check - verify Peachify is reachable
   */
  async health() {
    const startTime = Date.now();
    try {
      // Use helper peachifyGet to test peachify connection
      await peachifyGet('https://peachify.top', { timeout: 5000 });
      const duration = Date.now() - startTime;
      return { status: 'healthy', message: 'Peachify reachable', responseTimeMs: duration };
    } catch (err) {
      const duration = Date.now() - startTime;
      const status = err.response && [403, 429].includes(err.response.status) ? 'degraded' : 'unhealthy';
      return { status, message: `Peachify unreachable: ${err.message}`, responseTimeMs: duration };
    }
  }
}

module.exports = PeachifyProvider;
