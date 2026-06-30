const axios = require('axios');
const cheerio = require('cheerio');

const BASE_URL = 'https://movieswood.me';

const SCRAPE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Connection': 'keep-alive'
};

async function testRootSearch(query) {
  const url = `${BASE_URL}/?q=${encodeURIComponent(query)}`;
  console.log(`Searching globally for "${query}" on ${url}...`);
  try {
    const res = await axios.get(url, { headers: SCRAPE_HEADERS, timeout: 5000 });
    console.log(`Status: ${res.status}, Body length: ${res.data.length}`);
    const $ = cheerio.load(res.data);
    const results = [];
    $('a').each((_, el) => {
      const href = $(el).attr('href') || '';
      const text = $(el).text().trim().replace(/\s+/g, ' ');
      if (href && (href.includes('?d=') || href.includes('/?d=')) && text) {
        results.push({ text, href });
      }
    });
    console.log(`Found ${results.length} global search results.`);
  } catch (err) {
    console.error(`Root Search Failed: ${err.message}`);
  }
}

async function testHomepageParse() {
  console.log(`Fetching homepage ${BASE_URL}...`);
  try {
    const res = await axios.get(BASE_URL, { headers: SCRAPE_HEADERS, timeout: 5000 });
    console.log(`Homepage Status: ${res.status}, Length: ${res.data.length}`);
    console.log(`Body snippet:`);
    console.log(res.data.slice(0, 500));
  } catch (err) {
    console.error(`Homepage Parse Failed: ${err.message}`);
  }
}

async function run() {
  await testRootSearch('baby');
  console.log('');
  await testHomepageParse();
}

run();
