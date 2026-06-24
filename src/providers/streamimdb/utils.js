const axios = require('axios');
const logger = require('../../logger');

const DEFAULT_HEADERS = {
  'Referer': 'https://nextgencloudfabric.com/',
  'Origin': 'https://nextgencloudfabric.com/',
  'X-Requested-With': 'XMLHttpRequest',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

/**
 * Fetch helper for streamdata API
 */
async function streamimdbGet(url, options = {}) {
  const reqHeaders = {
    ...DEFAULT_HEADERS,
    ...(options.headers || {})
  };
  
  return await axios.get(url, {
    ...options,
    headers: reqHeaders,
    timeout: options.timeout || 6000
  });
}

module.exports = {
  streamimdbGet,
  DEFAULT_HEADERS
};
