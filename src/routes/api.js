const express = require('express');
const apiController = require('../controllers/apiController');

const router = express.Router();

// Define routes
router.get('/search', apiController.search);
router.get('/details/:provider/:id', apiController.details);
router.get('/stream/:provider/:id', apiController.stream);
router.get('/providers', apiController.providers);
router.get('/health', apiController.health);
router.get('/proxy-stream', apiController.proxyStream);

module.exports = router;
