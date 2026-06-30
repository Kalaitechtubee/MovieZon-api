const axios = require('axios');

const domains = [
  'https://movieswood.cfd',
  'https://movieswood.click',
  'https://movieswood.ws',
  'https://movieswood.to',
  'https://movieswood.is',
  'https://movieswood.run',
  'https://movieswood.tv',
];

const SCRAPE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Connection': 'keep-alive'
};

async function testDomains() {
  console.log('Testing extra Movieswood domains...\n');
  for (const d of domains) {
    try {
      const res = await axios.get(d, { headers: SCRAPE_HEADERS, timeout: 3000 });
      const isCf = res.data && res.data.includes('cf-beacon') && res.data.length < 1500;
      console.log(`[SUCCESS] ${d} -> Status: ${res.status}, Length: ${res.data.length}, CF Challenged: ${isCf}`);
    } catch (err) {
      console.log(`[FAILED]  ${d} -> ${err.message}`);
    }
  }
}

testDomains();
