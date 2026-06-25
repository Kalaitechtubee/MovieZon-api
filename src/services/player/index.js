const axios = require('axios');
const logger = require('../../logger');
const crypto = require('crypto');
const config = require('../../config');

// Session secret key generated at startup for securing tokens
const rawSecret = process.env.PROXY_TOKEN_SECRET || 'moviezon_stable_fallback_secret_key_2026';
const PROXY_TOKEN_SECRET = crypto.createHash('sha256').update(rawSecret).digest();
const IV_LENGTH = 16;

/**
 * Encrypt target URL and headers to generate a secure proxy token
 */
function encryptToken(payload) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(PROXY_TOKEN_SECRET), iv);
  let encrypted = cipher.update(JSON.stringify(payload), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt token to retrieve the original target URL and headers
 */
function decryptToken(token) {
  try {
    const parts = token.split(':');
    if (parts.length !== 2) return null;
    const iv = Buffer.from(parts[0], 'hex');
    const encryptedText = parts[1];
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(PROXY_TOKEN_SECRET), iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted);
  } catch (err) {
    logger.error(`Failed to decrypt proxy token: ${err.message}`);
    return null;
  }
}

/**
 * Helper to build proxy URL for segments or subtitles
 */
function getProxyUrl(req, originalUrl, streamHeaders) {
  if (!originalUrl) return '';
  // Skip re-proxying URLs that are already going through our own backend proxy endpoint
  if (originalUrl.includes('/stream/proxy') || originalUrl.includes('/proxy-stream')) {
    return originalUrl;
  }
  const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  const host = req.get('host');
  const proxyBase = `${protocol}://${host}/api/v2/stream/proxy`;

  let pUrl = `${proxyBase}?url=${encodeURIComponent(originalUrl)}`;
  if (streamHeaders && Object.keys(streamHeaders).length > 0) {
    pUrl += `&headers=${encodeURIComponent(JSON.stringify(streamHeaders))}`;
  }
  return pUrl;
}

/**
 * Handle proxy stream requests with seeking and CORS bypass.
 */
