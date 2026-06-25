const axios = require('axios');
const logger = require('../../logger');
const { URL } = require('url');
const config = require('../../config');

const DEFAULT_HEADERS = {
  'Referer': 'https://nextgencloudfabric.com/',
  'Origin': 'https://nextgencloudfabric.com/',
  'X-Requested-With': 'XMLHttpRequest',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

/**
 * Fetch helper for streamdata API with Cloudflare Worker proxy fallback.
 */
async function streamimdbGet(url, options = {}) {
  const reqHeaders = {
    ...DEFAULT_HEADERS,
    ...(options.headers || {})
  };
  
  try {
    return await axios.get(url, {
      ...options,
      headers: reqHeaders,
      timeout: options.timeout || 6000
    });
  } catch (err) {
    logger.warn(`[StreamIMDb] Direct request failed for ${url}: ${err.message}. Retrying via Cloudflare Worker proxy...`);
    const proxyUrl = `${config.workerProxyUrl}/?url=${encodeURIComponent(url)}&headers=${encodeURIComponent(JSON.stringify(reqHeaders))}`;
    try {
      const res = await axios.get(proxyUrl, { timeout: (options.timeout || 6000) + 2000 });
      logger.info(`[StreamIMDb Proxy] Successfully fetched via Cloudflare Worker proxy: ${url}`);
      return res;
    } catch (proxyErr) {
      logger.error(`[StreamIMDb Proxy] Cloudflare Worker proxy also failed: ${proxyErr.message}`);
      throw err; // throw original error
    }
  }
}

/**
 * Parse HLS master playlist to extract quality levels.
 * Moved here from parser.js to avoid circular dependency.
 */
async function parseQualitiesFromMaster(masterUrl, requestHeaders = {}) {
  const headers = {
    ...DEFAULT_HEADERS,
    ...requestHeaders
  };

  try {
    logger.info(`[StreamIMDb Parser] Parsing master playlist: ${masterUrl}`);
    const response = await axios.get(masterUrl, {
      headers,
      timeout: 5000
    });

    const playlistText = response.data;
    if (typeof playlistText !== 'string') return [];

    const qualities = [];
    const urlObj = new URL(masterUrl);
    const origin = urlObj.origin;

    const lines = playlistText.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('#EXT-X-STREAM-INF:')) {
        // Extract height resolution (e.g., RESOLUTION=1280x720)
        let qStr = '1080p';
        const resMatch = line.match(/RESOLUTION=(\d+x\d+)/i);
        if (resMatch) {
          const height = resMatch[1].split('x')[1];
          if (height) {
            qStr = `${height}p`;
          }
        }

        // Next line contains the URL path
        const nextLine = lines[i + 1]?.trim();
        if (nextLine && !nextLine.startsWith('#')) {
          let variantUrl = nextLine;
          if (variantUrl.startsWith('/')) {
            variantUrl = origin + variantUrl;
          } else if (!variantUrl.startsWith('http')) {
            const basePath = masterUrl.substring(0, masterUrl.lastIndexOf('/') + 1);
            variantUrl = basePath + variantUrl;
          }
          qualities.push({
            quality: qStr,
            url: variantUrl,
            headers
          });
        }
      }
    }
    return qualities;
  } catch (err) {
    logger.warn(`[StreamIMDb Parser] Failed to parse qualities from master: ${err.message}`);
    return [];
  }
}

module.exports = {
  streamimdbGet,
  DEFAULT_HEADERS,
  parseQualitiesFromMaster
};
