const BaseProvider = require('../BaseProvider');
const { getDownloadLinks, getWorkingDomain } = require('./scraper');
const logger = require('../../logger');

class MoviesdaProvider extends BaseProvider {
  constructor() {
    super('moviesda');
  }

  async search(query) {
    return [];
  }

  async details(id, type) {
    return null;
  }

  async exists(id, type) {
    return true;
  }

  async stream(id, type = 'movie', season = 1, episode = 1, variantId = null, clientIp = null) {
    // Moviesda is a download provider, not a stream provider.
    return null;
  }

  /**
   * Resolve download links for a movie title.
   * @param {string} title - Movie title
   * @param {number} [year] - Optional release year
   * @returns {Promise<Object>} - { found, title, qualities }
   */
  async download(title, year = null) {
    logger.info(`[MoviesdaProvider] Resolving downloads for: "${title}" year=${year}`);
    return await getDownloadLinks(title, year);
  }

  async health() {
    const startTime = Date.now();
    try {
      const domain = await getWorkingDomain();
      const duration = Date.now() - startTime;
      return {
        status: 'healthy',
        message: `Moviesda reachable at ${domain}`,
        responseTimeMs: duration,
      };
    } catch (err) {
      const duration = Date.now() - startTime;
      return {
        status: 'unhealthy',
        message: `Moviesda unreachable: ${err.message}`,
        responseTimeMs: duration,
      };
    }
  }
}

module.exports = MoviesdaProvider;