async function streamVideoProxy(req, res, next) {
  try {
    const { url, headers: queryHeaders, token } = req.query;
    
    let targetUrl = '';
    let decryptedHeaders = null;
    let targetFilename = req.query.filename || 'video.mp4';

    if (token) {
      const decrypted = decryptToken(token);
      if (!decrypted) {
        return res.status(403).json({ error: 'Forbidden', message: 'Invalid or expired download token.' });
      }
      targetUrl = decrypted.url;
      decryptedHeaders = decrypted.headers || null;
      if (decrypted.filename) {
        targetFilename = decrypted.filename;
      }
    } else if (url) {
      targetUrl = url;
      if (url.startsWith('http%3A%2F%2F') || url.startsWith('https%3A%2F%2F')) {
        targetUrl = decodeURIComponent(url);
      }
    } else {
      return res.status(400).json({ error: 'Bad Request', message: 'Missing "url" or "token" parameter.' });
    }

    // Only allow HTTP/HTTPS URLs
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      return res.status(400).json({ error: 'Bad Request', message: 'Invalid URL protocol.' });
    }

    // Extract nested target URL if wrapped in eat-peach.sbs / peachify proxy
    try {
      const parsed = new URL(targetUrl);
      if ((parsed.hostname.includes('eat-peach.sbs') || parsed.hostname.includes('peachify')) && parsed.searchParams.has('url')) {
        const nested = parsed.searchParams.get('url');
        if (nested && (nested.startsWith('http://') || nested.startsWith('https://'))) {
          logger.info(`[ProxyStream] Extracting nested target URL from proxy wrapper: ${nested}`);
          targetUrl = nested;
        }
      }
    } catch (e) {
      // ignore invalid URL parsing
    }

    const isDownload = req.query.download === 'true';
    let targetHost = '';
    try {
      targetHost = new URL(targetUrl).hostname;
    } catch (e) {
      const hostMatch = targetUrl.match(/^(?:https?:\/\/)?([^/?:#]+)/i);
      if (hostMatch) {
        targetHost = hostMatch[1];
      }
    }

    const isSubtitle = targetUrl.toLowerCase().includes('.srt') ||
      targetUrl.toLowerCase().includes('.vtt') ||
      targetUrl.includes('/msubt/') ||
      targetUrl.includes('/subtitle/');

    if (!isDownload && !isSubtitle && targetHost.endsWith('hakunaymatata.com') && !targetHost.includes('streamhub-proxy') && !targetHost.includes('workers.dev')) {
      targetUrl = `${config.workerProxyUrl}/?url=${encodeURIComponent(targetUrl)}`;
      logger.debug(`[ProxyStream] Redirecting direct CDN link to Cloudflare Worker proxy: ${targetUrl}`);
    }

    // Content-Disposition will be set below, after we know whether it is HLS or a plain file.

    const headers = {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'referer': 'https://net27.cc/'
    };

    // Merge in custom headers
    if (decryptedHeaders) {
      Object.keys(decryptedHeaders).forEach(k => {
        const lowerKey = k.toLowerCase();
        Object.keys(headers).forEach(hk => {
          if (hk.toLowerCase() === lowerKey) {
            delete headers[hk];
          }
        });
        headers[lowerKey] = decryptedHeaders[k];
      });
    } else if (queryHeaders) {
      try {
        const rawHeaders = Array.isArray(queryHeaders) ? queryHeaders[queryHeaders.length - 1] : queryHeaders;
        const parsed = JSON.parse(decodeURIComponent(rawHeaders));
        Object.keys(parsed).forEach(k => {
          const lowerKey = k.toLowerCase();
          Object.keys(headers).forEach(hk => {
            if (hk.toLowerCase() === lowerKey) {
              delete headers[hk];
            }
          });
          headers[lowerKey] = parsed[k];
        });
      } catch (e) {
        logger.warn(`Failed to parse custom query headers: ${e.message}`);
      }
    }

    if (targetUrl.includes('workers.dev')) {
      delete headers['Referer'];
      delete headers['referer'];
      delete headers['Origin'];
      delete headers['origin'];
      delete headers['User-Agent'];
      delete headers['user-agent'];
    }

    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    // Detect HLS/m3u8 playlists and rewrite segment URLs
    const isM3u8Url = targetUrl.split('?')[0].endsWith('.m3u8') ||
      targetUrl.includes('hls-proxy') ||
      targetUrl.includes('m3u8') ||
      targetUrl.includes('/hls/');

    // ─── HLS Download: concatenate .ts segments into a single streamable file ──
    // When the resolved download URL is an HLS variant playlist (e.g. from
    // StreamIMDb), we fetch every segment and pipe them concatenated as
    // video/mp2t so the browser saves a real video file instead of a text
    // playlist. Streaming (non-download) flow is completely unchanged.
    if (isDownload && isM3u8Url) {
      logger.info(`[ProxyDownload] HLS download detected. Fetching variant playlist to concatenate segments: ${targetUrl}`);
      let downloadHandled = false;
      try {
        const plRes = await axios({
          method: 'get',
          url: targetUrl,
          headers,
          responseType: 'text',
          timeout: 15000,
          validateStatus: false
        });

        let playlistText = typeof plRes.data === 'string' ? plRes.data : '';
        let currentPlaylistUrl = targetUrl;

        // If it is a master playlist, parse and fetch the best variant playlist
        if (playlistText.includes('#EXT-X-STREAM-INF:')) {
          logger.info(`[ProxyDownload] Master playlist detected. Finding best quality variant...`);
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

          if (variants.length > 0) {
            // Sort variants by height desc, then bandwidth desc
            variants.sort((a, b) => b.height - a.height || b.bandwidth - a.bandwidth);
            const bestVariant = variants[0];
            logger.info(`[ProxyDownload] Selected best variant: ${bestVariant.width}x${bestVariant.height} (${bestVariant.bandwidth} bps) -> ${bestVariant.url}`);

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
            } else {
              throw new Error('Failed to fetch variant playlist data');
            }
          }
        }

        // Collect every non-comment line — these are segment URLs
        const segmentUrls = playlistText
          .split(/\r?\n/)
          .map(l => l.trim())
          .filter(l => l && !l.startsWith('#'))
          .map(l => {
            try { return new URL(l, currentPlaylistUrl).toString(); } catch (_) { return null; }
          })
          .filter(Boolean);

        if (segmentUrls.length > 0) {
          logger.info(`[ProxyDownload] Variant playlist has ${segmentUrls.length} segment(s). Streaming concatenated .ts file.`);
          const tsFilename = targetFilename.replace(/\.m3u8$/i, '.ts');
          res.setHeader('Content-Disposition', `attachment; filename="${tsFilename}"`);
          res.setHeader('Content-Type', 'video/mp2t');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges, Content-Disposition');
          res.status(200);

          for (const segUrl of segmentUrls) {
            if (res.writableEnded) break;
            try {
              const segRes = await axios({
                method: 'get',
                url: segUrl,
                headers,
                responseType: 'arraybuffer',
                timeout: 30000,
                validateStatus: false
              });
              if ((segRes.status === 200 || segRes.status === 206) && segRes.data) {
                res.write(Buffer.from(segRes.data));
              }
            } catch (segErr) {
              logger.warn(`[ProxyDownload] Segment fetch failed (${segUrl}): ${segErr.message}`);
            }
          }

          if (!res.writableEnded) res.end();
          downloadHandled = true;
        } else {
          logger.warn(`[ProxyDownload] No segments found in playlist. Falling back to m3u8 file download.`);
        }
      } catch (hlsErr) {
        logger.warn(`[ProxyDownload] HLS segment concatenation failed: ${hlsErr.message}. Falling back to m3u8 file download.`);
      }

      if (downloadHandled) return;
      // Fallthrough: master playlist or error → serve m3u8 as attachment (existing behaviour)
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Set attachment header for direct (non-HLS) download
    if (isDownload) {
      res.setHeader('Content-Disposition', `attachment; filename="${targetFilename}"`);
    }

    if (isM3u8Url) {
      logger.info(`[ProxyStream] Detected HLS playlist. Fetching and rewriting URLs for: ${targetUrl}`);
      try {
        const response = await axios({
          method: 'get',
          url: targetUrl,
          headers,
          responseType: 'text',
          validateStatus: false
        });

        res.status(response.status);
        res.setHeader('Content-Type', response.headers['content-type'] || 'application/vnd.apple.mpegurl');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges, Content-Disposition');

        const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
        const host = req.get('host');
        const proxyBase = `${protocol}://${host}/api/v2/stream/proxy`;

        const lines = response.data.split(/\r?\n/);
        const rewrittenLines = lines.map(line => {
          const trimmed = line.trim();
          if (!trimmed) return line;
          if (trimmed.startsWith('#')) {
            return line.replace(/URI="([^"]+)"/g, (match, p1) => {
              try {
                const absoluteUrl = new URL(p1, targetUrl).toString();
                let rewrittenUrl = `${proxyBase}?url=${encodeURIComponent(absoluteUrl)}`;
                if (queryHeaders) {
                  rewrittenUrl += `&headers=${queryHeaders}`;
                }
                return `URI="${rewrittenUrl}"`;
              } catch (e) {
                return match;
              }
            });
          }
          try {
            const absoluteUrl = new URL(trimmed, targetUrl).toString();
            let rewrittenUrl = `${proxyBase}?url=${encodeURIComponent(absoluteUrl)}`;
            if (queryHeaders) {
              rewrittenUrl += `&headers=${queryHeaders}`;
            }
            return rewrittenUrl;
          } catch (e) {
            return line;
          }
        });

        res.send(rewrittenLines.join('\n'));
        return;
      } catch (err) {
        logger.error(`HLS playlist rewriting failed: ${err.message}`);
      }
    }

    logger.debug(`[ProxyStream] Proxying stream to targetUrl: "${targetUrl}"`);

    const response = await axios({
      method: 'get',
      url: targetUrl,
      headers,
      responseType: 'stream',
      validateStatus: false
    });

    res.status(response.status);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges, Content-Disposition');

    const headersToCopy = [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
      'cache-control'
    ];

    headersToCopy.forEach(h => {
      if (response.headers[h]) {
        res.setHeader(h, response.headers[h]);
      }
    });

    response.data.pipe(res);

    req.on('close', () => {
      if (response.data && typeof response.data.destroy === 'function') {
        response.data.destroy();
      }
    });
  } catch (err) {
    logger.error(`Stream proxying failed: ${err.message}`);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Proxy streaming failed', message: err.message });
    }
  }
}

module.exports = {
  getProxyUrl,
  streamVideoProxy,
  encryptToken,
  decryptToken
};
