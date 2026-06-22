const axios = require('axios');
const config = require('../../config');
const logger = require('../../logger');
const { normalizeCatalogItem } = require('../../utils/normalizer');

/**
 * Fetch movie/TV details from TMDB with cast, genres, and trailers appended
 */
async function fetchDetails(id, type) {
  const { baseUrl, apiKey } = config.tmdb;
  const pathType = type.toLowerCase() === 'tv' ? 'tv' : 'movie';
  const url = `${baseUrl}/${pathType}/${id}?api_key=${apiKey}&append_to_response=credits,videos,recommendations`;

  try {
    const response = await axios.get(url, { timeout: 5000 });
    const data = response.data;

    // Normalize response to standard format
    const title = data.title || data.name || 'Unknown Title';
    const originalTitle = data.original_title || data.original_name || title;
    const releaseDate = data.release_date || data.first_air_date || '';
    const year = releaseDate ? new Date(releaseDate).getFullYear() : null;
    const runtime = data.runtime || (data.episode_run_time && data.episode_run_time.length > 0 ? data.episode_run_time[0] : null);

    const cast = (data.credits?.cast || []).slice(0, 10).map(c => ({
      name: c.name,
      character: c.character,
      profilePath: c.profile_path ? `https://image.tmdb.org/t/p/w185${c.profile_path}` : null
    }));

    const genres = (data.genres || []).map(g => g.name);
    const genreStr = genres.join(', ');

    // Parse director from crew
    const crew = data.credits?.crew || [];
    const directorObj = crew.find(c => c.job === 'Director');
    const director = directorObj ? directorObj.name : '';

    // Find YouTube Trailer key
    const trailerKey = (data.videos?.results || []).find(
      v => v.type === 'Trailer' && v.site === 'YouTube'
    )?.key || null;
    const trailer = trailerKey ? `https://www.youtube.com/watch?v=${trailerKey}` : null;

    const seasons = (data.seasons || []).map(s => ({
      seasonNumber: s.season_number,
      season_number: s.season_number,
      episodeCount: s.episode_count,
      episode_count: s.episode_count,
      name: s.name || `Season ${s.season_number}`
    })).filter(s => s.season_number > 0);

    const recommendations = (data.recommendations?.results || []).slice(0, 10).map(r => ({
      id: r.id,
      title: r.title || r.name || 'Unknown',
      posterPath: r.poster_path ? `https://image.tmdb.org/t/p/w185${r.poster_path}` : null,
      mediaType: r.media_type || (r.first_air_date ? 'tv' : 'movie')
    }));

    const ratingVal = data.vote_average ? `TMDB ${data.vote_average.toFixed(1)}` : 'TMDB 0.0';

    return {
      id: String(data.id),
      provider: 'tmdb',
      tmdbId: data.id,
      title,
      originalTitle,
      overview: data.overview || '',
      description: data.overview || '',
      poster: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : null,
      backdrop: data.backdrop_path ? `https://image.tmdb.org/t/p/original${data.backdrop_path}` : null,
      year: year ? String(year) : '',
      rating: ratingVal,
      genres,
      genre: genreStr,
      duration: runtime,
      language: data.original_language || 'en',
      cast,
      director,
      trailer,
      seasons,
      recommendations,
      mediaType: pathType,
      type: pathType,
      languages: [],
      sources: []
    };
  } catch (err) {
    logger.warn(`Failed to fetch TMDB details for ${type} ID ${id}: ${err.message}`);
    return null;
  }
}

/**
 * Search movies and TV shows on TMDB
 */
async function search(query) {
  const { baseUrl, apiKey } = config.tmdb;
  const url = `${baseUrl}/search/multi?api_key=${apiKey}&query=${encodeURIComponent(query)}&language=en-US`;

  try {
    const response = await axios.get(url, { timeout: 5000 });
    const results = response.data.results || [];

    return results
      .filter(item => ['movie', 'tv'].includes(item.media_type))
      .map(item => {
        return normalizeCatalogItem({
          tmdbId: item.id,
          id: String(item.id),
          title: item.title || item.name,
          originalTitle: item.original_title || item.original_name,
          year: item.release_date || item.first_air_date ? new Date(item.release_date || item.first_air_date).getFullYear() : null,
          type: item.media_type,
          rating: item.vote_average,
          poster: item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : null,
          backdrop: item.backdrop_path ? `https://image.tmdb.org/t/p/w780${item.backdrop_path}` : null,
          overview: item.overview || '',
          language: item.original_language || 'en'
        }, 'tmdb');
      });
  } catch (err) {
    logger.warn(`Failed to search TMDB for "${query}": ${err.message}`);
    return [];
  }
}

