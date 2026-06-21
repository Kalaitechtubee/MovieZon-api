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
   * Fast existence check — return true if the provider has this title.
   * Used by the pipeline to skip full stream resolution for absent titles.
   * Default implementation: delegates to stream() and checks for a valid result.
   * Override for a cheaper catalog-level check (e.g. a lightweight API ping).
   * @param {string|number} id - TMDB ID
   * @param {'movie'|'tv'} type - Media type
   * @returns {Promise<boolean>}
   */
  async exists(id, type) {
    // Default: assume the provider has the title — stream() will fail if it doesn't.
    // Providers may override this with a cheaper catalog API check.
    return true;
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
   * @param {string|null} [clientIp] - Client IP for CDN token signing
   * @returns {Promise<Object>} Normalized MovieZon stream details object
   */
  async stream(id, type, season = 1, episode = 1, variantId = null, clientIp = null) {
    throw new Error(`Method 'stream()' must be implemented by provider ${this.displayName}`);
  }

  /**
   * Getter indicating if this provider supports direct downloads
   * @returns {boolean}
   */
  get downloadSupported() {
    return false;
  }

  /**
   * Get download stream details for a movie or TV show episode.
   * Embed-only providers (e.g. Peachify) should not override this — the default
   * throws NotSupported so the pipeline skips them for download requests.
   * @param {string|number} id - TMDB ID
   * @param {'movie'|'tv'} type - Media type
   * @param {number} [season]
   * @param {number} [episode]
   * @param {string} [variantId]
   * @returns {Promise<Object>} Normalized stream object with direct CDN URLs
   */
  async download(id, type, season = 1, episode = 1, variantId = null) {
    throw new Error(`Provider ${this.displayName} does not support direct downloads.`);
  }

  /**
   * Run health check
   * @returns {Promise<{status: 'healthy'|'degraded'|'unhealthy', message: string, responseTimeMs: number}>}
   */
  async health() {
    throw new Error(`Method 'health()' must be implemented by provider ${this.displayName}`);
  }
}

module.exports = BaseProvider;

