const BaseProvider = require('../BaseProvider');
const { normalizeCatalogItem } = require('../../utils/normalizer');
const { streamimdbGet } = require('./utils');
const stream = require('./stream');
const download = require('./download');

class StreamImdbProvider extends BaseProvider {
  constructor() {
    super('streamimdb');
  }

  get downloadSupported() {
    return true;
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
    }, 'streamimdb');
  }

  async exists(id, type) {
    return true;
  }

  async stream(id, type = 'movie', season = 1, episode = 1, variantId = null, clientIp = null) {
    return await stream(id, type, season, episode, variantId, clientIp);
  }

  async download(id, type, season = 1, episode = 1, variantId = null) {
    return await download(id, type, season, episode, variantId);
  }

  async health() {
    const startTime = Date.now();
    try {
      const url = `https://streamdata.vaplayer.ru/api.php?tmdb=1399&type=tv&season=1&episode=1`;
      await streamimdbGet(url, { timeout: 4000 });
      const duration = Date.now() - startTime;
      return { status: 'healthy', message: 'StreamIMDb API reachable', responseTimeMs: duration };
    } catch (err) {
      const duration = Date.now() - startTime;
      return { status: 'unhealthy', message: `StreamIMDb API unreachable: ${err.message}`, responseTimeMs: duration };
    }
  }
}

module.exports = StreamImdbProvider;
