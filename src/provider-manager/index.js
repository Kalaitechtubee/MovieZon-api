const registry = require('../provider-registry');
const cache = require('../cache');
const config = require('../config');
const logger = require('../logger');

class ProviderManager {
  constructor() {
    // Initialize Registry and discover providers
    registry.initialize();
  }

  /**
   * Get list of providers and their details
   */
  getProviders() {
    return registry.getAll().map(p => ({
      name: p.name,
      displayName: p.displayName,
      priority: config.providerPriority.indexOf(p.name) !== -1 
        ? config.providerPriority.indexOf(p.name) 
        : config.providerPriority.length + 1
    })).sort((a, b) => a.priority - b.priority);
  }

  /**
   * Get sorted active providers based on priority config
   */
  getSortedProviders() {
    const all = registry.getAll();
    const priority = config.providerPriority;
    
    return all.sort((a, b) => {
      const idxA = priority.indexOf(a.name);
      const idxB = priority.indexOf(b.name);
      
      // If both are in priority list, sort by index
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      // Put priority ones first
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      // Default alphabetically for the rest
      return a.name.localeCompare(b.name);
    });
  }

  /**
   * Search query across all enabled providers, merge and deduplicate results
   */
  async search(query) {
    const cacheKey = `search:${query.toLowerCase().trim()}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const providers = this.getSortedProviders();
    if (providers.length === 0) {
      logger.warn('No registered providers found for search');
      return [];
    }

    logger.info(`Searching for "${query}" across ${providers.length} provider(s)`);

    // Run searches in parallel with a timeout wrapper
    const searchPromises = providers.map(async (provider) => {
      try {
        // Enforce a timeout per provider (e.g. 5 seconds) so one slow provider doesn't block the whole request
        const results = await Promise.race([
          provider.search(query),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
        ]);
        return { provider: provider.name, results: results || [] };
      } catch (err) {
        logger.error(`Search failed for provider ${provider.displayName}: ${err.message}`);
        return { provider: provider.name, results: [] };
      }
    });

    const searchResponses = await Promise.all(searchPromises);
    
    // Merge & Deduplicate
    const mergedMap = new Map();
    
    for (const response of searchResponses) {
      for (const item of response.results) {
        if (!item || !item.tmdbId) continue;
        
        const key = `${item.type}_${item.tmdbId}`;
        
        if (mergedMap.has(key)) {
          // Merge provider tags or keep the richer metadata
          const existing = mergedMap.get(key);
          // Keep poster/backdrop if existing is missing them
          if (!existing.poster && item.poster) existing.poster = item.poster;
          if (!existing.overview && item.overview) existing.overview = item.overview;
          // Add provider source tracking
          if (Array.isArray(existing.providers)) {
            if (!existing.providers.includes(item.provider)) {
              existing.providers.push(item.provider);
            }
          } else {
            existing.providers = [existing.provider, item.provider];
          }
        } else {
          item.providers = [item.provider];
          mergedMap.set(key, item);
        }
      }
    }

    const mergedResults = Array.from(mergedMap.values());
    
    // Simple sort by rating or year (newest first, falling back to rating)
    mergedResults.sort((a, b) => {
      if (a.year !== b.year) {
        return (b.year || 0) - (a.year || 0);
      }
      return (b.rating || 0) - (a.rating || 0);
    });

    // Cache merged search results for 10 minutes
    cache.set(cacheKey, mergedResults, 600);
    return mergedResults;
  }

  /**
   * Fetch details for a tmdbId, with failover support
   */
  async details(providerName, id, type) {
    const cacheKey = `details:${providerName}:${type}:${id}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    // First attempt requested provider
    const targetProvider = registry.get(providerName);
    if (targetProvider) {
      try {
        logger.info(`Fetching details for TMDB ${id} (${type}) from primary provider: ${targetProvider.displayName}`);
        const data = await targetProvider.details(id, type);
        if (data) {
          cache.set(cacheKey, data);
          return data;
        }
      } catch (err) {
        logger.warn(`Primary provider details fetch failed for ${providerName}: ${err.message}. Triggering failover...`);
      }
    }

    // Failover: iterate through other providers
    const allProviders = this.getSortedProviders();
    for (const provider of allProviders) {
      if (provider.name === providerName.toLowerCase()) continue; // Skip failed primary
      
      try {
        logger.info(`Failover: Trying provider ${provider.displayName} for details of TMDB ${id}`);
        const data = await provider.details(id, type);
        if (data) {
          logger.info(`Failover SUCCESSFUL: Retrieved details from ${provider.displayName}`);
          // Cache under the original provider requested too (so subsequent requests hit cache)
          cache.set(cacheKey, data);
          return data;
        }
      } catch (err) {
        logger.debug(`Failover provider ${provider.displayName} details query failed: ${err.message}`);
      }
    }

    throw new Error(`Failed to retrieve details for ${type} ID ${id} from all providers.`);
  }

