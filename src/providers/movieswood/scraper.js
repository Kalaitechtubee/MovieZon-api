const axios = require('axios');
const cheerio = require('cheerio');
const logger = require('../../logger');
const config = require('../../config');

const MOVIESWOOD_DOMAINS = [
  'https://movieswood.cloud',
];

const CATEGORIES = [
  'telly',
  'tamil',
  'bolly',
  'eng',
  'malayalam',
  'kannada',
  'dubs',
  'web'
];

// Use Googlebot crawler User-Agent to bypass Cloudflare and LiteSpeed Anti-Bot challenges
const GOOGLEBOT_UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

const SCRAPE_HEADERS = {
  'User-Agent': GOOGLEBOT_UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive'
};

const REQUEST_TIMEOUT = 10000;

// Helper to check if a domain is reachable
async function getWorkingDomain() {
  for (const domain of MOVIESWOOD_DOMAINS) {
    try {
      await axios.head(domain, { timeout: 5000, headers: SCRAPE_HEADERS });
      return domain;
    } catch (err) {
      try {
        const headersToForward = JSON.stringify(SCRAPE_HEADERS);
        const proxyUrl = `${config.workerProxyUrl}/?url=${encodeURIComponent(domain)}&headers=${encodeURIComponent(headersToForward)}`;
        await axios.head(proxyUrl, { timeout: 5000 });
        logger.info(`[Movieswood] Domain OK via Worker Proxy: ${domain}`);
        return domain;
      } catch (proxyErr) {
        logger.debug(`[Movieswood] Domain unreachable: ${domain} - ${proxyErr.message}`);
      }
    }
  }
  return MOVIESWOOD_DOMAINS[0];
}

/**
 * Fetch HTML helper with Cloudflare Worker proxy fallback
 */
async function fetchHtml(url) {
  try {
    const response = await axios.get(url, {
      timeout: REQUEST_TIMEOUT,
      headers: SCRAPE_HEADERS
    });
    const html = response.data;
    // Check if Cloudflare challenged
    const isCf = html && (html.includes('cf-beacon') && html.length < 1500);
    if (isCf) throw new Error('Cloudflare challenged');
    return html;
  } catch (directErr) {
    logger.warn(`[Movieswood] Direct request failed/challenged for: ${url}. Error: ${directErr.message}. Retrying via Cloudflare Worker proxy...`);
    
    // Cloudflare Worker Proxy Fallback
    const headersToForward = JSON.stringify(SCRAPE_HEADERS);
    const proxyUrl = `${config.workerProxyUrl}/?url=${encodeURIComponent(url)}&headers=${encodeURIComponent(headersToForward)}`;
    
    const res = await axios.get(proxyUrl, { timeout: REQUEST_TIMEOUT });
    logger.info(`[Movieswood Proxy] Successfully fetched via Cloudflare Worker proxy: ${url}`);
    return res.data;
  }
}

/**
 * Follow a stream.php?f=... or rating.php?f=... page to find the final stream link.
 */
