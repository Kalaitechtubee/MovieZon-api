const BaseProvider = require('../BaseProvider');
const { normalizeStream } = require('../../utils/normalizer');

class VidSrcSbsProvider extends BaseProvider {
  constructor() {
    super('vidsrc-sbs');
    this.displayName = 'VidSrc SBS';
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
    const isTv = type === 'tv';
    let embedUrl = '';
    if (isTv) {
      embedUrl = `https://vidsrc.sbs/embed/tv/${id}/${season}/${episode}/`;
    } else {
      embedUrl = `https://vidsrc.sbs/embed/movie/${id}/`;
    }

    return normalizeStream({
      provider: 'vidsrc-sbs',
      streamType: 'embed',
      embedUrl: embedUrl,
      embedFallbacks: [embedUrl]
    }, 'vidsrc-sbs');
  }

  async health() {
    return {
      status: 'healthy',
      message: 'VidSrc SBS is healthy',
      responseTimeMs: 0
    };
  }
}

module.exports = VidSrcSbsProvider;
