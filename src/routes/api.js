const express = require('express');
const apiController = require('../controllers/apiController');

const router = express.Router();

// Define routes
router.get('/search', apiController.search);
router.get('/details/:provider/:id', apiController.details);
router.get('/details/:id', apiController.unifiedDetails);
router.get('/stream/:provider/:id', apiController.stream);
router.get('/providers', apiController.providers);
router.get('/health', apiController.health);
router.get('/proxy-stream', apiController.proxyStream);

// V2 Route Equivalents
router.get('/v2/search', apiController.search);
router.get('/v2/details/tmdb/:id', apiController.unifiedDetails);
router.get('/v2/details/:provider/:id', apiController.details);
router.get('/v2/stream/:provider/:id', apiController.stream);
router.get('/v2/tmdb/:category', apiController.tmdbList);
router.get('/v2/tmdb/season/:tmdbId/:seasonNumber', apiController.seasonEpisodes);
router.get('/v2/stream/proxy', apiController.proxyStream);

module.exports = router;
