const axios = require('axios');
const providerManager = require('../provider-manager');
const healthService = require('../provider-health');
const logger = require('../logger');
const config = require('../config');
const { normalizeCatalogItem } = require('../provider-normalizer');

/**
 * Fetch movie/TV details from TMDB with cast, genres, and trailers appended
 */
async function fetchTmdbDetails(id, type) {
  const { baseUrl, apiKey } = config.tmdb;
  const pathType = type.toLowerCase() === 'tv' ? 'tv' : 'movie';
  const url = `${baseUrl}/${pathType}/${id}?api_key=${apiKey}&append_to_response=credits,videos,recommendations`;

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
    const genreStr = genres.join(', ');

    // Parse director from crew
    const crew = data.credits?.crew || [];
    const directorObj = crew.find(c => c.job === 'Director');
    const director = directorObj ? directorObj.name : '';
    
    // Find YouTube Trailer key
    const trailerKey = (data.videos?.results || []).find(
      v => v.type === 'Trailer' && v.site === 'YouTube'
    )?.key || null;
    const trailer = trailerKey ? `https://www.youtube.com/watch?v=${trailerKey}` : null;

    const seasons = (data.seasons || []).map(s => ({
      seasonNumber: s.season_number,
      season_number: s.season_number,
      episodeCount: s.episode_count,
      episode_count: s.episode_count,
      name: s.name || `Season ${s.season_number}`
    })).filter(s => s.season_number > 0);

    const recommendations = (data.recommendations?.results || []).slice(0, 10).map(r => ({
      id: r.id,
      title: r.title || r.name || 'Unknown',
      posterPath: r.poster_path ? `https://image.tmdb.org/t/p/w185${r.poster_path}` : null,
      mediaType: r.media_type || (r.first_air_date ? 'tv' : 'movie')
    }));

    const ratingVal = data.vote_average ? `TMDB ${data.vote_average.toFixed(1)}` : 'TMDB 0.0';

    return {
      id: String(data.id),
      provider: 'tmdb',
      tmdbId: data.id,
      title,
      originalTitle,
      overview: data.overview || '',
      description: data.overview || '',
      poster: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : null,
      backdrop: data.backdrop_path ? `https://image.tmdb.org/t/p/original${data.backdrop_path}` : null,
      year: year ? String(year) : '',
      rating: ratingVal,
      genres,
      genre: genreStr,
      duration: runtime,
      language: data.original_language || 'en',
      cast,
      director,
      trailer,
      seasons,
      recommendations,
      mediaType: pathType,
      languages: [],
      sources: []
    };
  } catch (err) {
    logger.warn(`Failed to fetch TMDB details for ${type} ID ${id}: ${err.message}`);
    return null;
  }
}

/**
 * Search movies and TV shows on TMDB
 */
