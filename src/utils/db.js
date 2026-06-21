const fs = require('fs');
const path = require('path');
const logger = require('../logger');

const dbPath = path.resolve(__dirname, '../../data/history.json');

// Ensure directory exists
const dir = path.dirname(dbPath);
if (!fs.existsSync(dir)) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    logger.error(`Failed to create database directory: ${err.message}`);
  }
}

/**
 * Read the entire watch history array from the file.
 * Returns standard frontend-compatible objects.
 */
function readDb() {
  try {
    if (!fs.existsSync(dbPath)) return [];
    const data = fs.readFileSync(dbPath, 'utf8');
    return JSON.parse(data || '[]');
  } catch (err) {
    logger.error(`Database read error: ${err.message}`);
    return [];
  }
}

/**
 * Write the watch history array back to the file.
 */
function writeDb(data) {
  try {
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    logger.error(`Database write error: ${err.message}`);
  }
}

const db = {
  /**
   * Get all history items sorted by last watched/updatedAt descending.
   */
  getHistory() {
    const list = readDb();
    return list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  },

  /**
   * Save or update a watch history item.
   * Maps fields to ensure compatibility and schema persistence:
   * tmdbId, provider, position, duration, season, episode, last watched.
   */
  saveHistoryItem(item) {
    if (!item || !item.movie || !item.movie.id) {
      throw new Error('Invalid history item payload: missing movie identity.');
    }

    const list = readDb();
    const tmdbId = String(item.movie.id);
    const mediaType = item.movie.type || 'movie';

    // Build unique key
    let uniqueKey = `${mediaType}-${tmdbId}`;
    
    // Parse season and episode for TV shows to support episode-specific progress
    let season = null;
    let episode = null;
    const playContextId = item.playContext?.id;
    if (mediaType === 'tv' && playContextId) {
      const match = String(playContextId).match(/^(\d+)[-:](\d+)[-:](\d+)$/);
      if (match) {
        season = parseInt(match[2], 10);
        episode = parseInt(match[3], 10);
        uniqueKey = `tv-${tmdbId}-s${season}-e${episode}`;
      }
    }

    // Filter out existing matching key
    const filtered = list.filter(i => {
      const iTmdbId = String(i.movie?.id);
      const iType = i.movie?.type || 'movie';
      let iKey = `${iType}-${iTmdbId}`;
      if (iType === 'tv' && i.playContext?.id) {
        const iMatch = String(i.playContext.id).match(/^(\d+)[-:](\d+)[-:](\d+)$/);
        if (iMatch) {
          iKey = `tv-${iTmdbId}-s${iMatch[2]}-e${iMatch[3]}`;
        }
      }
      return iKey !== uniqueKey;
    });

    // Create normalized db history item
    const newItem = {
      movie: {
        id: parseInt(tmdbId, 10),
        title: item.movie.title || 'Unknown Title',
        overview: item.movie.overview || '',
        type: mediaType,
        posterPath: item.movie.posterPath || '',
      },
      progress: item.progress || 0,
      duration: item.duration || 0,
      updatedAt: Date.now(),
      playContext: item.playContext ? {
        provider: item.playContext.provider || 'netmirror',
        id: String(playContextId)
      } : null,
      // Database specific fields
      tmdbId: parseInt(tmdbId, 10),
      provider: item.playContext?.provider || 'netmirror',
      position: item.progress || 0,
      season,
      episode,
      lastWatched: Date.now()
    };

    filtered.unshift(newItem);
    writeDb(filtered.slice(0, 100)); // cap at 100 entries

    logger.info(`[Database] Watch progress saved for TMDB ${tmdbId} (${mediaType}) pos: ${newItem.progress}s`);
    return newItem;
  },

  /**
   * Delete a single history item.
   */
  removeHistoryItem(id, type) {
    const list = readDb();
    const filtered = list.filter(i => !(String(i.movie?.id) === String(id) && i.movie?.type === type));
    writeDb(filtered);
    logger.info(`[Database] Removed history item ${type} ID ${id}`);
    return true;
  },

  /**
   * Clear all history.
   */
  clearHistory() {
    writeDb([]);
    logger.info('[Database] Cleared all watch history');
    return true;
  }
};

module.exports = db;
