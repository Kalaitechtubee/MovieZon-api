const fs = require('fs');
const path = require('path');
const axios = require('axios');
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
    this.variantToTmdb = new Map(); // variant ID -> { tmdbId, type } mapping
    this.initializeCaptureData();
    this.loadDynamicVariants();
    this.initializeProxy();
  }

  /**
   * Parse PROXY_URL for connectivity checks
   */
  initializeProxy() {
    this.proxyConfig = null;
    // Outgoing proxy is disabled globally to prevent connection blocks and routing issues.
  }

  /**
   * Resolve a variant ID back to the TMDB ID
   */
  resolveTmdbId(id) {
    const mapping = this.variantToTmdb.get(String(id));
    return mapping ? mapping.tmdbId : id;
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

          // Extract variant to TMDB ID mappings
          try {
            const urlObj = new URL(req.url.startsWith('http') ? req.url : `https://net27.cc${req.url}`);
            const match = urlObj.pathname.match(/\/api\/variants-tmdb\/(movie|tv)\/(\d+)/);
            if (match) {
              const mediaType = match[1];
              const tmdbId = match[2];
              const resObj = JSON.parse(req.responseBody);
              
              const registerVariant = (vId) => {
                if (vId) {
                  this.variantToTmdb.set(String(vId), { tmdbId, type: mediaType });
                }
              };

              if (resObj.defaultSubjectId) {
                registerVariant(resObj.defaultSubjectId);
              }
              if (resObj.variants && Array.isArray(resObj.variants)) {
                resObj.variants.forEach(v => {
                  registerVariant(v.dubSubjectId);
                  registerVariant(v.id);
                });
              }
            }
          } catch (e) {
            // ignore malformed URLs or JSON
          }

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
   * Helper to fetch NetMirror URLs, falling back to a Cloudflare Worker proxy if the direct request fails
   */
  async netmirrorGet(url, options = {}) {
    try {
      return await httpClient.get(url, options);
    } catch (err) {
      logger.warn(`[NetMirror] Direct request failed for: ${url}. Error: ${err.message}. Retrying via Cloudflare Worker proxy...`);
      const proxyUrl = `https://streamhub-proxy.1545zoya.workers.dev/?url=${encodeURIComponent(url)}`;
      try {
        const res = await httpClient.get(proxyUrl, options);
        logger.info(`[NetMirror Proxy] Successfully fetched via Cloudflare Worker proxy: ${url}`);
        return res;
      } catch (proxyErr) {
        logger.error(`[NetMirror Proxy] Proxy request also failed: ${proxyErr.message}`);
        throw err; // throw the original error
      }
    }
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
      const data = await this.netmirrorGet(detailUrl);
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
  async stream(id, type, season = 1, episode = 1, variantId = null, clientIp = null) {
    logger.debug(`[NetMirror] stream() called for ID: ${id}, Type: ${type}, Season: ${season}, Episode: ${episode}, Variant: ${variantId}, Client IP: ${clientIp}`);
    
    let resolvedId = id;
    let resolvedType = type;
    const mapping = this.variantToTmdb.get(String(id));
    if (mapping) {
      resolvedId = mapping.tmdbId;
      resolvedType = mapping.type || type;
      variantId = id; // use the original variant ID that was passed as Route ID
      logger.info(`[NetMirror] Resolved variant/dub ID ${id} -> TMDB ID ${resolvedId} (${resolvedType})`);
    }

    const variantsUrl = `${config.netmirror.baseUrl}/api/variants-tmdb/${resolvedType}/${resolvedId}?se=${season}&ep=${episode}`;
    let variantsData = null;

    // Construct headers for forwarding client IP to avoid IP-mismatched signatures
    const requestOptions = {};
    if (clientIp) {
      requestOptions.headers = {
        'X-Forwarded-For': clientIp,
        'X-Real-IP': clientIp
      };
    }

    // 1. Get variants
    try {
      variantsData = await this.netmirrorGet(variantsUrl, requestOptions);

      // Treat empty or missing variants array as a lookup failure → fall back to capture
      const liveVariants = variantsData && variantsData.variants;
      if (!variantsData || !variantsData.ok || !liveVariants || liveVariants.length === 0) {
        throw new Error(`Live API returned empty variants list for ID ${resolvedId}`);
      }
    } catch (err) {
      logger.warn(`[NetMirror] Live variants lookup failed or returned empty. Falling back to capture. Reason: ${err.message}`);
      variantsData = this.getCapturedResponse(variantsUrl);
    }

    if (!variantsData || !variantsData.ok) {
      // --- DIRECT EMBED FALLBACK ---
      // Some titles (e.g. Amaran/927342) have variants:[] on net27.cc but are still
      // streamable via a direct embed-tmdb call (served through Peachify or similar).
      logger.info(`[NetMirror] No variants for ID ${resolvedId}. Attempting direct embed without variant...`);
      const directEmbedUrl = `${config.netmirror.baseUrl}/api/embed-tmdb/${resolvedId}?type=${resolvedType}&se=${season}&ep=${episode}`;
      let directEmbedData = null;

      try {
        directEmbedData = await this.netmirrorGet(directEmbedUrl, requestOptions);
        if (!directEmbedData || !directEmbedData.ok) {
          throw new Error('Direct embed returned non-ok');
        }
      } catch (err) {
        logger.warn(`[NetMirror] Direct embed live request failed. Trying capture. Reason: ${err.message}`);
        directEmbedData = this.getCapturedResponse(directEmbedUrl);
      }

      if (directEmbedData && directEmbedData.ok) {
        logger.info(`[NetMirror] Direct embed succeeded for ID ${resolvedId}`);
        const normalized = normalizeNetMirrorStream(directEmbedData);
        if (normalized) {
          normalized.variants = [];
        }
        return normalized;
      }

      throw new Error(`Could not retrieve variants for ID ${resolvedId} (Season ${season}, Episode ${episode})`);
    }

    // Dynamically register live variants to TMDB ID map
    try {
      let registeredAny = false;
      const registerVariant = (vId) => {
        if (vId && !this.variantToTmdb.has(String(vId))) {
          this.variantToTmdb.set(String(vId), { tmdbId: resolvedId, type: resolvedType });
          registeredAny = true;
        }
      };

      if (variantsData.defaultSubjectId) {
        registerVariant(variantsData.defaultSubjectId);
      }
      if (variantsData.variants && Array.isArray(variantsData.variants)) {
        variantsData.variants.forEach(v => {
          registerVariant(v.dubSubjectId);
          registerVariant(v.id);
        });
      }

      if (registeredAny) {
        this.saveDynamicVariants();
      }
    } catch (e) {
      logger.debug(`[NetMirror] Failed to dynamically register variants: ${e.message}`);
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
      throw new Error(`No stream variants available for ID ${resolvedId}`);
    }

    logger.debug(`[NetMirror] Selected variant ID: ${targetVariant}`);

    // 3. Get stream embed details
    const embedUrl = `${config.netmirror.baseUrl}/api/embed-tmdb/${resolvedId}?type=${resolvedType}&se=${season}&ep=${episode}&dub=${targetVariant}`;
    let embedData = null;

    try {
      embedData = await this.netmirrorGet(embedUrl, requestOptions);
    } catch (err) {
      logger.warn(`[NetMirror] Live request failed for embed. Falling back to capture. Error: ${err.message}`);
      embedData = this.getCapturedResponse(embedUrl);
    }

    if (!embedData || !embedData.ok) {
      throw new Error(`Could not retrieve streaming embed data for ID ${resolvedId} with variant ${targetVariant}`);
    }

    const variants = (variantsData.variants || []).map(v => ({
      id: String(v.dubSubjectId || v.id),
      language: v.language || 'Default'
    }));

    // 4. Normalize and return
    const normalized = normalizeNetMirrorStream(embedData);
    if (normalized) {
      normalized.variants = variants;

      // Programmatically check if the signature is expired
      if (normalized.expires) {
        const nowSec = Math.floor(Date.now() / 1000);
        if (normalized.expires - nowSec < 60) {
          logger.warn(`[NetMirror] Stream URL signature is expired or expiring soon (expires at ${new Date(normalized.expires * 1000).toISOString()}). Discarding NetMirror stream.`);
          throw new Error('Stream signature expired');
        }
      }

      // Check stream URL connectivity to make sure we don't serve a 403 Forbidden link.
      // IMPORTANT: hakunaymatata.com CDN tokens are IP-signed for THIS server's IP (clientIp=null).
      // We must fetch directly (NOT via a Cloudflare Worker proxy) so the requesting IP matches
      // the signed token IP. Using a CF Worker introduces a different IP → 403.
      const testUrl = normalized.streamUrl || (normalized.qualities && normalized.qualities[0] && normalized.qualities[0].url);
      if (testUrl) {
        logger.info(`[NetMirror] Testing stream URL connectivity for ID ${resolvedId}...`);

        try {
          const axiosOptions = {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Referer': `${config.netmirror.baseUrl}/`,
              'Range': 'bytes=0-10'
            },
            timeout: 5000,
            validateStatus: false
          };

          // Fetch directly — no CF Worker wrapper. The CDN token is signed for this server's IP.
          const res = await axios.get(testUrl, axiosOptions);

          if (res.status === 403 || res.status === 404) {
            logger.warn(`[NetMirror] Stream URL check returned ${res.status} (token expired or IP mismatch). Discarding stream.`);
            // Throw unconditionally so cross-provider fallback activates in both dev and prod.
            throw new Error(`Stream CDN returned ${res.status} - token expired or IP mismatch`);
          } else {
            logger.info(`[NetMirror] Stream URL verified OK (Status: ${res.status}).`);
          }
        } catch (err) {
          logger.warn(`[NetMirror] Stream connectivity check failed: ${err.message}. Discarding stream.`);
          throw err; // Always throw — let apiController try Peachify fallback
        }
      }
    }
    return normalized;
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

  /**
   * Load dynamic variants mapping on startup
   */
  loadDynamicVariants() {
    const filePath = path.resolve(config.netmirror.fallbackFile, '../dynamic-variants.json');
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(raw);
        Object.keys(data).forEach(vId => {
          this.variantToTmdb.set(vId, data[vId]);
        });
        logger.info(`Loaded ${Object.keys(data).length} dynamic variant mapping(s) from ${filePath}`);
      }
    } catch (e) {
      logger.warn(`Failed to load dynamic variants: ${e.message}`);
    }
  }

  /**
   * Save dynamic variants mapping
   */
  saveDynamicVariants() {
    const filePath = path.resolve(config.netmirror.fallbackFile, '../dynamic-variants.json');
    try {
      const obj = {};
      this.variantToTmdb.forEach((val, key) => {
        obj[key] = val;
      });
      fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf8');
    } catch (e) {
      logger.warn(`Failed to save dynamic variants: ${e.message}`);
    }
  }
}

module.exports = NetMirrorProvider;
