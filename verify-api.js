const dns = require('dns');
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}

const axios = require('axios');
const { spawn } = require('child_process');
const path = require('path');

// Test Config
const port = process.env.PORT || 3000;
const baseUrl = `http://localhost:${port}/api`;

let serverProcess;

function startServer() {
  return new Promise((resolve, reject) => {
    console.log('Spawning server process...');
    serverProcess = spawn('node', [path.join(__dirname, 'src/server.js')], {
      env: { ...process.env, PORT: port, NODE_ENV: 'development' },
      stdio: 'inherit'
    });

    // Wait 2.5 seconds for server to bind port and load
    setTimeout(() => {
      console.log('Server should be ready. Running assertions...\n');
      resolve();
    }, 2500);

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

    // 1. Test Providers list
    await assertResponse('GET /api/providers', async () => {
      const res = await axios.get(`${baseUrl}/providers`);
      const data = res.data;

      if (!data.ok || !Array.isArray(data.providers)) {
        throw new Error('Response shape is invalid or ok is false.');
      }

      console.log('Registered Providers:', JSON.stringify(data.providers, null, 2));

      // Assert peachify exists
      const hasPeachify = data.providers.some(p => p.name === 'peachify');
      if (!hasPeachify) {
        throw new Error('Peachify provider is missing from registration.');
      }
    });

    // 2. Test Catalog Search (TMDB fallbacks)
    await assertResponse('GET /api/search?q=Inception', async () => {
      const res = await axios.get(`${baseUrl}/search?q=Inception`);
      const data = res.data;

      if (!data.ok || !Array.isArray(data.items) || data.items.length === 0) {
        throw new Error('No search results returned for query "Inception"');
      }

      console.log(`Found ${data.items.length} result(s). Checking schema of first item:`);
      const item = data.items[0];
      console.log(JSON.stringify(item, null, 2));

      // Schema verification
      const requiredFields = ['id', 'provider', 'tmdbId', 'title', 'year', 'type', 'poster', 'backdrop'];
      for (const field of requiredFields) {
        if (item[field] === undefined || item[field] === null) {
          throw new Error(`Catalog item schema violation: missing field "${field}"`);
        }
      }
    });

    // 3. Test Details Fetching (with TMDB enrichment)
    await assertResponse('GET /api/details/peachify/27205?type=movie', async () => {
      const res = await axios.get(`${baseUrl}/details/peachify/27205?type=movie`);
      const data = res.data;

      if (!data.ok || !data.details) {
        throw new Error('Could not fetch details for TMDB movie 27205');
      }

      console.log('Details metadata:', JSON.stringify(data.details, null, 2));

      // Schema verification
      const requiredFields = ['id', 'provider', 'tmdbId', 'title', 'year', 'type', 'poster', 'backdrop', 'overview', 'rating'];
      for (const field of requiredFields) {
        if (data.details[field] === undefined || data.details[field] === null) {
          throw new Error(`Details schema violation: missing field "${field}"`);
        }
      }
    });

    // 4. Test Stream Resolution (Peachify embed player)
    await assertResponse('GET /api/stream/peachify/27205?type=movie', async () => {
      const res = await axios.get(`${baseUrl}/stream/peachify/27205?type=movie`);
      const data = res.data;

      if (!data.ok || !data.stream) {
        throw new Error('Could not resolve stream details for TMDB movie 27205');
      }

      console.log('Stream Details resolved:', JSON.stringify(data.stream, null, 2));

      // Schema verification
      const requiredFields = ['provider', 'drm', 'streamUrl', 'subtitles', 'headers', 'qualities'];
      for (const field of requiredFields) {
        if (data.stream[field] === undefined || data.stream[field] === null) {
          throw new Error(`Stream schema violation: missing field "${field}"`);
        }
      }

      if (!Array.isArray(data.stream.subtitles)) {
        throw new Error('Subtitles must be an array');
      }
      if (!Array.isArray(data.stream.qualities)) {
        throw new Error('Qualities must be an array');
      }
    });

    // 5. Test Main Health status
    await assertResponse('GET /api/health', async () => {
      const res = await axios.get(`${baseUrl}/health`);
      const data = res.data;

      if (data.status === undefined) {
        throw new Error('Missing health status field');
      }

      console.log('Server Health statistics:', JSON.stringify(data, null, 2));
    });

    console.log('============================================');
    console.log(' All API integration tests PASSED successfully!');
    console.log('============================================');
    cleanShutdown();
    process.exit(0);
  } catch (err) {
    console.error('Test framework execution failed:', err);
    cleanShutdown();
    process.exit(1);
  }
}

runTests();
