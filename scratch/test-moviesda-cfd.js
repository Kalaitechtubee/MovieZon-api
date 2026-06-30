const axios = require('axios');
const cheerio = require('cheerio');

const SCRAPE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Connection': 'keep-alive'
};

async function run() {
  const url = 'https://moviesda.cfd/';
  console.log(`Fetching Moviesda.cfd: ${url}...`);
  try {
    const res = await axios.get(url, { headers: SCRAPE_HEADERS, timeout: 5000 });
    console.log(`Status: ${res.status}, Length: ${res.data.length}`);
    const $ = cheerio.load(res.data);
    
    const links = [];
    $('a').each((_, el) => {
      const href = $(el).attr('href') || '';
      const text = $(el).text().trim().replace(/\s+/g, ' ');
      if (href && text) {
        links.push({ text, href });
      }
    });
    
    console.log(`Found ${links.length} links on Moviesda.cfd.`);
    console.log(`First 40 links:`);
    links.slice(0, 40).forEach((l, i) => {
      console.log(`  ${i+1}. ${l.text} -> ${l.href}`);
    });
  } catch (err) {
    console.error('Failed:', err.message);
  }
}

run();
