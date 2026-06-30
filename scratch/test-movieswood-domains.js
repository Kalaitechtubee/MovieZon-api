const axios = require('axios');

const domains = [
  'https://movieswood.cloud',
  'https://movieswood.cool',
  'https://movieswood.rocks',
  'https://movieswood.vip',
  'https://movieswood.link',
  'https://movieswood.me',
  'https://movieswood.org',
  'https://movieswood.net',
  'https://movieswood.cc',
  'https://movieswood.co',
  'https://movieswood.mobi',
  'https://movieswood.best',
  'https://movieswood.icu',
  'https://movieswood.xyz',
  'https://movieswood.pw',
  'https://movieswood.top',
  'https://movieswood.info',
  'https://movieswood.club',
  'https://movieswood.space',
  'https://movieswood.fun',
  'https://movieswood.site',
  'https://movieswood.online',
  'https://movieswood.live',
  'https://movieswood.cloud/telly/'
];

const SCRAPE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Connection': 'keep-alive'
};

async function testDomains() {
  console.log('Testing Movieswood domains for direct reachability...\n');
  for (const d of domains) {
    try {
      const res = await axios.get(d, { headers: SCRAPE_HEADERS, timeout: 3000 });
      const isCf = res.data && res.data.includes('cf-beacon') && res.data.length < 1500;
      console.log(`[SUCCESS] ${d} -> Status: ${res.status}, Length: ${res.data.length}, CF Challenged: ${isCf}`);
      if (!isCf && res.data.length > 5000) {
        console.log(`>>> FOUND DIRECT WORKING DOMAIN: ${d} <<<`);
      }
    } catch (err) {
      console.log(`[FAILED]  ${d} -> ${err.message}`);
    }
  }
}

testDomains();
