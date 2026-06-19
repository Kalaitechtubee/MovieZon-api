const fs = require('fs');
const path = require('path');
const BaseProvider = require('../BaseProvider');
const httpClient = require('../../utils/httpClient');
const config = require('../../config');
const logger = require('../../logger');
const { normalizeNetMirrorItem, normalizeNetMirrorStream } = require('./normalizer');

class NetMirrorProvider extends BaseProvider {
  constructor() {
    super('netmirror');
    this.fallbackMap = new Map();
    this.catalogItems = new Map(); // local DB of unique titles for search
    this.initializeCaptureData();
  }

  /**
   * Helper to normalize URLs for map lookup (ignoring protocol/domain, sorting query parameters)
   */
  getUrlKey(urlStr) {
    if (!urlStr) return '';
    try {
      // Handle relative URLs
      const absoluteUrl = urlStr.startsWith('http') ? urlStr : `https://net27.cc${urlStr}`;
      const url = new URL(absoluteUrl);
      const pathname = url.pathname;
      
      // Sort query parameters alphabetically to ensure deterministic lookup
      const params = Array.from(url.searchParams.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .filter(([k]) => k !== 't' && k !== 'sign'); // remove signature tokens that change over time
        
      const paramStr = params.map(([k, v]) => `${k}=${v}`).join('&');
      return `${pathname}${paramStr ? '?' + paramStr : ''}`;
    } catch (e) {
      return urlStr;
    }
  }

  /**
   * Load the capture JSON file and populate lookups
   */
  initializeCaptureData() {
    const filePath = config.netmirror.fallbackFile;
    logger.info(`Loading NetMirror capture fallback data from: ${filePath}`);

    try {
      if (!fs.existsSync(filePath)) {
        logger.warn(`NetMirror capture file not found at ${filePath}. Fallback mode will be unavailable.`);
        return;
      }

      const raw = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(raw);

      if (!data.requests || !Array.isArray(data.requests)) {
        logger.warn('NetMirror capture file does not contain a valid requests array.');
        return;
      }

      let indexedCount = 0;
      data.requests.forEach(req => {
        if (req.url && req.responseBody && req.status === 200) {
          const key = this.getUrlKey(req.url);
          this.fallbackMap.set(key, req.responseBody);
          indexedCount++;

          // Extract search items
          try {
            const resObj = JSON.parse(req.responseBody);
            
            const addSearchItem = (item) => {
              if (!item || !item.tmdbId) return;
              const id = String(item.tmdbId);
              if (!this.catalogItems.has(id)) {
                this.catalogItems.set(id, {
                  tmdbId: item.tmdbId,
                  imdbId: item.imdbId || item.imdb || null,
                  title: item.title,
                  originalTitle: item.originalTitle || item.title,
                  year: item.year,
                  type: item.type || 'movie',
                  poster: item.poster,
                  backdrop: item.backdrop,
                  rating: item.rating,
                  overview: item.overview
                });
              }
            };

            if (resObj.items && Array.isArray(resObj.items)) {
              resObj.items.forEach(addSearchItem);
            }
            if (resObj.hero && Array.isArray(resObj.hero)) {
              resObj.hero.forEach(addSearchItem);
            }
            if (resObj.rails && Array.isArray(resObj.rails)) {
              resObj.rails.forEach(rail => {
                if (rail.items && Array.isArray(rail.items)) {
                  rail.items.forEach(addSearchItem);
                }
              });
            }
          } catch (e) {
            // Failed to parse response body as JSON (e.g. srt files), ignore for catalog search
          }
        }
      });

      logger.info(`Successfully indexed ${indexedCount} response(s) and ${this.catalogItems.size} search item(s) from capture.`);
    } catch (err) {
      logger.error(`Failed to initialize NetMirror capture data: ${err.message}`, err);
    }
  }

  /**
   * Helper to retrieve response from capture file if network fails
   */
  getCapturedResponse(url) {
    const key = this.getUrlKey(url);
    const cached = this.fallbackMap.get(key);
    if (cached) {
      logger.info(`[NetMirror Fallback] Serving captured response for: ${key}`);
      return JSON.parse(cached);
    }
    logger.warn(`[NetMirror Fallback] No captured response found for key: ${key}`);
    return null;
  }

  /**
   * search method
   */
  async search(query) {
    logger.debug(`[NetMirror] search() called with query: ${query}`);
    const qLower = query.toLowerCase().trim();
    
    // Search local database extracted from capture file
    const matches = [];
    for (const item of this.catalogItems.values()) {
      const titleMatch = item.title && item.title.toLowerCase().includes(qLower);
      const overviewMatch = item.overview && item.overview.toLowerCase().includes(qLower);
      
      if (titleMatch || overviewMatch) {
        matches.push(normalizeNetMirrorItem(item));
      }
    }
    
    logger.debug(`[NetMirror] Search matched ${matches.length} item(s) locally`);
    return matches;
  }

  /**
   * details method
   */
  async details(id, type) {
    logger.debug(`[NetMirror] details() called for ID: ${id}, Type: ${type}`);
    const detailUrl = `${config.netmirror.baseUrl}/api/catalog/title/${type}/${id}`;

    try {
      // 1. Try real HTTP request
      const data = await httpClient.get(detailUrl);
      if (data && data.ok) {
        data.tmdbId = data.tmdbId || id;
        return normalizeNetMirrorItem(data);
      }
      throw new Error('Provider returned non-success JSON');
    } catch (err) {
      logger.warn(`[NetMirror] Live request failed for details. Falling back to capture data. Error: ${err.message}`);
      
      // 2. Fallback to capture
      const captured = this.getCapturedResponse(detailUrl);
      if (captured) {
        captured.tmdbId = captured.tmdbId || id;
        return normalizeNetMirrorItem(captured);
      }
      
      // 3. Fallback to catalog items database
      const localItem = this.catalogItems.get(String(id));
      if (localItem) {
        logger.info(`[NetMirror] Serving basic details from catalog db for ID: ${id}`);
        return normalizeNetMirrorItem(localItem);
      }
      
      throw new Error(`Details for ID ${id} not found in live API or local capture.`);
    }
  }

  /**
   * stream method
   */
  async stream(id, type, season = 1, episode = 1, variantId = null) {
    logger.debug(`[NetMirror] stream() called for ID: ${id}, Type: ${type}, Season: ${season}, Episode: ${episode}, Variant: ${variantId}`);
    
    const variantsUrl = `${config.netmirror.baseUrl}/api/variants-tmdb/${type}/${id}?se=${season}&ep=${episode}`;
    let variantsData = null;

    // 1. Get variants
    try {
      variantsData = await httpClient.get(variantsUrl);
    } catch (err) {
      logger.warn(`[NetMirror] Live request failed for variants. Falling back to capture. Error: ${err.message}`);
      variantsData = this.getCapturedResponse(variantsUrl);
    }

    if (!variantsData || !variantsData.ok) {
      throw new Error(`Could not retrieve variants for ID ${id} (Season ${season}, Episode ${episode})`);
    }

    // 2. Select target variant ID
    let targetVariant = variantId;
    if (!targetVariant) {
      if (variantsData.defaultSubjectId) {
        targetVariant = variantsData.defaultSubjectId;
      } else if (variantsData.variants && variantsData.variants.length > 0) {
        // Prefer Tamil or Hindi or English dub/sub if available, otherwise grab the first
        const pref = variantsData.variants.find(v => 
          v.language.toLowerCase().includes('hindi') || 
          v.language.toLowerCase().includes('tamil') ||
          v.language.toLowerCase().includes('english')
        );
        targetVariant = pref ? pref.dubSubjectId : variantsData.variants[0].dubSubjectId;
      }
    }

    if (!targetVariant) {
      throw new Error(`No stream variants available for ID ${id}`);
    }

    logger.debug(`[NetMirror] Selected variant ID: ${targetVariant}`);

    // 3. Get stream embed details
    const embedUrl = `${config.netmirror.baseUrl}/api/embed-tmdb/${id}?type=${type}&se=${season}&ep=${episode}&dub=${targetVariant}`;
    let embedData = null;

    try {
      embedData = await httpClient.get(embedUrl);
    } catch (err) {
      logger.warn(`[NetMirror] Live request failed for embed. Falling back to capture. Error: ${err.message}`);
      embedData = this.getCapturedResponse(embedUrl);
    }

    if (!embedData || !embedData.ok) {
      throw new Error(`Could not retrieve streaming embed data for ID ${id} with variant ${targetVariant}`);
    }

    // 4. Normalize and return
    return normalizeNetMirrorStream(embedData);
  }

  /**
   * health check method
   */
  async health() {
    const startTime = Date.now();
    try {
      // Ping homepage to verify server is reachable
      await httpClient.get(config.netmirror.baseUrl, { timeout: 3000, retries: 0 });
      const duration = Date.now() - startTime;
      return {
        status: 'healthy',
        message: 'Reachable',
        responseTimeMs: duration
      };
    } catch (err) {
      const duration = Date.now() - startTime;
      
      // If server is rate-limited (429) or Cloudflare-blocked (403), we report it as degraded
      const status = err.response && [403, 429].includes(err.response.status) ? 'degraded' : 'unhealthy';
      
      return {
        status,
        message: `HTTP connection failed: ${err.message}`,
        responseTimeMs: duration
      };
    }
  }
}

module.exports = NetMirrorProvider;
