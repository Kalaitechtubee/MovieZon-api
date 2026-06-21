const express = require('express');
const apiController = require('../controllers/apiController');

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

// Backend-controlled sequential download pipeline.
// The backend decides which provider to use — the frontend NEVER picks a provider for downloads.
// Peachify (embed-only) is automatically skipped; NetMirror is always tried first.
router.get('/v2/download/tmdb/:tmdbId', apiController.resolveDownload);

// Explicit provider stream (for user-initiated manual server switching).
router.get('/v2/stream/:provider/:id', apiController.stream);

router.get('/v2/tmdb/:category', apiController.tmdbList);
router.get('/v2/tmdb/season/:tmdbId/:seasonNumber', apiController.seasonEpisodes);
router.get('/v2/stream/proxy', apiController.proxyStream);

module.exports = router;

