/**
 * Moviesda Scraper
 *
 * Resolves direct MP4 download links from moviesda33.com via a multi-hop chain:
 *   1. Search for movie slug by title
 *   2. Load movie page → get quality options (360p, 720p, 1080p)
 *   3. Load quality page → get file variants (size, href)
 *   4. Load moviesda download page → get intermediate CDN relay URL
 *   5. Load CDN relay page → extract final direct MP4 + watch-online URLs
 */

const axios = require('axios');
const cheerio = require('cheerio');
const logger = require('../../logger');

// Multiple known domains for fallback — moviesda frequently rotates domains
const MOVIESDA_DOMAINS = [
  'https://moviesda33.com',
  'https://moviesda.blue',
  'https://moviesda.mobi',
];

const REQUEST_TIMEOUT = 12000;

const SCRAPE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Connection': 'keep-alive',
};

/**
 * Fetch HTML from a URL with a configurable timeout.
 * @param {string} url
 * @param {object} [opts]
 * @returns {Promise<string>} raw HTML
 */
async function fetchHtml(url, opts = {}) {
  const response = await axios.get(url, {
    timeout: opts.timeout || REQUEST_TIMEOUT,
    headers: { ...SCRAPE_HEADERS, ...(opts.headers || {}) },
    maxRedirects: 5,
  });
  return response.data;
}

/**
 * Slugify a movie title for URL construction.
 * e.g. "Blast 2026" → "blast-2026"
 * @param {string} title
 * @returns {string}
 */
function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

/**
 * Try to find a working base domain from the known list.
 * @returns {Promise<string>} the first reachable domain
 */
async function getWorkingDomain() {
  for (const domain of MOVIESDA_DOMAINS) {
    try {
      await axios.head(domain, { timeout: 6000, headers: SCRAPE_HEADERS });
      logger.debug(`[Moviesda] Domain OK: ${domain}`);
      return domain;
    } catch (err) {
      logger.debug(`[Moviesda] Domain unreachable: ${domain} — ${err.message}`);
    }
  }
  throw new Error('All Moviesda domains are unreachable.');
}

/**
 * Search for a movie title on the Moviesda search form.
 * Returns an array of { title, href } results.
 * @param {string} title
 * @param {string} baseUrl
 * @returns {Promise<Array<{title: string, href: string}>>}
 */
async function searchTitle(title, baseUrl) {
  try {
    const searchUrl = `${baseUrl}/?s=${encodeURIComponent(title)}`;
    const html = await fetchHtml(searchUrl);
    const $ = cheerio.load(html);

    const results = [];
    // Movie listing items appear as div.f > a
    $('main .f a, main .folder a, main a[href*="-movie"]').each((_, el) => {
      const href = $(el).attr('href');
      const text = $(el).text().trim();
      if (href && text && !href.includes('download')) {
        const fullHref = href.startsWith('http') ? href : `${baseUrl}${href}`;
        results.push({ title: text, href: fullHref });
      }
    });

    logger.debug(`[Moviesda] Search for "${title}" → ${results.length} results`);
    return results;
  } catch (err) {
    logger.warn(`[Moviesda] searchTitle error: ${err.message}`);
    return [];
  }
}

/**
 * Find the best matching search result for a given title.
 * @param {Array<{title, href}>} results
 * @param {string} query
 * @returns {{title, href}|null}
 */
