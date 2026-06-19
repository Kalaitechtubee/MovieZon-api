# MovieZon Backend

MovieZon Backend is a production-ready, extensible Node.js + Express video indexing and streaming backend built using a plugin-based, provider-driven architecture. 

It handles search queries, detailed catalog metadata, and streaming link resolutions across multiple third-party provider sites (starting with **NetMirror**) and normalizes them into a unified, provider-agnostic MovieZon JSON schema.

---

## Key Features

- **Provider-Based Architecture**: Add new indexing providers by creating a single folder in `src/providers/` without changing any core application code.
- **Dynamic Registry & Disovery**: Automatically registers and instantiates valid provider classes at startup by scanning directories.
- **Deduplication & Sorting**: Merges search results from multiple providers, ranks them by priority configurations, and removes duplicates (mapped by TMDB ID).
- **Dual-Mode Client with Fallback**: Makes real HTTP calls to the source providers, with automatic fallback to local JSON database captures when servers are down, rate-limited, or protected by Cloudflare.
- **Robust Failover Routing**: Dynamically queries alternative providers in case a primary provider fails to resolve details or streams.
- **Extensible Caching Service**: Memory cache using `node-cache`, structured to support transition to Redis.
- **Centralized Error Handling**: Logs errors securely using Winston and shields sensitive details in production.
- **Graceful Shutdown**: Automatically closes server and drains background routines on shutdown signals.

---

## Recommended Folder Structure

```
moviezon-backend/
│
├── src/
│   ├── app/                      # Express app configurations
│   ├── config/                   # Configuration loader
│   ├── routes/                   # API routes definitions
│   ├── controllers/              # Business controllers (handles inputs/responses)
│   ├── services/                 # Central application service layer
│   │
│   ├── providers/                # Sub-providers
│   │   ├── BaseProvider.js       # Abstract contract for providers
│   │   └── netmirror/            # NetMirror (net27.cc) provider
│   │       ├── data/             # Local database captures
│   │       ├── index.js          # Main NetMirror client and fallbacks
│   │       └── normalizer.js     # Response mapper to MovieZon schemas
│   │
│   ├── provider-manager/         # Orchestrator (priority routing, de-dup, failover)
│   ├── provider-registry/        # Discovers and registers sub-providers dynamically
│   ├── provider-health/          # Background worker tracking provider health statuses
│   ├── provider-cache/           # Intermediary provider-specific caching utilities
│   ├── provider-normalizer/      # Unified MovieZon schemas
│   ├── provider-utils/           # Universal provider helper utilities
│   │
│   ├── middleware/               # 404, Request Logger, Central Error Handler
│   ├── utils/                    # General utilities (HttpClient with retry/backoff)
│   ├── logger/                   # Winston logger instance
│   ├── cache/                    # Memory cache wrapper (NodeCache)
│   └── server.js                 # App server startup and graceful listener
│
├── .env                          # App environment configs
├── package.json                  # Node.js dependencies
└── README.md                     # Documentation
```

---

## Installation & Running

### 1. Prerequisites
- Node.js (v18 or higher)
- npm or yarn

### 2. Install Dependencies
```bash
npm install
```

### 3. Environment Setup
Configure the environment variables by modifying `.env` in the root directory:
```env
PORT=3000
NODE_ENV=development
CACHE_TTL=3600
PROVIDER_PRIORITY=netmirror
NETMIRROR_BASE_URL=https://net27.cc
NETMIRROR_FALLBACK_FILE=./src/providers/netmirror/data/net27.cc-capture.json
HTTP_TIMEOUT=10000
HTTP_RETRIES=3
```

### 4. Running Locally
Run the server with hot-reloading:
```bash
npm run dev
```

Start in production mode:
```bash
npm start
```

### 5. Running Verification Tests
Execute the integration test suite to assert routes and schema layouts:
```bash
npm test
```

---

## API Endpoints

All APIs are prefixed with `/api`.

### 1. Search Query
- **URL**: `GET /api/search?q={query}`
- **Description**: Searches for titles across all active providers, deduplicates, and sorts them.
- **Example Response**:
```json
{
  "ok": true,
  "count": 1,
  "items": [
    {
      "id": "1291608",
      "provider": "netmirror",
      "tmdbId": 1291608,
      "imdbId": "tt33014583",
      "title": "Dhurandhar",
      "originalTitle": "Dhurandhar",
      "year": 2025,
      "type": "movie",
      "language": "hi",
      "quality": "1080p",
      "poster": "https://image.tmdb.org/t/p/w342/snBOuXDdhmTvlzMUvP9Em3Pp1u1.jpg",
      "backdrop": "https://image.tmdb.org/t/p/original/4DfxcN4w0FuYZHQ3JAHzpHWia1U.jpg",
      "overview": "A mysterious traveler...",
      "duration": 212,
      "rating": 7.244,
      "providers": ["netmirror"]
    }
  ]
}
```