async function resolveFinalMediaUrls(pageUrl) {
  try {
    const html = await fetchHtml(pageUrl);
    const $ = cheerio.load(html);
    
    // Look for video source or video element src
    let mediaUrl = $('video source').first().attr('src')
      || $('video source').first().attr('data-src')
      || $('video').first().attr('src')
      || $('video').first().attr('data-src')
      || $('iframe').first().attr('src')
      || $('iframe').first().attr('data-src');
      
    // Look for script tags containing CDN URLs or video link variables
    if (!mediaUrl) {
      $('script').each((_, el) => {
        const js = $(el).html() || '';
        const mp4Match = js.match(/["'](https?:\/\/[^"']+\.(?:mp4|mkv|m3u8)[^"']*)["']/i);
        if (mp4Match) {
          mediaUrl = mp4Match[1];
          return false;
        }
        const signMatch = js.match(/["'](https?:\/\/[^"']+\?sign=[^"']+)["']/i);
        if (signMatch) {
          mediaUrl = signMatch[1];
          return false;
        }
      });
    }
    
    // Look for download buttons / redirects in rating.php page
    let downloadUrl = null;
    $('a').each((_, el) => {
      const href = $(el).attr('href') || '';
      const dataHref = $(el).attr('data-href') || '';
      const text = $(el).text().toLowerCase();
      
      const candidate = (dataHref && dataHref.startsWith('http')) ? dataHref : href;
      if (candidate && !candidate.startsWith('javascript:')) {
        if (candidate.endsWith('.mp4') || candidate.endsWith('.mkv') || candidate.includes('cdn') || text.includes('download') || text.includes('starting')) {
          downloadUrl = candidate;
        }
      }
    });
    
    return {
      streamUrl: mediaUrl || downloadUrl || null,
      downloadUrl: downloadUrl || mediaUrl || null
    };
  } catch (err) {
    logger.debug(`[Movieswood] Failed to resolve final media for ${pageUrl}: ${err.message}`);
    return { streamUrl: null, downloadUrl: null };
  }
}

/**
 * Dynamic search across categories
 * @param {string} query
 * @param {string} baseUrl
 * @returns {Promise<Array>} List of matches
 */
async function searchTitle(query, baseUrl) {
  logger.info(`[Movieswood] Dynamic search for: "${query}"`);
  
  // Try Live Search across categories in parallel
  try {
    const searchPromises = CATEGORIES.map(async (cat) => {
      const searchUrl = `${baseUrl}/${cat}/?q=${encodeURIComponent(query)}`;
      try {
        const html = await fetchHtml(searchUrl);
        const $ = cheerio.load(html);
        const results = [];
        
        // Scan for links containing ?d=
        $('a').each((_, el) => {
          const href = $(el).attr('href') || '';
          const text = $(el).text().trim().replace(/\s+/g, ' ');
          if (href && href.includes('?d=') && text) {
            const cleanText = text.replace(/^🎬\s*/, '').trim();
            const fullHref = href.startsWith('http') ? href : `${baseUrl}/${cat}/${href.replace(/^\.\//, '')}`;
            results.push({
              title: cleanText,
              href: fullHref,
              category: cat
            });
          }
        });
        return results;
      } catch (err) {
        return [];
      }
    });
    
    const resultsArrays = await Promise.all(searchPromises);
    let liveResults = resultsArrays.flat();
    
    // De-duplicate results by href
    const uniqueMap = new Map();
    for (const r of liveResults) {
      uniqueMap.set(r.href, r);
    }
    liveResults = Array.from(uniqueMap.values());
    
    if (liveResults.length > 0) {
      logger.info(`[Movieswood] Live search succeeded. Found ${liveResults.length} matches.`);
      return liveResults;
    }
  } catch (err) {
    logger.warn(`[Movieswood] Live search failed: ${err.message}`);
  }

  return [];
}

/**
 * Resolve download links dynamically
 * @param {string} title
 * @param {number} [year]
 * @returns {Promise<Object>} Final result
 */
async function getDownloadLinks(title, year = null) {
  const baseUrl = await getWorkingDomain();
  const searchResults = await searchTitle(title, baseUrl);
  
  if (searchResults.length === 0) {
    return { found: false, title, qualities: [] };
  }

  // Filter search results that closely match the title and optionally the year
  const cleanTitle = title.toLowerCase().replace(/[^a-z0-9]/g, '');
  const matchedResults = searchResults.filter(r => {
    const rClean = r.title.toLowerCase().replace(/[^a-z0-9]/g, '');
    let yearMatch = true;
    if (year) {
      const yearStr = year.toString();
      yearMatch = r.title.includes(yearStr) || r.category?.includes(yearStr);
    }
    return (rClean.includes(cleanTitle) || cleanTitle.includes(rClean)) && yearMatch;
  }).slice(0, 3); // Take up to 3 matched pages to scrape in parallel and merge qualities

  if (matchedResults.length === 0) {
    return { found: false, title, qualities: [] };
  }

  const qualities = [];
  const matchedUrl = matchedResults[0].href;
  const finalTitle = matchedResults[0].title;

  const scrapePromises = matchedResults.map(async (match) => {
    try {
      logger.info(`[Movieswood] Fetching details page dynamically: ${match.href}`);
      const html = await fetchHtml(match.href);
      const $ = cheerio.load(html);
      let pageCount = 0;

      // Parse list items matching .file-item structure
      $('.file-item').each((_, el) => {
        const name = $(el).find('.file-name').text().trim();
        const size = $(el).find('.file-size').text().trim() || '1.40 GB';
        const linkEl = $(el).find('a');
        const href = linkEl.attr('href') || '';
        
        if (href && (href.includes('rating.php?f=') || href.includes('stream.php?f='))) {
          const isStream = href.includes('stream.php?f=');
          const fullHref = href.startsWith('http') ? href : new URL(href, match.href).href;
          
          let label = '720p';
          const labelMatch = name.match(/(\d{3,4}p|700MB)/i);
          if (labelMatch) {
            label = labelMatch[0].toLowerCase();
          } else if (name.toLowerCase().includes('720p')) {
            label = '720p';
          } else if (name.toLowerCase().includes('1080p') || name.toLowerCase().includes(' hd') || name.toLowerCase().includes(' p')) {
            label = '1080p';
          } else if (name.toLowerCase().includes('700mb')) {
            label = '700mb';
          }
          
          let qEntry = qualities.find(q => q.label.toLowerCase() === label.toLowerCase());
          if (!qEntry) {
            qEntry = { label: label.toUpperCase(), files: [] };
            qualities.push(qEntry);
          }
          
          // Avoid duplicate files across categories
          const fileExists = qEntry.files.some(f => f.name === name);
          if (!fileExists) {
            qEntry.files.push({
              name: name || match.title,
              size,
              format: isStream ? 'MP4' : 'MKV',
              downloadUrl: isStream ? null : fullHref,
              watchUrl: isStream ? fullHref : null
            });
            pageCount++;
          }
        }
      });

      // Generic fallback loop for legacy page layouts
      if (pageCount === 0) {
        $('a').each((_, el) => {
          const href = $(el).attr('href') || '';
          
          if (href && (href.includes('rating.php?f=') || href.includes('stream.php?f='))) {
            const isStream = href.includes('stream.php?f=');
            const fullHref = href.startsWith('http') ? href : new URL(href, match.href).href;
            
            const container = $(el).closest('div, li, tr, td, p');
            const containerText = container.text().replace(/\s+/g, ' ').trim();
            
            const sizeMatch = containerText.match(/(\d+(?:\.\d+)?\s*(?:GB|MB|KB))/i);
            const size = sizeMatch ? sizeMatch[0] : (isStream ? '1.40 GB' : '1.30 GB');
            
            let fileName = containerText
              .replace(/download|stream|watch|play/gi, '')
              .replace(/[\(\)\[\]]/g, '')
              .trim();
              
            if (!fileName || fileName.length < 5) {
              fileName = match.title + (isStream ? ' (Stream)' : ' (Download)');
            }

            const labelMatch = fileName.match(/(\d{3,4}p|700MB)/i);
            const label = labelMatch ? labelMatch[0].toLowerCase() : '720p';

            let qEntry = qualities.find(q => q.label.toLowerCase() === label.toLowerCase());
            if (!qEntry) {
              qEntry = { label: label.toUpperCase(), files: [] };
              qualities.push(qEntry);
            }

            const fileExists = qEntry.files.some(f => f.name === fileName);
            if (!fileExists) {
              qEntry.files.push({
                name: fileName,
                size,
                format: isStream ? 'MP4' : 'MKV',
                downloadUrl: isStream ? null : fullHref,
                watchUrl: isStream ? fullHref : null
              });
            }
          }
        });
      }
    } catch (err) {
      logger.warn(`[Movieswood] Detail page parsing failed for ${match.href}: ${err.message}`);
    }
  });

  await Promise.all(scrapePromises);

  // Follow redirects to get final video CDN stream links or final download pages
  if (qualities.length > 0) {
    logger.info(`[Movieswood] Successfully resolved ${qualities.length} qualities dynamically.`);
    for (const q of qualities) {
      for (const f of q.files) {
        if (f.watchUrl && f.watchUrl.includes('stream.php?f=')) {
          const resMedia = await resolveFinalMediaUrls(f.watchUrl);
          if (resMedia.streamUrl) {
            f.watchUrl = resMedia.streamUrl;
          }
        }
        if (f.downloadUrl && f.downloadUrl.includes('rating.php?f=')) {
          const resMedia = await resolveFinalMediaUrls(f.downloadUrl);
          if (resMedia.downloadUrl) {
            f.downloadUrl = resMedia.downloadUrl;
          }
        }
      }

      // Deduplicate files inside this quality by resolved download/stream URL
      const uniqueFiles = [];
      const seenUrls = new Set();
      for (const f of q.files) {
        const urlKey = f.downloadUrl || f.watchUrl;
        if (urlKey && !seenUrls.has(urlKey)) {
          seenUrls.add(urlKey);
          uniqueFiles.push(f);
        }
      }
      q.files = uniqueFiles;
    }
    
    return {
      found: true,
      title: finalTitle,
      matchedUrl,
      qualities
    };
  }

  return { found: false, title, qualities: [] };
}

module.exports = {
  getWorkingDomain,
  searchTitle,
  getDownloadLinks
};
