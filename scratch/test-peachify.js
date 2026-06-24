const axios = require('axios');
const { URL } = require('url');

const proxies = [
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

async function testProxies() {
  const url = 'https://uwu.eat-peach.sbs/moviebox/movie/1007757';
  
  for (let i = 0; i < proxies.length; i++) {
    const proxyString = proxies[i];
    const parsedProxy = new URL(proxyString);
    const proxyConfig = {
      protocol: parsedProxy.protocol.replace(':', ''),
      host: parsedProxy.hostname,
      port: parseInt(parsedProxy.port, 10),
      auth: {
        username: decodeURIComponent(parsedProxy.username),
        password: decodeURIComponent(parsedProxy.password)
      }
    };
    
    try {
      const res = await axios.get(url, {
        proxy: proxyConfig,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://peachify.top/',
          'Origin': 'https://peachify.top'
        },
        timeout: 4000
      });
      console.log(`[Proxy ${proxyConfig.host}:${proxyConfig.port}] Success! Status: ${res.status}`);
    } catch (err) {
      console.log(`[Proxy ${proxyConfig.host}:${proxyConfig.port}] Failed: ${err.message}, status: ${err.response?.status}`);
    }
  }
}

testProxies();
