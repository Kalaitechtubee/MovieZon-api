const registry = require('../provider-registry');
const cache = require('../cache');
const config = require('../config');
const logger = require('../logger');

// ─── Pipeline logging helper ───────────────────────────────────────────────────
// Emits one structured log line per resolveStream() request, containing the
// full audit trail: which providers were checked, why each failed/succeeded, etc.
function logPipelineResult(tmdbId, type, entries, selectedProvider, totalMs) {
  const fallbackTriggered = entries.filter(e => e.checked).length > 1;
  logger.info(JSON.stringify({
    event: 'PIPELINE_RESULT',
    tmdbId: String(tmdbId),
    type,
    selectedProvider: selectedProvider || null,
    fallbackTriggered,
    totalResponseTimeMs: totalMs,
    pipeline: entries
  }));
}

class ProviderManager {
  constructor() {
    // Initialize Registry and discover providers
    registry.initialize();
  }

  /**
   * Get list of providers and their details (sorted by priority)
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
   * Get all registered providers sorted in strict priority order.
   * Priority is read from config.providerPriority — the order is deterministic.
   */
  getSortedProviders() {
    const all = registry.getAll();
    const priority = config.providerPriority;

    return all.sort((a, b) => {
      const idxA = priority.indexOf(a.name);
      const idxB = priority.indexOf(b.name);

      // Providers in the priority list always come before unlisted ones
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.name.localeCompare(b.name);
    });
  }

  // ─── Search ─────────────────────────────────────────────────────────────────

  /**
   * Search query across all enabled providers, merge and deduplicate results.
   * Search is fan-out / parallel because it is NOT subject to provider priority —
   * we want all results regardless of which provider has the title.
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

    const searchPromises = providers.map(async (provider) => {
      try {
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

    // Merge & Deduplicate by TMDB ID
    const mergedMap = new Map();
    for (const response of searchResponses) {
      for (const item of response.results) {
        if (!item || !item.tmdbId) continue;
        const key = `${item.type}_${item.tmdbId}`;
        if (mergedMap.has(key)) {
          const existing = mergedMap.get(key);
          if (!existing.poster && item.poster) existing.poster = item.poster;
          if (!existing.overview && item.overview) existing.overview = item.overview;
          if (Array.isArray(existing.providers)) {
            if (!existing.providers.includes(item.provider)) existing.providers.push(item.provider);
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
    mergedResults.sort((a, b) => {
      if (a.year !== b.year) return (b.year || 0) - (a.year || 0);
      return (b.rating || 0) - (a.rating || 0);
    });

    cache.set(cacheKey, mergedResults, 600);
    return mergedResults;
  }

  // ─── Details ────────────────────────────────────────────────────────────────

  /**
   * Fetch details for a tmdbId from a specific provider, with automatic
   * failover to other providers if the primary fails.
   * @param {string} providerName - Requested provider (may be 'tmdb' for fallback)
   * @param {string|number} id - TMDB ID
   * @param {'movie'|'tv'} type
   */
  async details(providerName, id, type) {
    const cacheKey = `details:${providerName}:${type}:${id}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

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

    // Failover: iterate through other providers in priority order
    const allProviders = this.getSortedProviders();
    for (const provider of allProviders) {
      if (provider.name === providerName.toLowerCase()) continue;
      try {
        logger.info(`Failover: Trying provider ${provider.displayName} for details of TMDB ${id}`);
        const data = await provider.details(id, type);
        if (data) {
          logger.info(`Failover SUCCESSFUL: Retrieved details from ${provider.displayName}`);
          cache.set(cacheKey, data);
          return data;
        }
      } catch (err) {
        logger.debug(`Failover provider ${provider.displayName} details query failed: ${err.message}`);
      }
    }

    throw new Error(`Failed to retrieve details for ${type} ID ${id} from all providers.`);
  }

  // ─── resolveDetails (SEQUENTIAL DETAILS PIPELINE) ──────────────────────────

  /**
   * Unified sequential pipeline for metadata + stream availability.
   * Mirrors resolveStream() exactly — same provider order, same rules.
   *
   * Phase 1 (Metadata): Iterate providers sequentially. Stop at first
   *   provider that returns valid details. This is the metadata source.
   *
   * Phase 2 (Stream Availability): After getting metadata, check stream
   *   availability for ALL providers in parallel (for the server status
   *   indicators on the detail page). Uses cached stream results if present
   *   so this does NOT duplicate resolveStream() work.
   *
   * Sources: ALL registered providers are always listed in priority order.
   *   Each has `available: true|false`. The frontend never filters or sorts.
   *
   * defaultProvider: first provider that has a working stream (priority order).
   *   This is identical to the provider resolveStream() would select.
   *
   * @param {string|number} tmdbId
   * @param {'movie'|'tv'} type
   * @returns {Promise<Object>} Details with sources[] and defaultProvider
   */
  async resolveDetails(tmdbId, type) {
    const cacheKey = `details:resolved:${type}:${tmdbId}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      logger.info(`[DetailsP] Cache HIT for TMDB ${tmdbId} (${type}) — defaultProvider: ${cached.defaultProvider}`);
      return cached;
    }

