const registry = require('../provider-registry');
const logger = require('../logger');

class ProviderHealthService {
  constructor() {
    this.healthStatuses = new Map();
    this.intervalId = null;
  }

  /**
   * Start checking health periodically (e.g. every 5 minutes)
   */
  startHealthChecks(intervalMs = 300000) {
    logger.info('Starting background provider health checks...');
    
    // Run immediately on start
    this.checkAllProviders();

    // Schedule periodic checks
    this.intervalId = setInterval(() => {
      this.checkAllProviders();
    }, intervalMs);
  }

  /**
   * Stop background checks
   */
  stopHealthChecks() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('Background provider health checks stopped.');
    }
  }

  /**
   * Check health of all registered providers
   */
  async checkAllProviders() {
    const providers = registry.getAll();
    logger.debug(`Running health check for ${providers.length} provider(s)`);

    const checks = providers.map(async (provider) => {
      const startTime = Date.now();
      try {
        const result = await provider.health();
        const duration = Date.now() - startTime;
        
        this.healthStatuses.set(provider.name, {
          status: result.status || 'healthy',
          message: result.message || 'Operational',
          responseTimeMs: result.responseTimeMs || duration,
          lastChecked: new Date()
        });
      } catch (err) {
        const duration = Date.now() - startTime;
        logger.error(`Health check failed for provider ${provider.displayName}: ${err.message}`);
        this.healthStatuses.set(provider.name, {
          status: 'unhealthy',
          message: err.message || 'Connection failed',
          responseTimeMs: duration,
          lastChecked: new Date()
        });
      }
    });

    await Promise.all(checks);
  }

  /**
   * Get health status for a specific provider
   */
  getHealth(providerName) {
    const name = providerName.toLowerCase();
    return this.healthStatuses.get(name) || {
      status: 'unknown',
      message: 'Not checked yet',
      responseTimeMs: 0,
      lastChecked: null
    };
  }

  /**
   * Get health status for all providers
   */
  getAllHealth() {
    const statusObj = {};
    for (const [name, status] of this.healthStatuses.entries()) {
      statusObj[name] = status;
    }
    return statusObj;
  }
}

// Export singleton
module.exports = new ProviderHealthService();
