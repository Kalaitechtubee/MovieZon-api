const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const PORT = process.env.PORT || 3000;
const BASE_URL = `http://localhost:${PORT}/api/movieswood`;

async function testEndpoints() {
  console.log(`Starting Movieswood backend endpoint checks on port ${PORT}...\n`);

  // Test 1: Health endpoint
  try {
    console.log(`Checking Health: GET ${BASE_URL}/health`);
    const healthRes = await axios.get(`${BASE_URL}/health`);
    console.log(`Health Status: ${healthRes.status}`);
    console.log(`Health Response:`, JSON.stringify(healthRes.data, null, 2));
    console.log('--- OK ---\n');
  } catch (err) {
    console.error(`Health check failed:`, err.message);
  }

  // Test 2: Search endpoint
  try {
    console.log(`Checking Search for "Karuppu": GET ${BASE_URL}/search?title=Karuppu&year=2026`);
    const searchRes = await axios.get(`${BASE_URL}/search`, {
      params: { title: 'Karuppu', year: '2026' }
    });
    console.log(`Search Status: ${searchRes.status}`);
    console.log(`Search Response Results Count: ${searchRes.data.results ? searchRes.data.results.length : 0}`);
    console.log(`Search First Result:`, JSON.stringify(searchRes.data.results?.[0], null, 2));
    console.log('--- OK ---\n');
  } catch (err) {
    console.error(`Search check failed:`, err.message);
  }

  // Test 3: Download/Stream resolution endpoint
  try {
    console.log(`Checking Download for "Karuppu": GET ${BASE_URL}/download?title=Karuppu&year=2026`);
    const downloadRes = await axios.get(`${BASE_URL}/download`, {
      params: { title: 'Karuppu', year: '2026' }
    });
    console.log(`Download Status: ${downloadRes.status}`);
    console.log(`Download Response Found: ${downloadRes.data.found}`);
    console.log(`Download Qualities Count: ${downloadRes.data.qualities ? downloadRes.data.qualities.length : 0}`);
    console.log(`Download Qualities:`, JSON.stringify(downloadRes.data.qualities, null, 2));
    console.log('--- OK ---\n');
  } catch (err) {
    console.error(`Download check failed:`, err.message);
  }
}

testEndpoints();
