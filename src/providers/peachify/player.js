const logger = require('../../logger');

const PEACHIFY_BASE = 'https://peachify.top';

/**
 * Generate primary Peachify embed url and alternative fallback mirrors
 */
function getEmbedUrl(id, type, season = 1, episode = 1) {
  const mediaType = type === 'tv' ? 'tv' : 'movie';
  let embedUrl;

  if (mediaType === 'tv') {
    embedUrl = `${PEACHIFY_BASE}/embed/tv/${id}/${season}/${episode}`;
  } else {
    embedUrl = `${PEACHIFY_BASE}/embed/movie/${id}`;
  }

  const fallbackEmbeds = [embedUrl];
  if (mediaType === 'tv') {
    fallbackEmbeds.push(
      `https://vidsrc.to/embed/tv/${id}/${season}/${episode}`,
      `https://autoembed.cc/tv/${id}-${season}-${episode}`,
      `https://embed.su/embed/tv/${id}/${season}/${episode}`
    );
  } else {
    fallbackEmbeds.push(
      `https://vidsrc.to/embed/movie/${id}`,
      `https://autoembed.cc/movie/${id}`,
      `https://embed.su/embed/movie/${id}`
    );
  }

  return {
    embedUrl: fallbackEmbeds[0],
    embedFallbacks: fallbackEmbeds
  };
}

module.exports = {
  getEmbedUrl
};
