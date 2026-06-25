const axios = require('axios');
const logger = require('../../logger');

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Referer': 'https://vidsrc-embed.ru/',
  'Origin': 'https://vidsrc-embed.ru'
};

function estimateSize(quality) {
  const q = String(quality).toLowerCase();
  if (q.includes('1080') || q.includes('fhd')) return '2.4 GB';
  if (q.includes('720') || q.includes('hd')) return '1.2 GB';
  if (q.includes('480')) return '600 MB';
  if (q.includes('360')) return '300 MB';
  if (q.includes('2160') || q.includes('4k')) return '4.8 GB';
  return '1.5 GB';
}

module.exports = async function download(id, type, season = 1, episode = 1, variantId = null) {
  logger.info(`[VidSrc Download] download() called for ID: ${id}, Type: ${type}, S${season}E${episode}`);

  const isTv = type === 'tv';

  // Attempt vidsrc-embed.ru direct API
  const apiUrl = isTv
    ? `https://vidsrc-embed.ru/api/v1/stream/tv/${id}/${season}/${episode}`
    : `https://vidsrc-embed.ru/api/v1/stream/movie/${id}`;

  try {
    const res = await axios.get(apiUrl, { headers: DEFAULT_HEADERS, timeout: 8000 });
    const data = res.data;

    let streamUrl = null;

    if (data && (data.url || data.stream_url || data.hls)) {
      streamUrl = data.url || data.stream_url || data.hls;
    } else if (data && Array.isArray(data.sources) && data.sources.length > 0) {
      streamUrl = data.sources[0].url || data.sources[0].file;
    }

    if (streamUrl) {
      logger.info(`[VidSrc Download] Found stream URL for download: ${streamUrl}`);

      // Try to parse quality from URL or API response
      const quality = data.quality || 'auto';
      const qualities = [{
        quality: String(quality).includes('p') ? String(quality) : `${quality}p`,
        size: estimateSize(quality),
        url: streamUrl,
        language: 'English',
        headers: DEFAULT_HEADERS
      }];

      // If the API returns multiple qualities
      if (data.qualities && Array.isArray(data.qualities)) {
        qualities.splice(0, qualities.length);
        data.qualities.forEach(q => {
          const qStr = String(q.quality || q.resolution || 'auto');
          qualities.push({
            quality: qStr.includes('p') ? qStr : `${qStr}p`,
            size: estimateSize(qStr),
            url: q.url || q.file || streamUrl,
            language: 'English',
            headers: DEFAULT_HEADERS
          });
        });
      }

      return {
        success: true,
        provider: 'vidsrc',
        downloadSupported: true,
        available: true,
        languages: [{ id: 'en', name: 'English' }],
        qualities,
        headers: DEFAULT_HEADERS
      };
    }
  } catch (err) {
    logger.warn(`[VidSrc Download] vidsrc-embed.ru API failed: ${err.message}`);
    try {
      logger.info(`[VidSrc Download] Trying vidsrc-embed.su alt direct API`);
      const altUrl = isTv
        ? `https://vidsrc-embed.su/api/v1/stream/tv/${id}/${season}/${episode}`
        : `https://vidsrc-embed.su/api/v1/stream/movie/${id}`;
      const res = await axios.get(altUrl, { 
        headers: { ...DEFAULT_HEADERS, Referer: 'https://vidsrc-embed.su/', Origin: 'https://vidsrc-embed.su' }, 
        timeout: 8000 
      });
      const data = res.data;
      let streamUrl = null;

      if (data && (data.url || data.stream_url || data.hls)) {
        streamUrl = data.url || data.stream_url || data.hls;
      } else if (data && Array.isArray(data.sources) && data.sources.length > 0) {
        streamUrl = data.sources[0].url || data.sources[0].file;
      }

      if (streamUrl) {
        logger.info(`[VidSrc Download] Found stream URL for download from alt API: ${streamUrl}`);
        const quality = data.quality || 'auto';
        const qualities = [{
          quality: String(quality).includes('p') ? String(quality) : `${quality}p`,
          size: estimateSize(quality),
          url: streamUrl,
          language: 'English',
          headers: { ...DEFAULT_HEADERS, Referer: 'https://vidsrc-embed.su/', Origin: 'https://vidsrc-embed.su' }
        }];

        if (data.qualities && Array.isArray(data.qualities)) {
          qualities.splice(0, qualities.length);
          data.qualities.forEach(q => {
            const qStr = String(q.quality || q.resolution || 'auto');
            qualities.push({
              quality: qStr.includes('p') ? qStr : `${qStr}p`,
              size: estimateSize(qStr),
              url: q.url || q.file || streamUrl,
              language: 'English',
              headers: { ...DEFAULT_HEADERS, Referer: 'https://vidsrc-embed.su/', Origin: 'https://vidsrc-embed.su' }
            });
          });
        }

        return {
          success: true,
          provider: 'vidsrc',
          downloadSupported: true,
          available: true,
          languages: [{ id: 'en', name: 'English' }],
          qualities,
          headers: { ...DEFAULT_HEADERS, Referer: 'https://vidsrc-embed.su/', Origin: 'https://vidsrc-embed.su' }
        };
      }
    } catch (altErr) {
      logger.warn(`[VidSrc Download] vidsrc-embed.su alt API failed: ${altErr.message}`);
    }
  }

  // Fallback 1: Try Peachify download
  try {
    logger.info(`[VidSrc Download] Falling back to Peachify for download`);
    const peachifyDownload = require('../peachify/download');
    const peachifyResult = await peachifyDownload(id, type, season, episode, variantId);
    if (peachifyResult && peachifyResult.success) {
      logger.info(`[VidSrc Download] Fallback to Peachify download succeeded`);
      return {
        ...peachifyResult,
        provider: 'vidsrc' // Override provider name to match expected request provider
      };
    }
  } catch (err) {
    logger.warn(`[VidSrc Download] Fallback to Peachify failed: ${err.message}`);
  }

  // Fallback 2: Try StreamIMDb download
  try {
    logger.info(`[VidSrc Download] Falling back to StreamIMDb for download`);
    const streamimdbDownload = require('../streamimdb/download');
    const streamimdbResult = await streamimdbDownload(id, type, season, episode, variantId);
    if (streamimdbResult && streamimdbResult.success) {
      logger.info(`[VidSrc Download] Fallback to StreamIMDb download succeeded`);
      return {
        ...streamimdbResult,
        provider: 'vidsrc' // Override provider name to match expected request provider
      };
    }
  } catch (err) {
    logger.warn(`[VidSrc Download] Fallback to StreamIMDb failed: ${err.message}`);
  }

  // Download not possible
  logger.info(`[VidSrc Download] No direct streams available; download not supported for TMDB ${id}`);
  return {
    success: false,
    downloadSupported: false,
    available: false,
    message: 'VidSrc does not provide direct download streams for this title. Try using another server.'
  };
};
