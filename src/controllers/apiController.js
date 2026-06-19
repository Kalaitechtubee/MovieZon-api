const axios = require('axios');
const providerManager = require('../provider-manager');
const healthService = require('../provider-health');
const logger = require('../logger');

/**
 * Controller handling MovieZon API routes
 */
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

      const results = await providerManager.search(q);
      res.json({
        ok: true,
        count: results.length,
        items: results
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

      if (!type || !['movie', 'tv'].includes(type.toLowerCase())) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Query parameter "type" must be "movie" or "tv".'
        });
      }

      const details = await providerManager.details(provider, id, type.toLowerCase());
      res.json({
        ok: true,
        details
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

      if (!type || !['movie', 'tv'].includes(type.toLowerCase())) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Query parameter "type" must be "movie" or "tv".'
        });
      }

      const isTv = type.toLowerCase() === 'tv';
      const seasonNum = season ? parseInt(season, 10) : 1;
      const episodeNum = episode ? parseInt(episode, 10) : 1;

      if (isTv && (isNaN(seasonNum) || isNaN(episodeNum))) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'For type "tv", "season" and "episode" must be valid numbers.'
        });
      }

      const streamInfo = await providerManager.stream(
        provider,
        id,
        type.toLowerCase(),
        seasonNum,
        episodeNum,
        variant || null
      );

      res.json({
        ok: true,
        stream: streamInfo
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
      const providers = providerManager.getProviders();
      const list = providers.map(p => {
        const health = healthService.getHealth(p.name);
        return {
          name: p.name,
          displayName: p.displayName,
          priority: p.priority,
          status: health.status,
          message: health.message,
          responseTimeMs: health.responseTimeMs,
          lastChecked: health.lastChecked
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
    const providersHealth = healthService.getAllHealth();
    
    // Check if any provider is unhealthy
    const isDegraded = Object.values(providersHealth).some(h => h.status === 'unhealthy');

    res.status(isDegraded ? 200 : 200).json({
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
  }
};

/**
 * Proxy streaming video requests to bypass CORS/Referer protections on stream hosting servers.
 * Implements chunked 206 Partial Content queries for scrub/seeking.
 * GET /api/proxy-stream?url=https://stream-cdn.com/...
 */
apiController.proxyStream = async function(req, res, next) {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ error: 'Bad Request', message: 'Missing "url" parameter.' });
    }

    const decodedUrl = decodeURIComponent(url);

    // Only allow HTTP/HTTPS URLs
    if (!decodedUrl.startsWith('http://') && !decodedUrl.startsWith('https://')) {
      return res.status(400).json({ error: 'Bad Request', message: 'Invalid URL protocol.' });
    }

    // Determine target URL. If it's a CDN link from hakunaymatata.com, wrap it in NetMirror's custom Cloudflare Worker proxy
    let targetUrl = decodedUrl;
    if (decodedUrl.includes('hakunaymatata.com') && !decodedUrl.includes('streamhub-proxy')) {
      targetUrl = `https://streamhub-proxy.1545zoya.workers.dev/?url=${encodeURIComponent(decodedUrl)}`;
      logger.debug(`[ProxyStream] Redirecting direct CDN link to Cloudflare Worker proxy: ${targetUrl}`);
    }

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://net27.cc/'
    };

    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    logger.debug(`Proxying stream to: ${targetUrl} (Range: ${req.headers.range || 'All'})`);

    const response = await axios({
      method: 'get',
      url: targetUrl,
      headers,
      responseType: 'stream',
      validateStatus: false
    });

    res.status(response.status);

    const headersToCopy = [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
      'cache-control'
    ];

    headersToCopy.forEach(h => {
      if (response.headers[h]) {
        res.setHeader(h, response.headers[h]);
      }
    });

    response.data.pipe(res);

    req.on('close', () => {
      if (response.data && typeof response.data.destroy === 'function') {
        response.data.destroy();
      }
    });
  } catch (err) {
    logger.error(`Stream proxying failed: ${err.message}`);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Proxy streaming failed', message: err.message });
    }
  }
};

module.exports = apiController;
