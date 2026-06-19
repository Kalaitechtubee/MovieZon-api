const NodeCache = require('node-cache');
const config = require('../config');
const logger = require('../logger');

// Extensible Cache Layer wrapper (can be easily swapped to Redis later)
class CacheService {
  constructor() {
    this.cache = new NodeCache({
      stdTTL: config.cacheTtl,
      checkperiod: Math.floor(config.cacheTtl * 0.2), // check expired keys periodically
      useClones: true
    });
    
    logger.info('In-memory Cache service initialized with default TTL of ' + config.cacheTtl + ' seconds');
  }

  get(key) {
    const val = this.cache.get(key);
    if (val !== undefined) {
      logger.debug(`Cache HIT for key: ${key}`);
      return val;
    }
    logger.debug(`Cache MISS for key: ${key}`);
    return null;
  }

  set(key, value, ttl = config.cacheTtl) {
    logger.debug(`Cache SET for key: ${key} with TTL: ${ttl}`);
    return this.cache.set(key, value, ttl);
  }

  del(key) {
    logger.debug(`Cache DEL for key: ${key}`);
    return this.cache.del(key);
  }

  flush() {
    logger.info('Cache flushed');
    return this.cache.flushAll();
  }
  
  // Method to check cache health
  getStats() {
    return this.cache.getStats();
  }
}

// Singleton pattern
module.exports = new CacheService();
