const dns = require('dns');
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}

const axios = require('axios');
const { spawn } = require('child_process');
const path = require('path');

// Test Config
const port = process.env.PORT || 3002;
const baseUrl = `http://localhost:${port}/api`;

let serverProcess;

function startServer() {
  return new Promise((resolve, reject) => {
    console.log('Spawning server process on port ' + port + '...');
    serverProcess = spawn('node', [path.join(__dirname, 'src/server.js')], {
      env: { ...process.env, PORT: port, NODE_ENV: 'development' },
      stdio: 'inherit'
    });

    // Wait 3.5 seconds for server to bind port and load
    setTimeout(() => {
      console.log('Server should be ready. Running assertions...\n');
      resolve();
    }, 3500);

    serverProcess.on('error', (err) => {
      reject(err);
    });
  });
}

function cleanShutdown() {
  if (serverProcess) {
    console.log('\nShutting down server process gracefully...');
    serverProcess.kill('SIGINT');
  }
}

async function assertResponse(name, fn) {
  try {
    console.log(`[TEST] Running: ${name}`);
    await fn();
    console.log(`[PASSED] ${name}\n`);
  } catch (err) {
    console.error(`[FAILED] ${name}`);
    console.error(`Reason: ${err.message}`);
    if (err.response) {
      console.error('Response Data:', JSON.stringify(err.response.data, null, 2));
    }
    cleanShutdown();
    process.exit(1);
  }
}

