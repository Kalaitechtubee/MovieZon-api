require('dotenv').config();
const path = require('path');

const config = {
  port: parseInt(process.env.PORT, 10) || 3000,
  env: process.env.NODE_ENV || 'development',
  isDev: (process.env.NODE_ENV || 'development') === 'development' && !process.env.RENDER,
  cacheTtl: parseInt(process.env.CACHE_TTL, 10) || 3600,
  proxyUrl: process.env.PROXY_URL || null,
  
  // Providers config — order defines the deterministic resolution pipeline.
  // Provider 1 (index 0) is always tried first. Fallback proceeds in order.
  // To add a new provider: create its folder, then append its name here.
  providerPriority: (process.env.PROVIDER_PRIORITY || 'peachify')
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
  },
  
  // TMDB API Configuration
  tmdb: {
    baseUrl: process.env.TMDB_BASE_URL || 'https://api.tmdb.org/3',
    apiKey: process.env.TMDB_API_KEY || '5bc6f3e00a5718a03b7bec56352790c6'
  }
};

module.exports = config;
