const BaseProvider = require('../BaseProvider');
const axios = require('axios');
const stream = require('./stream');
const download = require('./download');

class VidSrcProvider extends BaseProvider {
  constructor() {
    super('vidsrc');
  }

  // VidSrc attempts direct stream extraction — if it gets an HLS URL, download is supported.
  // We mark this true so the download pipeline tries; download.js returns false internally if unavailable.
  get downloadSupported() {
    return true;
  }

  async search(query) {
    return [];
  }

  async details(id, type) {
    return null;
  }

  async exists(id, type) {
    return true;
  }

  async stream(id, type = 'movie', season = 1, episode = 1, variantId = null, clientIp = null) {
    return await stream(id, type, season, episode, variantId, clientIp);
  }

  async download(id, type, season = 1, episode = 1, variantId = null) {
    return await download(id, type, season, episode, variantId);
  }

  async health() {
    const startTime = Date.now();
    try {
      const res = await axios.get('https://vidsrc-embed.ru', {
        timeout: 5000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Referer': 'https://vidsrc-embed.ru'
        }
      });
      const duration = Date.now() - startTime;
      // Embed providers are always considered at least degraded (not unhealthy)
      // since the embed resolves client-side even if the server can't reach it directly.
      const httpOk = res.status >= 200 && res.status < 400;
      return {
        status: httpOk ? 'healthy' : 'degraded',
        message: httpOk ? 'VidSrc reachable' : `VidSrc returned status ${res.status}`,
        responseTimeMs: duration
      };
    } catch (err) {
      const duration = Date.now() - startTime;
      // Always return 'degraded' (not 'unhealthy') for embed providers so the pipeline
      // doesn't skip them — embed URLs resolve in the browser, not the backend.
      return {
        status: 'degraded',
        message: `VidSrc degraded: ${err.message}`,
        responseTimeMs: duration
      };
    }
  }
}

module.exports = VidSrcProvider;