    const providers = this.getSortedProviders();
    if (providers.length === 0) {
      throw new Error('No providers registered');
    }

    // ── Phase 1: Metadata — sequential, stop at first success ───────────────
    let metadata = null;
    let metadataProvider = null;

    for (const provider of providers) {
      try {
        logger.info(`[DetailsP] → Fetching metadata from: ${provider.displayName} for TMDB ${tmdbId}`);
        const data = await provider.details(tmdbId, type);
        if (data) {
          metadata = data;
          metadataProvider = provider.name;
          logger.info(`[DetailsP] ✓ Metadata resolved via ${provider.displayName}`);
          break;
        }
      } catch (err) {
        logger.warn(`[DetailsP] ${provider.displayName} metadata failed: ${err.message}. Trying next provider...`);
      }
    }

    if (!metadata) {
      throw new Error(`No provider could fetch details for ${type} ID ${tmdbId}`);
    }

    // ── Phase 2: Stream Availability — parallel, ALL providers ──────────────
    // Check each provider's stream status to populate the sources list.
    // Uses cached stream results first (from a prior resolveStream() call).
    // This avoids duplicate work if the user visited the player already.
    const streamChecks = providers.map(async (provider, idx) => {
      const streamCacheKey = `stream:${provider.name}:${type}:${tmdbId}:1:1:default:default`;
      const cachedStream = cache.get(streamCacheKey);
      if (cachedStream) {
        const isPlayable = cachedStream.streamUrl ||
          (cachedStream.qualities && cachedStream.qualities.length > 0) ||
          (cachedStream.streamType === 'embed' && cachedStream.embedUrl);
        logger.debug(`[DetailsP] ${provider.displayName} stream availability: CACHED (${isPlayable ? 'available' : 'unavailable'})`);
        return {
          provider: provider.name,
          id: String(tmdbId),
          serverIndex: idx + 1,
          available: !!isPlayable,
          streamType: cachedStream.streamType || null,
          embedUrl: cachedStream.embedUrl || null,
          variants: cachedStream.variants || [],
          languages: cachedStream.variants?.map(v => v.language) || ['Original Audio'],
        };
      }

      // No cache — do a live check (with timeout so it doesn't stall)
      try {
        const streamData = await Promise.race([
          provider.stream(tmdbId, type, 1, 1, null, null),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Availability check timeout')), 7000))
        ]);
        const isPlayable = streamData && (
          streamData.streamUrl ||
          (streamData.qualities && streamData.qualities.length > 0) ||
          (streamData.streamType === 'embed' && streamData.embedUrl)
        );
        // Cache the successful stream check result
        if (isPlayable) {
          let ttl = 1800;
          if (streamData.expires) {
            const nowSec = Math.floor(Date.now() / 1000);
            ttl = Math.max(0, streamData.expires - nowSec - 60);
          }
          if (ttl > 0) cache.set(streamCacheKey, streamData, ttl);
        }
        logger.debug(`[DetailsP] ${provider.displayName} stream availability: ${isPlayable ? 'AVAILABLE' : 'UNAVAILABLE'}`);
        return {
          provider: provider.name,
          id: String(tmdbId),
          serverIndex: idx + 1,
          available: !!isPlayable,
          streamType: streamData?.streamType || null,
          embedUrl: streamData?.embedUrl || null,
          variants: streamData?.variants || [],
          languages: streamData?.variants?.map(v => v.language) || ['Original Audio'],
        };
      } catch (err) {
        logger.debug(`[DetailsP] ${provider.displayName} stream availability: OFFLINE — ${err.message}`);
        return {
          provider: provider.name,
          id: String(tmdbId),
          serverIndex: idx + 1,
          available: false,
          streamType: null,
          embedUrl: null,
          variants: [],
          languages: ['Original Audio'],
        };
      }
    });

