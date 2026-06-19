const http = require('http');
const app = require('./app');
const config = require('./config');
const logger = require('./logger');
const healthService = require('./provider-health');

// Create HTTP Server
const server = http.createServer(app);

// Start Server
server.listen(config.port, () => {
  logger.info(`=================================================`);
  logger.info(` MovieZon Backend is starting...`);
  logger.info(` Environment : ${config.env}`);
  logger.info(` Port        : ${config.port}`);
  logger.info(` Base URL    : http://localhost:${config.port}`);
  logger.info(`=================================================`);

  // Start background health checking for providers
  // Runs every 5 minutes (300000ms)
  healthService.startHealthChecks(300000);
});

// Graceful Shutdown
const handleShutdown = (signal) => {
  logger.info(`Received ${signal}. Shutting down gracefully...`);
  
  // Stop background activities
  healthService.stopHealthChecks();

  // Stop accepting new connections
  server.close(() => {
    logger.info('HTTP server closed.');
    logger.info('Graceful shutdown completed successfully.');
    process.exit(0);
  });

  // Force shutdown after 10s if connections didn't drain
  setTimeout(() => {
    logger.warn('Force shutting down as connections did not drain in time.');
    process.exit(1);
  }, 10000);
};

// Listen to shutdown signals
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

// Catch unhandled rejections and exceptions
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  // Give logger time to write logs then exit
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});
