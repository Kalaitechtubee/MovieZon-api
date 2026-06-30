const axios = require('axios');
const cheerio = require('cheerio');

const BASE_URL = 'https://isaimini.lol';
const SCRAPE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Connection': 'keep-alive'
};

async function testHomepage() {
  const url = BASE_URL;
  console.log(`[TEST] Fetching homepage links on ${url}...`);
  try {
    const res = await axios.get(url, { headers: SCRAPE_HEADERS, timeout: 5000 });
    console.log(`Status: ${res.status}, Length: ${res.data.length}`);
    const $ = cheerio.load(res.data);
    const results = [];
    $('a').each((_, el) => {
      const href = $(el).attr('href') || '';
      const text = $(el).text().trim().replace(/\s+/g, ' ');
      if (href && text) {
        results.push({ text, href });
      }
    });
    console.log(`Found ${results.length} links on page.`);
    results.slice(0, 30).forEach((r, i) => {
      console.log(`   ${i+1}. ${r.text} -> ${r.href}`);
    });
  } catch (err) {
    console.error('Failed:', err.message);
  }
}

async function run() {
  await testHomepage();
}

run();
