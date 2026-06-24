const logger = require('../../logger');
const { scrapeDirectStream } = require('./utils');

function getLanguageCode(name) {
  const clean = name.toLowerCase().trim();
  if (clean.includes('tamil')) return 'ta';
  if (clean.includes('telugu')) return 'te';
  if (clean.includes('hindi')) return 'hi';
  if (clean.includes('malayalam')) return 'ml';
  if (clean.includes('kannada')) return 'kn';
  if (clean.includes('english')) return 'en';
  return 'en';
}

function estimateSize(quality) {
  const cleanQ = quality.toLowerCase();
  if (cleanQ.includes('1080')) return '2.4 GB';
  if (cleanQ.includes('720')) return '1.2 GB';
  if (cleanQ.includes('480')) return '600 MB';
  if (cleanQ.includes('2160') || cleanQ.includes('4k')) return '4.8 GB';
  return '1.5 GB';
}

module.exports = async function download(id, type, season = 1, episode = 1, variantId = null) {
  logger.info(`[Peachify Download] download() called for ID: ${id}, Type: ${type}, S${season}E${episode}`);
  const directData = await scrapeDirectStream(id, type, season, episode);

  if (!directData) {
    throw new Error(`Failed to resolve any direct stream for download.`);
  }

  const languagesMap = new Map();
  let qualities = [];

  const addSource = (q) => {
    let qStr = '720p';
    if (q.quality) {
      const val = String(q.quality);
      qStr = val.endsWith('p') ? val : `${val}p`;
    }
    const dub = q.dub || 'English';
    const langId = getLanguageCode(dub);
    
    languagesMap.set(langId, { id: langId, name: dub });

    qualities.push({
      quality: qStr,
      size: estimateSize(qStr),
      url: q.url,
      language: dub,
      headers: q.headers || directData.headers
    });
  };

  if (directData.sources && Array.isArray(directData.sources)) {
    directData.sources.forEach(addSource);
  } else if (directData.qualities && Array.isArray(directData.qualities)) {
    directData.qualities.forEach(addSource);
  } else if (directData.streamUrl) {
    addSource({
      quality: 'auto',
      url: directData.streamUrl,
      headers: directData.headers
    });
  }

  if (qualities.length === 0) {
    throw new Error(`Decrypted payload contains no valid download URLs.`);
  }

  const headers = directData.headers || {
    'Referer': 'https://peachify.top/',
    'Origin': 'https://peachify.top',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  };

  return {
    success: true,
    provider: 'peachify',
    downloadSupported: true,
    available: true,
    languages: Array.from(languagesMap.values()),
    qualities,
    headers
  };
};
