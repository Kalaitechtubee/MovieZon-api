const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const config = require('../config');
const logger = require('../logger');
const apiRoutes = require('../routes/api');
const apiController = require('../controllers/apiController');

const app = express();

// Disable ETag generation to prevent caching of dynamic/short-lived stream URLs
app.disable('etag');

// Security Middlewares
// Disable Helmet contentSecurityPolicy if we are loading remote videos, or adjust it
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  })
);
app.use(cors());

// Serve static assets from public folder.
app.use(express.static(path.join(__dirname, '../../public')));

// Body Parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// HTTP Request Logger using Morgan wired to Winston
const morganFormat = config.isDev ? 'dev' : 'combined';
app.use(morgan(morganFormat, {
  stream: {
    write: (message) => logger.http(message.trim())
  }
}));

// API Routes
app.use('/api', apiRoutes);
app.get('/health', apiController.health);

// 404 handler
app.use((req, res, next) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.originalUrl}`
  });
});

// Centralized error handler
app.use((err, req, res, next) => {
  logger.error(`${err.message} - ${req.method} ${req.originalUrl} - IP: ${req.ip}`, { stack: err.stack });

  const responseStatus = err.status || 500;
  const isProduction = config.env === 'production';

  res.status(responseStatus).json({
    error: err.name || 'Internal Server Error',
    message: err.message || 'An unexpected error occurred.',
    ...(isProduction ? {} : { stack: err.stack })
  });
});

module.exports = app;