  /**
   * Fetch stream url for a tmdbId, with failover support
   */
  async stream(providerName, id, type, season = 1, episode = 1, variantId = null, clientIp = null) {
    const cacheKey = `stream:${providerName}:${type}:${id}:${season}:${episode}:${variantId || 'default'}:${clientIp || 'default'}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    // First attempt requested provider
    const targetProvider = registry.get(providerName);
    if (targetProvider) {
      try {
        logger.info(`Fetching stream for TMDB ${id} (${type}) from primary provider: ${targetProvider.displayName}`);
        const data = await targetProvider.stream(id, type, season, episode, variantId, clientIp);
        if (data && (data.streamUrl || data.qualities?.length > 0)) {
          cache.set(cacheKey, data, 1800); // cache streams for 30 minutes
          return data;
        }
      } catch (err) {
        logger.warn(`Primary provider stream fetch failed for ${providerName}: ${err.message}. Triggering failover...`);
      }
    }

    // Failover: iterate through other providers
    const allProviders = this.getSortedProviders();
    for (const provider of allProviders) {
      if (provider.name === providerName.toLowerCase()) continue; // Skip failed primary
      
      try {
        logger.info(`Failover: Trying provider ${provider.displayName} for stream of TMDB ${id}`);
        const data = await provider.stream(id, type, season, episode, variantId, clientIp);
        if (data && (data.streamUrl || data.qualities?.length > 0)) {
          logger.info(`Failover SUCCESSFUL: Retrieved stream from ${provider.displayName}`);
          cache.set(cacheKey, data, 1800);
          return data;
        }
      } catch (err) {
        logger.debug(`Failover provider ${provider.displayName} stream query failed: ${err.message}`);
      }
    }

    throw new Error(`Failed to retrieve streams for ${type} ID ${id} from all providers.`);
  }

  /**
   * Check availability of a media ID across all active providers in parallel.
   * If a stream resolves successfully, it will be pre-cached, yielding instant playback later.
   */
  async checkAvailability(id, type, season = 1, episode = 1, clientIp = null) {
    const providers = this.getSortedProviders();
    if (providers.length === 0) {
      return {
        available: false,
        providers: [],
        bestProvider: null
      };
    }

    // Call stream resolution in parallel with a timeout for each provider
    const checkPromises = providers.map(async (provider) => {
      try {
        logger.debug(`[AvailabilityCheck] Checking provider ${provider.displayName} for TMDB ID: ${id}`);
        // We use stream() directly, which triggers full stream resolution
        const streamData = await Promise.race([
          provider.stream(id, type, season, episode, null, clientIp),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 4000))
        ]);

        if (streamData && (streamData.streamUrl || streamData.qualities?.length > 0)) {
          // Pre-cache the successful response in ProviderManager's cache format
          const cacheKey = `stream:${provider.name}:${type}:${id}:${season}:${episode}:default:${clientIp || 'default'}`;
          cache.set(cacheKey, streamData, 1800); // 30 minutes caching

          return {
            name: provider.name,
            status: 'available',
            qualities: streamData.qualities?.map(q => q.quality) || []
          };
        }
        
        return {
          name: provider.name,
          status: 'unavailable'
        };
      } catch (err) {
        logger.debug(`[AvailabilityCheck] Provider ${provider.displayName} is unavailable/offline: ${err.message}`);
        return {
          name: provider.name,
          status: 'offline'
        };
      }
    });

    const results = await Promise.all(checkPromises);
    
    // Select the best provider from available ones based on list ordering (since getSortedProviders is prioritized)
    const availableProviders = results.filter(r => r.status === 'available');
    const isAvailable = availableProviders.length > 0;
    const bestProvider = isAvailable ? availableProviders[0].name : null;

    return {
      available: isAvailable,
      providers: results,
      bestProvider
    };
  }
}

// Export as a singleton
module.exports = new ProviderManager();