    const sourceChecks = await Promise.all(streamChecks);

    // Build the final sources array — ALL providers in priority order.
    // If a provider has language variants, expand to one entry per variant.
    // Frontend renders this exactly as received — never sorts or filters.
    const sources = [];
    for (const check of sourceChecks) {
      if (check.available && check.variants && check.variants.length > 0) {
        for (const variant of check.variants) {
          sources.push({
            provider: check.provider,
            id: variant.id,
            serverIndex: check.serverIndex,
            available: true,
            languages: [variant.language],
            streamType: check.streamType || null,
          });
        }
      } else {
        sources.push({
          provider: check.provider,
          id: String(tmdbId),
          serverIndex: check.serverIndex,
          available: check.available,
          languages: check.languages,
          streamType: check.streamType || null,
          embedUrl: check.embedUrl || null,
        });
      }
    }

    // defaultProvider = first provider with a working stream (priority order).
    // This is IDENTICAL to what resolveStream() would select.
    // Both pipelines consult the same config.providerPriority — they cannot disagree.
    const defaultProviderEntry = sourceChecks.find(s => s.available);
    const defaultProvider = defaultProviderEntry?.provider || metadataProvider;

    logger.info(`[DetailsP] Sources for TMDB ${tmdbId}: ${sources.map(s => `${s.provider}(${s.available ? '✓' : '✗'})`).join(' → ')} | defaultProvider: ${defaultProvider}`);

    const result = {
      ...metadata,
      sources,
      defaultProvider,
    };