function bestMatch(results, query) {
  if (!results.length) return null;
  const qWords = query.toLowerCase().split(/\s+/);
  // Score by how many query words appear in the result title
  const scored = results.map((r) => {
    const rLower = r.title.toLowerCase();
    const score = qWords.filter((w) => rLower.includes(w)).length;
    return { ...r, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].score > 0 ? scored[0] : results[0];
}

/**
 * Parse a movie page to extract quality links.
 * e.g. "Blast (Original)" → [{label: 'Blast (Original)', href}]
 *      then inside Original: [{label: '360p HD', href}, {label: '720p HD'}, ...]
 * @param {string} moviePageUrl
 * @param {string} baseUrl
 * @returns {Promise<Array<{label: string, href: string}>>}
 */
async function resolveQualityOptions(moviePageUrl, baseUrl) {
  try {
    const html = await fetchHtml(moviePageUrl);
    const $ = cheerio.load(html);

    const options = [];
    $('main .f a, main .folder a').each((_, el) => {
      const href = $(el).attr('href');
      const text = $(el).text().trim();
      if (href && text) {
        const fullHref = href.startsWith('http') ? href : `${baseUrl}${href}`;
        options.push({ label: text, href: fullHref });
      }
    });

    logger.debug(`[Moviesda] Quality options for ${moviePageUrl}: ${options.map(o => o.label).join(', ')}`);
    return options;
  } catch (err) {
    logger.warn(`[Moviesda] resolveQualityOptions error: ${err.message}`);
    return [];
  }
}

/**
 * Parse a quality sub-page to get file download entries.
 * e.g. on the 1080p page: [{name, size, format, thumb, downloadHref}]
 * @param {string} qualityPageUrl
 * @param {string} baseUrl
 * @returns {Promise<Array<{name, size, format, thumb, downloadHref}>>}
 */
async function resolveFileList(qualityPageUrl, baseUrl) {
  try {
    const html = await fetchHtml(qualityPageUrl);
    const $ = cheerio.load(html);

    const files = [];
    $('main .mv-content, main .folder .mv-content').each((_, el) => {
      const linkEl = $(el).find('a[href*="/download/"]').first();
      const href = linkEl.attr('href');
      if (!href) return;

      const name = linkEl.text().trim();
      const details = $(el).find('.details, li').map((__, li) => $(li).text().trim()).get();

      let size = '';
      let format = 'Mp4';
      details.forEach((d) => {
        if (/file size/i.test(d)) size = d.replace(/file size:/i, '').trim();
        if (/format/i.test(d)) format = d.replace(/download format:/i, '').trim();
      });

      const thumb = $(el).find('img').first().attr('src') || '';
      const fullHref = href.startsWith('http') ? href : `${baseUrl}${href}`;

      files.push({ name, size, format, thumb: thumb.startsWith('http') ? thumb : `${baseUrl}${thumb}`, downloadHref: fullHref });
    });

    logger.debug(`[Moviesda] File list for ${qualityPageUrl}: ${files.length} files`);
    return files;
  } catch (err) {
    logger.warn(`[Moviesda] resolveFileList error: ${err.message}`);
    return [];
  }
}

/**
 * Follow the moviesda download page to get the CDN relay URL.
 * moviesda33.com/download/{slug}/ → download.moviespage.xyz/download/file/{id}
 * @param {string} downloadPageUrl
 * @returns {Promise<string|null>} CDN relay URL
 */
async function resolveDownloadRelay(downloadPageUrl) {
  try {
    const html = await fetchHtml(downloadPageUrl);
    const $ = cheerio.load(html);

    let relayUrl = null;
    // Download link is inside div.dlink > a
    $('div.dlink a, div.download a').each((_, el) => {
      const href = $(el).attr('href');
      if (href && href.includes('moviespage.xyz')) {
        relayUrl = href;
        return false; // break
      }
    });

    logger.debug(`[Moviesda] Relay URL: ${relayUrl}`);
    return relayUrl;
  } catch (err) {
    logger.warn(`[Moviesda] resolveDownloadRelay error: ${err.message}`);
    return null;
  }
}

/**
 * Follow the moviespage.xyz relay to get the downloadpage.xyz URL.
 * download.moviespage.xyz/download/file/{id} → movies.downloadpage.xyz/download/page/{id}
 * @param {string} relayUrl
 * @returns {Promise<string|null>}
 */
async function resolveDownloadPage(relayUrl) {
  try {
    const html = await fetchHtml(relayUrl);
    const $ = cheerio.load(html);

    let pageUrl = null;
    $('div.dlink a, div.download a').each((_, el) => {
      const href = $(el).attr('href');
      if (href && (href.includes('downloadpage.xyz') || href.includes('cdnserver'))) {
        pageUrl = href;
        return false;
      }
    });

    logger.debug(`[Moviesda] Download page URL: ${pageUrl}`);
    return pageUrl;
  } catch (err) {
    logger.warn(`[Moviesda] resolveDownloadPage error: ${err.message}`);
    return null;
  }
}

/**
 * Resolve the final direct MP4 link and optional watch-online URL.
 * movies.downloadpage.xyz/download/page/{id} → {downloadUrl, watchUrl}
 * @param {string} pageUrl
 * @returns {Promise<{downloadUrl: string|null, watchUrl: string|null}>}
 */
async function resolveFinalLinks(pageUrl) {
  try {
    const html = await fetchHtml(pageUrl);
    const $ = cheerio.load(html);

    let downloadUrl = null;
    let watchUrl = null;

    $('div.dlink a, div.download a').each((_, el) => {
      const href = $(el).attr('href') || '';
      const text = $(el).text().toLowerCase();
      if (!downloadUrl && (href.includes('cdnserver') || href.endsWith('.mp4'))) {
        downloadUrl = href;
      }
      if (!watchUrl && (text.includes('watch') || href.includes('onestream') || href.includes('stream'))) {
        watchUrl = href;
      }
    });

    logger.debug(`[Moviesda] Final links: download=${downloadUrl} watch=${watchUrl}`);
    return { downloadUrl, watchUrl };
  } catch (err) {
    logger.warn(`[Moviesda] resolveFinalLinks error: ${err.message}`);
    return { downloadUrl: null, watchUrl: null };
  }
}

/**
 * Full pipeline: given a movie title, resolve all download links across all qualities.
 *
 * @param {string} title - Movie title to search for
 * @param {number} [year] - Optional year to narrow results
 * @returns {Promise<{
 *   found: boolean,
 *   title: string,
 *   qualities: Array<{
 *     label: string,
 *     files: Array<{name, size, format, thumb, downloadUrl, watchUrl}>
 *   }>
 * }>}
 */
async function getDownloadLinks(title, year = null) {
  const query = year ? `${title} ${year}` : title;

  let baseUrl;
  try {
    baseUrl = await getWorkingDomain();
  } catch (err) {
    logger.error(`[Moviesda] No working domain found: ${err.message}`);
    return { found: false, title, qualities: [] };
  }

  // Step 1: Search for movie
  const searchResults = await searchTitle(query, baseUrl);
  const match = bestMatch(searchResults, query);

  if (!match) {
    logger.info(`[Moviesda] No match found for "${query}"`);
    return { found: false, title, qualities: [] };
  }

  logger.info(`[Moviesda] Best match: "${match.title}" → ${match.href}`);

  // Step 2: Get quality options from the movie page
  let qualityOptions = await resolveQualityOptions(match.href, baseUrl);

  // If still no quality options found, we may be already on a quality page — treat it as one
  if (!qualityOptions.length) {
    logger.warn(`[Moviesda] No quality sub-options, treating ${match.href} as direct quality page`);
    qualityOptions = [{ label: match.title, href: match.href }];
  }

  // Step 3: For each quality, resolve file list and then CDN links
  const qualities = [];

  for (const quality of qualityOptions) {
    // Determine if this is a quality-variant page (has 360p/720p/1080p links)
    // or a direct file list page
    const fileList = await resolveFileList(quality.href, baseUrl);

    if (!fileList.length) {
      // This might itself be a sub-folder with quality options — recurse one level
      const subOptions = await resolveQualityOptions(quality.href, baseUrl);
      for (const sub of subOptions) {
        const subFiles = await resolveFileList(sub.href, baseUrl);
        if (subFiles.length) {
          const resolvedFiles = await resolveFilesLinks(subFiles);
          qualities.push({ label: sub.label, files: resolvedFiles });
        }
      }
    } else {
      const resolvedFiles = await resolveFilesLinks(fileList);
      qualities.push({ label: quality.label, files: resolvedFiles });
    }
  }

  return {
    found: qualities.length > 0,
    title: match.title,
    matchedUrl: match.href,
    qualities,
  };
}

/**
 * Helper: follow the download chain for each file and attach final URLs.
 * @param {Array} files
 * @returns {Promise<Array>}
 */
async function resolveFilesLinks(files) {
  const resolved = [];
  for (const file of files) {
    let downloadUrl = null;
    let watchUrl = null;
    try {
      const relayUrl = await resolveDownloadRelay(file.downloadHref);
      if (relayUrl) {
        const pageUrl = await resolveDownloadPage(relayUrl);
        if (pageUrl) {
          const links = await resolveFinalLinks(pageUrl);
          downloadUrl = links.downloadUrl;
          watchUrl = links.watchUrl;
        }
      }
    } catch (err) {
      logger.warn(`[Moviesda] resolveFilesLinks error for ${file.name}: ${err.message}`);
    }
    resolved.push({ ...file, downloadUrl, watchUrl });
  }
  return resolved;
}

module.exports = {
  getDownloadLinks,
  searchTitle,
  resolveQualityOptions,
  resolveFileList,
  resolveDownloadRelay,
  resolveDownloadPage,
  resolveFinalLinks,
  getWorkingDomain,
};
