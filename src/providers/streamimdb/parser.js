const axios = require('axios');
const logger = require('../../logger');
const { URL } = require('url');
const { DEFAULT_HEADERS } = require('./utils');

async function parseQualitiesFromMaster(masterUrl, requestHeaders = {}) {
  const headers = {
    ...DEFAULT_HEADERS,
    ...requestHeaders
  };

  try {
    logger.info(`[StreamIMDb Parser] Parsing master playlist: ${masterUrl}`);
    const response = await axios.get(masterUrl, {
      headers,
      timeout: 5000
    });

    const playlistText = response.data;
    if (typeof playlistText !== 'string') return [];

    const qualities = [];
    const urlObj = new URL(masterUrl);
    const origin = urlObj.origin;

    const lines = playlistText.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('#EXT-X-STREAM-INF:')) {
        // Extract height resolution (e.g., RESOLUTION=1280x720)
        let qStr = '1080p';
        const resMatch = line.match(/RESOLUTION=(\d+x\d+)/i);
        if (resMatch) {
          const height = resMatch[1].split('x')[1];
          if (height) {
            qStr = `${height}p`;
          }
        }

        // Next line contains the URL path
        const nextLine = lines[i + 1]?.trim();
        if (nextLine && !nextLine.startsWith('#')) {
          let variantUrl = nextLine;
          if (variantUrl.startsWith('/')) {
            variantUrl = origin + variantUrl;
          } else if (!variantUrl.startsWith('http')) {
            const basePath = masterUrl.substring(0, masterUrl.lastIndexOf('/') + 1);
            variantUrl = basePath + variantUrl;
          }
          qualities.push({
            quality: qStr,
            url: variantUrl,
            headers
          });
        }
      }
    }
    return qualities;
  } catch (err) {
    logger.warn(`[StreamIMDb Parser] Failed to parse qualities from master: ${err.message}`);
    return [];
  }
}

module.exports = {
  parseQualitiesFromMaster
};
