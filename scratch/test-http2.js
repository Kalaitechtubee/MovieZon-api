const http2 = require('http2');
const { URL } = require('url');

const TARGET = 'https://movieswood.cloud/telly/?q=baby';

function fetchHttp2(urlStr) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const client = http2.connect(parsed.origin);
    
    client.on('error', (err) => reject(err));
    
    const req = client.request({
      ':method': 'GET',
      ':path': parsed.pathname + parsed.search,
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
      'accept-encoding': 'gzip, deflate, br'
    });
    
    const zlib = require('zlib');
    let responseHeaders = {};
    req.on('response', (headers) => {
      responseHeaders = headers;
      console.log('HTTP/2 Headers:', headers);
    });
    
    const chunks = [];
    req.on('data', (chunk) => {
      chunks.push(chunk);
    });
    
    req.on('end', () => {
      client.close();
      const buffer = Buffer.concat(chunks);
      const encoding = responseHeaders['content-encoding'];
      
      try {
        let decompressed;
        if (encoding === 'br') {
          decompressed = zlib.brotliDecompressSync(buffer);
        } else if (encoding === 'gzip') {
          decompressed = zlib.gunzipSync(buffer);
        } else if (encoding === 'deflate') {
          decompressed = zlib.inflateSync(buffer);
        } else {
          decompressed = buffer;
        }
        resolve(decompressed.toString('utf8'));
      } catch (err) {
        reject(new Error(`Decompression failed: ${err.message}`));
      }
    });
  });
}

async function run() {
  console.log(`Fetching via HTTP/2: ${TARGET}...\n`);
  try {
    const html = await fetchHttp2(TARGET);
    console.log(`Success! Length: ${html.length}`);
    const isCf = html.includes('cf-beacon') && html.length < 1500;
    const isEmpty = html.includes('<body style="margin:0;background:#fff">');
    console.log(`Cloudflare Challenged: ${isCf}, LiteSpeed Challenged: ${isEmpty}`);
    if (html.length > 5000) {
      console.log('HTML snippet:');
      console.log(html.slice(0, 1000));
    }
  } catch (err) {
    console.error('HTTP/2 Request Failed:', err.message);
  }
}

run();
