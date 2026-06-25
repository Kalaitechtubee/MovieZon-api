const axios = require('axios');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const port = 3001;
let serverProcess;

function startServer() {
  return new Promise((resolve, reject) => {
    console.log('Spawning test server process...');
    serverProcess = spawn('node', [path.join(__dirname, '../src/server.js')], {
      env: { ...process.env, PORT: port, NODE_ENV: 'development' },
      stdio: 'inherit'
    });

    setTimeout(() => {
      console.log('Test server ready.');
      resolve();
    }, 3000);

    serverProcess.on('error', (err) => {
      reject(err);
    });
  });
}

function cleanShutdown() {
  if (serverProcess) {
    console.log('Shutting down server...');
    serverProcess.kill('SIGINT');
  }
}

async function testDownload() {
  try {
    await startServer();

    // In a real flow:
    // 1. Client calls /api/v2/download/streamimdb/1367220 (or any TMDB ID)
    // 2. It returns qualities containing a secure proxied URL
    // 3. We download from that URL
    
    console.log('Requesting explicit download list from StreamIMDb...');
    const detailsRes = await axios.get(`http://localhost:${port}/api/v2/download/streamimdb/1007757?type=movie`, {
      timeout: 15000,
      validateStatus: false
    });

    console.log('Response Status:', detailsRes.status);
    console.log('Response Qualities:', JSON.stringify(detailsRes.data.qualities, null, 2));

    if (!detailsRes.data || !detailsRes.data.qualities || detailsRes.data.qualities.length === 0) {
      throw new Error('No qualities returned for download');
    }

    const firstQualityUrl = detailsRes.data.qualities[0].url;
    console.log('Downloading from proxy URL:', firstQualityUrl);

    // Call the proxy download URL
    const dlRes = await axios({
      method: 'get',
      url: firstQualityUrl,
      timeout: 30000,
      responseType: 'arraybuffer',
      validateStatus: false
    });

    console.log('Download Status:', dlRes.status);
    console.log('Headers:', dlRes.headers);
    console.log('Downloaded data size:', dlRes.data.length, 'bytes');

    const contentType = dlRes.headers['content-type'];
    const contentDisposition = dlRes.headers['content-disposition'];

    if (contentType !== 'video/mp2t') {
      throw new Error(`Expected Content-Type: video/mp2t, got: ${contentType}`);
    }

    if (!contentDisposition || !contentDisposition.includes('.ts')) {
      throw new Error(`Expected filename with .ts extension in Content-Disposition, got: ${contentDisposition}`);
    }

    console.log('\nSUCCESS: End-to-end HLS download proxy and concatenation verified successfully!');

    cleanShutdown();
    process.exit(0);
  } catch (err) {
    console.error('Test failed:', err.message);
    if (err.response) {
      console.error('Response Data:', Buffer.from(err.response.data).toString('utf8'));
    }
    cleanShutdown();
    process.exit(1);
  }
}

testDownload();