### 2. Title Details
- **URL**: `GET /api/details/:provider/:id?type={movie|tv}`
- **Description**: Fetches detailed metadata for a movie or TV show using its TMDB ID. Automatically fails over to alternate providers if the requested provider fails.
- **Example Response**:
```json
{
  "ok": true,
  "details": {
    "id": "1291608",
    "provider": "netmirror",
    "tmdbId": 1291608,
    "imdbId": "tt33014583",
    "title": "Dhurandhar",
    "originalTitle": "Dhurandhar",
    "year": 2025,
    "type": "movie",
    "language": "hi",
    "quality": "1080p",
    "poster": "https://image.tmdb.org/t/p/w342/snBOuXDdhmTvlzMUvP9Em3Pp1u1.jpg",
    "backdrop": "https://image.tmdb.org/t/p/original/4DfxcN4w0FuYZHQ3JAHzpHWia1U.jpg",
    "overview": "A mysterious traveler...",
    "duration": 212,
    "rating": 7.244
  }
}
```

### 3. Stream Details
- **URL**: `GET /api/stream/:provider/:id?type={movie|tv}&season={1}&episode={1}&variant={variantId}`
- **Description**: Resolves streaming links, qualities, and subtitles for a movie or TV show episode. Automatically fails over to alternate providers if requested provider is down.
- **Example Response**:
```json
{
  "ok": true,
  "stream": {
    "provider": "netmirror",
    "drm": false,
    "streamUrl": "https://bcdnxw.hakunaymatata.com/resource/e9f7f50cd17ea9b81a8904e639b12a00.mp4?sign=6287ef3958a0a784b4cd80d5ba5f9ac9&t=1781855727",
    "subtitles": [
      {
        "lang": "en",
        "name": "English",
        "url": "https://net27.cc/api/captions/tt33014583/en.srt"
      }
    ],
    "headers": {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Referer": "https://net27.cc/"
    },
    "qualities": [
      {
        "quality": "480p",
        "url": "https://bcdnxw.hakunaymatata.com/bt/7d50e90c3a0a3027d59df99f32e84344.mp4?sign=f5777ad0097eec5d89d34add1f36b929&t=1781855188"
      },
      {
        "quality": "1080p",
        "url": "https://bcdnxw.hakunaymatata.com/resource/e9f7f50cd17ea9b81a8904e639b12a00.mp4?sign=6287ef3958a0a784b4cd80d5ba5f9ac9&t=1781855727"
      }
    ],
    "expires": 1781855727
  }
}
```

### 4. Providers List & Health status
- **URL**: `GET /api/providers`
- **Description**: Returns all registered providers sorted by priority configuration, alongside cached health check reports.

---

## How to Add a New Provider

The backend utilizes dynamic provider discovery. You can add a new provider (e.g. `StreamWish` or `Net11`) **without modifying any core code** by following these steps:

### Step 1: Create the Provider Folder
Create a subdirectory under `src/providers/` for your provider (e.g., `src/providers/streamwish/`).

### Step 2: Implement the Provider Entrypoint
Create an `index.js` file inside your folder. It must extend `BaseProvider` and export the class.

```javascript
// src/providers/streamwish/index.js
const BaseProvider = require('../BaseProvider');
const httpClient = require('../../utils/httpClient');
const { normalizeCatalogItem, normalizeStream } = require('../../provider-normalizer');

class StreamWishProvider extends BaseProvider {
  constructor() {
    // Pass the unique lowercase provider identifier to super
    super('streamwish');
  }

  /**
   * Search query
   * @returns {Promise<Array>} Normalized items
   */
  async search(query) {
    const rawData = await httpClient.get(`https://api.streamwish.to/search?q=${encodeURIComponent(query)}`);
    // Map items through normalizeCatalogItem(item, 'streamwish')
    return (rawData.items || []).map(item => normalizeCatalogItem(item, this.name));
  }

  /**
   * Fetch detailed metadata
   * @returns {Promise<Object>} Normalized catalog item
   */
  async details(id, type) {
    const rawData = await httpClient.get(`https://api.streamwish.to/details/${type}/${id}`);
    return normalizeCatalogItem(rawData, this.name);
  }

  /**
   * Resolve stream details
   * @returns {Promise<Object>} Normalized stream details
   */
  async stream(id, type, season = 1, episode = 1, variantId = null) {
    const rawData = await httpClient.get(`https://api.streamwish.to/stream/${id}`);
    return normalizeStream(rawData, this.name);
  }

  /**
   * Provider health check ping
   */
  async health() {
    const startTime = Date.now();
    try {
      await httpClient.get('https://api.streamwish.to/ping', { timeout: 3000 });
      return {
        status: 'healthy',
        message: 'Operational',
        responseTimeMs: Date.now() - startTime
      };
    } catch (err) {
      return {
        status: 'unhealthy',
        message: err.message,
        responseTimeMs: Date.now() - startTime
      };
    }
  }
}

module.exports = StreamWishProvider;
```

### Step 3: Enable the Provider in Priority configuration
If you want to configure its sorting preference and priority routing order, add its name to `PROVIDER_PRIORITY` inside your `.env` file:
```env
PROVIDER_PRIORITY=netmirror,streamwish
```
That's it! When you restart the server, the Provider Registry will automatically discover `streamwish`, register it with the `ProviderManager`, configure its sorting hierarchy, and route search/details/stream queries to it.
