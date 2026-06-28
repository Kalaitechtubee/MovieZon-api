const BaseProvider = require('../BaseProvider');
const logger = require('../../logger');
const { normalizeCatalogItem } = require('../../utils/normalizer');
const { peachifyGet } = require('./utils');
const stream = require('./stream');

class PeachifyProvider extends BaseProvider {
  constructor() {
    super('peachify');
  }



  async search(query) {
    return [];
  }

  async details(id, type) {
    return normalizeCatalogItem({
      tmdbId: id,
      id: String(id),
      title: '',
      type: type || 'movie'
    }, 'peachify');
  }

  async exists(id, type) {
    return true;
  }

  async peachifyGet(url, options = {}) {
    return await peachifyGet(url, options);
  }

  async stream(id, type = 'movie', season = 1, episode = 1, variantId = null, clientIp = null) {
    return await stream(id, type, season, episode, variantId, clientIp);
  }



  async health() {
    const startTime = Date.now();
    try {
      await peachifyGet('https://peachify.top', { timeout: 5000 });
      const duration = Date.now() - startTime;
      return { status: 'healthy', message: 'Peachify reachable', responseTimeMs: duration };
    } catch (err) {
      const duration = Date.now() - startTime;
      const status = err.response && [402, 403, 429].includes(err.response.status) ? 'degraded' : 'unhealthy';
      return { status, message: `Peachify unreachable: ${err.message}`, responseTimeMs: duration };
    }
  }
}

module.exports = PeachifyProvider;
