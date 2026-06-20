const BaseProvider = require('../BaseProvider');
const httpClient = require('../../utils/httpClient');
const logger = require('../../logger');
const { normalizeCatalogItem, normalizeStream } = require('../../provider-normalizer');
const axios = require('axios');
const { webcrypto } = require('crypto');
const config = require('../../config');

const PEACHIFY_BASE = 'https://peachify.top';
const NETMIRROR_BASE = 'https://net27.cc';
const keyHex = "a8f2a1b5e9c470814f6b2c3a5d8e7f9c1a2b3c4d5e3f7a8b8cad1e2d0a4d5c5d";

let proxyConfig = null;
if (config.proxyUrl) {
  try {
    const parsed = new URL(config.proxyUrl);
    proxyConfig = {
      protocol: parsed.protocol.replace(':', ''),
      host: parsed.hostname,
      port: parseInt(parsed.port, 10) || (parsed.protocol === 'https:' ? 443 : 80)
    };
    if (parsed.username || parsed.password) {
      proxyConfig.auth = {
        username: decodeURIComponent(parsed.username),
        password: decodeURIComponent(parsed.password)
      };
    }
    logger.info(`[Peachify] Configured outgoing Axios proxy: ${proxyConfig.host}:${proxyConfig.port}`);
  } catch (e) {
    logger.warn(`[Peachify] Failed to parse PROXY_URL: ${e.message}`);
  }
}

function dC(e) {
  let t = e.replace(/-/g, "+").replace(/_/g, "/"),
      i = t.length % 4 == 0 ? "" : "=".repeat(4 - t.length % 4),
      r = Buffer.from(t + i, 'base64').toString('binary'),
      s = new Uint8Array(r.length);
  for (let e = 0; e < r.length; e++) {
    s[e] = r.charCodeAt(e);
  }
  return s;
}

async function dP(e) {
  let t = new Uint8Array(e.match(/.{1,2}/g).map(e => parseInt(e, 16)));
  return await webcrypto.subtle.importKey("raw", t, {name: "AES-GCM"}, false, ["decrypt"]);
}

async function dD(e, t) {
  try {
    let [i, r, s] = e.split(".");
    let n = dC(i),
        a = dC(r),
        l = dC(s);
    let o = new Uint8Array(a.length + l.length);
    o.set(a, 0);
    o.set(l, a.length);
    let u = await dP(t);
    let d = await webcrypto.subtle.decrypt({name: "AES-GCM", iv: n}, u, o);
    let h = new TextDecoder().decode(d);
    return JSON.parse(h);
  } catch (err) {
    logger.warn(`Decryption failed: ${err.message}`);
    return null;
  }
}

class PeachifyProvider extends BaseProvider {
  constructor() {
    super('peachify');
  }

  async peachifyGet(url, options = {}) {
    const reqOptions = { ...options };
    if (proxyConfig) {
      reqOptions.proxy = proxyConfig;
    }
    try {
      return await axios.get(url, reqOptions);
    } catch (err) {
      logger.warn(`[Peachify] Direct request failed for: ${url}. Error: ${err.message}. Retrying via Cloudflare Worker proxy...`);
      const proxyUrl = `https://streamhub-proxy.1545zoya.workers.dev/?url=${encodeURIComponent(url)}`;
      try {
        const res = await axios.get(proxyUrl, options);
        logger.info(`[Peachify Proxy] Successfully fetched via Cloudflare Worker proxy: ${url}`);
        return res;
      } catch (proxyErr) {
        logger.error(`[Peachify Proxy] Proxy request also failed: ${proxyErr.message}`);
        throw err;
      }
    }
  }

  /**
   * Search - not directly supported by Peachify; always returns empty.
   * Search is handled by TMDB / NetMirror.
   */
  async search(_query) {
    return [];
  }

  /**
   * Details - delegates to NetMirror catalog or TMDB.
   * Peachify doesn't have its own catalog metadata.
   */
  async details(id, type) {
    const registry = require('../../provider-registry');
    const netmirror = registry.get('netmirror');
    let resolvedId = id;
    if (netmirror && typeof netmirror.resolveTmdbId === 'function') {
      resolvedId = netmirror.resolveTmdbId(id);
    }

    // Try to get basic info from net27.cc catalog endpoint
    const detailUrl = `${NETMIRROR_BASE}/api/catalog/title/${type}/${resolvedId}`;
    try {
      const data = await httpClient.get(detailUrl);
      if (data && data.ok) {
        data.tmdbId = data.tmdbId || resolvedId;
        return normalizeCatalogItem(data, 'peachify');
      }
    } catch (err) {
      logger.debug(`[Peachify] details() live request failed for ID ${resolvedId}: ${err.message}`);
    }

    // Minimal stub so the details page still renders
    return normalizeCatalogItem({
      tmdbId: resolvedId,
      id: String(resolvedId),
      title: '',
      type: type || 'movie'
    }, 'peachify');
  }

