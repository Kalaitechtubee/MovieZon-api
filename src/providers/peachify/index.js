const BaseProvider = require('../BaseProvider');
const logger = require('../../logger');
const { normalizeCatalogItem, normalizeStream } = require('../../utils/normalizer');
const { getEmbedUrl } = require('./player');
const { peachifyGet } = require('./utils');
const { dD } = require('./parser');

class PeachifyProvider extends BaseProvider {
  constructor() {
    super('peachify');
  }

  get downloadSupported() {
    return true;
  }

  /**
   * Search - not directly supported by Peachify; always returns empty.
   */
  async search(query) {
    return [];
  }

  /**
   * Details - stub implementation (enriched by TMDB details later in provider manager)
   */
  async details(id, type) {
    return normalizeCatalogItem({
      tmdbId: id,
      id: String(id),
      title: '',
      type: type || 'movie'
    }, 'peachify');
  }

  /**
   * Fast existence check. Peachify supports embed player if title has metadata.
   */
  async exists(id, type) {
    return true;
  }

  /**
   * Helper request utility required by integration tests
   */
  async peachifyGet(url, options = {}) {
    return await peachifyGet(url, options);
  }

  /**
   * Stream - returns the Peachify embed iframe video player
   */
  async stream(id, type = 'movie', season = 1, episode = 1, variantId = null, clientIp = null) {
    logger.debug(`[Peachify] stream() called for ID: ${id}, Type: ${type}, S${season}E${episode}`);
    
    const embedInfo = getEmbedUrl(id, type, season, episode);

    return normalizeStream({
      provider: 'peachify',
      drm: false,
      streamUrl: '',
      embedUrl: embedInfo.embedUrl,
      embedFallbacks: embedInfo.embedFallbacks,
      streamType: 'embed',
      subtitles: [],
      headers: {},
      qualities: [],
      variants: [],
      expires: null
    }, 'peachify');
  }

  /**
   * Scrapes direct stream urls by checking the 5 eat-peach scraper APIs and decrypting their payloads.
   */
  async _scrapeDirectStream(id, type, season = 1, episode = 1) {
    const keyHex = "a8f2a1b5e9c470814f6b2c3a5d8e7f9c1a2b3c4d5e3f7a8b8cad1e2d0a4d5c5d";
    const engines = [
      { label: "Iron", path: "moviebox", apis: ["https://uwu.eat-peach.sbs"] },
      { label: "Spider", path: "holly", apis: ["https://usa.eat-peach.sbs"] },
      { label: "Wolf", path: "air", apis: ["https://usa.eat-peach.sbs"] },
      { label: "Multi", path: "multi", apis: ["https://usa.eat-peach.sbs"] },
      { label: "Dark", path: "net", apis: ["https://uwu.eat-peach.sbs"] }
    ];

    for (const engine of engines) {
      for (const api of engine.apis) {
        let url = "";
        if (type === 'tv') {
          url = `${api}/${engine.path}/tv/${id}/${season}/${episode}`;
        } else {
          url = `${api}/${engine.path}/movie/${id}`;
        }

        logger.info(`[Peachify Scraper] Querying ${engine.label} API: ${url}`);
        try {
          const res = await peachifyGet(url, {
            timeout: 6000,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Referer': 'https://peachify.top/'
            }
          });

          if (res && res.data && res.data.isEncrypted) {
            logger.info(`[Peachify Scraper] Found encrypted data from ${engine.label}. Decrypting...`);
            const decrypted = await dD(res.data.data, keyHex);
            if (decrypted) {
              const results = decrypted.results || decrypted;
              if (results.sources || results.qualities || results.streamUrl || results.url) {
                logger.info(`[Peachify Scraper] Successfully decrypted streams from ${engine.label}`);
                return results;
              }
            }
          } else if (res && res.data) {
            const results = res.data.results || res.data;
            if (results.sources || results.qualities || results.streamUrl || results.url) {
              logger.info(`[Peachify Scraper] Found plain results from ${engine.label}`);
              return results;
            }
          }
        } catch (err) {
          logger.warn(`[Peachify Scraper] Failed to scrape ${engine.label} via ${url}: ${err.message}`);
        }
      }
    }
    return null;
  }

  /**
   * Resolves direct MP4 download links for Peachify by scraping direct video components.
   */
  async download(id, type, season = 1, episode = 1, variantId = null) {
    logger.info(`[Peachify] download() called for ID: ${id}, Type: ${type}, S${season}E${episode}`);
    const directData = await this._scrapeDirectStream(id, type, season, episode);

    if (!directData) {
      throw new Error(`Failed to resolve any direct stream for download.`);
    }

    let qualities = [];
    if (directData.sources && Array.isArray(directData.sources)) {
      qualities = directData.sources.map(q => {
        let qStr = '720p';
        if (q.quality) {
          const val = String(q.quality);
          qStr = val.endsWith('p') ? val : `${val}p`;
        }
        if (q.dub) {
          qStr = `${q.dub} ${qStr}`;
        }
        return {
          quality: qStr,
          url: q.url,
          headers: q.headers || directData.headers
        };
      });
    } else if (directData.qualities && Array.isArray(directData.qualities)) {
      qualities = directData.qualities.map(q => {
        let qStr = '720p';
        if (q.quality) {
          const val = String(q.quality);
          qStr = val.endsWith('p') ? val : `${val}p`;
        }
        return {
          quality: qStr,
          url: q.url,
          headers: q.headers || directData.headers
        };
      });
    } else if (directData.streamUrl) {
      qualities.push({
        quality: 'auto',
        url: directData.streamUrl,
        headers: directData.headers
      });
    }

    if (qualities.length === 0) {
      throw new Error(`Decrypted payload contains no valid download URLs.`);
    }

    const headers = directData.headers || {
      'Referer': 'https://peachify.top/',
      'Origin': 'https://peachify.top',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    };

    return {
      provider: 'peachify',
      selectedProvider: 'peachify',
      available: true,
      qualities,
      headers
    };
  }

  /**
   * Health check - verify Peachify is reachable
   */
  async health() {
    const startTime = Date.now();
    try {
      // Use helper peachifyGet to test peachify connection
      await peachifyGet('https://peachify.top', { timeout: 5000 });
      const duration = Date.now() - startTime;
      return { status: 'healthy', message: 'Peachify reachable', responseTimeMs: duration };
    } catch (err) {
      const duration = Date.now() - startTime;
      const status = err.response && [403, 429].includes(err.response.status) ? 'degraded' : 'unhealthy';
      return { status, message: `Peachify unreachable: ${err.message}`, responseTimeMs: duration };
    }
  }
}

module.exports = PeachifyProvider;
