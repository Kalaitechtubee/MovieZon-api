const axios = require('axios');

async function test() {
  try {
    // 1. Get details
    const detailsRes = await axios.get('http://localhost:3000/api/v2/details/tmdb/1007757?type=movie');
    console.log('=== DETAILS SOURCES ===');
    console.log(JSON.stringify(detailsRes.data.details.sources, null, 2));
    
    // 2. Get stream
    const streamRes = await axios.get('http://localhost:3000/api/v2/stream/tmdb/1007757?type=movie');
    console.log('\n=== STREAM VARIANTS ===');
    console.log(JSON.stringify(streamRes.data.variants, null, 2));
    console.log('Selected Variant ID:', streamRes.data.selectedVariantId);
  } catch (err) {
    console.error('Error:', err.message);
  }
}

test();
