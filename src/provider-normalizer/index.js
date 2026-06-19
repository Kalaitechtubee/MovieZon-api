const logger = require('../logger');

/**
 * Standard normalizer for provider catalog items (search/details results)
 */
function normalizeCatalogItem(data, providerName) {
  if (!data) return null;

  const isTv = data.type === 'tv' || data.mediaType === 'tv';
  const mediaType = isTv ? 'tv' : 'movie';

  let ratingVal = data.rating;
  let ratingStr = 'TMDB 0.0';
  if (ratingVal) {
    if (typeof ratingVal === 'string') {
      const match = ratingVal.match(/[\d.]+/);
      if (match) {
        ratingStr = `TMDB ${parseFloat(match[0]).toFixed(1)}`;
      } else {
        ratingStr = ratingVal;
      }
    } else if (typeof ratingVal === 'number') {
      ratingStr = `TMDB ${ratingVal.toFixed(1)}`;
    }
  }

  return {
    id: String(data.tmdbId || data.id),
    provider: providerName.toLowerCase(),
    tmdbId: data.tmdbId ? parseInt(data.tmdbId, 10) : null,
    imdbId: data.imdbId || data.imdb || null,
    title: data.title || '',
    originalTitle: data.originalTitle || data.title || '',
    year: data.year ? parseInt(data.year, 10) : null,
    type: mediaType,
    mediaType: mediaType,
    language: data.language || data.originalLanguage || 'en',
    quality: data.quality || '1080p',
    poster: data.poster || '',
    backdrop: data.backdrop || '',
    overview: data.overview || '',
    duration: data.duration ? parseInt(data.duration, 10) : (data.runtime ? parseInt(data.runtime, 10) : null),
    rating: ratingStr
  };
}

/**
 * Standard normalizer for stream details
 */
function normalizeStream(data, providerName) {
  if (!data) return null;

  // Normalize qualities
  const qualities = Array.isArray(data.qualities)
    ? data.qualities.map(q => ({
        quality: String(q.quality || q.resolution || '1080p').endsWith('p') ? String(q.quality || q.resolution || '1080p') : `${q.quality || q.resolution || '1080'}p`,
        url: q.url || ''
      }))
    : [];

  // Normalize subtitles
  const subtitles = Array.isArray(data.subtitles || data.captions)
    ? (data.subtitles || data.captions).map(s => ({
        lang: s.lang || s.language || 'en',
        name: s.name || s.label || 'English',
        url: s.url || ''
      }))
    : [];

  return {
    provider: providerName.toLowerCase(),
    drm: typeof data.drm === 'boolean' ? data.drm : false,
    streamUrl: data.streamUrl || data.url || data.mp4 || '',
    subtitles,
    headers: data.headers || {},
    qualities,
    expires: data.expires ? parseInt(data.expires, 10) : null
  };
}

module.exports = {
  normalizeCatalogItem,
  normalizeStream
};
