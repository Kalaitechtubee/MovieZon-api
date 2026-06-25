const axios = require('axios');
const { URL } = require('url');

const testUrl = 'https://leadgenerationblueprint.site/VmxrmarW5/pl/H4sIAAAAAAAAAwXBy3KDIBQA0F9S0Rq7rBpTE0hBLgg7HramopNOndH69T0nzo2zyYv1WZrHw5DENve5KWxa5J.F8_4VHzR1gijb7NwE9qemDanEg5nDncxC.PI3wigs1.h5lf0bviZ72tWMulrHJKY7nzQ18xmDOIuu0vWwsIl1BXVz.6NQizBkJT4CcBgfsleIQLj4HqeWC4nlaRMVo2zabxB9pQJWjiv9xOX67Rp3kLL44OEtsYuQFmjEL243Dc1s8Er3z9VP6x0_TptFLPA5Y2zeb47rQBZNCCKcSd_JZkekiQ4FhLEGNixG04GOBjkKtYSExSNAgzddt.chEBiq90zyFkyEE31ExT8DnSQyQQEAAA--/master.m3u8';

const headers = {
  'Referer': 'https://nextgencloudfabric.com/',
  'Origin': 'https://nextgencloudfabric.com/',
  'X-Requested-With': 'XMLHttpRequest',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

async function run() {
  console.log("Fetching playlist from:", testUrl);
  try {
    const plRes = await axios({
      method: 'get',
      url: testUrl,
      headers,
      responseType: 'text',
      timeout: 15000,
      validateStatus: false
    });

    console.log("Status:", plRes.status);
    let playlistText = typeof plRes.data === 'string' ? plRes.data : '';
    console.log("Playlist preview:\n", playlistText.slice(0, 1000));

    let currentPlaylistUrl = testUrl;

    if (playlistText.includes('#EXT-X-STREAM-INF:')) {
      console.log("\n[Detect] Master playlist detected. Parsing variants...");
      const lines = playlistText.split(/\r?\n/);
      const variants = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('#EXT-X-STREAM-INF:')) {
          let width = 0, height = 0, bandwidth = 0;
          const resMatch = line.match(/RESOLUTION=(\d+)x(\d+)/i);
          if (resMatch) {
            width = parseInt(resMatch[1], 10);
            height = parseInt(resMatch[2], 10);
          }
          const bwMatch = line.match(/BANDWIDTH=(\d+)/i);
          if (bwMatch) {
            bandwidth = parseInt(bwMatch[1], 10);
          }

          const nextLine = lines[i + 1]?.trim();
          if (nextLine && !nextLine.startsWith('#')) {
            try {
              const variantUrl = new URL(nextLine, currentPlaylistUrl).toString();
              variants.push({ width, height, bandwidth, url: variantUrl });
            } catch (_) {}
          }
        }
      }

      console.log("Variants found:", variants);

      if (variants.length > 0) {
        variants.sort((a, b) => b.height - a.height || b.bandwidth - a.bandwidth);
        const bestVariant = variants[0];
        console.log(`\nSelected best variant: ${bestVariant.width}x${bestVariant.height} (${bestVariant.bandwidth} bps) -> ${bestVariant.url}`);

        const varRes = await axios({
          method: 'get',
          url: bestVariant.url,
          headers,
          responseType: 'text',
          timeout: 15000,
          validateStatus: false
        });

        if (typeof varRes.data === 'string') {
          playlistText = varRes.data;
          currentPlaylistUrl = bestVariant.url;
          console.log("\nFetched variant playlist. Preview:\n", playlistText.slice(0, 1000));
        } else {
          throw new Error('Failed to fetch variant playlist data');
        }
      }
    }

    const segmentUrls = playlistText
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'))
      .map(l => {
        try { return new URL(l, currentPlaylistUrl).toString(); } catch (_) { return null; }
      })
      .filter(Boolean);

    console.log(`\nParsed ${segmentUrls.length} segments. First 5:`);
    console.log(segmentUrls.slice(0, 5));

    if (segmentUrls.length > 0) {
      console.log("\nTesting download of first segment...");
      const segRes = await axios({
        method: 'get',
        url: segmentUrls[0],
        headers,
        responseType: 'arraybuffer',
        timeout: 15000,
        validateStatus: false
      });
      console.log("Segment download status:", segRes.status);
      console.log("Segment size:", segRes.data.length, "bytes");
    }

  } catch (err) {
    console.error("Error occurred:", err.message);
  }
}

run();