async function searchTmdb(query) {
  const { baseUrl, apiKey } = config.tmdb;
  const url = `${baseUrl}/search/multi?api_key=${apiKey}&query=${encodeURIComponent(query)}&language=en-US`;

  try {
    const response = await axios.get(url, { timeout: 5000 });
    const results = response.data.results || [];
    
    return results
      .filter(item => ['movie', 'tv'].includes(item.media_type))
      .map(item => {
        return normalizeCatalogItem({
          tmdbId: item.id,
          id: String(item.id),
          title: item.title || item.name,
          originalTitle: item.original_title || item.original_name,
          year: item.release_date || item.first_air_date ? new Date(item.release_date || item.first_air_date).getFullYear() : null,
          type: item.media_type,
          rating: item.vote_average,
          poster: item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : null,
          backdrop: item.backdrop_path ? `https://image.tmdb.org/t/p/w780${item.backdrop_path}` : null,
          overview: item.overview || '',
          language: item.original_language || 'en'
        }, 'tmdb');
      });
  } catch (err) {
    logger.warn(`Failed to search TMDB for "${query}": ${err.message}`);
    return [];
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

      logger.info(`Search request received for query: "${q}"`);

      // 1. Try TMDB search first
      let items = await searchTmdb(q.trim());
      
      // 2. If TMDB search failed or returned 0 results, fall back to local provider catalog database
      if (items.length === 0) {
        logger.info(`TMDB search returned 0 items. Querying local providers index...`);
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
        logger.warn(`Could not retrieve details for provider ${provider} ID ${id}: ${err.message}`);
      }
      
      if (details) {
        details.id = details.id || String(details.tmdbId || id);
        details.provider = details.provider || provider;
        details.mediaType = details.mediaType || details.type || parsedType.toLowerCase();
        details.description = details.description || details.overview || '';
        details.overview = details.overview || details.description || '';
        details.genre = details.genre || (Array.isArray(details.genres) ? details.genres.join(', ') : '');
        details.genres = details.genres || (details.genre ? details.genre.split(',').map(g => g.trim()) : []);
        
        if (details.rating && typeof details.rating === 'number') {
          details.rating = `TMDB ${details.rating.toFixed(1)}`;
        }
        details.sources = details.sources || [];
      } else {
        return res.status(404).json({
          success: false,
          error: 'Not Found',
          message: `Details for provider ${provider} ID ${id} not found.`
        });
      }

      res.json({
        ok: true,
        success: true,
        details,
        results: details
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
                { seasonNumber: 2, season_number: 2, episodeCount: 9, episode_count: 9, name: 'Season 2' },
                { seasonNumber: 3, season_number: 3, episodeCount: 8, episode_count: 8, name: 'Season 3' },
                { seasonNumber: 5, season_number: 5, episodeCount: 8, episode_count: 8, name: 'Season 5' }
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

      // Format properties for client compliance
      finalDetails.id = finalDetails.id || String(finalDetails.tmdbId || id);
      finalDetails.provider = finalDetails.provider || 'tmdb';
      finalDetails.mediaType = finalDetails.mediaType || type.toLowerCase();
      finalDetails.description = finalDetails.description || finalDetails.overview || '';
      finalDetails.overview = finalDetails.overview || finalDetails.description || '';
      finalDetails.genre = finalDetails.genre || (Array.isArray(finalDetails.genres) ? finalDetails.genres.join(', ') : '');
      finalDetails.genres = finalDetails.genres || (finalDetails.genre ? finalDetails.genre.split(',').map(g => g.trim()) : []);

      if (finalDetails.rating && typeof finalDetails.rating === 'number') {
        finalDetails.rating = `TMDB ${finalDetails.rating.toFixed(1)}`;
      }

      // Map provider availability check results to V2 sources array
      const sources = [];
      if (availability && Array.isArray(availability.providers)) {
        availability.providers.forEach(p => {
          if (p.status === 'available') {
            if (p.streamType === 'embed' && p.embedUrl) {
              // Peachify / iframe embed providers (Server 2)
              sources.push({
                provider: p.name,
                id: String(id),
                languages: ['Original Audio'],
                label: 'Server 2 (Peachify)',
                streamType: 'embed'
              });
            } else if (p.variants && p.variants.length > 0) {
              p.variants.forEach(v => {
                sources.push({
                  provider: p.name,
                  id: v.id, // dubSubjectId
                  languages: [v.language]
                });
              });
            } else {
              sources.push({
                provider: p.name,
                id: String(id),
                languages: ['Original Audio']
              });
            }
          }
        });
      }

      finalDetails.sources = sources;

      // --- SERVER 2 (PEACHIFY) SAFETY NET ---
      // Ensure Peachify (Server 2) is always added as a source if it is not already present,
      // so the client can always switch to Server 2 as a fallback.
      const hasPeachifySource = sources.some(s => s.provider === 'peachify');
      if (!hasPeachifySource) {
        logger.info(`[UnifiedDetails] Adding Peachify (Server 2) as fallback source for ID ${id}.`);
        sources.push({
          provider: 'peachify',
          id: String(id),
          languages: ['Original Audio'],
          label: 'Server 2 (Peachify)',
          streamType: 'embed'
        });
        finalDetails.sources = sources;
      }



      res.json({
        ok: true,
        success: true,
        movie: finalDetails,
        details: finalDetails,
        availability,
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

      // Always use null for clientIp so CDN URLs (e.g. hakunaymatata.com) are signed
      // for the backend server's IP address. Since ALL stream URLs are routed through
      // the backend proxy (/api/v2/stream/proxy), the backend server fetches the CDN
      // using the same IP — preventing 403 Forbidden errors from IP-locked signed tokens.
      const isDownload = req.query.download === 'true';
      const clientIp = null;

      let streamInfo = null;
      try {
        streamInfo = await providerManager.stream(
          provider,
          parsedId,
          parsedType.toLowerCase(),
          seasonNum,
          episodeNum,
          variant || null,
          clientIp
        );
      } catch (err) {
        logger.warn(`Could not retrieve stream for provider ${provider} ID ${parsedId}: ${err.message}`);
      }

      // --- CROSS-PROVIDER FALLBACK ---
      // If the primary provider (NetMirror) failed or returned expired/empty streams,
      // automatically fall back to Peachify before returning 404.
      const isNetmirror = provider.toLowerCase() === 'netmirror';
      const hasValidStreams = streamInfo && (
        (streamInfo.qualities && streamInfo.qualities.length > 0) ||
        (streamInfo.streamUrl && streamInfo.streamUrl.length > 0) ||
        (streamInfo.streamType === 'embed' && streamInfo.embedUrl)
      );

      if (!hasValidStreams && isNetmirror) {
        logger.info(`[Stream] NetMirror returned no valid stream for ID ${parsedId}. Attempting Peachify fallback...`);
        try {
          const peachifyInfo = await providerManager.stream(
            'peachify',
            parsedId,
            parsedType.toLowerCase(),
            seasonNum,
            episodeNum,
            null,
            null
          );
          if (peachifyInfo) {
            streamInfo = peachifyInfo;
            logger.info(`[Stream] Peachify fallback succeeded for ID ${parsedId} (streamType: ${peachifyInfo.streamType || 'native'})`);
          }
        } catch (peachErr) {
          logger.warn(`[Stream] Peachify fallback also failed for ID ${parsedId}: ${peachErr.message}`);
        }
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

      // Proxy stream URLs to bypass CORS and Referer restrictions
      const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
      const host = req.get('host');
      const proxyBase = `${protocol}://${host}/api/v2/stream/proxy`;
      const proxyUrl = (originalUrl, streamHeaders) => {
        if (!originalUrl) return '';
        // Skip re-proxying URLs that are already going through our own backend proxy endpoint
        if (
          originalUrl.includes('/stream/proxy') ||
          originalUrl.includes('/proxy-stream')
        ) {
          return originalUrl;
        }
        // All other URLs (including workers.dev Cloudflare Worker proxy URLs) are routed
        // through the backend proxy so the server can attach proper headers and stream to the client.
        let pUrl = `${proxyBase}?url=${encodeURIComponent(originalUrl)}`;
        if (streamHeaders && Object.keys(streamHeaders).length > 0) {
          pUrl += `&headers=${encodeURIComponent(JSON.stringify(streamHeaders))}`;
        }
        return pUrl;
      };

      if (streamInfo.streamUrl) {
        streamInfo.streamUrl = proxyUrl(streamInfo.streamUrl, streamInfo.headers);
      }
      if (streamInfo.qualities && Array.isArray(streamInfo.qualities)) {
        streamInfo.qualities = streamInfo.qualities.map(q => ({
          ...q,
          url: proxyUrl(q.url, q.headers || streamInfo.headers)
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
            url: proxyUrl(sub.url, subHeaders)
          };
        });
      }

      // For embed-type streams (e.g. Peachify), return the embed URL directly
      // No CORS proxy needed — the frontend renders these in an <iframe>
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
          subtitles: [],
          stream: streamInfo
        });
      }

      res.json({
        ok: true,
        success: true,
        provider: provider.toLowerCase(),
        subjectId: id, // return original id string to match frontend validation
        streams: streamInfo.qualities || [],
        subtitles: streamInfo.subtitles || [],
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
  },

  /**
   * GET /api/v2/tmdb/:category
   * Proxies TMDB catalog list requests (trending, popular, discover, etc.)
   */
  async tmdbList(req, res, next) {
    try {
      const { category } = req.params;
      const { baseUrl, apiKey } = config.tmdb;
      
      let url = '';
      
      if (category === 'trending') {
        const media = req.query.media || 'all';
        const time = req.query.time || 'week';
        url = `${baseUrl}/trending/${media}/${time}?api_key=${apiKey}`;
      } else if (category === 'popular') {
        url = `${baseUrl}/movie/popular?api_key=${apiKey}`;
      } else if (category === 'popular_tv') {
        url = `${baseUrl}/tv/popular?api_key=${apiKey}`;
      } else if (category === 'top_rated') {
        const isTv = req.query.type === 'tv';
        url = isTv ? `${baseUrl}/tv/top_rated?api_key=${apiKey}` : `${baseUrl}/movie/top_rated?api_key=${apiKey}`;
      } else if (category === 'upcoming') {
        url = `${baseUrl}/movie/upcoming?api_key=${apiKey}`;
      } else if (category === 'discover') {
        const isTv = req.query.type === 'tv';
        url = isTv ? `${baseUrl}/discover/tv?api_key=${apiKey}` : `${baseUrl}/discover/movie?api_key=${apiKey}`;
      } else {
        return res.status(400).json({
          error: 'Bad Request',
          message: `Unsupported TMDB list category: ${category}`
        });
      }

      // Forward other query parameters to TMDB
      const urlObj = new URL(url);
      Object.keys(req.query).forEach(key => {
        if (!['media', 'time', 'type'].includes(key)) {
          urlObj.searchParams.set(key, req.query[key]);
        }
      });

      logger.debug(`Proxying TMDB list query for category "${category}" to: ${urlObj.toString()}`);
      
      const response = await axios.get(urlObj.toString(), { timeout: 5000 });
      const results = response.data.results || [];
      
      // Normalize results using provider-normalizer
      const { normalizeCatalogItem } = require('../provider-normalizer');
      const normalizedResults = results.map(item => {
        const isTvShow = category === 'popular_tv' || req.query.type === 'tv' || item.media_type === 'tv' || (!item.title && item.name);
        const mediaType = isTvShow ? 'tv' : 'movie';
        
        return normalizeCatalogItem({
          tmdbId: item.id,
          id: String(item.id),
          title: item.title || item.name,
          originalTitle: item.original_title || item.original_name,
          year: item.release_date || item.first_air_date ? new Date(item.release_date || item.first_air_date).getFullYear() : null,
          type: mediaType,
          mediaType: mediaType,
          rating: item.vote_average,
          poster: item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : null,
          backdrop: item.backdrop_path ? `https://image.tmdb.org/t/p/w780${item.backdrop_path}` : null,
          overview: item.overview || '',
          language: item.original_language || 'en'
        }, 'tmdb');
      });

      res.json({
        ok: true,
        success: true,
        results: normalizedResults
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
      const { baseUrl, apiKey } = config.tmdb;
      
      const url = `${baseUrl}/tv/${tmdbId}/season/${seasonNumber}?api_key=${apiKey}&language=en-US`;
      logger.debug(`Fetching TV season episodes from TMDB: ${url}`);
      
      const response = await axios.get(url, { timeout: 5000 });
      const episodes = response.data.episodes || [];
      
      const normalizedEpisodes = episodes.map(item => {
        const compositeId = `${tmdbId}-${seasonNumber}-${item.episode_number}`;
        const stillUrl = item.still_path ? `https://image.tmdb.org/t/p/w300${item.still_path}` : null;
        
        return {
          id: compositeId,
          provider: provider || 'netmirror',
          episode_number: item.episode_number,
          name: item.name || `Episode ${item.episode_number}`,
          still_path: stillUrl,
          still: stillUrl,
          air_date: item.air_date || '',
          airDate: item.air_date || '',
          runtime: item.runtime || 0,
          overview: item.overview || ''
        };
      });

      res.json({
        ok: true,
        success: true,
        results: normalizedEpisodes
      });
    } catch (err) {
      logger.warn(`Failed to fetch season episodes: ${err.message}`);
      res.json({
        ok: true,
        success: true,
        results: []
      });
    }
  }
};

/**
 * Proxy streaming video requests to bypass CORS/Referer protections on stream hosting servers.
 * Implements chunked 206 Partial Content queries for scrub/seeking.
 * GET /api/proxy-stream?url=https://stream-cdn.com/...
 */
apiController.proxyStream = async function(req, res, next) {
  try {
    const { url, headers: queryHeaders } = req.query;
    if (!url) {
      return res.status(400).json({ error: 'Bad Request', message: 'Missing "url" parameter.' });
    }

    // Express already decodes query parameters once.
    // We only call decodeURIComponent if the protocol is still encoded,
    // to preserve nested parameter boundaries for Cloudflare Worker proxies.
    let targetUrl = url;
    if (url.startsWith('http%3A%2F%2F') || url.startsWith('https%3A%2F%2F')) {
      targetUrl = decodeURIComponent(url);
    }

    // Only allow HTTP/HTTPS URLs
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      return res.status(400).json({ error: 'Bad Request', message: 'Invalid URL protocol.' });
    }

    // Extract nested target URL if wrapped in eat-peach.sbs / peachify proxy
    try {
      const parsed = new URL(targetUrl);
      if ((parsed.hostname.includes('eat-peach.sbs') || parsed.hostname.includes('peachify')) && parsed.searchParams.has('url')) {
        const nested = parsed.searchParams.get('url');
        if (nested && (nested.startsWith('http://') || nested.startsWith('https://'))) {
          logger.info(`[ProxyStream] Extracting nested target URL from proxy wrapper: ${nested}`);
          targetUrl = nested;
        }
      }
    } catch (e) {
      // ignore invalid URL parsing
    }

    // Determine target URL. If it's a CDN link from hakunaymatata.com, wrap it in NetMirror's custom Cloudflare Worker proxy
    // (Only if it's not a direct backend download request, since the backend handles CORS natively)
    const isDownload = req.query.download === 'true';
    let targetHost = '';
    try {
      targetHost = new URL(targetUrl).hostname;
    } catch (e) {
      const hostMatch = targetUrl.match(/^(?:https?:\/\/)?([^/?:#]+)/i);
      if (hostMatch) {
        targetHost = hostMatch[1];
      }
    }
    const isSubtitle = targetUrl.toLowerCase().includes('.srt') || 
                       targetUrl.toLowerCase().includes('.vtt') ||
                       targetUrl.includes('/msubt/') ||
                       targetUrl.includes('/subtitle/');
    if (!isDownload && !isSubtitle && targetHost.endsWith('hakunaymatata.com') && !targetHost.includes('streamhub-proxy') && !targetHost.includes('workers.dev')) {
      targetUrl = `https://streamhub-proxy.1545zoya.workers.dev/?url=${encodeURIComponent(targetUrl)}`;
      logger.debug(`[ProxyStream] Redirecting direct CDN link to Cloudflare Worker proxy: ${targetUrl}`);
    }

    // Set attachment header for direct download trigger without navigation
    if (isDownload) {
      const filename = req.query.filename || 'video.mp4';
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    }

    const headers = {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'referer': 'https://net27.cc/'
    };

    if (queryHeaders) {
      try {
        const rawHeaders = Array.isArray(queryHeaders) ? queryHeaders[queryHeaders.length - 1] : queryHeaders;
        const parsed = JSON.parse(decodeURIComponent(rawHeaders));
        Object.keys(parsed).forEach(k => {
          const lowerKey = k.toLowerCase();
          // Delete any existing key that matches case-insensitively to prevent duplicates
          Object.keys(headers).forEach(hk => {
            if (hk.toLowerCase() === lowerKey) {
              delete headers[hk];
            }
          });
          headers[lowerKey] = parsed[k];
        });
      } catch (e) {
        logger.warn(`Failed to parse custom query headers: ${e.message}`);
      }
    }

    // For Cloudflare Worker proxies (workers.dev), strip Referer/Origin from our own request
    // since the worker itself forwards the correct headers from the query string to the CDN.
    if (targetUrl.includes('workers.dev')) {
      delete headers['Referer'];
      delete headers['referer'];
      delete headers['Origin'];
      delete headers['origin'];
      delete headers['User-Agent'];
      delete headers['user-agent'];
    }

    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    // Detect HLS/m3u8 playlists and rewrite segment URLs to route through the backend proxy
    const isM3u8Url = targetUrl.split('?')[0].endsWith('.m3u8') || 
                      targetUrl.includes('hls-proxy') || 
                      targetUrl.includes('m3u8') || 
                      targetUrl.includes('/hls/');
    if (isM3u8Url) {
      logger.info(`[ProxyStream] Detected HLS playlist. Fetching and rewriting URLs for: ${targetUrl}`);
      try {
        const response = await axios({
          method: 'get',
          url: targetUrl,
          headers,
          responseType: 'text',
          validateStatus: false
        });

        res.status(response.status);
        res.setHeader('Content-Type', response.headers['content-type'] || 'application/vnd.apple.mpegurl');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges, Content-Disposition');

        const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
        const host = req.get('host');
        const proxyBase = `${protocol}://${host}/api/v2/stream/proxy`;

        const lines = response.data.split(/\r?\n/);
        const rewrittenLines = lines.map(line => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) {
            return line;
          }
          try {
            const absoluteUrl = new URL(trimmed, targetUrl).toString();
            let rewrittenUrl = `${proxyBase}?url=${encodeURIComponent(absoluteUrl)}`;
            if (queryHeaders) {
              rewrittenUrl += `&headers=${queryHeaders}`;
            }
            return rewrittenUrl;
          } catch (e) {
            return line;
          }
        });

        res.send(rewrittenLines.join('\n'));
        return;
      } catch (err) {
        logger.error(`HLS playlist rewriting failed: ${err.message}`);
        // fallback to default stream proxying below if rewrite fails
      }
    }

    logger.debug(`[ProxyStream] Proxying stream to targetUrl: "${targetUrl}"`);
    logger.debug(`[ProxyStream] Request headers: ${JSON.stringify(headers)}`);

    const response = await axios({
      method: 'get',
      url: targetUrl,
      headers,
      responseType: 'stream',
      validateStatus: false
    });

    res.status(response.status);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges, Content-Disposition');

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
