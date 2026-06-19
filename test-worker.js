const axios = require('axios');

const cdnUrl = 'https://bcdnxw.hakunaymatata.com/resource/e9f7f50cd17ea9b81a8904e639b12a00.mp4?sign=7c8a8c6a93676cf012b7cb50b17a794f&t=1781852844';
const workerUrl = `https://streamhub-proxy.1545zoya.workers.dev/?url=${encodeURIComponent(cdnUrl)}`;

async function test(name, headers = {}) {
  try {
    const res = await axios({
      method: 'get',
      url: workerUrl,
      headers: {
        'Range': 'bytes=0-100',
        ...headers
      },
      timeout: 5000,
      validateStatus: false
    });
    console.log(`[${name}] Status: ${res.status}, Content-Length: ${res.headers['content-length']}, ETag: ${res.headers['etag']}`);
  } catch (err) {
    console.log(`[${name}] Error: ${err.message}`);
  }
}

async function run() {
  console.log("Testing streamhub-proxy with browser-like headers...\n");

  // Test 1: No Referer/Origin (Node default, succeeded before)
  await test("No Referer/Origin");

  // Test 2: Localhost Referer
  await test("Localhost Referer", {
    'Referer': 'http://127.0.0.1:5500/'
  });

  // Test 3: Localhost Origin
  await test("Localhost Origin", {
    'Origin': 'http://127.0.0.1:5500'
  });

  // Test 4: Localhost Referer + Origin
  await test("Localhost Referer + Origin", {
    'Referer': 'http://127.0.0.1:5500/',
    'Origin': 'http://127.0.0.1:5500'
  });

  // Test 5: Render Referer + Origin
  await test("Render Referer + Origin", {
    'Referer': 'https://moviezon-api.onrender.com/',
    'Origin': 'https://moviezon-api.onrender.com'
  });
}

run();
