const axios = require('axios');

async function testProd() {
  const url = 'https://moviezon-api.onrender.com/api/v2/download/tmdb/1007757?type=movie';
  console.log(`Querying production API: ${url}...`);
  try {
    const res = await axios.get(url, { timeout: 10000 });
    console.log("Success! Status:", res.status);
    console.log("Response Data:", JSON.stringify(res.data, null, 2));
  } catch (err) {
    console.log("Failed! Error:", err.message);
    if (err.response) {
      console.log("Status:", err.response.status);
      console.log("Data:", JSON.stringify(err.response.data, null, 2));
    }
  }
}

testProd();
