/**
 * Moviesda Download Router
 *
 * GET /api/moviesda/search?title=Blast&year=2026
 *   → Returns matched movie title and URL slug on moviesda
 *
 * GET /api/moviesda/download?title=Blast&year=2026
 *   → Full resolution: returns qualities with files and CDN download links
 *
 * GET /api/moviesda/health
 *   → Health check — tests if moviesda domain is reachable
 */

const express = require('express');
const MoviesdaProvider = require('../providers/moviesda');
const { searchTitle, getWorkingDomain } = require('../providers/moviesda/scraper');
const logger = require('../logger');

const router = express.Router();
const moviesda = new MoviesdaProvider();

/**
 * GET /api/moviesda/search?title=Blast&year=2026
 */
router.get('/search', async (req, res, next) => {
  try {
    const { title, year } = req.query;
    if (!title || !title.trim()) {
      return res.status(400).json({ ok: false, error: 'Query parameter "title" is required.' });
    }

    let baseUrl;
    try {
      baseUrl = await getWorkingDomain();
    } catch (err) {
      return res.status(503).json({ ok: false, error: 'Moviesda is currently unreachable.', message: err.message });
    }

    const query = year ? `${title.trim()} ${year}` : title.trim();
    const results = await searchTitle(query, baseUrl);

    return res.json({
      ok: true,
      query,
      count: results.length,
      results,
    });
  } catch (err) {
    logger.error(`[MoviesDA Route /search] ${err.message}`);
    next(err);
  }
});

/**
 * GET /api/moviesda/download?title=Blast&year=2026
 *
 * Full pipeline resolution. May take 5–20 seconds for the full chain.
 */
router.get('/download', async (req, res, next) => {
  try {
    const { title, year } = req.query;
    if (!title || !title.trim()) {
      return res.status(400).json({ ok: false, error: 'Query parameter "title" is required.' });
    }

    const parsedYear = year ? parseInt(year, 10) : null;

    logger.info(`[MoviesDA Route /download] title="${title}" year=${parsedYear}`);
    const result = await moviesda.download(title.trim(), parsedYear);

    if (!result.found) {
      return res.status(404).json({
        ok: false,
        found: false,
        title: title.trim(),
        message: `Movie "${title}" was not found on Moviesda download servers.`,
        qualities: [],
      });
    }

    return res.json({
      ok: true,
      found: true,
      title: result.title,
      matchedUrl: result.matchedUrl,
      qualities: result.qualities,
    });
  } catch (err) {
    logger.error(`[MoviesDA Route /download] ${err.message}`);
    next(err);
  }
});

/**
 * GET /api/moviesda/health
 */
router.get('/health', async (req, res, next) => {
  try {
    const health = await moviesda.health();
    const statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 206 : 503;
    return res.status(statusCode).json({ ok: health.status !== 'unhealthy', ...health });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
