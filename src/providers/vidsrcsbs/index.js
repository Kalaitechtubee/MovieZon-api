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
    let f1 = '';
    let f2 = '';
    let f3 = '';

    if (isTv) {
      embedUrl = `https://vidsrc.sbs/embed/tv/${id}/${season}/${episode}/`;
      f1 = `https://vidsrc.pro/embed/tv/${id}/${season}/${episode}/`;
      f2 = `https://vidsrc.cc/embed/tv/${id}/${season}/${episode}/`;
      f3 = `https://vidsrc.to/embed/tv/${id}/${season}/${episode}/`;
    } else {
      embedUrl = `https://vidsrc.sbs/embed/movie/${id}/`;
      f1 = `https://vidsrc.pro/embed/movie/${id}/`;
      f2 = `https://vidsrc.cc/embed/movie/${id}/`;
      f3 = `https://vidsrc.to/embed/movie/${id}/`;
    }

    return normalizeStream({
      provider: 'vidsrc-sbs',
      streamType: 'embed',
      embedUrl: embedUrl,
      embedFallbacks: [embedUrl, f1, f2, f3]
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
