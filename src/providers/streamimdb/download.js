const logger = require('../../logger');
const { streamimdbGet, DEFAULT_HEADERS } = require('./utils');
const { parseQualitiesFromMaster } = require('./parser');

function estimateSize(quality) {
  const cleanQ = quality.toLowerCase();
  if (cleanQ.includes('1080')) return '2.4 GB';
  if (cleanQ.includes('720')) return '1.2 GB';
  if (cleanQ.includes('480')) return '600 MB';
  if (cleanQ.includes('2160') || cleanQ.includes('4k')) return '4.8 GB';
  return '1.5 GB';
}

module.exports = async function download(id, type, season = 1, episode = 1, variantId = null) {
  logger.info(`[StreamIMDb Download] download() called for ID: ${id}, Type: ${type}, S${season}E${episode}`);
  
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

    // Map all available streams to languages list
    const languages = streamUrls.map((_, idx) => {
      let label = `Audio Track ${idx + 1}`;
      if (idx === 0) label = 'Original / Default';
      else if (idx === 1) label = 'Alternative Audio';
      else if (idx === 2) label = 'Dub / Translation';
      return {
        id: String(idx),
        name: label
      };
    });

    // Parse variant index and resolve selected streamUrl
    const variantIdx = variantId ? parseInt(variantId, 10) : 0;
    const selectedIdx = (!isNaN(variantIdx) && variantIdx >= 0 && variantIdx < streamUrls.length) ? variantIdx : 0;
    const streamUrl = streamUrls[selectedIdx];
    const selectedLangName = languages[selectedIdx].name;

    // Parse direct qualities from master playlist
    let parsedQualities = await parseQualitiesFromMaster(streamUrl, DEFAULT_HEADERS);
    
    if (parsedQualities.length === 0) {
      // Fallback to auto
      parsedQualities.push({
        quality: 'auto',
        url: streamUrl,
        headers: DEFAULT_HEADERS
      });
    }

    const qualities = parsedQualities.map(q => ({
      quality: q.quality,
      size: estimateSize(q.quality),
      url: q.url,
      language: selectedLangName,
      headers: q.headers || DEFAULT_HEADERS
    }));

    return {
      success: true,
      provider: 'streamimdb',
      downloadSupported: true,
      available: true,
      languages,
      qualities,
      headers: DEFAULT_HEADERS
    };

  } catch (err) {
    logger.error(`[StreamIMDb Download] download() resolution failed: ${err.message}`);
    throw err;
  }
};
