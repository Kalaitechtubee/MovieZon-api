const axios = require('axios');
const logger = require('../../logger');
const crypto = require('crypto');

// Session secret key generated at startup for securing tokens
const PROXY_TOKEN_SECRET = process.env.PROXY_TOKEN_SECRET || crypto.randomBytes(32);
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
      targetUrl = `https://streamhub-proxy.1545zoya.workers.dev/?url=${encodeURIComponent(targetUrl)}`;
      logger.debug(`[ProxyStream] Redirecting direct CDN link to Cloudflare Worker proxy: ${targetUrl}`);
    }

    // Set attachment header for direct download trigger without navigation
    if (isDownload) {
      res.setHeader('Content-Disposition', `attachment; filename="${targetFilename}"`);
    }

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
