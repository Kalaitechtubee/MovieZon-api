const tmdbService = require('../services/tmdb');
const providerManager = require('../services/provider-manager');
const playerService = require('../services/player');
const logger = require('../logger');
const cache = require('../cache');

const apiController = {
  /**
   * GET /api/search?q=query
   */
  async search(req, res, next) {
    try {
      const { q } = req.query;
      if (!q || !q.trim()) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Search query parameter "q" is required.'
        });
      }

      logger.info(`Search request received for query: "${q}"`);

      // 1. Try TMDB search first
      let items = await tmdbService.search(q.trim());

      // 2. Fallback to local index search (which delegates to provider manager search)
      if (items.length === 0) {
        logger.info(`TMDB search returned 0 items. Querying local providers...`);
        items = await providerManager.search(q);
      }

      res.json({
        ok: true,
        success: true,
        count: items.length,
        items,
        results: items
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/details/:provider/:id?type=movie|tv
   */
  async details(req, res, next) {
    try {
      const { provider, id } = req.params;
      const { type } = req.query;
      const parsedType = type || 'movie';

      if (!parsedType || !['movie', 'tv'].includes(parsedType.toLowerCase())) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Query parameter "type" must be "movie" or "tv".'
        });
      }

      let details = null;
      try {
        details = await providerManager.details(provider, id, parsedType.toLowerCase());
      } catch (err) {
        logger.warn(`Failed to resolve details for provider ${provider} ID ${id}: ${err.message}`);
      }

      if (details) {
        res.json({
          ok: true,
          success: true,
          results: details
        });
      } else {
        res.status(404).json({
          success: false,
          error: 'Not Found',
          message: `Details for provider ${provider} ID ${id} not found.`
        });
      }
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/v2/details/tmdb/:id?type=movie|tv
   */
  async unifiedDetails(req, res, next) {
    try {
      const { id } = req.params;
      const { type } = req.query;

      if (!type || !['movie', 'tv'].includes(type.toLowerCase())) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Query parameter "type" must be "movie" or "tv".'
        });
      }

      const parsedType = type.toLowerCase();
      logger.info(`[UnifiedDetails] TMDB ${id} (${parsedType}) — resolveDetails() pipeline`);

      let finalDetails = null;
      try {
        finalDetails = await providerManager.resolveDetails(id, parsedType);
      } catch (err) {
        logger.warn(`Failed to resolve unified details for TMDB ID ${id}: ${err.message}`);
      }

      if (!finalDetails) {
        return res.status(404).json({
          success: false,
          error: 'Not Found',
          message: `Details for ${parsedType} ID ${id} not found.`
        });
      }

      res.json({
        ok: true,
        success: true,
        results: finalDetails
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/stream/:provider/:id?type=movie|tv&season=1&episode=1&variant=variantId
   */
  async stream(req, res, next) {
    try {
      const { provider, id } = req.params;
      const { type, season, episode, variant } = req.query;

      let parsedId = id;
      let parsedType = type || 'movie';
      let parsedSeason = season;
      let parsedEpisode = episode;

      // Handle TV show composite IDs (e.g. 71912-1-2)
      const tvMatch = String(id).match(/^(\d+)[-:](\d+)[-:](\d+)$/);
      if (tvMatch) {
        parsedId = tvMatch[1];
        parsedType = 'tv';
        parsedSeason = tvMatch[2];
        parsedEpisode = tvMatch[3];
      }

      if (!parsedType || !['movie', 'tv'].includes(parsedType.toLowerCase())) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Query parameter "type" must be "movie" or "tv".'
        });
      }

      const isTv = parsedType.toLowerCase() === 'tv';
      const seasonNum = parsedSeason ? parseInt(parsedSeason, 10) : 1;
      const episodeNum = parsedEpisode ? parseInt(parsedEpisode, 10) : 1;

      if (isTv && (isNaN(seasonNum) || isNaN(episodeNum))) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'For type "tv", "season" and "episode" must be valid numbers.'
        });
      }

      let streamInfo = null;
      try {
        streamInfo = await providerManager.stream(
          provider,
          parsedId,
          parsedType.toLowerCase(),
          seasonNum,
          episodeNum,
          variant || null,
          null
        );
      } catch (err) {
        logger.warn(`Error resolving primary stream for provider "${provider}": ${err.message}`);
      }



      if (!streamInfo) {
        return res.status(404).json({
          success: false,
          error: 'Not Found',
          message: `Stream for provider ${provider} ID ${id} not found.`,
          streams: [],
          subtitles: []
        });
      }

      // Rewrite URLs to target streaming proxy
      if (streamInfo.streamUrl) {
        streamInfo.streamUrl = playerService.getProxyUrl(req, streamInfo.streamUrl, streamInfo.headers);
      }
      if (streamInfo.qualities && Array.isArray(streamInfo.qualities)) {
        streamInfo.qualities = streamInfo.qualities.map(q => ({
          ...q,
          url: playerService.getProxyUrl(req, q.url, q.headers || streamInfo.headers)
        }));
      }
      if (streamInfo.subtitles && Array.isArray(streamInfo.subtitles)) {
        streamInfo.subtitles = streamInfo.subtitles.map(sub => {
          if (!sub.url) return sub;
          let subHeaders = {};
          if (streamInfo.headers) {
            Object.keys(streamInfo.headers).forEach(k => {
              subHeaders[k.toLowerCase()] = streamInfo.headers[k];
            });
          }
          if (sub.url.includes('eat-peach.sbs') || sub.url.includes('peachify')) {
            subHeaders['referer'] = 'https://peachify.top/';
            subHeaders['origin'] = 'https://peachify.top';
          }
          return {
            ...sub,
            url: playerService.getProxyUrl(req, sub.url, subHeaders)
          };
        });
      }

      const isEmbed = streamInfo.streamType === 'embed' && streamInfo.embedUrl;
      if (isEmbed) {
        return res.json({
          ok: true,
          success: true,
          provider: provider.toLowerCase(),
          subjectId: id,
          streamType: 'embed',
          embedUrl: streamInfo.embedUrl,
          embedFallbacks: streamInfo.embedFallbacks || [],
          streams: [],
          variants: streamInfo.variants || [],
          selectedVariantId: streamInfo.selectedVariantId || null,
          stream: streamInfo
        });
      }

      res.json({
        ok: true,
        success: true,
        provider: provider.toLowerCase(),
        subjectId: id,
        streams: streamInfo.qualities || [],
        subtitles: streamInfo.subtitles || [],
        variants: streamInfo.variants || [],
        selectedVariantId: streamInfo.selectedVariantId || null,
        stream: streamInfo
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/v2/stream/tmdb/:tmdbId?type=movie|tv&season=1&episode=1
   */
  async resolveStream(req, res, next) {
    try {
      const { tmdbId } = req.params;
      const { type, season, episode, variant } = req.query;

      const parsedType = (type || 'movie').toLowerCase();
      if (!['movie', 'tv'].includes(parsedType)) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Query parameter "type" must be "movie" or "tv".'
        });
      }

      const seasonNum = season ? parseInt(season, 10) : 1;
      const episodeNum = episode ? parseInt(episode, 10) : 1;

      if (parsedType === 'tv' && (isNaN(seasonNum) || isNaN(episodeNum))) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'For type "tv", "season" and "episode" must be valid numbers.'
        });
      }

      logger.info(`[ResolveStream] TMDB ${tmdbId} (${parsedType} S${seasonNum}E${episodeNum})`);

      const streamResult = await providerManager.resolveStream(
        tmdbId,
        parsedType,
        seasonNum,
        episodeNum,
        null,
        variant || null
      );

      if (!streamResult.available) {
        return res.status(404).json({
          ok: false,
          success: false,
          available: false,
          reason: streamResult.reason || 'No provider available',
          streams: [],
          subtitles: []
        });
      }

      // Proxy stream URLs
      if (streamResult.streamUrl) {
        streamResult.streamUrl = playerService.getProxyUrl(req, streamResult.streamUrl, streamResult.headers);
      }
      if (streamResult.qualities && Array.isArray(streamResult.qualities)) {
        streamResult.qualities = streamResult.qualities.map(q => ({
          ...q,
          url: playerService.getProxyUrl(req, q.url, q.headers || streamResult.headers)
        }));
      }
      if (streamResult.subtitles && Array.isArray(streamResult.subtitles)) {
        streamResult.subtitles = streamResult.subtitles.map(sub => {
          if (!sub.url) return sub;
          let subHeaders = { ...(streamResult.headers || {}) };
          return { ...sub, url: playerService.getProxyUrl(req, sub.url, subHeaders) };
        });
      }

      if (streamResult.streamType === 'embed' && streamResult.embedUrl) {
        return res.json({
          ok: true,
          success: true,
          available: true,
          provider: streamResult.selectedProvider,
          selectedProvider: streamResult.selectedProvider,
          fallbackTriggered: streamResult.fallbackTriggered || false,
          subjectId: String(tmdbId),
          streamType: 'embed',
          embedUrl: streamResult.embedUrl,
          embedFallbacks: streamResult.embedFallbacks || [],
          streams: [],
          variants: streamResult.variants || [],
          selectedVariantId: streamResult.selectedVariantId || null,
          stream: streamResult
        });
      }

      res.json({
        ok: true,
        success: true,
        available: true,
        provider: streamResult.selectedProvider,
        selectedProvider: streamResult.selectedProvider,
        fallbackTriggered: streamResult.fallbackTriggered || false,
        subjectId: String(tmdbId),
        streamType: streamResult.streamType || 'native',
        streams: streamResult.qualities || [],
        subtitles: streamResult.subtitles || [],
        variants: streamResult.variants || [],
        selectedVariantId: streamResult.selectedVariantId || null,
        stream: streamResult
      });
    } catch (err) {
      next(err);
    }
  },



  /**
   * GET /api/providers
   */
  async providers(req, res, next) {
    try {
      const list = providerManager.getProviders().map(p => {
        const diag = providerManager.providerDiagnostics.get(p.name) || {};
        return {
          name: p.name,
          displayName: p.displayName,
          priority: p.priority,
          status: diag.online ? 'healthy' : 'unhealthy',
          message: diag.error || 'Operational',
          responseTimeMs: diag.latency || 0,
          lastChecked: diag.lastSuccess || new Date()
        };
      });

      res.json({
        ok: true,
        providers: list
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/health
   */
  async health(req, res) {
    const uptime = process.uptime();
    const memory = process.memoryUsage();
    
    const providersHealth = {};
    const diags = providerManager.providerDiagnostics;
    for (const [name, diag] of diags.entries()) {
      providersHealth[name] = {
        status: diag.online ? 'healthy' : 'unhealthy',
        message: diag.error || 'Operational',
        responseTimeMs: diag.latency,
        lastSuccess: diag.lastSuccess,
        downloadSupported: diag.downloadSupported,
        streamSupported: diag.streamSupported
      };
    }

    const isDegraded = Object.values(providersHealth).some(h => h.status === 'unhealthy');

    res.status(200).json({
      status: isDegraded ? 'degraded' : 'ok',
      timestamp: new Date(),
      uptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`,
      memory: {
        rss: `${Math.round(memory.rss / 1024 / 1024)} MB`,
        heapTotal: `${Math.round(memory.heapTotal / 1024 / 1024)} MB`,
        heapUsed: `${Math.round(memory.heapUsed / 1024 / 1024)} MB`
      },
      providers: providersHealth
    });
  },

  /**
   * GET /api/v2/tmdb/:category
   */
  async tmdbList(req, res, next) {
    try {
      const { category } = req.params;
      const results = await tmdbService.fetchList(category, req.query);
      res.json({
        ok: true,
        success: true,
        results
      });
    } catch (err) {
      logger.warn(`Failed to retrieve TMDB list: ${err.message}`);
      res.json({
        ok: true,
        success: true,
        results: []
      });
    }
  },

  /**
   * GET /api/v2/tmdb/season/:tmdbId/:seasonNumber
   */
  async seasonEpisodes(req, res, next) {
    try {
      const { tmdbId, seasonNumber } = req.params;
      const { provider } = req.query;
      const results = await tmdbService.fetchSeasonEpisodes(tmdbId, seasonNumber, provider || 'peachify');
      res.json({
        ok: true,
        success: true,
        results
      });
    } catch (err) {
      logger.warn(`Failed to fetch season episodes: ${err.message}`);
      res.json({
        ok: true,
        success: true,
        results: []
      });
    }
  },

  /**
   * GET /api/v2/stream/auto/:tmdbId?type=movie|tv&season=1&episode=1
   * Intelligent Automatic Failover streaming using Server-Sent Events (SSE).
   */
  async resolveStreamAuto(req, res, next) {
    try {
      const { tmdbId } = req.params;
      const { type, season, episode, variant } = req.query;

      const parsedType = (type || 'movie').toLowerCase();
      if (!['movie', 'tv'].includes(parsedType)) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Query parameter "type" must be "movie" or "tv".'
        });
      }

      const seasonNum = season ? parseInt(season, 10) : 1;
      const episodeNum = episode ? parseInt(episode, 10) : 1;

      if (parsedType === 'tv' && (isNaN(seasonNum) || isNaN(episodeNum))) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'For type "tv", "season" and "episode" must be valid numbers.'
        });
      }

      logger.info(`[ResolveStreamAuto] SSE failover streaming requested for TMDB ${tmdbId} (${parsedType} S${seasonNum}E${episodeNum})`);

      // Set up EventSource SSE headers
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
      });

      const sendEvent = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      const pipelineCacheKey = `pipeline:${parsedType}:${tmdbId}:${seasonNum}:${episodeNum}:${variant || 'default'}`;
      const lastSuccessProviderCacheKey = `last_success_provider:${tmdbId}`;

      // Check cache first
      const cachedResult = cache.get(pipelineCacheKey);
      if (cachedResult) {
        logger.info(`[ResolveStreamAuto] Cache HIT for TMDB ${tmdbId}`);
        sendEvent({
          status: 'STARTING',
          providers: [cachedResult.selectedProvider || 'cached']
        });
        sendEvent({
          status: 'SUCCESS',
          provider: cachedResult.selectedProvider,
          stream: cachedResult
        });
        res.end();
        return;
      }

      const sortedProviders = providerManager.getSortedProviders();
      const lastSuccessfulProvider = cache.get(lastSuccessProviderCacheKey);

      let providersToTry = [...sortedProviders];
      if (lastSuccessfulProvider) {
        const idx = providersToTry.findIndex(p => p.name === lastSuccessfulProvider);
        if (idx !== -1) {
          const [p] = providersToTry.splice(idx, 1);
          providersToTry.unshift(p);
          logger.info(`[ResolveStreamAuto] Prioritized last successful provider: ${p.displayName} for TMDB ${tmdbId}`);
        }
      }

      // Send start event
      sendEvent({
        status: 'STARTING',
        providers: providersToTry.map(p => p.name)
      });

      const errors = [];
      let successData = null;

      for (const provider of providersToTry) {
        // Skip offline providers
        try {
          const health = await provider.health();
          if (health && health.status === 'unhealthy') {
            logger.info(`[ResolveStreamAuto] Skip offline provider: ${provider.displayName}`);
            sendEvent({
              status: 'SKIPPED',
              provider: provider.name,
              reason: 'Provider offline'
            });
            continue;
          }
        } catch (healthErr) {
          // ignore
        }

        let attempts = 0;
        let success = false;

        while (attempts < 2 && !success) {
          attempts++;
          sendEvent({
            status: 'TRYING',
            provider: provider.name,
            attempt: attempts
          });

          try {
            logger.info(`[ResolveStreamAuto] Trying provider ${provider.displayName} (Attempt ${attempts})`);
            const streamData = await provider.stream(tmdbId, parsedType, seasonNum, episodeNum, variant || null, null);
            if (streamData && (streamData.streamUrl || streamData.embedUrl)) {
              // Apply proxy URLs
              if (streamData.streamUrl) {
                streamData.streamUrl = playerService.getProxyUrl(req, streamData.streamUrl, streamData.headers);
              }
              if (streamData.qualities && Array.isArray(streamData.qualities)) {
                streamData.qualities = streamData.qualities.map(q => ({
                  ...q,
                  url: playerService.getProxyUrl(req, q.url, q.headers || streamData.headers)
                }));
              }
              if (streamData.subtitles && Array.isArray(streamData.subtitles)) {
                streamData.subtitles = streamData.subtitles.map(sub => {
                  if (!sub.url) return sub;
                  let subHeaders = { ...(streamData.headers || {}) };
                  return { ...sub, url: playerService.getProxyUrl(req, sub.url, subHeaders) };
                });
              }

              successData = {
                ok: true,
                success: true,
                available: true,
                provider: provider.name,
                selectedProvider: provider.name,
                fallbackTriggered: errors.length > 0,
                subjectId: String(tmdbId),
                streamType: streamData.streamType || (streamData.embedUrl ? 'embed' : 'hls'),
                streams: streamData.qualities || [],
                subtitles: streamData.subtitles || [],
                embedUrl: streamData.embedUrl || null,
                embedFallbacks: streamData.embedFallbacks || [],
                variants: streamData.variants || [],
                selectedVariantId: streamData.selectedVariantId || null,
                stream: streamData
              };

              cache.set(pipelineCacheKey, successData, 1800);
              cache.set(lastSuccessProviderCacheKey, provider.name, 1800);

              sendEvent({
                status: 'SUCCESS',
                provider: provider.name,
                stream: successData
              });

              success = true;
              break;
            }
          } catch (err) {
            logger.error(`[ResolveStreamAuto] ${provider.displayName} attempt ${attempts} failed: ${err.message}`);
            if (attempts >= 2) {
              errors.push(`${provider.name}: ${err.message}`);
              sendEvent({
                status: 'FAILED',
                provider: provider.name,
                reason: err.message
              });
            } else {
              // Delay 500ms before retry
              await new Promise(resolve => setTimeout(resolve, 500));
            }
          }
        }

        if (success) break;
      }

      if (!successData) {
        logger.error(`[ResolveStreamAuto] All providers failed for TMDB ${tmdbId}`);
        sendEvent({
          status: 'FAILED_ALL',
          reason: 'ALL_PROVIDERS_FAILED',
          message: `All providers failed: ${errors.join(', ')}`
        });
      }
    } catch (err) {
      logger.error(`[ResolveStreamAuto] Fatal error: ${err.message}`);
    } finally {
      res.end();
    }
  },

  /**
   * Proxy streaming video requests
   */
  async proxyStream(req, res, next) {
    await playerService.streamVideoProxy(req, res, next);
  }
};

module.exports = apiController;
