const axios = require('axios');
const logger = require('../../logger');
const { normalizeStream } = require('../../utils/normalizer');
const config = require('../../config');

async function vidsrcGet(url, options = {}) {
  try {
    return await axios.get(url, { ...options, timeout: options.timeout || 7000 });
  } catch (err) {
    logger.warn(`[VidSrc] Direct request failed for ${url}: ${err.message}. Retrying via Cloudflare Worker proxy...`);
    const headersToForward = options.headers
      ? JSON.stringify(options.headers)
      : JSON.stringify(DEFAULT_HEADERS);
    const proxyUrl = `${config.workerProxyUrl}/?url=${encodeURIComponent(url)}&headers=${encodeURIComponent(headersToForward)}`;
    try {
      const res = await axios.get(proxyUrl, { timeout: options.timeout || 8000 });
      logger.info(`[VidSrc Proxy] Successfully fetched via Cloudflare Worker proxy: ${url}`);
      return res;
    } catch (proxyErr) {
      logger.error(`[VidSrc Proxy] Cloudflare Worker proxy request also failed: ${proxyErr.message}`);
      throw err; // throw original error
    }
  }
}


const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Referer': 'https://vidsrc-embed.ru/',
  'Origin': 'https://vidsrc-embed.ru'
};

/**
 * Build embed URLs for VidSrc using documented API format:
 * Movie: https://vidsrc-embed.ru/embed/movie?tmdb=ID
 * TV:    https://vidsrc-embed.ru/embed/tv?tmdb=ID&season=S&episode=E
 * 
 * Full documented fallback chain covers all known VidSrc mirrors.
 */
function buildEmbedUrls(id, type, season, episode) {
  const isTv = type === 'tv';

  if (isTv) {
    return [
      // Primary — vidsrc-embed.ru (documented API, query param format)
      `https://vidsrc-embed.ru/embed/tv?tmdb=${id}&season=${season}&episode=${episode}`,
      // Secondary — vsembed.su
      `https://vsembed.su/embed/tv?tmdb=${id}&season=${season}&episode=${episode}`,
      // Tertiary — vidsrc.me
      `https://vidsrc.me/embed/tv?tmdb=${id}&season=${season}&episode=${episode}`,
      // Quaternary — vidsrc.to (path format)
      `https://vidsrc.to/embed/tv/${id}/${season}/${episode}`,
      // Quinary — vidsrc.xyz
      `https://vidsrc.xyz/embed/tv?tmdb=${id}&season=${season}&episode=${episode}`
    ];
  } else {
    return [
      // Primary — vidsrc-embed.ru (documented API, query param format)
      `https://vidsrc-embed.ru/embed/movie?tmdb=${id}`,
      // Secondary — vsembed.su
      `https://vsembed.su/embed/movie?tmdb=${id}`,
      // Tertiary — vidsrc.me
      `https://vidsrc.me/embed/movie?tmdb=${id}`,
      // Quaternary — vidsrc.to (path format)
      `https://vidsrc.to/embed/movie/${id}`,
      // Quinary — vidsrc.xyz
      `https://vidsrc.xyz/embed/movie?tmdb=${id}`
    ];
  }
}

/**
 * Try to resolve a direct HLS stream from the vidsrc-embed.ru JSON API.
 * Returns { streamUrl, headers } if successful, null otherwise.
 */
async function resolveDirectStream(id, type, season, episode) {
  const isTv = type === 'tv';

  const apisToTry = [
    {
      url: isTv
        ? `https://vidsrc-embed.ru/api/v1/stream/tv/${id}/${season}/${episode}`
        : `https://vidsrc-embed.ru/api/v1/stream/movie/${id}`,
      headers: DEFAULT_HEADERS
    },
    {
      url: isTv
        ? `https://vidsrc-embed.su/api/v1/stream/tv/${id}/${season}/${episode}`
        : `https://vidsrc-embed.su/api/v1/stream/movie/${id}`,
      headers: { ...DEFAULT_HEADERS, Referer: 'https://vidsrc-embed.su/', Origin: 'https://vidsrc-embed.su' }
    }
  ];

  for (const api of apisToTry) {
    try {
      logger.info(`[VidSrc Stream] Trying direct API: ${api.url}`);
      const res = await vidsrcGet(api.url, { headers: api.headers, timeout: 7000 });
      const data = res.data;

      if (data && (data.url || data.stream_url || data.hls)) {
        const streamUrl = data.url || data.stream_url || data.hls;
        logger.info(`[VidSrc Stream] Got direct HLS from API: ${streamUrl}`);
        return { streamUrl, headers: api.headers };
      }

      if (data && Array.isArray(data.sources) && data.sources.length > 0) {
        const streamUrl = data.sources[0].url || data.sources[0].file;
        if (streamUrl) {
          logger.info(`[VidSrc Stream] Got direct HLS from sources[]: ${streamUrl}`);
          return { streamUrl, headers: api.headers };
        }
      }
    } catch (err) {
      logger.warn(`[VidSrc Stream] API ${api.url} failed: ${err.message}`);
      if (err.response && err.response.status === 404) {
        throw new Error(`Media not found on VidSrc (404)`);
      }
    }
  }

  return null;
}

module.exports = async function stream(id, type = 'movie', season = 1, episode = 1, variantId = null, clientIp = null) {
  logger.debug(`[VidSrc Stream] stream() called for ID: ${id}, Type: ${type}, S${season}E${episode}`);

  const embedFallbacks = buildEmbedUrls(id, type, season, episode);
  const embedUrl = embedFallbacks[0]; // Primary is vidsrc-embed.ru

  // Attempt to get a real HLS stream first (enables native player + download)
  try {
    const direct = await resolveDirectStream(id, type, season, episode);
    if (direct && direct.streamUrl) {
      logger.info(`[VidSrc Stream] Resolved direct HLS stream for TMDB ${id}`);
      return normalizeStream({
        provider: 'vidsrc',
        drm: false,
        streamUrl: direct.streamUrl,
        embedUrl,
        embedFallbacks,
        streamType: 'hls',
        subtitles: [],
        headers: direct.headers || DEFAULT_HEADERS,
        qualities: [{ quality: 'auto', url: direct.streamUrl, headers: direct.headers || DEFAULT_HEADERS }],
        variants: [],
        expires: null
      }, 'vidsrc');
    }
  } catch (err) {
    // Direct API failure (including 404) does NOT mean the embed won't work.
    // The vidsrc-embed.ru iframe player resolves content independently of the API.
    // Always fall through to the embed fallback so VidSrc remains visible in the UI.
    logger.warn(`[VidSrc Stream] Direct stream resolution failed (will use embed fallback): ${err.message}`);
  }

  // Fallback: return embed URL (iframe player) with full fallback chain
  logger.info(`[VidSrc Stream] Using embed fallback for TMDB ${id}`);
  return normalizeStream({
    provider: 'vidsrc',
    drm: false,
    streamUrl: '',
    embedUrl,
    embedFallbacks,
    streamType: 'embed',
    subtitles: [],
    headers: {},
    qualities: [],
    variants: [],
    expires: null
  }, 'vidsrc');
};
