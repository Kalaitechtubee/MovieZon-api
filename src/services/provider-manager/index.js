const PeachifyProvider = require('../../providers/peachify');
const tmdbService = require('../tmdb');
const cache = require('../../cache');
const logger = require('../../logger');
const config = require('../../config');

class ProviderManager {
  constructor() {
    this.providers = new Map();
    // Register Peachify initially
    const peachify = new PeachifyProvider();
    this.providers.set(peachify.name, peachify);
  }

  /**
   * Get all registered providers
   */
  getProviders() {
    return Array.from(this.providers.values()).map(p => ({
      name: p.name,
      displayName: p.displayName,
      priority: 1
    }));
  }

  /**
   * Get provider by name
   */
  get(name) {
    if (!name) return null;
    return this.providers.get(name.toLowerCase()) || null;
  }

  /**
   * Get metadata details from a specific provider
   */
  async details(providerName, id, type) {
    return await this.resolveDetails(id, type);
  }

  /**
   * Single unified pipeline for metadata + stream availability.
   * Exposes consistent structure (tmdb, player, download nodes) as well as flat fields for legacy compatibility.
   */
  async resolveDetails(tmdbId, type) {
    const cacheKey = `details:resolved:${type}:${tmdbId}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      logger.info(`[DetailsP] Cache HIT for TMDB ${tmdbId} (${type})`);
      return cached;
    }

    logger.info(`[DetailsP] Resolving details for TMDB ${tmdbId} (${type})`);

    // 1. Fetch metadata from TMDB
    const tmdbData = await tmdbService.fetchDetails(tmdbId, type);
    if (!tmdbData) {
      throw new Error(`No TMDB metadata found for ${type} ID ${tmdbId}`);
    }

    // 2. Fetch stream details for Peachify to build embed links and confirm availability
    const peachify = this.providers.get('peachify');
    let isPlayable = false;
    let embedUrl = null;
    let embedFallbacks = [];

    try {
      const streamData = await peachify.stream(tmdbId, type, 1, 1);
      if (streamData && streamData.embedUrl) {
        isPlayable = true;
        embedUrl = streamData.embedUrl;
        embedFallbacks = streamData.embedFallbacks || [];
      }
    } catch (err) {
      logger.warn(`[DetailsP] Peachify availability check failed: ${err.message}`);
    }

    const sources = [
      {
        provider: 'peachify',
        id: String(tmdbId),
        serverIndex: 1,
        available: isPlayable,
        downloadSupported: false,
        languages: ['Original Audio'],
        streamType: 'embed',
        embedUrl: embedUrl,
        embedFallbacks: embedFallbacks,
        variants: []
      }
    ];

    // 3. Build unified structured object and flat fields
    const result = {
      // Root level flat fields for frontend compatibility
      ...tmdbData,
      id: String(tmdbId),
      provider: 'peachify',
      sources,
      defaultProvider: 'peachify',
      supportedAudio: ['Original Audio'],
      supportedSubtitles: [],
      supportedQualities: [],
      downloadAvailable: false,

      // Structured API contract fields
      tmdb: tmdbData,
      player: {
        provider: 'peachify',
        type: 'iframe', // Peachify is iframe embed
        available: isPlayable,
        embedUrl: embedUrl,
        embedFallbacks: embedFallbacks
      },
      download: {
        available: false,
        qualities: []
      }
    };

    // Cache for 30 minutes
    cache.set(cacheKey, result, 1800);
    return result;
  }

  /**
   * Fetch stream URL from a SPECIFIC provider (explicit user choice).
   */
  async stream(providerName, id, type, season = 1, episode = 1, variantId = null, clientIp = null) {
    const provider = this.get(providerName);
    if (!provider) {
      throw new Error(`Provider "${providerName}" is not registered.`);
    }

    logger.info(`[Stream:explicit] Fetching stream for TMDB ${id} from provider: ${provider.displayName}`);
    return await provider.stream(id, type, season, episode, variantId, clientIp);
  }

  /**
   * Deterministic provider stream resolution.
   */
  async resolveStream(tmdbId, type, season = 1, episode = 1, clientIp = null, variantId = null) {
    const pipelineCacheKey = `pipeline:${type}:${tmdbId}:${season}:${episode}:${variantId || 'default'}`;
    const cachedResult = cache.get(pipelineCacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    logger.info(`[Pipeline] Sequential stream resolution for TMDB ${tmdbId}`);
    const peachify = this.providers.get('peachify');
    if (!peachify) {
      return { available: false, reason: 'Peachify provider not registered' };
    }

    try {
      const streamData = await peachify.stream(tmdbId, type, season, episode, variantId, clientIp);
      const resolvedResult = {
        ...streamData,
        selectedProvider: 'peachify',
        available: true,
        fallbackTriggered: false
      };

      cache.set(pipelineCacheKey, resolvedResult, 1800);
      return resolvedResult;
    } catch (err) {
      logger.error(`[Pipeline] Peachify stream resolution failed: ${err.message}`);
      return {
        available: false,
        reason: err.message
      };
    }
  }

  /**
   * Download stream pipeline.
   * Return available: false because Peachify doesn't support downloads.
   */
  async resolveDownload(tmdbId, type, season = 1, episode = 1, variantId = null) {
    logger.info(`[DownloadP] Sequential download resolution for TMDB ${tmdbId}`);
    return {
      available: false,
      reason: 'No provider supports direct download for this title'
    };
  }
}

module.exports = new ProviderManager();
