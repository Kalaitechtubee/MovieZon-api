const BaseProvider = require('../BaseProvider');
const logger = require('../../logger');
const { normalizeCatalogItem, normalizeStream } = require('../../utils/normalizer');
const { streamimdbGet, parseQualitiesFromMaster, DEFAULT_HEADERS } = require('./utils');

class StreamImdbProvider extends BaseProvider {
  constructor() {
    super('streamimdb');
  }

  get downloadSupported() {
    return true;
  }

  /**
   * Search - stub implementation, always returns empty.
   */
  async search(query) {
    return [];
  }

  /**
   * Details - stub implementation
   */
  async details(id, type) {
    return normalizeCatalogItem({
      tmdbId: id,
      id: String(id),
      title: '',
      type: type || 'movie'
    }, 'streamimdb');
  }

  /**
   * Fast existence check.
   */
  async exists(id, type) {
    return true;
  }

  /**
   * Get direct stream details
   */
  async stream(id, type = 'movie', season = 1, episode = 1, variantId = null, clientIp = null) {
    logger.debug(`[StreamIMDb] stream() called for ID: ${id}, Type: ${type}, S${season}E${episode}`);

    const isTv = type === 'tv';
    let url = `https://streamdata.vaplayer.ru/api.php?tmdb=${id}&type=${isTv ? 'tv' : 'movie'}`;
    if (isTv) {
      url += `&season=${season}&episode=${episode}`;
    }

    try {
      const response = await streamimdbGet(url);
      if (!response.data || response.data.status_code !== "200" || !response.data.data) {
        throw new Error(`API returned status code ${response.data ? response.data.status_code : 'empty'}`);
      }

      const streamUrls = response.data.data.stream_urls;
      if (!streamUrls || !Array.isArray(streamUrls) || streamUrls.length === 0) {
        throw new Error('API returned no playable stream URLs');
      }

      const streamUrl = streamUrls[0];
      const imdbId = response.data.data.imdb_id;

      // Parse qualities from the master playlist if available
      let qualities = [];
      try {
        qualities = await parseQualitiesFromMaster(streamUrl, DEFAULT_HEADERS);
      } catch (err) {
        logger.warn(`[StreamIMDb] Master playlist parsing failed, falling back to basic stream: ${err.message}`);
      }

      // If quality parsing yielded nothing, fallback to auto quality with the master url
      if (qualities.length === 0) {
        qualities.push({
          quality: 'auto',
          url: streamUrl,
          headers: DEFAULT_HEADERS
        });
      }

      const embedUrl = `https://streamimdb.ru/embed/${isTv ? 'tv' : 'movie'}/${imdbId || id}`;

      return normalizeStream({
        provider: 'streamimdb',
        drm: false,
        streamUrl,
        embedUrl,
        embedFallbacks: [embedUrl],
        streamType: 'hls',
        subtitles: [],
        headers: DEFAULT_HEADERS,
        qualities,
        variants: [],
        expires: null
      }, 'streamimdb');

    } catch (err) {
      logger.error(`[StreamIMDb] Failed to resolve stream for ${type} ID ${id}: ${err.message}`);
      throw err;
    }
  }

  /**
   * Direct download streams for StreamIMDb
   */
  async download(id, type, season = 1, episode = 1, variantId = null) {
    logger.info(`[StreamIMDb] download() called for ID: ${id}, Type: ${type}, S${season}E${episode}`);
    
    const isTv = type === 'tv';
    let url = `https://streamdata.vaplayer.ru/api.php?tmdb=${id}&type=${isTv ? 'tv' : 'movie'}`;
    if (isTv) {
      url += `&season=${season}&episode=${episode}`;
    }

    try {
      const response = await streamimdbGet(url);
      if (!response.data || response.data.status_code !== "200" || !response.data.data) {
        throw new Error(`API returned status code ${response.data ? response.data.status_code : 'empty'}`);
      }

      const streamUrls = response.data.data.stream_urls;
      if (!streamUrls || !Array.isArray(streamUrls) || streamUrls.length === 0) {
        throw new Error('API returned no playable stream URLs');
      }

      const streamUrl = streamUrls[0];

      // Parse direct qualities from master playlist
      const qualities = await parseQualitiesFromMaster(streamUrl, DEFAULT_HEADERS);
      
      if (qualities.length === 0) {
        // Fallback to auto
        qualities.push({
          quality: 'auto',
          url: streamUrl,
          headers: DEFAULT_HEADERS
        });
      }

      return {
        provider: 'streamimdb',
        selectedProvider: 'streamimdb',
        available: true,
        qualities,
        headers: DEFAULT_HEADERS
      };

    } catch (err) {
      logger.error(`[StreamIMDb] download() resolution failed: ${err.message}`);
      throw err;
    }
  }

  /**
   * Health check - verify streamdata API is reachable
   */
  async health() {
    const startTime = Date.now();
    try {
      // Game of thrones S1E1 is a very fast lookup
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
