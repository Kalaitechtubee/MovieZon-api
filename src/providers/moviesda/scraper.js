/**
 * Moviesda Scraper — v3 (movieblur.com backend)
 *
 * Architecture (confirmed June 2026):
 *
 *  - All moviesda.* domains (moviesda.blue, moviesda.mobi, moviesda.dev, etc.)
 *    are thin redirect pages — the actual content engine is at movieblur.com
 *
 *  - movieblur.com listing page (home / search):
 *      Each entry is a "Download Now" link → {title}-{year}-{quality}-{language}.html
 *
 *  - movieblur.com movie page (e.g. /moondram-kan-2026-hdrip-tamil.html):
 *      - .movie-info-container  → title, year, quality metadata
 *      - .download-section      → magnet: links per quality (1080p, 720p, 480p)
 *      - .watch-box a           → embed watch URLs (audinifer.com, minochinos.com)
 *      - og:image               → movie thumbnail
 *
 *  - URL slug pattern: {slug}-{year}-{quality}-{language}.html
 *      e.g. karuppu-2026-hdrip-tamil.html
 *           blast-2026-hdrip-tamil.html
 */

const axios = require('axios');
const cheerio = require('cheerio');
const logger = require('../../logger');

// ─── Constants ────────────────────────────────────────────────────────────────

const BASE_URL = 'https://movieblur.com';

const REQUEST_TIMEOUT = 12000;

const SCRAPE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Connection': 'keep-alive',
};