  /**
   * Stream - returns the Peachify embed URL as an iframe-type stream.
   * The frontend renders this in an <iframe> instead of a native video player.
   */
  async stream(id, type = 'movie', season = 1, episode = 1, _variantId = null, _clientIp = null) {
    logger.debug(`[Peachify] stream() called for ID: ${id}, Type: ${type}, S${season}E${episode}`);

    const registry = require('../../provider-registry');
    const netmirror = registry.get('netmirror');
    let resolvedId = id;
    if (netmirror && typeof netmirror.resolveTmdbId === 'function') {
      resolvedId = netmirror.resolveTmdbId(id);
    }

    const mediaType = type === 'tv' ? 'tv' : 'movie';
    let embedUrl;

    if (mediaType === 'tv') {
      embedUrl = `${PEACHIFY_BASE}/embed/tv/${resolvedId}/${season}/${episode}`;
    } else {
      embedUrl = `${PEACHIFY_BASE}/embed/movie/${resolvedId}`;
    }

    // Try to scrape direct streams
    const ee = [
      {label:"Iron",path:"moviebox",apis:["https://uwu.eat-peach.sbs"]},
      {label:"Spider",path:"holly",apis:["https://usa.eat-peach.sbs"]},
      {label:"Wolf",path:"air",apis:["https://usa.eat-peach.sbs"]},
      {label:"Multi",path:"multi",apis:["https://usa.eat-peach.sbs"]},
      {label:"Dark",path:"net",apis:["https://uwu.eat-peach.sbs"]}
    ];

    let decryptedData = null;

    for (const item of ee) {
      for (const api of item.apis) {
        let url;
        if (mediaType === 'tv') {
          url = `${api}/${item.path}/tv/${resolvedId}/${season}/${episode}`;
        } else {
          url = `${api}/${item.path}/movie/${resolvedId}`;
        }
        logger.debug(`[Peachify] Trying to fetch stream from API: ${url}`);
        try {
          const res = await this.peachifyGet(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': 'application/json, text/plain, */*',
              'Accept-Language': 'en-US,en;q=0.9',
              'Accept-Encoding': 'gzip, deflate, br',
              'Referer': 'https://peachify.top/',
              'Origin': 'https://peachify.top',
              'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
              'Sec-Ch-Ua-Mobile': '?0',
              'Sec-Ch-Ua-Platform': '"Windows"',
              'Sec-Fetch-Dest': 'empty',
              'Sec-Fetch-Mode': 'cors',
              'Sec-Fetch-Site': 'cross-site'
            },
            timeout: 4000
          });

          if (res.data && res.data.isEncrypted && res.data.data) {
            logger.info(`[Peachify] Decrypting response from ${item.label} (${url})`);
            const decrypted = await dD(res.data.data, keyHex);
            if (decrypted && decrypted.sources && decrypted.sources.length > 0) {
              decryptedData = decrypted;
              break;
            }
          }
        } catch (err) {
          logger.debug(`[Peachify] Fetch/Decrypt failed for ${item.label} (${url}): ${err.message}`);
        }
      }
      if (decryptedData) break;
    }

    if (decryptedData) {
      logger.info(`[Peachify] Successfully resolved direct native streams!`);

      // Normalize qualities
      const qualities = decryptedData.sources.map(s => {
        let qStr = '1080p';
        if (s.quality) {
          qStr = String(s.quality).endsWith('p') ? String(s.quality) : `${s.quality}p`;
        } else if (s.type === 'm3u8') {
          qStr = 'HLS';
        }
        return {
          quality: qStr,
          url: s.url || '',
          headers: s.headers || {}
        };
      });

      // Normalize subtitles
      const subtitles = (decryptedData.subtitles || []).map(sub => ({
        lang: sub.langCode || 'en',
        name: sub.label || 'English',
        url: sub.url || ''
      }));

      // Find best default streamUrl (prefer HLS/m3u8, then first quality)
      const hlsStream = decryptedData.sources.find(s => s.type === 'm3u8');
      const firstStream = decryptedData.sources[0];
      const streamUrl = hlsStream ? hlsStream.url : (firstStream ? firstStream.url : '');
      const streamHeaders = hlsStream ? hlsStream.headers : (firstStream ? firstStream.headers : {});

      // Parse expiration timestamp from the stream URL if present
      let expires = null;
      if (streamUrl) {
        try {
          let urlToParse = streamUrl;
          if (streamUrl.includes('url=')) {
            const match = streamUrl.match(/url=([^&]+)/);
            if (match) {
              urlToParse = decodeURIComponent(match[1]);
            }
          }
          const urlObj = new URL(urlToParse);
          const t = urlObj.searchParams.get('t');
          if (t) {
            // 't' is the generation timestamp. The secure token is valid for 1 hour (3600 seconds).
            expires = parseInt(t, 10) + 3600;
          }
        } catch (e) {
          logger.debug(`[Peachify] Failed to parse expires from stream URL: ${e.message}`);
        }
      }

      return normalizeStream({
        drm: false,
        streamUrl,
        qualities,
        subtitles,
        expires,
        headers: streamHeaders
      }, 'peachify');
    }

    // Fallback if scraping/decryption failed
    // Use reliable public embed sources instead of peachify.top which opens that site's full player UI
    const fallbackEmbeds = [];
    if (mediaType === 'tv') {
      fallbackEmbeds.push(
        `https://vidsrc.to/embed/tv/${resolvedId}/${season}/${episode}`,
        `https://autoembed.cc/tv/${resolvedId}-${season}-${episode}`,
        `https://embed.su/embed/tv/${resolvedId}/${season}/${episode}`
      );
    } else {
      fallbackEmbeds.push(
        `https://vidsrc.to/embed/movie/${resolvedId}`,
        `https://autoembed.cc/movie/${resolvedId}`,
        `https://embed.su/embed/movie/${resolvedId}`
      );
    }

    const primaryFallbackEmbed = fallbackEmbeds[0];
    logger.warn(`[Peachify] No direct stream resolved. Returning reliable embed fallback: ${primaryFallbackEmbed}`);

    return {
      provider: 'peachify',
      drm: false,
      streamUrl: '',
      embedUrl: primaryFallbackEmbed,
      embedFallbacks: fallbackEmbeds,
      streamType: 'embed',
      subtitles: [],
      headers: {},
      qualities: [],
      variants: [],
      expires: null
    };
  }

  /**
   * Health check - verify Peachify is reachable
   */
  async health() {
    const startTime = Date.now();
    try {
      await httpClient.get(PEACHIFY_BASE, { timeout: 5000, retries: 0 });
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