    // Cache for 30 minutes (availability may change)
    cache.set(cacheKey, result, 1800);
    return result;
  }


  /**
   * Fetch stream URL from a SPECIFIC provider (explicit user or system choice).
   * This method respects the caller's provider choice and does NOT run the
   * full sequential pipeline. It is used for:
   *   - User-initiated "switch to Server 2" actions
   *   - Quality refresh on the player page
   *
   * For backend-resolved auto-play, use resolveStream() instead.
   *
   * @param {string} providerName - Exact provider to use
   * @param {string|number} id - TMDB ID or composite ID
   * @param {'movie'|'tv'} type
   * @param {number} season
   * @param {number} episode
   * @param {string|null} variantId
   * @param {string|null} clientIp
   */
  async stream(providerName, id, type, season = 1, episode = 1, variantId = null, clientIp = null) {
    const cacheKey = `stream:${providerName}:${type}:${id}:${season}:${episode}:${variantId || 'default'}:${clientIp || 'default'}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      if (cached.expires) {
        const nowSec = Math.floor(Date.now() / 1000);
        if (cached.expires - nowSec < 60) {
          logger.info(`Cached stream for provider ${providerName} ID ${id} is expired or near expiry. Evicting.`);
          cache.del(cacheKey);
        } else {
          return cached;
        }
      } else {
        return cached;
      }
    }

    const targetProvider = registry.get(providerName);
    if (!targetProvider) {
      throw new Error(`Provider "${providerName}" is not registered.`);
    }

    logger.info(`[Stream:explicit] Fetching stream for TMDB ${id} (${type}) from provider: ${targetProvider.displayName}`);
    const data = await targetProvider.stream(id, type, season, episode, variantId, clientIp);

    if (data && (data.streamUrl || data.qualities?.length > 0 || data.embedUrl)) {
      let ttl = 1800;
      if (data.expires) {
        const nowSec = Math.floor(Date.now() / 1000);
        ttl = Math.max(0, data.expires - nowSec - 60);
      }
      if (ttl > 0) cache.set(cacheKey, data, ttl);
      return data;
    }

    throw new Error(`Provider ${targetProvider.displayName} returned no valid stream for ${type} ID ${id}.`);
  }

  // ─── resolveStream (DETERMINISTIC SEQUENTIAL PIPELINE) ──────────────────────

  /**
   * The canonical entry point for backend-controlled stream resolution.
   *
   * Implements the deterministic Provider Resolution Pipeline:
   *   Provider 1 (NetMirror) → Provider 2 (Peachify) → ... → Not Available
   *
   * Rules:
   *  - Never skips Provider 1.
   *  - Never jumps directly to Provider 2.
   *  - Provider order is always defined by config.providerPriority.
   *  - Unhealthy providers are skipped with a log entry.
   *  - Returns on the FIRST successful stream — stops the pipeline immediately.
   *  - If ALL providers fail, returns { available: false, reason: '...' }.
   *
   * @param {string|number} tmdbId
   * @param {'movie'|'tv'} type
   * @param {number} season
   * @param {number} episode
   * @param {string|null} clientIp
   * @returns {Promise<Object>} - Normalized stream data or { available: false }
   */
  async resolveStream(tmdbId, type, season = 1, episode = 1, clientIp = null) {
    // ── Pipeline-level result cache ────────────────────────────────────────────
    // Cache the final resolved result so repeated calls (frontend retries, HMR
    // reloads, React StrictMode double-invocations) don't re-run the pipeline.
    // Cache key is keyed by content identity only — clientIp is excluded because
    // all stream URLs are already proxied through this server.
    const pipelineCacheKey = `pipeline:${type}:${tmdbId}:${season}:${episode}`;
    const cachedResult = cache.get(pipelineCacheKey);
    if (cachedResult) {
      logger.info(`[Pipeline] Cache HIT for TMDB ${tmdbId} (${type} S${season}E${episode}) — returning cached result via: ${cachedResult.selectedProvider}`);
      return cachedResult;
    }

    const pipelineStart = Date.now();
    const providers = this.getSortedProviders();
    const pipelineLog = [];

    logger.info(`[Pipeline] Starting sequential stream resolution for TMDB ${tmdbId} (${type} S${season}E${episode}) — ${providers.length} provider(s) in queue`);

    if (providers.length === 0) {
      logger.warn('[Pipeline] No registered providers found.');
      return { available: false, reason: 'No providers registered', providers: [] };
    }

    for (const provider of providers) {
      const providerStart = Date.now();
      const entry = { provider: provider.name, checked: true, result: null, reason: null, responseTimeMs: 0 };

      logger.info(`[Pipeline] → Checking provider: ${provider.displayName} for TMDB ${tmdbId}`);

      try {
        const streamData = await provider.stream(tmdbId, type, season, episode, null, clientIp);
        entry.responseTimeMs = Date.now() - providerStart;

        const isPlayable = streamData && (
          streamData.streamUrl ||
          (streamData.qualities && streamData.qualities.length > 0) ||
          (streamData.streamType === 'embed' && streamData.embedUrl)
        );

        if (isPlayable) {
          entry.result = 'success';
          pipelineLog.push(entry);

          // Pre-cache the individual provider stream result
          const streamCacheKey = `stream:${provider.name}:${type}:${tmdbId}:${season}:${episode}:default:${clientIp || 'default'}`;
          let ttl = 1800;
          if (streamData.expires) {
            const nowSec = Math.floor(Date.now() / 1000);
            ttl = Math.max(0, streamData.expires - nowSec - 60);
          }
          if (ttl > 0) cache.set(streamCacheKey, streamData, ttl);

          const totalMs = Date.now() - pipelineStart;
          logPipelineResult(tmdbId, type, pipelineLog, provider.name, totalMs);

          logger.info(`[Pipeline] ✓ RESOLVED via ${provider.displayName} in ${totalMs}ms`);

          const resolvedResult = {
            ...streamData,
            selectedProvider: provider.name,
            available: true,
            fallbackTriggered: pipelineLog.filter(e => e.checked).length > 1,
          };

          // Cache the final pipeline result so subsequent calls return immediately
          if (ttl > 0) cache.set(pipelineCacheKey, resolvedResult, ttl);

          return resolvedResult;
        } else {
          entry.result = 'fail';
          entry.reason = 'Provider returned no playable stream';
          logger.warn(`[Pipeline] ✗ ${provider.displayName} returned no playable stream. Continuing to next provider...`);
        }
      } catch (err) {
        entry.responseTimeMs = Date.now() - providerStart;
        entry.result = 'fail';
        entry.reason = err.message;
        logger.warn(`[Pipeline] ✗ ${provider.displayName} threw an error: ${err.message}. Continuing to next provider...`);
      }

      pipelineLog.push(entry);
    }

    // All providers exhausted
    const totalMs = Date.now() - pipelineStart;
    logPipelineResult(tmdbId, type, pipelineLog, null, totalMs);
    logger.warn(`[Pipeline] All providers exhausted for TMDB ${tmdbId} (${type}). No stream available.`);

    return {
      available: false,
      reason: 'No provider available',
      providers: pipelineLog,
    };
  }

  // ─── checkAvailability (SEQUENTIAL — for details page server status) ─────────

  /**
   * Check availability of a media ID across providers IN PRIORITY ORDER.
   * Unlike the old parallel implementation, this runs sequentially so the
   * `bestProvider` is always the highest-priority working provider, never a
   * race-condition winner.
   *
   * Results for ALL providers are still returned (for the frontend server status
   * indicators), but the ordering is always preserved.
   *
   * @param {string|number} id
   * @param {'movie'|'tv'} type
   * @param {number} season
   * @param {number} episode
   * @param {string|null} clientIp
   */
  async checkAvailability(id, type, season = 1, episode = 1, clientIp = null) {
    const providers = this.getSortedProviders();
    if (providers.length === 0) {
      return { available: false, providers: [], bestProvider: null };
    }

    const results = [];
    let bestProvider = null;

    // Check providers sequentially in priority order
    for (const provider of providers) {
      try {
        logger.debug(`[AvailabilityCheck] Checking provider ${provider.displayName} for TMDB ID: ${id}`);

        const streamData = await Promise.race([
          provider.stream(id, type, season, episode, null, clientIp),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 6000))
        ]);

        const isPlayable = streamData && (
          streamData.streamUrl ||
          (streamData.qualities && streamData.qualities.length > 0) ||
          (streamData.streamType === 'embed' && streamData.embedUrl)
        );

        if (isPlayable) {
          // Pre-cache the successful response
          const cacheKey = `stream:${provider.name}:${type}:${id}:${season}:${episode}:default:${clientIp || 'default'}`;
          let ttl = 1800;
          if (streamData.expires) {
            const nowSec = Math.floor(Date.now() / 1000);
            ttl = Math.max(0, streamData.expires - nowSec - 60);
          }
          if (ttl > 0) cache.set(cacheKey, streamData, ttl);

          // First available provider in priority order becomes bestProvider
          if (!bestProvider) bestProvider = provider.name;

          results.push({
            name: provider.name,
            status: 'available',
            qualities: streamData.qualities?.map(q => q.quality) || [],
            variants: streamData.variants || [],
            streamType: streamData.streamType || null,
            embedUrl: streamData.embedUrl || null
          });
        } else {
          results.push({ name: provider.name, status: 'unavailable' });
        }
      } catch (err) {
        logger.debug(`[AvailabilityCheck] Provider ${provider.displayName} is unavailable/offline: ${err.message}`);
        results.push({ name: provider.name, status: 'offline' });
      }
    }

    return {
      available: !!bestProvider,
      providers: results,
      bestProvider
    };
  }
}

// Export as a singleton
module.exports = new ProviderManager();
