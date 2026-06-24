const PeachifyProvider = require('../../providers/peachify');
const tmdbService = require('../tmdb');
const cache = require('../../cache');
const logger = require('../../logger');
const config = require('../../config');

const languageMap = {
  'ta': 'Tamil',
  'te': 'Telugu',
  'ml': 'Malayalam',
  'kn': 'Kannada',
  'hi': 'Hindi',
  'en': 'English',
  'bn': 'Bengali',
  'mr': 'Marathi',
  'gu': 'Gujarati',
  'pa': 'Punjabi',
  'ur': 'Urdu',
  'or': 'Odia',
  'as': 'Assamese',
  'ko': 'Korean',
  'ja': 'Japanese',
  'zh': 'Chinese',
  'es': 'Spanish',
  'fr': 'French',
  'de': 'German',
  'it': 'Italian',
  'ru': 'Russian',
  'pt': 'Portuguese'
};

function getLanguageName(code) {
  if (!code) return 'English';
  const cleanCode = code.toLowerCase().trim();
  return languageMap[cleanCode] || cleanCode.charAt(0).toUpperCase() + cleanCode.slice(1);
}

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
   * Get sorted providers by priority config
   */
  getSortedProviders() {
    const priority = config.providerPriority || ['peachify'];
    return Array.from(this.providers.values()).sort((a, b) => {
      const idxA = priority.indexOf(a.name);
      const idxB = priority.indexOf(b.name);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.name.localeCompare(b.name);
    });
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

    const nativeLang = getLanguageName(tmdbData.language || 'en');
    const audioLangs = [nativeLang];

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
        downloadSupported: peachify.downloadSupported,
        languages: audioLangs,
        streamType: 'embed',
        embedUrl: embedUrl,
        embedFallbacks: embedFallbacks,
        variants: []
      }
    ];

    // Determine the watch provider from TMDB metadata if valid, otherwise default to 'peachify'
    const resolvedProvider = (tmdbData.provider && tmdbData.provider !== 'tmdb') ? tmdbData.provider : 'peachify';

    // 3. Build unified structured object and flat fields
    const result = {
      // Root level flat fields for frontend compatibility
      ...tmdbData,
      id: String(tmdbId),
      provider: resolvedProvider,
      sources,
      defaultProvider: resolvedProvider,
      supportedAudio: audioLangs,
      supportedSubtitles: [],
      supportedQualities: [],
      downloadAvailable: isPlayable && peachify.downloadSupported,

      // Structured API contract fields
      player: {
        provider: 'peachify',
        type: 'iframe', // Peachify is iframe embed
        available: isPlayable,
        embedUrl: embedUrl,
        embedFallbacks: embedFallbacks
      },
      download: {
        available: isPlayable && peachify.downloadSupported,
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
      logger.warn(`Provider "${providerName}" is not registered.`);
      return null;
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
    
    // Iterate through registered providers (currently only Peachify, but dynamically handles others)
    const sortedProviders = Array.from(this.providers.values());

    for (const provider of sortedProviders) {
      try {
        logger.info(`[DownloadP] Trying provider: ${provider.displayName}`);
        const downloadData = await provider.download(tmdbId, type, season, episode, variantId);
        if (downloadData && downloadData.available && downloadData.qualities && downloadData.qualities.length > 0) {
          logger.info(`[DownloadP] Successfully resolved download using provider: ${provider.displayName}`);
          return {
            ...downloadData,
            selectedProvider: provider.name,
            available: true
          };
        }
      } catch (err) {
        logger.warn(`[DownloadP] Provider ${provider.displayName} download resolution failed: ${err.message}`);
      }
    }

    return {
      available: false,
      reason: 'No provider supports direct download for this title'
    };
  }
}

module.exports = new ProviderManager();
