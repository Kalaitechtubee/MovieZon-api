const axios = require('axios');

const proxies = [
  { name: 'corsproxy.io', url: 'https://corsproxy.io/?' },
  { name: 'allorigins', url: 'https://api.allorigins.win/get?url=' },
  { name: 'codetabs', url: 'https://api.codetabs.com/v1/proxy?quest=' }
];

const TARGET = 'https://movieswood.cloud/telly/?q=baby';

async function test() {
  console.log(`Testing public proxies for ${TARGET}...\n`);
  for (const p of proxies) {
    try {
      const fullUrl = p.name === 'allorigins' 
        ? `${p.url}${encodeURIComponent(TARGET)}`
        : `${p.url}${TARGET}`;
      
      console.log(`[TEST] ${p.name}...`);
      const res = await axios.get(fullUrl, { timeout: 6000 });
      let body = res.data;
      if (p.name === 'allorigins') {
        body = body.contents;
      }
      
      const isCf = body && body.includes('cf-beacon') && body.length < 1500;
      const isEmpty = body && body.includes('<body style="margin:0;background:#fff">');
      
      console.log(`-> Success! Status: ${res.status}, Length: ${body ? body.length : 0}, CF Challenged: ${isCf}, LiteSpeed Challenged: ${isEmpty}`);
      if (!isCf && !isEmpty && body && body.length > 5000) {
        console.log(`>>> WORKED! ${p.name} returned clean HTML! <<<\n`);
      }
    } catch (err) {
      console.log(`-> Failed: ${err.message}`);
    }
  }
}

test();
