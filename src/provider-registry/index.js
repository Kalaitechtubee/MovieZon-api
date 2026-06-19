const fs = require('fs');
const path = require('path');
const BaseProvider = require('../providers/BaseProvider');
const logger = require('../logger');

class ProviderRegistry {
  constructor() {
    this.providers = new Map();
  }

  /**
   * Scan the providers directory and register all valid providers.
   * This allows new providers to be registered dynamically just by creating a subfolder.
   */
  initialize() {
    const providersPath = path.join(__dirname, '../providers');
    logger.info(`Scanning providers directory at: ${providersPath}`);

    try {
      const items = fs.readdirSync(providersPath);
      
      for (const item of items) {
        const itemPath = path.join(providersPath, item);
        const stats = fs.statSync(itemPath);

        // Check if it's a directory (representing a provider)
        if (stats.isDirectory()) {
          const entryPoint = path.join(itemPath, 'index.js');
          if (fs.existsSync(entryPoint)) {
            try {
              const ProviderClass = require(entryPoint);
              
              // Validate that it extends BaseProvider
              if (ProviderClass.prototype instanceof BaseProvider) {
                const providerInstance = new ProviderClass();
                const name = providerInstance.name;
                
                this.providers.set(name, providerInstance);
                logger.info(`Successfully registered provider: ${providerInstance.displayName}`);
              } else {
                logger.warn(`Skipping provider directory '${item}': Class does not extend BaseProvider.`);
              }
            } catch (err) {
              logger.error(`Failed to load provider at '${entryPoint}': ${err.message}`, err);
            }
          } else {
            logger.warn(`Skipping provider directory '${item}': Missing index.js entry point.`);
          }
        }
      }

      logger.info(`Provider Registry initialized. Total providers loaded: ${this.providers.size}`);
    } catch (err) {
      logger.error(`Error scanning providers directory: ${err.message}`, err);
    }
  }

  /**
   * Get a registered provider by name
   * @param {string} name - Provider identifier
   * @returns {BaseProvider} Provider instance
   */
  get(name) {
    if (!name) return null;
    return this.providers.get(name.toLowerCase()) || null;
  }

  /**
   * Get all registered providers as an array
   * @returns {Array<BaseProvider>}
   */
  getAll() {
    return Array.from(this.providers.values());
  }
}

// Export as a singleton
module.exports = new ProviderRegistry();
