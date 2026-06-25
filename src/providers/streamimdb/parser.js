'use strict';
/**
 * StreamIMDb playlist parser.
 * parseQualitiesFromMaster lives in utils.js to avoid circular imports.
 * Re-exported here for backwards compatibility with any direct imports of this module.
 */
const { parseQualitiesFromMaster } = require('./utils');

module.exports = {
  parseQualitiesFromMaster
};
