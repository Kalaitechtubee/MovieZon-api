const BaseProvider = require('../BaseProvider');
const { getDownloadLinks, getWorkingDomain } = require('./scraper');
const logger = require('../../logger');

class MovieswoodProvider extends BaseProvider {
  constructor() {
    super('movieswood');
  }

  async search(query) {
    // Like moviesda, search is delegated directly via download endpoint
    return [];
  }

  async details(id, type) {
    return null;
  }

  async exists(id, type) {
    return true;
  }

  async stream(id, type = 'movie', season = 1, episode = 1, variantId = null, clientIp = null) {
    // Movieswood is primarily resolved via download endpoints
    return null;
  }

  /**
   * Resolve download/stream links for a movie title.
   * @param {string} title - Movie title
   * @param {number} [year] - Optional release year
   * @returns {Promise<Object>} - { found, title, qualities }
   */
  async download(title, year = null) {
    logger.info(`[MovieswoodProvider] Resolving downloads for: "${title}" year=${year}`);
    return await getDownloadLinks(title, year);
  }

  async health() {
    const startTime = Date.now();
    try {
      const domain = await getWorkingDomain();
      const duration = Date.now() - startTime;
      return {
        status: 'healthy',
        message: `Movieswood reachable at ${domain}`,
        responseTimeMs: duration,
      };
    } catch (err) {
      const duration = Date.now() - startTime;
      return {
        status: 'unhealthy',
        message: `Movieswood unreachable: ${err.message}`,
        responseTimeMs: duration,
      };
    }
  }
}

module.exports = MovieswoodProvider;
