const PeachifyProvider = require('../../providers/peachify');
const StreamImdbProvider = require('../../providers/streamimdb');
const VidSrcProvider = require('../../providers/vidsrc');
const VidSrcSbsProvider = require('../../providers/vidsrcsbs');
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

    // Register StreamIMDb
    const streamimdb = new StreamImdbProvider();
    this.providers.set(streamimdb.name, streamimdb);



    // Register VidSrc
    const vidsrc = new VidSrcProvider();
    this.providers.set(vidsrc.name, vidsrc);

    // Register VidSrc SBS
    const vidsrcsbs = new VidSrcSbsProvider();
    this.providers.set(vidsrcsbs.name, vidsrcsbs);

    // Initialize diagnostics
    this.providerDiagnostics = new Map();
    for (const [name, provider] of this.providers.entries()) {
      this.providerDiagnostics.set(name, {
        online: true,
        movieAvailable: false,
        streamSupported: true,
        downloadSupported: provider.downloadSupported,
        latency: 0,
        lastSuccess: null,
        error: null
      });
    }

    // Run health check immediately and start the scheduler
    this.runHealthChecks();
    this.healthInterval = setInterval(() => this.runHealthChecks(), 300000);
    if (this.healthInterval && typeof this.healthInterval.unref === 'function') {
      this.healthInterval.unref();
    }
  }

  stopHealthMonitor() {
    if (this.healthInterval) {
      clearInterval(this.healthInterval);
    }
  }

  async runHealthChecks() {
    logger.info('[HealthMonitor] Running scheduled provider health checks...');
    for (const [name, provider] of this.providers.entries()) {
      const startTime = Date.now();
      try {
        const health = await provider.health();
        const latency = Date.now() - startTime;
        
        const isHealthy = health && health.status !== 'unhealthy';
        const diag = this.providerDiagnostics.get(name) || {};
        
        this.providerDiagnostics.set(name, {
          ...diag,
          online: isHealthy,
          latency: latency,
          error: isHealthy ? null : (health.message || 'Unhealthy status')
        });
      } catch (err) {
        const latency = Date.now() - startTime;
        const diag = this.providerDiagnostics.get(name) || {};
        
        this.providerDiagnostics.set(name, {
          ...diag,
          online: false,
          latency: latency,
          error: err.message
        });
      }
    }
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
    const priority = config.providerPriority || ['vidsrc-sbs', 'peachify', 'streamimdb', 'vidsrc'];
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

    // 2. Fetch stream details for all sorted providers to confirm availability
    const sortedProviders = this.getSortedProviders();
    const sources = [];
    let downloadAvailable = false;
    let firstPlayableProvider = null;
    let primaryEmbedUrl = null;
    let primaryEmbedFallbacks = [];

    for (let idx = 0; idx < sortedProviders.length; idx++) {
      const provider = sortedProviders[idx];
      let providerPlayable = false;
      let providerEmbedUrl = null;
      let providerEmbedFallbacks = [];
      let status = 'ONLINE';

      try {
        const streamData = await provider.stream(tmdbId, type, 1, 1);
        if (streamData && (streamData.streamUrl || streamData.embedUrl)) {
          providerPlayable = true;
          providerEmbedUrl = streamData.embedUrl;
          providerEmbedFallbacks = streamData.embedFallbacks || [];
          
          if (!firstPlayableProvider) {
            firstPlayableProvider = provider.name;
            primaryEmbedUrl = providerEmbedUrl;
            primaryEmbedFallbacks = providerEmbedFallbacks;
          }
        } else {
          status = 'UNAVAILABLE';
        }
      } catch (err) {
        logger.warn(`[DetailsP] ${provider.displayName} availability check failed: ${err.message}`);
        const errMsg = err.message || '';
        const is404 = errMsg.includes('404') || 
                      errMsg.toLowerCase().includes('not found') || 
                      errMsg.toLowerCase().includes('no playable stream') ||
                      errMsg.toLowerCase().includes('no streams');
        status = is404 ? 'UNAVAILABLE' : 'OFFLINE';
      }

      sources.push({
        provider: provider.name,
        label: provider.displayName,
        id: String(tmdbId),
        serverIndex: idx + 1,
        available: providerPlayable,
        status: status,
        downloadSupported: provider.downloadSupported,
        languages: audioLangs,
        streamType: provider.name === 'peachify' ? 'embed' : 'hls',
        embedUrl: providerEmbedUrl,
        embedFallbacks: providerEmbedFallbacks,
        variants: []
      });

      if (providerPlayable && provider.downloadSupported) {
        downloadAvailable = true;
      }
    }

    // Determine the watch provider from TMDB metadata if valid, otherwise default to the first playable provider
    const resolvedProvider = (tmdbData.provider && tmdbData.provider !== 'tmdb')
      ? tmdbData.provider
      : (firstPlayableProvider || 'peachify');

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
      downloadAvailable: downloadAvailable,

      // Structured API contract fields
      player: {
        provider: resolvedProvider,
        type: resolvedProvider === 'peachify' ? 'iframe' : 'hls',
        available: !!firstPlayableProvider,
        embedUrl: primaryEmbedUrl,
        embedFallbacks: primaryEmbedFallbacks
      },
      download: {
        available: downloadAvailable,
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
    const sortedProviders = this.getSortedProviders();
    const lastSuccessProviderCacheKey = `last_success_stream_provider:${tmdbId}`;
    const lastSuccessfulProvider = cache.get(lastSuccessProviderCacheKey);

    let providersToTry = [...sortedProviders];
    if (lastSuccessfulProvider) {
      const idx = providersToTry.findIndex(p => p.name === lastSuccessfulProvider);
      if (idx !== -1) {
        const [p] = providersToTry.splice(idx, 1);
        providersToTry.unshift(p);
        logger.info(`[Pipeline] Prioritized last successful provider: ${p.displayName} for TMDB ${tmdbId}`);
      }
    }

    const startMs = Date.now();
    let selectedProvider = null;
    let fallbackCount = 0;

    for (const provider of providersToTry) {
      // Check health status to skip if offline
      const diag = this.providerDiagnostics.get(provider.name);
      if (diag && !diag.online) {
        logger.info(`[Pipeline] Skipping offline provider: ${provider.displayName}`);
        continue;
      }

      let attempts = 0;
      let success = false;
      let streamData = null;
      const providerStart = Date.now();

      while (attempts < 2 && !success) {
        attempts++;
        try {
          logger.info(`[Pipeline] Trying provider: ${provider.displayName} (Attempt ${attempts})`);
          streamData = await provider.stream(tmdbId, type, season, episode, variantId, clientIp);
          if (streamData && (streamData.streamUrl || streamData.embedUrl)) {
            success = true;
          }
        } catch (err) {
          logger.error(`[Pipeline] ${provider.displayName} attempt ${attempts} failed: ${err.message}`);
          if (attempts >= 2) {
            const latency = Date.now() - providerStart;
            logger.info(`[Provider Log] Provider: ${provider.displayName} | Type: Streaming | Status: Failure | Reason: ${err.message} | Latency: ${latency}ms`);
            
            const diagState = this.providerDiagnostics.get(provider.name) || {};
            this.providerDiagnostics.set(provider.name, {
              ...diagState,
              latency,
              error: err.message
            });
          } else {
            // Delay 500ms before retry
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
      }

      if (success && streamData) {
        const latency = Date.now() - providerStart;
        logger.info(`[Provider Log] Provider: ${provider.displayName} | Type: Streaming | Status: Success | Latency: ${latency}ms`);
        
        const diagState = this.providerDiagnostics.get(provider.name) || {};
        this.providerDiagnostics.set(provider.name, {
          ...diagState,
          movieAvailable: true,
          latency,
          lastSuccess: new Date(),
          error: null
        });

        selectedProvider = provider.name;
        const resolvedResult = {
          ...streamData,
          selectedProvider: provider.name,
          available: true,
          fallbackTriggered: fallbackCount > 0
        };

        cache.set(pipelineCacheKey, resolvedResult, 900);
        cache.set(lastSuccessProviderCacheKey, provider.name, 900);

        const totalMs = Date.now() - startMs;
        logger.info(`[Pipeline Log] Selected Stream Provider: ${provider.displayName} | Fallback Count: ${fallbackCount} | Total Latency: ${totalMs}ms`);
        return resolvedResult;
      } else {
        fallbackCount++;
      }
    }

    return {
      available: false,
      reason: `All providers failed.`
    };
  }


}

module.exports = new ProviderManager();