// Quality suffixes tried in direct-slug construction (most common first)
const QUALITY_SUFFIXES = [
  'hdrip-tamil',
  'hdrip-telugu',
  'hdrip-malayalam',
  'hdrip-hindi',
  'hdrip-kannada',
  'dvdscr-tamil',
  'dvdscr-telugu',
  'dvdscr-hindi',
  'bluray-tamil',
  'bluray-telugu',
  'bluray-hindi',
  'tamil',
  'telugu',
  'hindi',
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Fetch HTML from a URL.
 */
async function fetchHtml(url, opts = {}) {
  const response = await axios.get(url, {
    timeout: opts.timeout || REQUEST_TIMEOUT,
    headers: { ...SCRAPE_HEADERS, ...(opts.headers || {}) },
    maxRedirects: 8,
    validateStatus: (s) => s < 500,
  });
  if (response.status >= 400) throw new Error(`HTTP ${response.status}`);
  return response.data;
}

/**
 * Slugify a movie title for URL construction.
 * e.g. "Moondram Kan" → "moondram-kan"
 */
function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

/**
 * Extract quality label from a movieblur.com URL slug.
 * e.g. "blast-2026-hdrip-tamil.html" → "HDRip Tamil"
 */
function qualityFromSlug(url) {
  const slug = url.split('/').pop().replace('.html', '');
  // Remove title words by stripping everything before year
  const afterYear = slug.replace(/^.+-\d{4}-?/, '');
  if (!afterYear) return 'Unknown';
  return afterYear
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Extract resolution from text (e.g. "2.8 gb 1080p" → "1080p")
 */
function extractResolution(text) {
  const m = text.match(/(\d{3,4}p)/i);
  return m ? m[1].toLowerCase() : null;
}

// ─── Listing/Search ───────────────────────────────────────────────────────────

/**
 * Get all movie entries from the listing/home page.
 * movieblur.com does NOT have per-search filtering — it returns the same
 * latest listing regardless of query. So we scrape all entries and
 * filter client-side by title match.
 *
 * Each entry: { title, href, quality, language }
 */
async function getListingEntries() {
  try {
    const html = await fetchHtml(BASE_URL);
    const $ = cheerio.load(html);

    const entries = [];
    // Listing links: <a href="https://movieblur.com/{slug}.html">Download Now</a>
    $('a[href*="movieblur.com/"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (!href.endsWith('.html')) return;
      const slug = href.split('/').pop().replace('.html', '');
      // slug format: {title-words}-{year}-{quality}-{language}
      // e.g. moondram-kan-2026-hdrip-tamil
      entries.push({ href, slug });
    });

    // Deduplicate
    const seen = new Set();
    return entries.filter((e) => {
      if (seen.has(e.href)) return false;
      seen.add(e.href);
      return true;
    });
  } catch (err) {
    logger.warn(`[Moviesda] getListingEntries error: ${err.message}`);
    return [];
  }
}

/**
 * Find listing entries matching a title query.
 * Scores by how many title words appear in the slug.
 */
function matchEntries(entries, title, year) {
  const titleWords = slugify(title).split('-').filter(Boolean);
  const yearStr = year ? String(year) : null;

  const scored = entries.map((e) => {
    const slug = e.slug;
    const wordMatches = titleWords.filter((w) => slug.includes(w)).length;
    if (wordMatches === 0) return { ...e, score: -1 };

    let score = wordMatches * 10;
    // Bonus: year matches
    if (yearStr && slug.includes(yearStr)) score += 15;
    // Bonus: slug starts with title slug
    if (slug.startsWith(titleWords[0])) score += 5;

    return { ...e, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.filter((e) => e.score > 0);
}

// ─── Direct Slug Construction ─────────────────────────────────────────────────

/**
 * Try to build movie page URLs directly by combining title slug + year + quality suffix.
 * Returns all URLs that respond with a real movie page.
 */
async function tryDirectSlugs(title, year) {
  const slug = slugify(title);
  const found = [];

  const checks = QUALITY_SUFFIXES.map(async (suffix) => {
    const url = `${BASE_URL}/${slug}-${year}-${suffix}.html`;
    try {
      const html = await fetchHtml(url, { timeout: 8000 });
      // Validate it's a real movie page
      if (html.includes('download-section') || html.includes('movie-info') || html.includes('magnet:')) {
        found.push({ href: url, slug: `${slug}-${year}-${suffix}` });
        logger.debug(`[Moviesda] Direct slug hit: ${url}`);
      }
    } catch (_) {
      // 404 or timeout — skip
    }
  });

  await Promise.all(checks);
  return found;
}

// ─── Movie Page Parsing ───────────────────────────────────────────────────────

/**
 * Parse a movieblur.com movie page.
 * Returns { title, year, thumb, synopsis, downloads[], watchLinks[] }
 *
 * downloads[]: { quality, size, magnetUrl, directUrl }
 * watchLinks[]: { label, embedUrl }
 */
async function parseMoviePage(pageUrl) {
  try {
    const html = await fetchHtml(pageUrl);
    const $ = cheerio.load(html);

    // ── Meta ──
    const title = $('meta[property="og:title"]').attr('content')
      || $('h1, .movie-title').first().text().trim()
      || $('title').text().split('|')[0].trim();

    const thumb = $('meta[property="og:image"]').attr('content')
      || $('img').first().attr('src') || '';

    const synopsis = $('.movie-synopsis, .synopsis, .description').first().text().trim()
      || $('meta[name="description"]').attr('content') || '';

    const yearMatch = (title + ' ' + pageUrl).match(/\b(20\d{2})\b/);
    const year = yearMatch ? yearMatch[1] : null;

    // ── Download Links ──
    // Each quality has magnet links like:
    // <a href="magnet:?xt=...">GET THIS TORRENT  2.8 gb 1080p</a>
    const downloads = [];
    const seenMagnets = new Set();

    $('a[href^="magnet:"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const text = $(el).text().trim();
      if (seenMagnets.has(href)) return;
      seenMagnets.add(href);

      const resolution = extractResolution(text);
      const sizeMatch = text.match(/([\d.]+\s*(?:gb|mb))/i);
      const size = sizeMatch ? sizeMatch[1].toUpperCase() : '';

      downloads.push({
        quality: resolution ? resolution.toUpperCase() : qualityFromSlug(pageUrl),
        size,
        magnetUrl: href,
        directUrl: null, // magnet only — no direct CDN
      });
    });

    // ── Watch/Embed Links ──
    const watchLinks = [];
    const seenEmbeds = new Set();

    // Watch embeds from .watch-box or .player-tabs
    $('a[href*="audinifer.com"], a[href*="minochinos.com"], a[href*="embed"], .watch-box a, .player-tabs a').each((_, el) => {
      const href = $(el).attr('href') || '';
      const text = $(el).text().trim() || 'Watch Online';
      if (!href || seenEmbeds.has(href)) return;
      seenEmbeds.add(href);
      watchLinks.push({ label: text.substring(0, 40), embedUrl: href });
    });

    // Fallback: any embed iframes
    $('iframe[src]').each((_, el) => {
      const src = $(el).attr('src') || '';
      if (src && !seenEmbeds.has(src)) {
        seenEmbeds.add(src);
        watchLinks.push({ label: 'Watch Online', embedUrl: src });
      }
    });

    const quality = qualityFromSlug(pageUrl);

    logger.debug(`[Moviesda] Movie page parsed: "${title}" | ${downloads.length} downloads | ${watchLinks.length} watch links`);

    return {
      title: title.replace(/\s*\|.*$/, '').replace(/\s*Download.*$/i, '').trim(),
      year,
      quality,
      thumb: thumb.startsWith('http') ? thumb : thumb ? `${BASE_URL}${thumb}` : '',
      synopsis,
      downloads,
      watchLinks,
      pageUrl,
    };
  } catch (err) {
    logger.warn(`[Moviesda] parseMoviePage error for ${pageUrl}: ${err.message}`);
    return null;
  }
}

// ─── Full Pipeline ────────────────────────────────────────────────────────────

/**
 * Main entry: given a movie title (+ optional year), find all quality variants
 * and return structured download info.
 *
 * Strategy:
 *  1. Get the home listing and filter by title match
 *  2. If no listing match, try direct slug construction
 *  3. Parse each matched movie page for downloads + watch links
 *
 * @param {string} title
 * @param {number|null} year
 * @returns {Promise<object>}
 */
async function getDownloadLinks(title, year = null) {
  logger.info(`[Moviesda] Searching: "${title}" year=${year}`);

  let matchedEntries = [];

  // ── Step 1: Listing match ──────────────────────────────────────────────────
  try {
    const allEntries = await getListingEntries();
    matchedEntries = matchEntries(allEntries, title, year);
    logger.debug(`[Moviesda] Listing match: ${matchedEntries.length} entries`);
  } catch (err) {
    logger.warn(`[Moviesda] Listing fetch failed: ${err.message}`);
  }

  // ── Step 2: Direct slug construction (if no listing match or for extra variants) ──
  if (matchedEntries.length === 0 && year) {
    logger.info(`[Moviesda] No listing match. Trying direct slug construction...`);
    const directHits = await tryDirectSlugs(title, year);
    matchedEntries = directHits;
    logger.debug(`[Moviesda] Direct slug hits: ${matchedEntries.length}`);
  }

  if (matchedEntries.length === 0) {
    logger.info(`[Moviesda] No results found for "${title}"`);
    return { found: false, title, qualities: [] };
  }

  // ── Step 3: Parse movie pages ──────────────────────────────────────────────
  // Group entries by "base title" (everything before quality suffix) to avoid
  // parsing 10 pages for the same movie
  const topEntries = matchedEntries.slice(0, 6); // Max 6 variants

  const parsed = await Promise.all(
    topEntries.map((e) => parseMoviePage(e.href))
  );

  const valid = parsed.filter(Boolean);

  if (valid.length === 0) {
    return { found: false, title, qualities: [] };
  }

  // ── Build result ───────────────────────────────────────────────────────────
  // Each parsed page = one quality variant
  const qualities = valid.map((p) => ({
    label: p.quality,
    pageUrl: p.pageUrl,
    thumb: p.thumb,
    synopsis: p.synopsis,
    files: p.downloads.map((d) => ({
      name: `${p.title} (${p.quality})`,
      size: d.size,
      quality: d.quality,
      magnetUrl: d.magnetUrl,
      downloadUrl: d.magnetUrl, // magnet IS the download
      watchUrl: p.watchLinks[0]?.embedUrl || null,
    })),
    watchLinks: p.watchLinks,
  }));

  return {
    found: true,
    title: valid[0].title,
    year: valid[0].year,
    thumb: valid[0].thumb,
    matchedUrl: valid[0].pageUrl,
    qualities,
  };
}

/**
 * Search for movies matching a title — returns lightweight listing entries.
 * Useful for autocomplete / quick search.
 */
async function searchTitle(title, _baseUrl) {
  const entries = await getListingEntries();
  const year = title.match(/\b(20\d{2})\b/)?.[1] || null;
  const matches = matchEntries(entries, title, year);
  return matches.map((e) => ({
    title: e.slug
      .replace(/-\d{4}.*$/, '')
      .split('-')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' '),
    href: e.href,
  }));
}

/**
 * Returns the base domain URL (for compatibility with old getWorkingDomain callers).
 */
async function getWorkingDomain() {
  // Verify movieblur.com is reachable
  try {
    await axios.head(BASE_URL, { timeout: 8000, headers: SCRAPE_HEADERS });
    return BASE_URL;
  } catch (err) {
    throw new Error(`movieblur.com is unreachable: ${err.message}`);
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  getDownloadLinks,
  searchTitle,
  getWorkingDomain,
  parseMoviePage,
  tryDirectSlugs,
  getListingEntries,
  matchEntries,
  // Legacy compat stubs
  searchInYearListing: async () => [],
  tryDirectSlugUrls: async () => [],
  resolveQualityOptions: async () => [],
  resolveDownloadInfoPage: async () => null,
  resolveFileList: async () => [],
  resolveRelayChain: async () => ({ downloadUrl: null, watchUrl: null }),
};