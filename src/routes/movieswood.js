/**
 * Movieswood Download Router
 *
 * GET /api/movieswood/search?title=Blast&year=2026
 *   → Returns matched movie title and URL slug on movieswood
 *
 * GET /api/movieswood/download?title=Blast&year=2026
 *   → Full resolution: returns qualities with files and CDN download/streaming links
 *
 * GET /api/movieswood/health
 *   → Health check — tests if movieswood domain is reachable
 */

const express = require('express');
const MovieswoodProvider = require('../providers/movieswood');
const { searchTitle, getWorkingDomain } = require('../providers/movieswood/scraper');
const logger = require('../logger');

const router = express.Router();
const movieswood = new MovieswoodProvider();

/**
 * GET /api/movieswood/search?title=Blast&year=2026
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
      return res.status(503).json({ ok: false, error: 'Movieswood is currently unreachable.', message: err.message });
    }

    const query = title.trim();
    const results = await searchTitle(query, baseUrl);

    let filteredResults = results;
    if (year) {
      const yearStr = year.toString();
      filteredResults = results.filter(r => 
        r.title.includes(yearStr) || 
        r.category?.includes(yearStr)
      );
    }

    return res.json({
      ok: true,
      query,
      count: filteredResults.length,
      results: filteredResults,
    });
  } catch (err) {
    logger.error(`[Movieswood Route /search] ${err.message}`);
    next(err);
  }
});

/**
 * GET /api/movieswood/download?title=Blast&year=2026
 */
router.get('/download', async (req, res, next) => {
  try {
    const { title, year } = req.query;
    if (!title || !title.trim()) {
      return res.status(400).json({ ok: false, error: 'Query parameter "title" is required.' });
    }

    const parsedYear = year ? parseInt(year, 10) : null;

    logger.info(`[Movieswood Route /download] title="${title}" year=${parsedYear}`);
    const result = await movieswood.download(title.trim(), parsedYear);

    if (!result.found) {
      return res.status(404).json({
        ok: false,
        found: false,
        title: title.trim(),
        message: `Movie "${title}" was not found on Movieswood download servers.`,
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
    logger.error(`[Movieswood Route /download] ${err.message}`);
    next(err);
  }
});

/**
 * GET /api/movieswood/health
 */
router.get('/health', async (req, res, next) => {
  try {
    const health = await movieswood.health();
    const statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 206 : 503;
    return res.status(statusCode).json({ ok: health.status !== 'unhealthy', ...health });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
