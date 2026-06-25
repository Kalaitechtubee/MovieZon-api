const BaseProvider = require('../BaseProvider');
const axios = require('axios');
const stream = require('./stream');
const download = require('./download');

class EmbedSuProvider extends BaseProvider {
  constructor() {
    super('embedsu');
  }

  get downloadSupported() {
    return false;
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
      const res = await axios.get('https://embed.su', {
        timeout: 4000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://embed.su'
        }
      });
      const duration = Date.now() - startTime;
      return { 
        status: 'healthy', 
        message: 'EmbedSU reachable', 
        responseTimeMs: duration 
      };
    } catch (err) {
      const duration = Date.now() - startTime;
      // Always 'degraded' (not 'unhealthy') — embed URLs resolve client-side
      return { 
        status: 'degraded', 
        message: `EmbedSU unreachable from server (embed still works client-side): ${err.message}`, 
        responseTimeMs: duration 
      };
    }
  }
}

module.exports = EmbedSuProvider;
