const axios = require('axios');
const providerManager = require('../provider-manager');
const healthService = require('../provider-health');
const logger = require('../logger');
const config = require('../config');

/**
 * Fetch movie/TV details from TMDB with cast, genres, and trailers appended
 */
async function fetchTmdbDetails(id, type) {
  const { baseUrl, apiKey } = config.tmdb;
  const pathType = type.toLowerCase() === 'tv' ? 'tv' : 'movie';
  const url = `${baseUrl}/${pathType}/${id}?api_key=${apiKey}&append_to_response=credits,videos`;

  try {
    const response = await axios.get(url, { timeout: 5000 });
    const data = response.data;
    
    // Normalize response to standard format
    const title = data.title || data.name || 'Unknown Title';
    const originalTitle = data.original_title || data.original_name || title;
    const releaseDate = data.release_date || data.first_air_date || '';
    const year = releaseDate ? new Date(releaseDate).getFullYear() : null;
    const runtime = data.runtime || (data.episode_run_time && data.episode_run_time.length > 0 ? data.episode_run_time[0] : null);
    
    const cast = (data.credits?.cast || []).slice(0, 10).map(c => ({
      name: c.name,
      character: c.character,
      profilePath: c.profile_path ? `https://image.tmdb.org/t/p/w185${c.profile_path}` : null
    }));
    
    const genres = (data.genres || []).map(g => g.name);
    
    // Find YouTube Trailer key
    const trailer = (data.videos?.results || []).find(
      v => v.type === 'Trailer' && v.site === 'YouTube'
    )?.key || null;

    const seasons = (data.seasons || []).map(s => ({
      seasonNumber: s.season_number,
      episodeCount: s.episode_count,
      name: s.name || `Season ${s.season_number}`
    })).filter(s => s.seasonNumber > 0);

    return {
      tmdbId: data.id,
      title,
      originalTitle,
      overview: data.overview || '',
      poster: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : null,
      backdrop: data.backdrop_path ? `https://image.tmdb.org/t/p/original${data.backdrop_path}` : null,
      year,
      rating: data.vote_average || 0,
      genres,
      duration: runtime,
      language: data.original_language || 'en',
      cast,
      trailer,
      seasons
    };
  } catch (err) {
    logger.warn(`Failed to fetch TMDB details for ${type} ID ${id}: ${err.message}`);
    return null;
  }
}

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
   * GET /api/details/:id?type=movie|tv&season=1&episode=1
   * Fetches metadata from TMDB and queries all providers in parallel for availability.
   */
  async unifiedDetails(req, res, next) {
    try {
      const { id } = req.params;
      const { type, season, episode } = req.query;

      if (!type || !['movie', 'tv'].includes(type.toLowerCase())) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Query parameter "type" must be "movie" or "tv".'
        });
      }

      const isTv = type.toLowerCase() === 'tv';
      const seasonNum = season ? parseInt(season, 10) : 1;
      const episodeNum = episode ? parseInt(episode, 10) : 1;
      
      const clientIp = req.headers['x-forwarded-for']
        ? req.headers['x-forwarded-for'].split(',')[0].trim()
        : req.socket.remoteAddress;

      logger.info(`Unified details query for ${type} ID ${id} (S${seasonNum}E${episodeNum}) requested by ${clientIp}`);

      // Run TMDB Details fetch and Provider Availability checks in parallel
      const [movieDetails, availability] = await Promise.all([
        fetchTmdbDetails(id, type.toLowerCase()),
        providerManager.checkAvailability(id, type.toLowerCase(), seasonNum, episodeNum, clientIp)
      ]);

      let finalDetails = movieDetails;
      if (!finalDetails) {
        logger.info(`Falling back to local provider catalog details for ID ${id}`);
        try {
          const localDetails = await providerManager.details('netmirror', id, type.toLowerCase());
          if (localDetails) {
            finalDetails = {
              tmdbId: parseInt(localDetails.tmdbId || id, 10),
              title: localDetails.title,
              originalTitle: localDetails.originalTitle || localDetails.title,
              overview: localDetails.overview || '',
              poster: localDetails.poster,
              backdrop: localDetails.backdrop,
              year: localDetails.year,
              rating: localDetails.rating,
              genres: [],
              duration: localDetails.duration,
              language: localDetails.language || 'en',
              cast: [],
              trailer: null,
              seasons: isTv ? [
                { seasonNumber: 2, episodeCount: 9, name: 'Season 2' },
                { seasonNumber: 3, episodeCount: 8, name: 'Season 3' },
                { seasonNumber: 5, episodeCount: 8, name: 'Season 5' }
              ] : []
            };
          }
        } catch (localErr) {
          logger.warn(`Local fallback details fetch failed: ${localErr.message}`);
        }
      }

      if (!finalDetails) {
        return res.status(404).json({
          error: 'Not Found',
          message: `Details for ${type} ID ${id} not found.`
        });
      }

      res.json({
        ok: true,
        movie: finalDetails,
        availability
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

      // Extract client IP (handling reverse proxies)
      // For download requests, do not forward client IP to generate signatures locked to the server IP instead
      const isDownload = req.query.download === 'true';
      const clientIp = isDownload ? null : (req.headers['x-forwarded-for']
        ? req.headers['x-forwarded-for'].split(',')[0].trim()
        : req.socket.remoteAddress);

      const streamInfo = await providerManager.stream(
        provider,
        id,
        type.toLowerCase(),
        seasonNum,
        episodeNum,
        variant || null,
        clientIp
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
    // (Only if it's not a direct backend download request, since the backend handles CORS natively)
    let targetUrl = decodedUrl;
    const isDownload = req.query.download === 'true';
    if (!isDownload && decodedUrl.includes('hakunaymatata.com') && !decodedUrl.includes('streamhub-proxy')) {
      targetUrl = `https://streamhub-proxy.1545zoya.workers.dev/?url=${encodeURIComponent(decodedUrl)}`;
      logger.debug(`[ProxyStream] Redirecting direct CDN link to Cloudflare Worker proxy: ${targetUrl}`);
    }

    // Set attachment header for direct download trigger without navigation
    if (isDownload) {
      const filename = req.query.filename || 'video.mp4';
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
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
