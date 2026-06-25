const logger = require('../../logger');
const { normalizeStream } = require('../../utils/normalizer');
const { streamimdbGet, DEFAULT_HEADERS } = require('./utils');
const { parseQualitiesFromMaster } = require('./parser');

module.exports = async function stream(id, type = 'movie', season = 1, episode = 1, variantId = null, clientIp = null) {
  logger.debug(`[StreamIMDb Stream] stream() called for ID: ${id}, Type: ${type}, S${season}E${episode}`);

  const isTv = type === 'tv';
  let url = `https://streamdata.vaplayer.ru/api.php?tmdb=${id}&type=${isTv ? 'tv' : 'movie'}`;
  if (isTv) {
    url += `&season=${season}&episode=${episode}`;
  }

  try {
    const response = await streamimdbGet(url);
    if (!response.data || response.data.status_code !== "200" || !response.data.data) {
      throw new Error(`API returned status code ${response.data ? response.data.status_code : 'empty'}`);
    }

    const streamUrls = response.data.data.stream_urls;
    if (!streamUrls || !Array.isArray(streamUrls) || streamUrls.length === 0) {
      throw new Error('API returned no playable stream URLs');
    }

    // Parse variant index and resolve selected streamUrl
    const variantIdx = variantId ? parseInt(variantId, 10) : 0;
    const selectedIdx = (!isNaN(variantIdx) && variantIdx >= 0 && variantIdx < streamUrls.length) ? variantIdx : 0;
    const streamUrl = streamUrls[selectedIdx];
    const imdbId = response.data.data.imdb_id;

    // Parse qualities from the master playlist if available
    let qualities = [];
    try {
      qualities = await parseQualitiesFromMaster(streamUrl, DEFAULT_HEADERS);
    } catch (err) {
      logger.warn(`[StreamIMDb Stream] Master playlist parsing failed, falling back to basic stream: ${err.message}`);
    }

    // If quality parsing yielded nothing, fallback to auto quality with the master url
    if (qualities.length === 0) {
      qualities.push({
        quality: 'auto',
        url: streamUrl,
        headers: DEFAULT_HEADERS
      });
    }

    let embedUrl = `https://streamimdb.ru/embed/${isTv ? 'tv' : 'movie'}/${imdbId || id}`;
    if (selectedIdx > 0) {
      embedUrl += `?variant=${selectedIdx}`;
    }

    // Map all available streams to variants so the player switcher displays them
    const variants = streamUrls.map((_, idx) => {
      let label = `Audio Track ${idx + 1}`;
      if (idx === 0) label = 'Original / Default';
      else if (idx === 1) label = 'Alternative Audio';
      else if (idx === 2) label = 'Dub / Translation';
      return {
        id: String(idx),
        language: label
      };
    });

    return normalizeStream({
      provider: 'streamimdb',
      drm: false,
      streamUrl,
      embedUrl,
      embedFallbacks: [embedUrl],
      streamType: 'hls',
      subtitles: [],
      headers: DEFAULT_HEADERS,
      qualities,
      variants,
      selectedVariantId: String(selectedIdx),
      expires: null
    }, 'streamimdb');

  } catch (err) {
    logger.error(`[StreamIMDb Stream] Failed to resolve stream for ${type} ID ${id}: ${err.message}`);
    throw err;
  }
};
