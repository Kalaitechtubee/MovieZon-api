const BaseProvider = require('../BaseProvider');
const httpClient = require('../../utils/httpClient');
const logger = require('../../logger');
const { normalizeCatalogItem } = require('../../provider-normalizer');

const PEACHIFY_BASE = 'https://peachify.top';
const NETMIRROR_BASE = 'https://net27.cc';

class PeachifyProvider extends BaseProvider {
  constructor() {
    super('peachify');
  }

  /**
   * Search - not directly supported by Peachify; always returns empty.
   * Search is handled by TMDB / NetMirror.
   */
  async search(_query) {
    return [];
  }

  /**
   * Details - delegates to NetMirror catalog or TMDB.
   * Peachify doesn't have its own catalog metadata.
   */
  async details(id, type) {
    const registry = require('../../provider-registry');
    const netmirror = registry.get('netmirror');
    let resolvedId = id;
    if (netmirror && typeof netmirror.resolveTmdbId === 'function') {
      resolvedId = netmirror.resolveTmdbId(id);
    }

    // Try to get basic info from net27.cc catalog endpoint
    const detailUrl = `${NETMIRROR_BASE}/api/catalog/title/${type}/${resolvedId}`;
    try {
      const data = await httpClient.get(detailUrl);
      if (data && data.ok) {
        data.tmdbId = data.tmdbId || resolvedId;
        return normalizeCatalogItem(data, 'peachify');
      }
    } catch (err) {
      logger.debug(`[Peachify] details() live request failed for ID ${resolvedId}: ${err.message}`);
    }

    // Minimal stub so the details page still renders
    return normalizeCatalogItem({
      tmdbId: resolvedId,
      id: String(resolvedId),
      title: '',
      type: type || 'movie'
    }, 'peachify');
  }

  /**
   * Stream - returns the Peachify embed URL as an iframe-type stream.
   * The frontend renders this in an <iframe> instead of a native video player.
   */
  async stream(id, type = 'movie', season = 1, episode = 1, _variantId = null, _clientIp = null) {
    logger.debug(`[Peachify] stream() called for ID: ${id}, Type: ${type}, S${season}E${episode}`);

    const registry = require('../../provider-registry');
    const netmirror = registry.get('netmirror');
    let resolvedId = id;
    if (netmirror && typeof netmirror.resolveTmdbId === 'function') {
      resolvedId = netmirror.resolveTmdbId(id);
    }

    const mediaType = type === 'tv' ? 'tv' : 'movie';
    let embedUrl;

    if (mediaType === 'tv') {
      embedUrl = `${PEACHIFY_BASE}/embed/tv/${resolvedId}/${season}/${episode}`;
    } else {
      embedUrl = `${PEACHIFY_BASE}/embed/movie/${resolvedId}`;
    }

    logger.info(`[Peachify] Returning embed URL: ${embedUrl}`);

    return {
      provider: 'peachify',
      drm: false,
      streamUrl: '',
      embedUrl,           // ← special field: frontend should render this in an <iframe>
      streamType: 'embed',
      subtitles: [],
      headers: {},
      qualities: [],
      variants: [],
      expires: null
    };
  }

  /**
   * Health check - verify Peachify is reachable
   */
  async health() {
    const startTime = Date.now();
    try {
      await httpClient.get(PEACHIFY_BASE, { timeout: 5000, retries: 0 });
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
