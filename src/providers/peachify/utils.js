const axios = require('axios');
const config = require('../../config');
const logger = require('../../logger');
const { URL } = require('url');

let proxyConfig = null;
let proxyDisabledUntil = 0; // Timestamp to bypass broken proxy temporarily

if (config.proxyUrl) {
  try {
    const parsedProxy = new URL(config.proxyUrl);
    proxyConfig = {
      protocol: parsedProxy.protocol.replace(':', ''),
      host: parsedProxy.hostname,
      port: parseInt(parsedProxy.port, 10),
    };
    if (parsedProxy.username || parsedProxy.password) {
      proxyConfig.auth = {
        username: decodeURIComponent(parsedProxy.username),
        password: decodeURIComponent(parsedProxy.password)
      };
    }
    logger.info(`[Peachify] Proxy configured successfully: ${proxyConfig.host}:${proxyConfig.port}`);
  } catch (e) {
    logger.warn(`[Peachify] Failed to parse PROXY_URL: ${e.message}`);
  }
}

/**
 * Perform a GET request to the Peachify endpoint, utilizing proxy and falling back to a CF Worker proxy on failure.
 */
async function peachifyGet(url, options = {}) {
  const reqOptions = { ...options };
  let usedProxy = false;
  const now = Date.now();
  if (proxyConfig && now > proxyDisabledUntil) {
    reqOptions.proxy = proxyConfig;
    usedProxy = true;
  }
  
  let lastError = null;
  try {
    return await axios.get(url, reqOptions);
  } catch (err) {
    lastError = err;
    if (usedProxy) {
      logger.warn(`[Peachify] Proxy request failed for: ${url}. Error: ${err.message}. Retrying TRULY directly (without proxy)...`);
      
      const isProxyStatusError = err.response && (err.response.status === 402 || err.response.status === 407);
      const isProxyNetError = err.code && ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EHOSTUNREACH'].includes(err.code);
      if (isProxyStatusError || isProxyNetError) {
        proxyDisabledUntil = Date.now() + 5 * 60 * 1000;
        logger.warn(`[Peachify] Proxy returned error (${err.message}). Bypassing proxy for 5 minutes.`);
      }

      try {
        const directOptions = { ...options };
        return await axios.get(url, { ...directOptions, proxy: false });
      } catch (directErr) {
        lastError = directErr;
        logger.warn(`[Peachify] Truly direct request also failed for: ${url}. Error: ${directErr.message}. Retrying via Cloudflare Worker proxy...`);
      }
    } else {
      logger.warn(`[Peachify] Direct request failed for: ${url}. Error: ${err.message}. Retrying via Cloudflare Worker proxy...`);
    }

    // CF Worker Proxy Fallback
    const headersToForward = options.headers
      ? JSON.stringify(options.headers)
      : JSON.stringify({
          'Referer': 'https://peachify.top/',
          'Origin': 'https://peachify.top',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });
    const proxyUrl = `https://streamhub-proxy.1545zoya.workers.dev/?url=${encodeURIComponent(url)}&headers=${encodeURIComponent(headersToForward)}`;
    try {
      const res = await axios.get(proxyUrl, { timeout: options.timeout || 8000 });
      logger.info(`[Peachify Proxy] Successfully fetched via Cloudflare Worker proxy: ${url}`);
      return res;
    } catch (proxyErr) {
      lastError = proxyErr;
      logger.error(`[Peachify Proxy] Cloudflare Worker proxy request also failed: ${proxyErr.message}`);
      throw lastError;
    }
  }
}

module.exports = {
  peachifyGet
};
