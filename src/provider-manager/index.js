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

const axios = require('axios');

async function parseMasterM3u8(m3u8Url, requestHeaders) {
  try {
    logger.info(`[HLS Parser] Fetching and parsing master playlist: ${m3u8Url}`);
    const response = await axios.get(m3u8Url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ...(requestHeaders || {})
      },
      timeout: 5000
    });

    const playlistText = response.data;
    if (typeof playlistText !== 'string') return null;

    const audioTracks = [];
    const subtitleTracks = [];
    const qualitiesSet = new Set();

    const parseAttributes = (attrStr) => {
      const attrs = {};
      const regex = /([^=\s,]+)=(?:"([^"]*)"|([^,\s]*))/g;
      let match;
      while ((match = regex.exec(attrStr)) !== null) {
        attrs[match[1]] = match[2] || match[3];
      }
      return attrs;
    };

    const lines = playlistText.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#EXT-X-MEDIA:')) {
        const attributes = parseAttributes(trimmed.substring(13));
        const type = attributes['TYPE'];
        if (type === 'AUDIO') {
          const langCode = attributes['LANGUAGE'] || attributes['NAME']?.toLowerCase() || 'und';
          const name = attributes['NAME'] || langCode;
          const isDefault = attributes['DEFAULT'] === 'YES';
          const trackId = attributes['GROUP-ID'] || langCode;

          const standardLang = langCode.substring(0, 3).toLowerCase();

          audioTracks.push({
            id: standardLang,
            name: name,
            language: standardLang,
            default: isDefault
          });
        } else if (type === 'SUBTITLES') {
          const langCode = attributes['LANGUAGE'] || attributes['NAME']?.toLowerCase() || 'und';
          const name = attributes['NAME'] || langCode;
          const isDefault = attributes['DEFAULT'] === 'YES';
          const uri = attributes['URI'];
          const trackId = attributes['GROUP-ID'] || langCode;

          let subUrl = uri ? new URL(uri, m3u8Url).toString() : '';

          subtitleTracks.push({
            id: trackId,
            name: name,
            language: langCode.substring(0, 3).toLowerCase(),
            url: subUrl,
            default: isDefault
          });
        }
      } else if (trimmed.startsWith('#EXT-X-STREAM-INF:')) {
        const attributes = parseAttributes(trimmed.substring(18));
        const resolution = attributes['RESOLUTION'];
        if (resolution) {
          const height = resolution.split('x')[1];
          if (height) {
            qualitiesSet.add(parseInt(height, 10));
          }
        }
      }
    }

    return {
      audioTracks,
      subtitleTracks,
      qualities: Array.from(qualitiesSet).sort((a, b) => b - a)
    };
  } catch (err) {
    logger.warn(`[HLS Parser] Failed to parse master M3U8: ${err.message}`);
    return null;
  }
}

async function parseAndEnrichHls(streamData) {
  if (!streamData || !streamData.streamUrl) return streamData;

  const isHls = streamData.streamUrl.endsWith('.m3u8') ||
    streamData.streamUrl.includes('m3u8') ||
    streamData.streamUrl.includes('/hls/');

  if (isHls && (!streamData.audioTracks || !streamData.subtitleTracks)) {
    const hlsDetails = await parseMasterM3u8(streamData.streamUrl, streamData.headers);
    if (hlsDetails) {
      streamData.audioTracks = hlsDetails.audioTracks;
      streamData.subtitleTracks = hlsDetails.subtitleTracks;
      if (hlsDetails.qualities && hlsDetails.qualities.length > 0) {
        if (!streamData.qualities || streamData.qualities.length === 0) {
          streamData.qualities = hlsDetails.qualities.map(q => ({
            quality: `${q}p`,
            url: streamData.streamUrl,
            headers: streamData.headers
          }));
        }
      }
    }
  }
  return streamData;
}

