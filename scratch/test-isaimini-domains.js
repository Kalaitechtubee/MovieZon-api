const axios = require('axios');

const domains = [
  'https://isaimini.lol',
  'https://isaimini.site',
  'https://isaimini.vip',
  'https://isaimini.co',
  'https://isaimini.net',
  'https://isaimini.rocks',
  'https://isaimini.icu',
  'https://isaimini.best',
  'https://isaimini.club'
];

const SCRAPE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Connection': 'keep-alive'
};

async function testDomains() {
  console.log('Testing Isaimini domains for reachability...\n');
  for (const d of domains) {
    try {
      const res = await axios.get(d, { headers: SCRAPE_HEADERS, timeout: 3000 });
      const isCf = res.data && res.data.includes('cf-beacon') && res.data.length < 1500;
      console.log(`[SUCCESS] ${d} -> Status: ${res.status}, Length: ${res.data.length}, CF Challenged: ${isCf}`);
      if (res.data.length > 5000) {
        console.log(`>>> FOUND ACTIVE ISAIMINI MIRROR: ${d} <<<`);
      }
    } catch (err) {
      console.log(`[FAILED]  ${d} -> ${err.message}`);
    }
  }
}

testDomains();
