const axios = require('axios');
const config = require('../config');
const logger = require('../logger');

// Create Axios Instance
const client = axios.create({
  timeout: config.http.timeout,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://net27.cc/'
  }
});

// Axios Request Interceptor for logging
client.interceptors.request.use((req) => {
  req.metadata = { startTime: new Date() };
  logger.debug(`HTTP Request: [${req.method.toUpperCase()}] ${req.url}`);
  return req;
}, (error) => {
  return Promise.reject(error);
});

// Axios Response Interceptor for logging
client.interceptors.response.use((res) => {
  const duration = new Date() - res.config.metadata.startTime;
  logger.debug(`HTTP Response: [${res.status}] ${res.config.url} - ${duration}ms`);
  return res;
}, (error) => {
  const duration = error.config?.metadata ? new Date() - error.config.metadata.startTime : 0;
  const status = error.response ? error.response.status : 'NETWORK_ERROR';
  logger.warn(`HTTP Request Failed: [${status}] ${error.config?.url || 'Unknown URL'} - ${duration}ms - Error: ${error.message}`);
  return Promise.reject(error);
});

// HttpClient Wrapper with retry logic
const httpClient = {
  async get(url, options = {}) {
    const retries = options.retries !== undefined ? options.retries : config.http.retries;
    let attempt = 0;
    
    while (attempt <= retries) {
      try {
        const response = await client.get(url, options);
        return response.data;
      } catch (error) {
        attempt++;
        const isNetworkError = !error.response;
        const isServerError = error.response && error.response.status >= 500;
        
        if (attempt > retries || (!isNetworkError && !isServerError)) {
          throw error;
        }
        
        const delay = Math.pow(2, attempt) * 300; // Exponential backoff: 600ms, 1200ms, 2400ms...
        logger.info(`Retrying GET ${url} (Attempt ${attempt}/${retries}) in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  },

  async post(url, data, options = {}) {
    const retries = options.retries !== undefined ? options.retries : config.http.retries;
    let attempt = 0;
    
    while (attempt <= retries) {
      try {
        const response = await client.post(url, data, options);
        return response.data;
      } catch (error) {
        attempt++;
        const isNetworkError = !error.response;
        const isServerError = error.response && error.response.status >= 500;
        
        if (attempt > retries || (!isNetworkError && !isServerError)) {
          throw error;
        }
        
        const delay = Math.pow(2, attempt) * 300;
        logger.info(`Retrying POST ${url} (Attempt ${attempt}/${retries}) in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
};

module.exports = httpClient;
