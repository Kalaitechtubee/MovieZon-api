const axios = require('axios');
const cheerio = require('cheerio');

const BASE_URL = 'https://movieswood.cloud';

const SCRAPE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Connection': 'keep-alive'
};

async function testSearch(query) {
  // We can try to search under /telly/ or /
  const searchUrl = `${BASE_URL}/telly/?q=${encodeURIComponent(query)}`;
  console.log(`Testing search at: ${searchUrl}`);
  try {
    const res = await axios.get(searchUrl, {
      headers: SCRAPE_HEADERS,
      timeout: 10000
    });
    console.log(`Search status: ${res.status}`);
    const $ = cheerio.load(res.data);
    
    // Let's print out some elements to see the structure
    console.log('Body length:', res.data.length);
    console.log('Body content:', res.data);
    console.log('Titles found on page:');
    
    // Look for class .mylist
    $('.mylist').each((i, el) => {
      const a = $(el).find('a').first();
      const title = a.text().trim();
      const href = a.attr('href');
      console.log(`- Title: ${title}, Link: ${href}, Tags: ${$(el).attr('data-tags')}`);
    });
    
    // Also look for cards (Screenshot 4 shows search results as card grids)
    console.log('Cards found on page:');
    $('.card, .browse, .layout').each((i, el) => {
      console.log(`Element ${i}: class="${$(el).attr('class')}" id="${$(el).attr('id')}"`);
    });
    
    // Let's dump links in class "mylist" or "card"
    $('a').each((i, el) => {
      const text = $(el).text().trim();
      const href = $(el).attr('href');
      if (href && (href.includes('?d=') || href.includes('?q='))) {
        console.log(`Link: text="${text}", href="${href}"`);
      }
    });

  } catch (err) {
    console.error(`Search error: ${err.message}`);
    if (err.response) {
      console.error(`Status: ${err.response.status}`);
    }
  }
}

testSearch('Blast');
