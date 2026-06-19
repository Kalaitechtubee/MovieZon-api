const axios = require('axios');

async function check() {
  const url = 'https://net27.cc/api/catalog/search-hybrid?q=Amaran';
  try {
    const res = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://net27.cc/'
      },
      validateStatus: false
    });
    console.log("Status Code:", res.status);
    if (res.data && res.data.items) {
      const match = res.data.items.find(item => String(item.tmdbId) === '927342');
      console.log("Matched Item in Search:", JSON.stringify(match, null, 2));
    } else {
      console.log("No items found.");
    }
  } catch (err) {
    console.error("Error:", err.message);
  }
}

check();