/**
 * Fetch trending, popular, discover, discover, discover, discover, discover, discover, discover or upcoming from TMDB
 */
async function fetchList(category, queryParams = {}) {
  const { baseUrl, apiKey } = config.tmdb;
  let url = '';

  if (category === 'trending') {
    const media = queryParams.media || 'all';
    const time = queryParams.time || 'week';
    url = `${baseUrl}/trending/${media}/${time}?api_key=${apiKey}`;
  } else if (category === 'popular') {
    url = `${baseUrl}/movie/popular?api_key=${apiKey}`;
  } else if (category === 'popular_tv') {
    url = `${baseUrl}/tv/popular?api_key=${apiKey}`;
  } else if (category === 'top_rated') {
    const isTv = queryParams.type === 'tv';
    url = isTv ? `${baseUrl}/tv/top_rated?api_key=${apiKey}` : `${baseUrl}/movie/top_rated?api_key=${apiKey}`;
  } else if (category === 'upcoming') {
    url = `${baseUrl}/movie/upcoming?api_key=${apiKey}`;
  } else if (category === 'discover') {
    const isTv = queryParams.type === 'tv';
    url = isTv ? `${baseUrl}/discover/tv?api_key=${apiKey}` : `${baseUrl}/discover/movie?api_key=${apiKey}`;
  } else {
    throw new Error(`Unsupported TMDB list category: ${category}`);
  }

  const urlObj = new URL(url);
  Object.keys(queryParams).forEach(key => {
    if (!['media', 'time', 'type'].includes(key)) {
      urlObj.searchParams.set(key, queryParams[key]);
    }
  });

  const response = await axios.get(urlObj.toString(), { timeout: 5000 });
  const results = response.data.results || [];

  return results.map(item => {
    const isTvShow = category === 'popular_tv' || queryParams.type === 'tv' || item.media_type === 'tv' || (!item.title && item.name);
    const mediaType = isTvShow ? 'tv' : 'movie';

    return normalizeCatalogItem({
      tmdbId: item.id,
      id: String(item.id),
      title: item.title || item.name,
      originalTitle: item.original_title || item.original_name,
      year: item.release_date || item.first_air_date ? new Date(item.release_date || item.first_air_date).getFullYear() : null,
      type: mediaType,
      mediaType: mediaType,
      rating: item.vote_average,
      poster: item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : null,
      backdrop: item.backdrop_path ? `https://image.tmdb.org/t/p/w780${item.backdrop_path}` : null,
      overview: item.overview || '',
      language: item.original_language || 'en'
    }, 'tmdb');
  });
}

/**
 * Fetch episodes list for a specific season from TMDB
 */
async function fetchSeasonEpisodes(tmdbId, seasonNumber, provider = 'peachify') {
  const { baseUrl, apiKey } = config.tmdb;
  const url = `${baseUrl}/tv/${tmdbId}/season/${seasonNumber}?api_key=${apiKey}&language=en-US`;
  
  const response = await axios.get(url, { timeout: 5000 });
  const episodes = response.data.episodes || [];

  return episodes.map(item => {
    const compositeId = `${tmdbId}-${seasonNumber}-${item.episode_number}`;
    const stillUrl = item.still_path ? `https://image.tmdb.org/t/p/w300${item.still_path}` : null;

    return {
      id: compositeId,
      provider: provider,
      episode_number: item.episode_number,
      name: item.name || `Episode ${item.episode_number}`,
      still_path: stillUrl,
      still: stillUrl,
      air_date: item.air_date || '',
      airDate: item.air_date || '',
      runtime: item.runtime || 0,
      overview: item.overview || ''
    };
  });
}

module.exports = {
  fetchDetails,
  search,
  fetchList,
  fetchSeasonEpisodes
};
