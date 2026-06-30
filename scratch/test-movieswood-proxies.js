const axios = require('axios');
const { URL } = require('url');

const TARGET_URL = 'https://movieswood.cloud/telly/?q=baby';

const SCRAPE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Connection': 'keep-alive'
};

const PROXIES = [
  'http://flpwszil:3ui2w06zs9i2@31.59.20.176:6754',
  'http://flpwszil:3ui2w06zs9i2@31.56.127.193:7684',
  'http://flpwszil:3ui2w06zs9i2@45.38.107.97:6014',
  'http://flpwszil:3ui2w06zs9i2@38.154.203.95:5863',
  'http://flpwszil:3ui2w06zs9i2@198.105.121.200:6462',
  'http://flpwszil:3ui2w06zs9i2@64.137.96.74:6641',
  'http://flpwszil:3ui2w06zs9i2@198.23.243.226:6361',
  'http://flpwszil:3ui2w06zs9i2@38.154.185.97:6370',
  'http://flpwszil:3ui2w06zs9i2@142.111.67.146:5611',
  'http://flpwszil:3ui2w06zs9i2@191.96.254.138:6185'
];

const WORKER_PROXY = 'https://streamhub-proxy.1545zoya.workers.dev';

function parseProxyUrl(proxyUrlStr) {
  const parsed = new URL(proxyUrlStr);
  const pConfig = {
    protocol: parsed.protocol.replace(':', ''),
    host: parsed.hostname,
    port: parseInt(parsed.port, 10),
  };
  if (parsed.username || parsed.password) {
    pConfig.auth = {
      username: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password)
    };
  }
  return pConfig;
}

async function testDirect() {
  console.log(`[TEST] Direct request to ${TARGET_URL}...`);
  try {
    const res = await axios.get(TARGET_URL, { headers: SCRAPE_HEADERS, timeout: 5000 });
    const isCf = res.data && res.data.includes('cf-beacon') && res.data.length < 1500;
    console.log(`-> Direct Success! Status: ${res.status}, Length: ${res.data.length}, Cloudflare Challenged: ${isCf}`);
  } catch (err) {
    console.log(`-> Direct Failed: ${err.message}`);
  }
}

async function testWorker() {
  console.log(`[TEST] Worker Proxy request to ${TARGET_URL}...`);
  const proxyUrl = `${WORKER_PROXY}/?url=${encodeURIComponent(TARGET_URL)}&headers=${encodeURIComponent(JSON.stringify(SCRAPE_HEADERS))}`;
  try {
    const res = await axios.get(proxyUrl, { timeout: 10000 });
    const isCf = res.data && res.data.includes('cf-beacon') && res.data.length < 1500;
    console.log(`-> Worker Proxy Success! Status: ${res.status}, Length: ${res.data.length}, Cloudflare Challenged: ${isCf}`);
  } catch (err) {
    console.log(`-> Worker Proxy Failed: ${err.message}`);
  }
}

async function testProxies() {
  for (let i = 0; i < PROXIES.length; i++) {
    const proxyStr = PROXIES[i];
    console.log(`[TEST] SOCKS/HTTP Proxy #${i+1} (${proxyStr.split('@')[1]})...`);
    try {
      const parsedProxy = parseProxyUrl(proxyStr);
      const res = await axios.get(TARGET_URL, {
        headers: SCRAPE_HEADERS,
        proxy: parsedProxy,
        timeout: 6000
      });
      const isCf = res.data && res.data.includes('cf-beacon') && res.data.length < 1500;
      console.log(`-> Proxy Success! Status: ${res.status}, Length: ${res.data.length}, Cloudflare Challenged: ${isCf}`);
      if (!isCf && res.data.length > 5000) {
        console.log(`SUCCESS! This proxy resolved the page cleanly!`);
      }
    } catch (err) {
      console.log(`-> Proxy Failed: ${err.message}`);
    }
  }
}

async function run() {
  await testDirect();
  console.log('');
  await testWorker();
  console.log('');
  await testProxies();
}

run();