async function runTests() {
  try {
    await startServer();

    // 1. Peachify Stream
    await assertResponse('GET /api/v2/stream/peachify/28322', async () => {
      const res = await axios.get(`${baseUrl}/v2/stream/peachify/28322?type=movie`);
      const data = res.data;
      if (!data.success || data.provider !== 'peachify' || data.streamType !== 'embed' || !data.embedUrl) {
        throw new Error('Invalid Peachify stream response structure.');
      }
      console.log('Peachify stream URL:', data.embedUrl);
    });

    // 2. Peachify Download
    await assertResponse('GET /api/v2/download/peachify/28322', async () => {
      const res = await axios.get(`${baseUrl}/v2/download/peachify/28322?type=movie`);
      const data = res.data;
      if (!data.success || !data.downloadSupported || !Array.isArray(data.languages) || !Array.isArray(data.qualities)) {
        throw new Error('Invalid Peachify download response structure.');
      }
      console.log(`Peachify Download languages: ${JSON.stringify(data.languages)}, qualities count: ${data.qualities.length}`);
    });

    // 3. StreamIMDb Stream
    await assertResponse('GET /api/v2/stream/streamimdb/1399 S1E1', async () => {
      const res = await axios.get(`${baseUrl}/v2/stream/streamimdb/1399?type=tv&season=1&episode=1`);
      const data = res.data;
      if (!data.success || data.provider !== 'streamimdb' || !Array.isArray(data.streams) || data.streams.length === 0) {
        throw new Error('Invalid StreamIMDb stream response structure.');
      }
      console.log(`StreamIMDb stream qualities count: ${data.streams.length}`);
    });

    // 4. StreamIMDb Download
    await assertResponse('GET /api/v2/download/streamimdb/1399 S1E1', async () => {
      const res = await axios.get(`${baseUrl}/v2/download/streamimdb/1399?type=tv&season=1&episode=1`);
      const data = res.data;
      if (!data.success || !data.downloadSupported || !Array.isArray(data.languages) || !Array.isArray(data.qualities)) {
        throw new Error('Invalid StreamIMDb download response structure.');
      }
      console.log(`StreamIMDb Download languages: ${JSON.stringify(data.languages)}, qualities count: ${data.qualities.length}`);
    });

    // 5. AutoEmbed Stream
    await assertResponse('GET /api/v2/stream/autoembed/28322', async () => {
      const res = await axios.get(`${baseUrl}/v2/stream/autoembed/28322?type=movie`);
      const data = res.data;
      if (!data.success || data.provider !== 'autoembed' || data.streamType !== 'embed') {
        throw new Error('Invalid AutoEmbed stream response structure.');
      }
    });

    // 6. AutoEmbed Download (should be unsupported)
    await assertResponse('GET /api/v2/download/autoembed/28322 (Expected Failure/Unsupported)', async () => {
      try {
        await axios.get(`${baseUrl}/v2/download/autoembed/28322?type=movie`);
        throw new Error('Expected 404/failure for unsupported download provider.');
      } catch (err) {
        if (err.response && err.response.status === 404) {
          console.log('Correctly returned 404 for unsupported AutoEmbed download.');
        } else {
          throw err;
        }
      }
    });

    // 7. EmbedSU Stream
    await assertResponse('GET /api/v2/stream/embedsu/28322', async () => {
      const res = await axios.get(`${baseUrl}/v2/stream/embedsu/28322?type=movie`);
      const data = res.data;
      if (!data.success || data.provider !== 'embedsu' || data.streamType !== 'embed') {
        throw new Error('Invalid EmbedSU stream response structure.');
      }
    });

    // 8. EmbedSU Download (should be unsupported)
    await assertResponse('GET /api/v2/download/embedsu/28322 (Expected Failure/Unsupported)', async () => {
      try {
        await axios.get(`${baseUrl}/v2/download/embedsu/28322?type=movie`);
        throw new Error('Expected 404/failure for unsupported download provider.');
      } catch (err) {
        if (err.response && err.response.status === 404) {
          console.log('Correctly returned 404 for unsupported EmbedSU download.');
        } else {
          throw err;
        }
      }
    });

    // 9. VidSrc Stream
    await assertResponse('GET /api/v2/stream/vidsrc/28322', async () => {
      const res = await axios.get(`${baseUrl}/v2/stream/vidsrc/28322?type=movie`);
      const data = res.data;
      if (!data.success || data.provider !== 'vidsrc' || data.streamType !== 'embed') {
        throw new Error('Invalid VidSrc stream response structure.');
      }
    });

    // 10. VidSrc Download (should succeed via fallback)
    await assertResponse('GET /api/v2/download/vidsrc/28322', async () => {
      const res = await axios.get(`${baseUrl}/v2/download/vidsrc/28322?type=movie`);
      const data = res.data;
      if (!data.success || !data.downloadSupported || !Array.isArray(data.languages) || !Array.isArray(data.qualities)) {
        throw new Error('Invalid VidSrc download response structure.');
      }
      console.log(`VidSrc Download resolved via fallback provider. Languages: ${JSON.stringify(data.languages)}, qualities count: ${data.qualities.length}`);
    });

    // 11. Unified /api/v2/stream/auto/:tmdbId
    await assertResponse('GET /api/v2/stream/auto/28322', async () => {
      const res = await axios.get(`${baseUrl}/v2/stream/auto/28322?type=movie`);
      const data = res.data;
      if (!res.headers['content-type']?.includes('event-stream')) {
        throw new Error('Expected Server-Sent Events (SSE) content-type.');
      }
      console.log('SSE Stream resolved successfully.');
    });

    // 12. Unified /api/v2/download/auto/:tmdbId
    await assertResponse('GET /api/v2/download/auto/28322', async () => {
      const res = await axios.get(`${baseUrl}/v2/download/auto/28322?type=movie`);
      const data = res.data;
      if (!data.success || !data.downloadSupported || !Array.isArray(data.languages) || !Array.isArray(data.qualities)) {
        throw new Error('Invalid unified auto download response structure.');
      }
      console.log(`Unified auto download selected provider: ${data.provider}`);
    });

    console.log('================================================================');
    console.log(' All Provider V2 API Streaming & Download tests PASSED successfully!');
    console.log('================================================================');
    cleanShutdown();
    process.exit(0);
  } catch (err) {
    console.error('Test suite failed execution:', err);
    cleanShutdown();
    process.exit(1);
  }
}

runTests();
