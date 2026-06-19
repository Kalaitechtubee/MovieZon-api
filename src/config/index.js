require('dotenv').config();
const path = require('path');

const config = {
  port: parseInt(process.env.PORT, 10) || 3000,
  env: process.env.NODE_ENV || 'development',
  isDev: (process.env.NODE_ENV || 'development') === 'development',
  cacheTtl: parseInt(process.env.CACHE_TTL, 10) || 3600,
  
  // Providers config
  providerPriority: (process.env.PROVIDER_PRIORITY || 'netmirror')
    .split(',')
    .map(p => p.trim().toLowerCase())
    .filter(Boolean),
  
  // NetMirror config
  netmirror: {
    baseUrl: process.env.NETMIRROR_BASE_URL || 'https://net27.cc',
    fallbackFile: path.resolve(process.env.NETMIRROR_FALLBACK_FILE || './src/providers/netmirror/data/net27.cc-capture.json')
  },
  
  // HTTP defaults
  http: {
    timeout: parseInt(process.env.HTTP_TIMEOUT, 10) || 10000,
    retries: parseInt(process.env.HTTP_RETRIES, 10) || 3
  }
};

module.exports = config;