async function fetchTmdbMetadata(id, type) {
  const { baseUrl, apiKey } = config.tmdb;
  const pathType = type.toLowerCase() === 'tv' ? 'tv' : 'movie';
  const url = `${baseUrl}/${pathType}/${id}?api_key=${apiKey}&append_to_response=credits,videos,recommendations`;

  try {
    const response = await axios.get(url, { timeout: 5000 });
    const data = response.data;

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

    return {
      overview: data.overview || '',
      genres,
      genre: genreStr,
      cast,
      director,
      trailer,
      seasons,
      recommendations,
      backdrop: data.backdrop_path ? `https://image.tmdb.org/t/p/original${data.backdrop_path}` : null,
      poster: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : null,
      rating: data.vote_average ? `TMDB ${data.vote_average.toFixed(1)}` : null,
      duration: data.runtime || (data.episode_run_time && data.episode_run_time.length > 0 ? data.episode_run_time[0] : null)
    };
  } catch (err) {
    logger.warn(`Failed to fetch TMDB details for enrichment: ${err.message}`);
    return null;
  }
}

async function enrichWithTmdb(data, type) {
  if (!data) return data;
  const tmdbId = data.tmdbId || data.id;
  if (!tmdbId) return data;

  try {
    const tmdbData = await fetchTmdbMetadata(tmdbId, type);
    if (!tmdbData) return data;

    return {
      ...data,
      cast: tmdbData.cast || [],
      director: tmdbData.director || '',
      trailer: tmdbData.trailer || null,
      recommendations: tmdbData.recommendations || [],
      seasons: tmdbData.seasons || [],
      genres: tmdbData.genres || data.genres || [],
      genre: tmdbData.genre || data.genre || '',
      overview: tmdbData.overview || data.overview || '',
      description: tmdbData.overview || data.overview || '',
      backdrop: tmdbData.backdrop || data.backdrop || '',
      poster: tmdbData.poster || data.poster || '',
      rating: tmdbData.rating || data.rating || 'TMDB 0.0',
      duration: tmdbData.duration || data.duration || null
    };
  } catch (err) {
    logger.warn(`Enrichment failed: ${err.message}`);
    return data;
  }
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
          const enriched = await enrichWithTmdb(data, type);
          cache.set(cacheKey, enriched);
          return enriched;
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
          const enriched = await enrichWithTmdb(data, type);
          cache.set(cacheKey, enriched);
          return enriched;
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

    metadata = await enrichWithTmdb(metadata, type);

    // ── Phase 2: Stream Availability — SEQUENTIAL, priority order ───────────
    //
    // ARCHITECTURE RULE: This phase must NEVER run providers in parallel.
    //
    // Providers are checked one-by-one in config.providerPriority order.
    // This guarantees that `defaultProvider` is ALWAYS the highest-priority
    // provider that has a working stream — identical to what resolveStream()
    // would select. A parallel Promise.all would allow a lower-priority
    // provider (e.g. Peachify) to appear available before a higher-priority
    // one (e.g. NetMirror) has finished its check, causing defaultProvider
    // to be set incorrectly.
    //
    // Cache-first: we check the stream cache before making any network call.
    // If resolveStream() has already run for this title, the results are
    // served instantly from cache — no duplicate provider requests.
    const sourceChecks = [];

    for (let idx = 0; idx < providers.length; idx++) {
      const provider = providers[idx];
      const streamCacheKey = `stream:${provider.name}:${type}:${tmdbId}:1:1:default:default`;
      const cachedStream = cache.get(streamCacheKey);

      if (cachedStream) {
        // ── Cache hit — no network call needed ──────────────────────────────
        const enrichedStream = await parseAndEnrichHls(cachedStream);
        const isPlayable = !!(
          enrichedStream.streamUrl ||
          (enrichedStream.qualities && enrichedStream.qualities.length > 0) ||
          (enrichedStream.streamType === 'embed' && enrichedStream.embedUrl)
        );
        logger.debug(`[DetailsP] ${provider.displayName} stream availability: CACHED (${isPlayable ? 'available' : 'unavailable'})`);
        sourceChecks.push({
          provider: provider.name,
          id: String(tmdbId),
          serverIndex: idx + 1,
          available: isPlayable,
          downloadSupported: provider.downloadSupported || false,
          streamType: enrichedStream.streamType || null,
          embedUrl: enrichedStream.embedUrl || null,
          variants: enrichedStream.variants || [],
          languages: enrichedStream.variants?.map(v => v.language) || ['Original Audio'],
          audioTracks: enrichedStream.audioTracks || [],
          subtitleTracks: enrichedStream.subtitleTracks || [],
          qualities: enrichedStream.qualities || []
        });
      } else {
        // ── No cache — live availability check (stream() with strict timeout) ─
        // We call stream() here because providers do not have a separate
        // lightweight ping API. The result is cached so subsequent calls
        // (e.g. Watch Now) are served from cache.
        try {
          let streamData = await Promise.race([
            provider.stream(tmdbId, type, 1, 1, null, null),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Availability check timeout')), 12000)
            )
          ]);

          let isPlayable = !!(
            streamData &&
            (
              streamData.streamUrl ||
              (streamData.qualities && streamData.qualities.length > 0) ||
              (streamData.streamType === 'embed' && streamData.embedUrl)
            )
          );

          if (isPlayable) {
            streamData = await parseAndEnrichHls(streamData);
          }

          // Cache the live result so Watch Now can serve it immediately
          if (isPlayable) {
            let ttl = 1800;
            if (streamData.expires) {
              const nowSec = Math.floor(Date.now() / 1000);
              ttl = Math.max(0, streamData.expires - nowSec - 60);
            }
            if (ttl > 0) cache.set(streamCacheKey, streamData, ttl);
          }

          logger.debug(`[DetailsP] ${provider.displayName} stream availability: ${isPlayable ? 'AVAILABLE' : 'UNAVAILABLE'}`);
          sourceChecks.push({
            provider: provider.name,
            id: String(tmdbId),
            serverIndex: idx + 1,
            available: isPlayable,
            downloadSupported: provider.downloadSupported || false,
            streamType: streamData?.streamType || null,
            embedUrl: streamData?.embedUrl || null,
            variants: streamData?.variants || [],
            languages: streamData?.variants?.map(v => v.language) || ['Original Audio'],
            audioTracks: streamData?.audioTracks || [],
            subtitleTracks: streamData?.subtitleTracks || [],
            qualities: streamData?.qualities || []
          });
        } catch (err) {
          logger.debug(`[DetailsP] ${provider.displayName} stream availability: OFFLINE — ${err.message}`);
          sourceChecks.push({
            provider: provider.name,
            id: String(tmdbId),
            serverIndex: idx + 1,
            available: false,
            downloadSupported: provider.downloadSupported || false,
            streamType: null,
            embedUrl: null,
            variants: [],
            languages: ['Original Audio'],
            audioTracks: [],
            subtitleTracks: [],
            qualities: []
          });
        }
      }
    }

    // Build the final sources array — ALL providers in priority order.
    // If a provider has language variants, expand to one entry per variant.
    // Frontend renders this exactly as received — never sorts or filters.
    const sources = [];
    const supportedAudio = new Set();
    const supportedSubtitles = new Set();
    const supportedQualities = new Set();
    let downloadAvailable = false;

    for (const check of sourceChecks) {
      sources.push({
        provider: check.provider,
        id: String(tmdbId),
        serverIndex: check.serverIndex,
        available: check.available,
        downloadSupported: check.downloadSupported || false,
        languages: check.languages,
        streamType: check.streamType || null,
        embedUrl: check.embedUrl || null,
        variants: check.variants || []
      });

      if (check.available) {
        if (check.audioTracks && check.audioTracks.length > 0) {
          check.audioTracks.forEach(t => supportedAudio.add(t.name || t.id));
        } else if (check.languages) {
          check.languages.forEach(l => supportedAudio.add(l));
        }

        if (check.subtitleTracks && check.subtitleTracks.length > 0) {
          check.subtitleTracks.forEach(t => supportedSubtitles.add(t.name || t.id));
        }

        if (check.qualities && check.qualities.length > 0) {
          check.qualities.forEach(q => {
            const cleanQ = String(q.quality).replace('p', '');
            if (cleanQ && !isNaN(cleanQ)) {
              supportedQualities.add(parseInt(cleanQ, 10));
            } else {
              supportedQualities.add(q.quality);
            }
          });
        }

        if (check.downloadSupported) {
          downloadAvailable = true;
        }
      }
    }

    // defaultProvider = first provider with a working stream (priority order).
    // Because Phase 2 is sequential, this is ALWAYS the highest-priority
    // provider — identical to what resolveStream() would select.
    const defaultProviderEntry = sourceChecks.find(s => s.available);
    const defaultProvider = defaultProviderEntry?.provider || metadataProvider;

    logger.info(`[DetailsP] Sources for TMDB ${tmdbId}: ${sourceChecks.map(s => `${s.provider}(${s.available ? '✓' : '✗'})`).join(' → ')} | defaultProvider: ${defaultProvider}`);

    const result = {
      ...metadata,
      sources,
      defaultProvider,
      supportedAudio: Array.from(supportedAudio),
      supportedSubtitles: Array.from(supportedSubtitles),
      supportedQualities: Array.from(supportedQualities)
        .sort((a, b) => {
          const numA = parseInt(a, 10);
          const numB = parseInt(b, 10);
          if (!isNaN(numA) && !isNaN(numB)) return numB - numA;
          return String(b).localeCompare(String(a));
        })
        .map(q => typeof q === 'number' ? `${q}p` : q),
      downloadAvailable
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
    let data = await targetProvider.stream(id, type, season, episode, variantId, clientIp);

    if (data && (data.streamUrl || data.qualities?.length > 0 || data.embedUrl)) {
      data = await parseAndEnrichHls(data);
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
  async resolveStream(tmdbId, type, season = 1, episode = 1, clientIp = null, variantId = null) {
    // ── Pipeline-level result cache ────────────────────────────────────────────
    // Cache the final resolved result so repeated calls (frontend retries, HMR
    // reloads, React StrictMode double-invocations) don't re-run the pipeline.
    // Cache key is keyed by content identity and variantId — clientIp is excluded
    // because all stream URLs are already proxied through this server.
    const pipelineCacheKey = `pipeline:${type}:${tmdbId}:${season}:${episode}:${variantId || 'default'}`;
    const cachedResult = cache.get(pipelineCacheKey);
    if (cachedResult) {
      logger.info(`[Pipeline] Cache HIT for TMDB ${tmdbId} (${type} S${season}E${episode} var:${variantId || 'default'}) — returning cached result via: ${cachedResult.selectedProvider}`);
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
        // Reuse cached individual provider stream if it exists (e.g. from Details availability check)
        const streamCacheKey = `stream:${provider.name}:${type}:${tmdbId}:${season}:${episode}:${variantId || 'default'}:${clientIp || 'default'}`;
        let streamData = cache.get(streamCacheKey);

        if (streamData) {
          if (streamData.expires) {
            const nowSec = Math.floor(Date.now() / 1000);
            if (streamData.expires - nowSec < 60) {
              logger.info(`[Pipeline] Cached stream for provider ${provider.displayName} is expiring soon. Evicting.`);
              cache.del(streamCacheKey);
              streamData = null;
            }
          }
        }

        if (streamData) {
          logger.info(`[Pipeline] Cache HIT for provider stream: ${provider.displayName}`);
        } else {
          streamData = await provider.stream(tmdbId, type, season, episode, variantId, clientIp);
        }

        entry.responseTimeMs = Date.now() - providerStart;

        const isPlayable = streamData && (
          streamData.streamUrl ||
          (streamData.qualities && streamData.qualities.length > 0) ||
          (streamData.streamType === 'embed' && streamData.embedUrl)
        );

        if (isPlayable) {
          streamData = await parseAndEnrichHls(streamData);
          entry.result = 'success';
          pipelineLog.push(entry);

          // Pre-cache the individual provider stream result
          let ttl = 1800;
          if (streamData.expires) {
            const nowSec = Math.floor(Date.now() / 1000);
            ttl = Math.max(0, streamData.expires - myTtlFix(streamData.expires, nowSec));
          }
          function myTtlFix(exp, now) {
            return now + 60;
          }
          const actualTtl = streamData.expires ? Math.max(0, streamData.expires - Math.floor(Date.now() / 1000) - 60) : 1800;
          if (actualTtl > 0) cache.set(streamCacheKey, streamData, actualTtl);

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
          if (actualTtl > 0) cache.set(pipelineCacheKey, resolvedResult, actualTtl);

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

  // ─── resolveDownload (SEQUENTIAL DOWNLOAD PIPELINE) ──────────────────────────

  /**
   * Backend-controlled sequential pipeline for download stream resolution.
   *
   * Mirrors resolveStream() exactly — same provider order, same rules —
   * but skips providers that are embed-only (no direct CDN URLs).
   *
   * Rules:
   *  - Always tries NetMirror first (download() not supported by Peachify).
   *  - Peachify is embed-only: its download() throws NotSupported → skip.
   *  - Returns the first provider that yields downloadable qualities.
   *  - If ALL providers fail, returns { available: false }.
   *
   * ARCHITECTURE RULE: This is the ONLY place allowed to decide which
   * provider handles a download request. No controller, no frontend,
   * no utility may make this decision.
   *
   * @param {string|number} tmdbId
   * @param {'movie'|'tv'} type
   * @param {number} season
   * @param {number} episode
   * @param {string|null} variantId
   * @returns {Promise<Object>} Normalized stream data or { available: false }
   */
  async resolveDownload(tmdbId, type, season = 1, episode = 1, variantId = null) {
    const providers = this.getSortedProviders();

    logger.info(`[DownloadP] Starting sequential download resolution for TMDB ${tmdbId} (${type} S${season}E${episode}) — ${providers.length} provider(s) in queue`);

    if (providers.length === 0) {
      logger.warn('[DownloadP] No registered providers found.');
      return { available: false, reason: 'No providers registered' };
    }

    for (const provider of providers) {
      logger.info(`[DownloadP] → Checking provider: ${provider.displayName} for TMDB ${tmdbId}`);
      try {
        const downloadData = await provider.download(tmdbId, type, season, episode, variantId);

        const hasDirectStreams = downloadData && (
          downloadData.streamUrl ||
          (downloadData.qualities && downloadData.qualities.length > 0)
        );

        if (hasDirectStreams) {
          logger.info(`[DownloadP] ✓ RESOLVED via ${provider.displayName}`);
          return {
            ...downloadData,
            selectedProvider: provider.name,
            available: true,
          };
        } else {
          logger.warn(`[DownloadP] ✗ ${provider.displayName} returned no downloadable streams. Continuing...`);
        }
      } catch (err) {
        // Embed-only providers (Peachify) throw NotSupported — expected, skip silently.
        logger.warn(`[DownloadP] ✗ ${provider.displayName} skipped: ${err.message}. Continuing to next provider...`);
      }
    }

    logger.warn(`[DownloadP] All providers exhausted for TMDB ${tmdbId}. No download stream available.`);
    return {
      available: false,
      reason: 'No provider supports direct download for this title',
    };
  }
}

// Export as a singleton
module.exports = new ProviderManager();
