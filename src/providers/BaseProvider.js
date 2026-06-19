const logger = require('../logger');

class BaseProvider {
  constructor(name) {
    if (this.constructor === BaseProvider) {
      throw new Error("BaseProvider is abstract and cannot be instantiated directly.");
    }
    this.name = name.toLowerCase();
    this.displayName = name.charAt(0).toUpperCase() + name.slice(1);
    logger.debug(`Provider instantiated: ${this.displayName}`);
  }

  /**
   * Search for movies or TV shows
   * @param {string} query - Search term
   * @returns {Promise<Array>} Normalized array of search results
   */
  async search(query) {
    throw new Error(`Method 'search()' must be implemented by provider ${this.displayName}`);
  }

  /**
   * Get detailed metadata for a movie or TV show
   * @param {string|number} id - TMDB ID of the title
   * @param {'movie'|'tv'} type - Media type
   * @returns {Promise<Object>} Normalized MovieZon metadata object
   */
  async details(id, type) {
    throw new Error(`Method 'details()' must be implemented by provider ${this.displayName}`);
  }

  /**
   * Get streaming details and link for a movie or TV show episode
   * @param {string|number} id - TMDB ID of the title
   * @param {'movie'|'tv'} type - Media type
   * @param {number} [season] - Season number (required if type is 'tv')
   * @param {number} [episode] - Episode number (required if type is 'tv')
   * @param {string} [variantId] - Specific language/dub variant ID (optional)
   * @returns {Promise<Object>} Normalized MovieZon stream details object
   */
  async stream(id, type, season = 1, episode = 1, variantId = null) {
    throw new Error(`Method 'stream()' must be implemented by provider ${this.displayName}`);
  }

  /**
   * Run health check check
   * @returns {Promise<{status: 'healthy'|'degraded'|'unhealthy', message: string, responseTimeMs: number}>}
   */
  async health() {
    throw new Error(`Method 'health()' must be implemented by provider ${this.displayName}`);
  }
}

module.exports = BaseProvider;
