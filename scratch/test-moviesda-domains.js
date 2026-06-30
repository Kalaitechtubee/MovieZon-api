const axios = require('axios');

const domains = [
  'https://moviesda33.com',
  'https://moviesda.blue',
  'https://moviesda.mobi',
  'https://moviesda.top',
  'https://moviesda.rocks',
  'https://moviesda.cfd',
  'https://moviesda.run',
  'https://moviesda.vip',
  'https://moviesda.co',
  'https://moviesda.me',
  'https://moviesda.net',
  'https://moviesda.org',
  'https://moviesda.cc',
  'https://moviesda.best',
  'https://moviesda.icu',
  'https://moviesda.cx'
];

const SCRAPE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Connection': 'keep-alive'
};

async function testDomains() {
  console.log('Testing Moviesda domains for reachability...\n');
  for (const d of domains) {
    try {
      const res = await axios.get(d, { headers: SCRAPE_HEADERS, timeout: 3000 });
      const isCf = res.data && res.data.includes('cf-beacon') && res.data.length < 1500;
      console.log(`[SUCCESS] ${d} -> Status: ${res.status}, Length: ${res.data.length}, CF Challenged: ${isCf}`);
      if (res.data.length > 5000 && !res.data.includes('Moviesda is now')) {
        console.log(`>>> FOUND ACTIVE MOVIESDA MIRROR: ${d} <<<`);
      }
    } catch (err) {
      console.log(`[FAILED]  ${d} -> ${err.message}`);
    }
  }
}

testDomains();
