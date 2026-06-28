/**
 * Moviesda Scraper — REVISED v2
 *
 * Actual site structure (confirmed from screenshots):
 *
 * Pattern A — Movie index page → quality sub-pages:
 *   /blast-2026-movie/               → lists qualities as div.f > a links
 *   /download/blast-2026-original-1080p-hd/  → "Download Information" page with file details
 *
 * Pattern B — Direct download info page (most common):
 *   /download/{slug}/                → "Download Information" layout with:
 *     - File Name, File Size, Duration, Video Resolution, Format, Added On
 *     - "Download Server 1" / "Download Server 2" links → relay → CDN MP4
 *
 * Note: moviesda uses /download/ in its OWN page URLs — do NOT filter these!
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
 * Fetch HTML from a URL.
 * @param {string} url
 * @param {object} [opts]
 * @returns {Promise<string>}
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
 * e.g. "Karuppu" → "karuppu",  "Blast 2026" → "blast-2026"
 */
function slugify(str) {
  return str
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

// ─── URL Classification ───────────────────────────────────────────────────────

/**
 * Patterns that identify category/listing pages — NOT individual movie pages.
 * IMPORTANT: /download/ is NOT in this list because moviesda uses it in movie page URLs!
 */
const CATEGORY_URL_PATTERNS = [
  /-movies\//,           // /tamil-2026-movies/
  /\/tamil-movies\//,    // /tamil-movies/a/
  /\/hindi-movies\//,
  /\/dubbed-movies\//,
  /\/category\//,
  /\/tag\//,
  /\/page\//,
  /\/\d{4}\//,           // /2026/ (year archive)
  /\/[a-z]\//,           // /a/ /b/ alphabetical listing
];

function isMoviePage(href) {
  return !CATEGORY_URL_PATTERNS.some((re) => re.test(href));
}

/**
 * Returns true if the URL looks like a moviesda "Download Information" page.
 * e.g. /download/karuppu-2026-original-720p-hd/
 */
function isDownloadInfoPage(href) {
  return /\/download\/[a-z0-9-]+\/$/.test(href) || href.includes('/download/');
}

// ─── Search ───────────────────────────────────────────────────────────────────

/**
 * Search the Moviesda search form.
 * Returns movie-page and download-info-page results only — no category pages.
 */
async function searchTitle(title, baseUrl) {
  try {
    const searchUrl = `${baseUrl}/?s=${encodeURIComponent(title)}`;
    const html = await fetchHtml(searchUrl);
    const $ = cheerio.load(html);

    const results = [];
    // Both movie index pages and download info pages can appear in search
    $('main .f a, main .folder a, main a').each((_, el) => {
      const href = $(el).attr('href');
      const text = $(el).text().trim();
      if (!href || !text || text.length < 3) return;

      const fullHref = href.startsWith('http') ? href : `${baseUrl}${href}`;

      // Skip pure category listing pages
      if (!isMoviePage(fullHref)) return;

      results.push({ title: text, href: fullHref });
    });

    // Deduplicate by href
    const seen = new Set();
    const unique = results.filter((r) => {
      if (seen.has(r.href)) return false;
      seen.add(r.href);
      return true;
    });

    logger.debug(`[Moviesda] Search for "${title}" → ${unique.length} results`);
    return unique;
  } catch (err) {
    logger.warn(`[Moviesda] searchTitle error: ${err.message}`);
    return [];
  }
}

/**
 * Scrape the year category listing page and return all movie entries.
 * e.g. /tamil-2026-movies/ → [{title, href}]
 */
async function searchInYearListing(title, year, baseUrl) {
  try {
    const categoryUrl = `${baseUrl}/tamil-${year}-movies/`;
    logger.debug(`[Moviesda] Trying year listing: ${categoryUrl}`);
    const html = await fetchHtml(categoryUrl);
    const $ = cheerio.load(html);

    const results = [];
    $('main .f a, main .folder a, main a').each((_, el) => {
      const href = $(el).attr('href');
      const text = $(el).text().trim();
      if (!href || !text || text.length < 3) return;
      const fullHref = href.startsWith('http') ? href : `${baseUrl}${href}`;
      results.push({ title: text, href: fullHref });
    });

    // Deduplicate
    const seen = new Set();
    const unique = results.filter((r) => { if (seen.has(r.href)) return false; seen.add(r.href); return true; });

    logger.debug(`[Moviesda] Year listing found ${unique.length} entries`);
    return unique;
  } catch (err) {
    logger.warn(`[Moviesda] searchInYearListing error: ${err.message}`);
    return [];
  }
}

/**
 * Try to construct the download info URL directly from title slug + quality.
 * moviesda33.com/download/{title}-{year}-original-{quality}/
 * Returns a list of URLs that actually exist (200 response).
 */
async function tryDirectSlugUrls(title, year, baseUrl) {
  const slug = slugify(title);
  const qualitySuffixes = [
    'original-1080p-hd',
    'original-720p-hd',
    'hdrip-1080p',
    'hdrip-720p',
    'original-480p-hd',
    'original-4k-uhd',
  ];

  const found = [];
  for (const quality of qualitySuffixes) {
    const url = `${baseUrl}/download/${slug}-${year}-${quality}/`;
    try {
      const html = await fetchHtml(url, { timeout: 8000 });
      const $ = cheerio.load(html);
      // Valid download info pages have "Download Information" or file name fields
      const hasContent = $('h2:contains("Download"), .download-info, strong:contains("File Name")').length > 0
        || html.includes('File Name') || html.includes('Download Server');
      if (hasContent) {
        // Derive a human label from the quality suffix
        const label = quality
          .replace('original-', '')
          .replace('-hd', ' HD')
          .replace('-uhd', ' UHD')
          .replace('hdrip-', 'HDRip ')
          .toUpperCase();
        found.push({ title: `${title} (${label})`, href: url });
        logger.debug(`[Moviesda] Direct slug hit: ${url}`);
      }
    } catch (err) {
      // 404 or timeout — this quality doesn't exist, skip
    }
  }
  return found;
}

// ─── Best Match ───────────────────────────────────────────────────────────────

/**
 * Score and return the best matching result for a given title query.
 */
function bestMatch(results, query) {
  if (!results.length) return null;

  // Strip year — title words are more distinctive
  const titleWords = query.toLowerCase().replace(/\d{4}/g, '').trim().split(/\s+/).filter(Boolean);

  const scored = results.map((r) => {
    const rLower = r.title.toLowerCase();
    const hrefLower = r.href.toLowerCase();

    // Must contain primary title word(s) to score at all
    const titleWordMatches = titleWords.filter((w) => rLower.includes(w) || hrefLower.includes(w));
    if (titleWordMatches.length === 0) return { ...r, score: -1 };

    let score = titleWordMatches.length * 10;

    // Bonus: href slug contains exact title
    const slug = titleWords.join('-');
    if (hrefLower.includes(slug)) score += 20;

    // Bonus: download info page (direct match)
    if (isDownloadInfoPage(r.href)) score += 15;

    // Bonus: result title starts with the movie name
    if (rLower.startsWith(titleWords[0])) score += 10;

    return { ...r, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  return best.score > 0 ? best : null;
}

// ─── Quality & File Resolution ────────────────────────────────────────────────

/**
 * Parse a movie index page to extract quality links.
 * These are the sub-folder links like "Original 1080p HD", "Original 720p HD".
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

    logger.debug(`[Moviesda] Quality options at ${moviePageUrl}: ${options.map((o) => o.label).join(', ')}`);
    return options;
  } catch (err) {
    logger.warn(`[Moviesda] resolveQualityOptions error: ${err.message}`);
    return [];
  }
}

/**
 * Parse a "Download Information" page (moviesda33.com/download/{slug}/).
 *
 * This layout shows:
 *   <img> thumbnail
 *   File Name: ...
 *   File Size: 1.46 GB
 *   Duration: 02:32:21 min
 *   Video Resolution: 1280×532
 *   Download Format: Mp4
 *   Added On: 12 June 2026
 *   Download Server 1  (link)
 *   Download Server 2  (link)
 *
 * Returns [{name, size, duration, resolution, format, thumb, downloadServerUrls[]}]
 */
async function resolveDownloadInfoPage(pageUrl, baseUrl) {
  try {
    const html = await fetchHtml(pageUrl);
    const $ = cheerio.load(html);

    // Extract metadata from <strong> label → next text node pattern
    function extractMeta(label) {
      // Try <strong>Label:</strong> text pattern
      let val = '';
      $('strong').each((_, el) => {
        const t = $(el).text().trim();
        if (t.toLowerCase().includes(label.toLowerCase())) {
          // Text is in the parent <p> after the <strong>
          const parent = $(el).parent();
          const raw = parent.text();
          const after = raw.substring(raw.indexOf(t) + t.length).trim().replace(/^:?\s*/, '');
          if (after) val = after;
        }
      });
      // Also try searching in all text
      if (!val) {
        $('p, li, td').each((_, el) => {
          const t = $(el).text();
          const re = new RegExp(`${label}\\s*:?\\s*(.+)`, 'i');
          const m = t.match(re);
          if (m) { val = m[1].split('\n')[0].trim(); return false; }
        });
      }
      return val;
    }

    const name = extractMeta('File Name') || extractMeta('filename');
    const size = extractMeta('File Size') || extractMeta('filesize');
    const duration = extractMeta('Duration');
    const resolution = extractMeta('Video Resolution') || extractMeta('Resolution');
    const format = extractMeta('Download Format') || extractMeta('Format') || 'Mp4';
    const addedOn = extractMeta('Added On') || extractMeta('Added');

    // Thumbnail
    const thumb = (() => {
      const src = $('img').first().attr('src') || '';
      return src.startsWith('http') ? src : src ? `${baseUrl}${src}` : '';
    })();

    // Download server links — "Download Server 1", "Download Server 2", etc.
    const serverLinks = [];
    $('a').each((_, el) => {
      const text = $(el).text().trim();
      const href = $(el).attr('href') || '';
      // Match "Download Server N" or external relay links
      if (/download\s*server\s*\d*/i.test(text) || /moviespage\.xyz|downloadpage\.xyz/i.test(href)) {
        const fullHref = href.startsWith('http') ? href : `${baseUrl}${href}`;
        if (fullHref && !serverLinks.includes(fullHref)) serverLinks.push(fullHref);
      }
    });

    logger.debug(`[Moviesda] Download info page: name="${name}" size="${size}" servers=${serverLinks.length}`);

    return {
      name: name || 'Movie File',
      size,
      duration,
      resolution,
      format,
      addedOn,
      thumb,
      serverLinks,
    };
  } catch (err) {
    logger.warn(`[Moviesda] resolveDownloadInfoPage error for ${pageUrl}: ${err.message}`);
    return null;
  }
}

/**
 * Legacy: Parse a quality sub-page to get file download entries (old .mv-content format).
 * Kept as fallback for older site layouts.
 */
async function resolveFileList(qualityPageUrl, baseUrl) {
  try {
    const html = await fetchHtml(qualityPageUrl);
    const $ = cheerio.load(html);

    const files = [];

    // New format: "Download Information" single-file page
    if (html.includes('File Name') || html.includes('Download Server')) {
      const info = await resolveDownloadInfoPage(qualityPageUrl, baseUrl);
      if (info) {
        files.push({
          name: info.name,
          size: info.size,
          format: info.format,
          thumb: info.thumb,
          duration: info.duration,
          resolution: info.resolution,
          downloadHref: qualityPageUrl, // The page itself is the download info page
          serverLinks: info.serverLinks,
        });
      }
      return files;
    }

    // Old format: .mv-content divs with multiple files
    $('main .mv-content, main .folder .mv-content').each((_, el) => {
      const linkEl = $(el).find('a').first();
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
      files.push({ name, size, format, thumb: thumb.startsWith('http') ? thumb : `${baseUrl}${thumb}`, downloadHref: fullHref, serverLinks: [] });
    });

    logger.debug(`[Moviesda] File list at ${qualityPageUrl}: ${files.length} files`);
    return files;
  } catch (err) {
    logger.warn(`[Moviesda] resolveFileList error: ${err.message}`);
    return [];
  }
}

// ─── CDN Link Resolution ──────────────────────────────────────────────────────

/**
 * Follow a "Download Server" relay link to get the next hop URL.
 * Supports moviespage.xyz, downloadpage.xyz style relays.
 */
async function resolveRelayChain(relayUrl) {
  // Cap the chain at 3 hops to avoid infinite loops
  let currentUrl = relayUrl;
  let downloadUrl = null;
  let watchUrl = null;

  for (let hop = 0; hop < 3; hop++) {
    try {
      const html = await fetchHtml(currentUrl, { timeout: 10000 });
      const $ = cheerio.load(html);

      // Check for direct video source (onestream player page)
      const videoSrc = $('video source').first().attr('src')
        || $('video').first().attr('src');
      if (videoSrc) {
        downloadUrl = videoSrc.startsWith('http') ? videoSrc : null;
        // The current URL is the watch page
        watchUrl = currentUrl;
        break;
      }

      // Look for next relay link
      let nextUrl = null;
      $('div.dlink a, div.download a, a.btn, a').each((_, el) => {
        const href = $(el).attr('href') || '';
        const text = $(el).text().toLowerCase();
        if (!nextUrl && (
          href.includes('cdnserver') ||
          href.endsWith('.mp4') ||
          href.includes('moviespage.xyz') ||
          href.includes('downloadpage.xyz') ||
          href.includes('onestream')
        )) {
          nextUrl = href;
        }
        if (!watchUrl && (text.includes('watch') || text.includes('online'))) {
          watchUrl = href;
        }
      });

      if (!nextUrl) break;

      if (nextUrl.includes('cdnserver') || nextUrl.endsWith('.mp4')) {
        downloadUrl = nextUrl;
        break;
      }

      currentUrl = nextUrl.startsWith('http') ? nextUrl : null;
      if (!currentUrl) break;
    } catch (err) {
      logger.debug(`[Moviesda] Relay hop ${hop} failed for ${currentUrl}: ${err.message}`);
      break;
    }
  }

  logger.debug(`[Moviesda] Relay chain result: download=${downloadUrl} watch=${watchUrl}`);
  return { downloadUrl, watchUrl };
}

// ─── Full Pipeline ────────────────────────────────────────────────────────────

/**
 * Full pipeline: given a movie title, resolve all quality download links.
 *
 * Strategy (in order):
 *  1. Direct search form (/?s=title)
 *  2. Year listing page (/tamil-{year}-movies/)
 *  3. Direct slug URL construction (/download/{slug}-{year}-original-{quality}/)
 *
 * @param {string} title - Movie title
 * @param {number} [year] - Release year
 */
async function getDownloadLinks(title, year = null) {
  let baseUrl;
  try {
    baseUrl = await getWorkingDomain();
  } catch (err) {
    logger.error(`[Moviesda] No working domain: ${err.message}`);
    return { found: false, title, qualities: [] };
  }

  // ── Step 1: Search form ──────────────────────────────────────────────────
  let searchResults = await searchTitle(title, baseUrl);
  let match = bestMatch(searchResults, title);

  // ── Step 2: Year listing fallback ────────────────────────────────────────
  if (!match && year) {
    logger.info(`[Moviesda] Search returned no match. Trying year listing for ${year}...`);
    const yearResults = await searchInYearListing(title, year, baseUrl);
    match = bestMatch(yearResults, title);
  }

  // ── Step 3: Direct slug construction fallback ────────────────────────────
  if (!match && year) {
    logger.info(`[Moviesda] Year listing returned no match. Trying direct slug construction...`);
    const slugResults = await tryDirectSlugUrls(title, year, baseUrl);
    if (slugResults.length > 0) {
      // Direct slug results are already quality pages — process them directly
      const qualities = await resolveQualityResults(slugResults, baseUrl);
      return {
        found: qualities.length > 0,
        title: slugResults[0].title.split(' (')[0],
        matchedUrl: slugResults[0].href,
        qualities,
      };
    }
  }

  if (!match) {
    logger.info(`[Moviesda] No match found for "${title}" year=${year}`);
    return { found: false, title, qualities: [] };
  }

  logger.info(`[Moviesda] Best match: "${match.title}" → ${match.href}`);

  // ── Step 4: Determine page type and resolve qualities ────────────────────
  let qualityPages = [];

  if (isDownloadInfoPage(match.href)) {
    // Already a download info page — treat it as a single-quality entry
    qualityPages = [{ label: deriveQualityLabel(match.href), href: match.href }];
  } else {
    // Movie index page — extract quality sub-links
    const options = await resolveQualityOptions(match.href, baseUrl);
    if (options.length > 0) {
      qualityPages = options;
    } else {
      // Fallback: treat the match page itself as a quality page
      qualityPages = [{ label: match.title, href: match.href }];
    }
  }

  const qualities = await resolveQualityResults(qualityPages, baseUrl);

  return {
    found: qualities.length > 0,
    title: match.title,
    matchedUrl: match.href,
    qualities,
  };
}

/**
 * Derive a human-readable quality label from a URL slug.
 * e.g. /download/karuppu-2026-original-720p-hd/ → "720p HD"
 */
function deriveQualityLabel(href) {
  const m = href.match(/(\d{3,4}p(?:-hd)?|-hd|-4k|-uhd)/i);
  if (m) return m[0].toUpperCase().replace('-', ' ');
  if (/1080/i.test(href)) return '1080p HD';
  if (/720/i.test(href)) return '720p HD';
  if (/480/i.test(href)) return '480p';
  if (/4k|uhd/i.test(href)) return '4K UHD';
  return 'Original';
}

/**
 * Process quality pages into the final {label, files} structure.
 */
async function resolveQualityResults(qualityPages, baseUrl) {
  const qualities = [];

  for (const qPage of qualityPages) {
    try {
      let files = [];

      if (isDownloadInfoPage(qPage.href)) {
        // This is already a download info page — parse it directly
        const info = await resolveDownloadInfoPage(qPage.href, baseUrl);
        if (info) {
          // Resolve CDN links from server links
          let downloadUrl = null;
          let watchUrl = null;

          for (const serverLink of (info.serverLinks || [])) {
            if (downloadUrl) break;
            const links = await resolveRelayChain(serverLink);
            if (links.downloadUrl) downloadUrl = links.downloadUrl;
            if (links.watchUrl) watchUrl = links.watchUrl;
          }

          files.push({
            name: info.name,
            size: info.size,
            duration: info.duration,
            resolution: info.resolution,
            format: info.format,
            thumb: info.thumb,
            downloadUrl,
            watchUrl: watchUrl || (info.serverLinks[0] || null),
          });
        }
      } else {
        // Try to get sub-files from a quality sub-page
        const fileList = await resolveFileList(qPage.href, baseUrl);

        for (const file of fileList) {
          let downloadUrl = null;
          let watchUrl = null;

          // If file already has serverLinks from resolveDownloadInfoPage
          for (const serverLink of (file.serverLinks || [])) {
            if (downloadUrl) break;
            const links = await resolveRelayChain(serverLink);
            if (links.downloadUrl) downloadUrl = links.downloadUrl;
            if (links.watchUrl) watchUrl = links.watchUrl;
          }

          // Legacy: file has downloadHref — follow it
          if (!downloadUrl && file.downloadHref && file.downloadHref !== qPage.href) {
            const links = await resolveRelayChain(file.downloadHref);
            downloadUrl = links.downloadUrl;
            watchUrl = links.watchUrl;
          }

          files.push({ ...file, downloadUrl, watchUrl });
        }
      }

      if (files.length > 0) {
        qualities.push({ label: deriveQualityLabel(qPage.href) || qPage.label, files });
      }
    } catch (err) {
      logger.warn(`[Moviesda] resolveQualityResults error for ${qPage.href}: ${err.message}`);
    }
  }

  return qualities;
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  getDownloadLinks,
  searchTitle,
  searchInYearListing,
  tryDirectSlugUrls,
  resolveQualityOptions,
  resolveDownloadInfoPage,
  resolveFileList,
  resolveRelayChain,
  getWorkingDomain,
};
