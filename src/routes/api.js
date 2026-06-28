const express = require('express');
const apiController = require('../controllers/apiController');
const historyController = require('../controllers/historyController');
const moviesdaRouter = require('./moviesda');

const router = express.Router();

// ─── Core routes ──────────────────────────────────────────────────────────────
router.get('/search', apiController.search);
router.get('/details/:provider/:id', apiController.details);
router.get('/details/:id', apiController.unifiedDetails);
router.get('/stream/:provider/:id', apiController.stream);
router.get('/providers', apiController.providers);
router.get('/health', apiController.health);
router.get('/proxy-stream', apiController.proxyStream);

// ─── V2 Routes ────────────────────────────────────────────────────────────────
router.get('/v2/search', apiController.search);
router.get('/v2/details/tmdb/:id', apiController.unifiedDetails);
router.get('/v2/details/:provider/:id', apiController.details);

// Backend-controlled sequential pipeline stream (backend decides provider — frontend never chooses).
// IMPORTANT: These routes MUST be declared before their /:provider/:id counterparts so that
// Express does not match "tmdb" as a :provider value.
router.get('/v2/stream/tmdb/:tmdbId', apiController.resolveStream);
router.get('/v2/stream/auto/:tmdbId', apiController.resolveStreamAuto);



// Explicit provider stream (for user-initiated manual server switching).
router.get('/v2/stream/:provider/:id', apiController.stream);

// ─── Download Routes (alias stream resolvers to reuse provider resolution pipeline) ───
router.get('/v2/download/auto/:tmdbId', apiController.resolveStream);
router.get('/v2/download/:provider/:id', apiController.stream);

router.get('/v2/tmdb/:category', apiController.tmdbList);
router.get('/v2/tmdb/season/:tmdbId/:seasonNumber', apiController.seasonEpisodes);
router.get('/v2/stream/proxy', apiController.proxyStream);

// ─── Moviesda Download Routes ────────────────────────────────────────────────
router.use('/moviesda', moviesdaRouter);

// ─── Watch History Routes ─────────────────────────────────────────────────────
router.get('/v2/history', historyController.getHistory);
router.post('/v2/history', historyController.saveHistory);
router.delete('/v2/history/:type/:id', historyController.removeHistory);
router.delete('/v2/history', historyController.clearHistory);

module.exports = router;

