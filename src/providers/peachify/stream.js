const logger = require('../../logger');
const { normalizeStream } = require('../../utils/normalizer');
const { getEmbedUrl } = require('./player');
const { scrapeDirectStream } = require('./utils');

module.exports = async function stream(id, type = 'movie', season = 1, episode = 1, variantId = null, clientIp = null) {
  logger.debug(`[Peachify Stream] stream() called for ID: ${id}, Type: ${type}, S${season}E${episode}`);
  
  // Attempt to get direct stream data from Peachify scraper APIs.
  // In production (Render), these may be blocked by Cloudflare (403).
  // In that case, we still return the embed URL so the iframe player works.
  let directData = null;
  try {
    directData = await scrapeDirectStream(id, type, season, episode);
  } catch (scrapeErr) {
    logger.warn(`[Peachify Stream] scrapeDirectStream failed (will use embed fallback): ${scrapeErr.message}`);
  }
  
  // Graceful embed fallback — Peachify iframe works independently of our scraper
  if (!directData) {
    logger.info(`[Peachify Stream] No direct data resolved; returning embed URL for TMDB ${id}`);
    const embedInfo = getEmbedUrl(id, type, season, episode);
    return normalizeStream({
      provider: 'peachify',
      drm: false,
      streamUrl: '',
      embedUrl: embedInfo.embedUrl,
      embedFallbacks: [...embedInfo.embedFallbacks],
      streamType: 'embed',
      subtitles: [],
      headers: {},
      qualities: [],
      variants: [],
      selectedVariantId: null,
      expires: null
    }, 'peachify');
  }

  // Extract audio variants (dubs) from decrypted Peachify streams
  const languagesMap = new Map();
  
  // Helper to resolve standard language code for dub name
  const getLanguageCode = (name) => {
    const clean = name.toLowerCase().trim();
    if (clean.includes('tamil')) return 'ta';
    if (clean.includes('telugu')) return 'te';
    if (clean.includes('hindi')) return 'hi';
    if (clean.includes('malayalam')) return 'ml';
    if (clean.includes('kannada')) return 'kn';
    if (clean.includes('english')) return 'en';
    return 'en';
  };

  const addVariant = (q) => {
    const dub = q.dub || 'English';
    const langId = getLanguageCode(dub);
    languagesMap.set(langId, { id: langId, language: dub });
  };

  if (directData.sources && Array.isArray(directData.sources)) {
    directData.sources.forEach(addVariant);
  } else if (directData.qualities && Array.isArray(directData.qualities)) {
    directData.qualities.forEach(addVariant);
  } else if (directData.streamUrl) {
    addVariant({ dub: 'English' });
  }

  const variants = Array.from(languagesMap.values());
  
  // Resolve selected variant dub string
  let activeDub = null;
  let selectedVariantId = null;
  if (variants.length > 0) {
    const matched = variantId ? variants.find(v => v.id === variantId) : null;
    const selected = matched || variants[0];
    activeDub = selected.language;
    selectedVariantId = selected.id;
  }

  const embedInfo = getEmbedUrl(id, type, season, episode);
  let embedUrl = embedInfo.embedUrl;
  let embedFallbacks = [...embedInfo.embedFallbacks];

  if (activeDub) {
    const appendDub = (url) => {
      const separator = url.includes('?') ? '&' : '?';
      return `${url}${separator}dub=${encodeURIComponent(activeDub)}&variant=${encodeURIComponent(activeDub)}`;
    };
    embedUrl = appendDub(embedUrl);
    embedFallbacks = embedFallbacks.map(appendDub);
  }

  return normalizeStream({
    provider: 'peachify',
    drm: false,
    streamUrl: '',
    embedUrl,
    embedFallbacks,
    streamType: 'embed',
    subtitles: [],
    headers: {},
    qualities: [],
    variants,
    selectedVariantId,
    expires: null
  }, 'peachify');
};
