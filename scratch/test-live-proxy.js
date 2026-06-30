const axios = require('axios');
const path = require('path');
const fs = require('fs');
const config = require('../src/config');

const BASE_URL = 'https://movieswood.cloud';
const SCRAPE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Connection': 'keep-alive'
};

async function testLive() {
  const url = `${BASE_URL}/telly/?q=baby`;
  console.log(`Fetching via Proxy: ${url}`);
  
  const proxyUrl = `${config.workerProxyUrl}/?url=${encodeURIComponent(url)}`;
  try {
    const res = await axios.get(proxyUrl, { timeout: 15000 });
    console.log(`Status: ${res.status}, Length: ${res.data.length}`);
    fs.writeFileSync(path.join(__dirname, 'live-proxy-output.html'), res.data);
    console.log('Saved response to scratch/live-proxy-output.html');
  } catch (err) {
    console.error(`Fetch failed: ${err.message}`);
  }
}

testLive();
