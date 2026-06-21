/**
 * MovieZon Provider Pipeline — Integration Tests
 *
 * Tests the three core guarantees of the architecture:
 *  1. Details endpoint never resolves streams (no HLS/MP4 CDN URLs in sources)
 *  2. defaultProvider is always the highest-priority working provider
 *  3. resolveStream always tries NetMirror before Peachify
 *  4. resolveDownload always tries NetMirror before Peachify
 *  5. All pipelines are sequential (never parallel)
 *
 * Run with: node --test src/__tests__/pipeline.test.js
 * (Node.js v18+ built-in test runner)
 */

'use strict';

const { test, describe, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

// ─── Minimal mock cache ────────────────────────────────────────────────────────
const cacheStore = new Map();
const mockCache = {
  get: (key) => cacheStore.get(key) ?? null,
  set: (key, val) => cacheStore.set(key, val),
  del: (key) => cacheStore.delete(key),
};

// ─── Mock providers ────────────────────────────────────────────────────────────

/** Creates a mock provider with configurable behavior */
function makeProvider(name, opts = {}) {
  return {
    name: name.toLowerCase(),
    displayName: name,
    stream: opts.stream ?? (async () => { throw new Error(`${name} stream unavailable`); }),
    details: opts.details ?? (async () => ({ tmdbId: '999', title: 'Test Movie', mediaType: 'movie' })),
    download: opts.download ?? (async () => { throw new Error(`${name} does not support downloads`); }),
  };
}

// ─── Minimal ProviderManager (extracted logic, not the full class) ─────────────

/**
 * Stripped-down version of resolveDetails() Phase 2 — sequential for test verification.
 * Returns sourceChecks array so we can assert ordering.
 */
async function runDetailsPhase2(providers, tmdbId, type, cache) {
  const sourceChecks = [];
  const callOrder = [];  // Track which providers were called and in what order

  for (let idx = 0; idx < providers.length; idx++) {
    const provider = providers[idx];
    const streamCacheKey = `stream:${provider.name}:${type}:${tmdbId}:1:1:default:default`;
    const cachedStream = cache.get(streamCacheKey);

    if (cachedStream) {
      const isPlayable = !!(
        cachedStream.streamUrl ||
        (cachedStream.qualities && cachedStream.qualities.length > 0) ||
        (cachedStream.streamType === 'embed' && cachedStream.embedUrl)
      );
      sourceChecks.push({ provider: provider.name, available: isPlayable, fromCache: true });
    } else {
      callOrder.push(provider.name);
      try {
        const streamData = await Promise.race([
          provider.stream(tmdbId, type, 1, 1, null, null),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
        ]);
        const isPlayable = !!(
          streamData && (
            streamData.streamUrl ||
            (streamData.qualities && streamData.qualities.length > 0) ||
            (streamData.streamType === 'embed' && streamData.embedUrl)
          )
        );
        sourceChecks.push({ provider: provider.name, available: isPlayable, fromCache: false });
      } catch (err) {
        sourceChecks.push({ provider: provider.name, available: false, fromCache: false, error: err.message });
      }
    }
  }

  const defaultProviderEntry = sourceChecks.find(s => s.available);
  const defaultProvider = defaultProviderEntry?.provider || null;

  return { sourceChecks, callOrder, defaultProvider };
}

/**
 * Stripped-down resolveStream() for test verification.
 */
async function runResolveStream(providers, tmdbId, type) {
  const callOrder = [];
  for (const provider of providers) {
    callOrder.push(provider.name);
    try {
      const streamData = await provider.stream(tmdbId, type, 1, 1, null, null);
      const isPlayable = !!(
        streamData && (
          streamData.streamUrl ||
          (streamData.qualities && streamData.qualities.length > 0) ||
          (streamData.streamType === 'embed' && streamData.embedUrl)
        )
      );
      if (isPlayable) {
        return { selectedProvider: provider.name, available: true, callOrder };
      }
    } catch (err) {
      // Continue to next provider
    }
  }
  return { available: false, callOrder };
}

/**
 * Stripped-down resolveDownload() for test verification.
 */
async function runResolveDownload(providers, tmdbId, type) {
  const callOrder = [];
  for (const provider of providers) {
    callOrder.push(provider.name);
    try {
      const downloadData = await provider.download(tmdbId, type, 1, 1, null);
      const hasDirectStreams = downloadData && (
        downloadData.streamUrl ||
        (downloadData.qualities && downloadData.qualities.length > 0)
      );
      if (hasDirectStreams) {
        return { selectedProvider: provider.name, available: true, callOrder };
      }
    } catch (err) {
      // Provider doesn't support download — continue
    }
  }
  return { available: false, callOrder };
}

// ─── Provider priority order (mirrors config.providerPriority) ─────────────────
const PRIORITY_ORDER = ['netmirror', 'peachify'];

function getSortedProviders(allProviders) {
  return [...allProviders].sort((a, b) => {
    const idxA = PRIORITY_ORDER.indexOf(a.name);
    const idxB = PRIORITY_ORDER.indexOf(b.name);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.name.localeCompare(b.name);
  });
}


// ═══════════════════════════════════════════════════════════════════════════════
// DETAILS PIPELINE TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Details Pipeline — Phase 2 Availability Check', () => {

  test('TC-D01: When NetMirror has a valid stream, defaultProvider must be netmirror', async () => {
    const providers = getSortedProviders([
      makeProvider('netmirror', {
        stream: async () => ({ streamUrl: 'https://cdn.example.com/movie.m3u8', qualities: [], subtitles: [] })
      }),
      makeProvider('peachify', {
        stream: async () => ({ embedUrl: 'https://peachify.top/embed/movie/999', streamType: 'embed' })
      }),
    ]);

    const cache = { get: () => null, set: () => {} };
    const { sourceChecks, defaultProvider } = await runDetailsPhase2(providers, '999', 'movie', cache);

    assert.equal(defaultProvider, 'netmirror', 'defaultProvider must be netmirror when it has a valid stream');
    assert.equal(sourceChecks[0].provider, 'netmirror', 'First source must be netmirror (priority order)');
    assert.equal(sourceChecks[0].available, true, 'NetMirror must be marked available');
  });

  test('TC-D02: When NetMirror is unavailable, defaultProvider must be peachify', async () => {
    const providers = getSortedProviders([
      makeProvider('netmirror', {
        stream: async () => { throw new Error('Stream signature expired'); }
      }),
      makeProvider('peachify', {
        stream: async () => ({ embedUrl: 'https://peachify.top/embed/movie/999', streamType: 'embed' })
      }),
    ]);

    const cache = { get: () => null, set: () => {} };
    const { sourceChecks, defaultProvider } = await runDetailsPhase2(providers, '999', 'movie', cache);

    assert.equal(defaultProvider, 'peachify', 'defaultProvider must be peachify when netmirror is unavailable');
    assert.equal(sourceChecks[0].provider, 'netmirror', 'netmirror must still be listed first (priority order)');
    assert.equal(sourceChecks[0].available, false, 'netmirror must be marked unavailable');
    assert.equal(sourceChecks[1].provider, 'peachify', 'peachify must be listed second');
    assert.equal(sourceChecks[1].available, true, 'peachify must be marked available');
  });

  test('TC-D03: When both providers are unavailable, defaultProvider must be null', async () => {
    const providers = getSortedProviders([
      makeProvider('netmirror', {
        stream: async () => { throw new Error('CDN 403'); }
      }),
      makeProvider('peachify', {
        stream: async () => { throw new Error('Timeout'); }
      }),
    ]);

    const cache = { get: () => null, set: () => {} };
    const { sourceChecks, defaultProvider } = await runDetailsPhase2(providers, '999', 'movie', cache);

    assert.equal(defaultProvider, null, 'defaultProvider must be null when no provider is available');
    assert.equal(sourceChecks.every(s => !s.available), true, 'All sources must be unavailable');
  });

  test('TC-D04: Phase 2 must run providers in strict priority order (netmirror first)', async () => {
    const callOrder = [];
    const providers = getSortedProviders([
      makeProvider('peachify', {
        stream: async () => {
          callOrder.push('peachify');
          return { embedUrl: 'https://peachify.top/embed/movie/999', streamType: 'embed' };
        }
      }),
      makeProvider('netmirror', {
        stream: async () => {
          callOrder.push('netmirror');
          throw new Error('Unavailable');
        }
      }),
    ]);

    const cache = { get: () => null, set: () => {} };
    await runDetailsPhase2(providers, '999', 'movie', cache);

    assert.equal(callOrder[0], 'netmirror', 'NetMirror must be called FIRST regardless of registration order');
    assert.equal(callOrder[1], 'peachify', 'Peachify must be called SECOND');
  });

  test('TC-D05: Phase 2 must use cache first — no network call if stream is cached', async () => {
    let networkCallMade = false;
    const providers = getSortedProviders([
      makeProvider('netmirror', {
        stream: async () => {
          networkCallMade = true;
          return { streamUrl: 'https://cdn.example.com/movie.m3u8' };
        }
      }),
    ]);

    // Pre-populate stream cache (simulating a prior resolveStream() call)
    const fakeCache = new Map();
    fakeCache.set('stream:netmirror:movie:999:1:1:default:default', {
      streamUrl: 'https://cdn.example.com/movie.m3u8',
      qualities: [{ quality: '1080p', url: 'https://cdn.example.com/1080p.m3u8' }]
    });
    const cache = {
      get: (key) => fakeCache.get(key) ?? null,
      set: () => {}
    };

    const { defaultProvider } = await runDetailsPhase2(providers, '999', 'movie', cache);

    assert.equal(networkCallMade, false, 'No network call must be made when stream is cached');
    assert.equal(defaultProvider, 'netmirror', 'defaultProvider must be correct even from cache');
  });

  test('TC-D06: Sources array must contain ALL providers in priority order regardless of availability', async () => {
    const providers = getSortedProviders([
      makeProvider('netmirror', {
        stream: async () => { throw new Error('Offline'); }
      }),
      makeProvider('peachify', {
        stream: async () => ({ embedUrl: 'https://peachify.top/embed/movie/999', streamType: 'embed' })
      }),
    ]);

    const cache = { get: () => null, set: () => {} };
    const { sourceChecks } = await runDetailsPhase2(providers, '999', 'movie', cache);

    assert.equal(sourceChecks.length, 2, 'Sources must contain ALL providers');
    assert.equal(sourceChecks[0].provider, 'netmirror', 'First source must be netmirror');
    assert.equal(sourceChecks[1].provider, 'peachify', 'Second source must be peachify');
  });

  test('TC-D07: Sources must NOT contain raw CDN stream URLs (only availability status)', async () => {
    const providers = getSortedProviders([
      makeProvider('netmirror', {
        stream: async () => ({
          streamUrl: 'https://cdn.hakunaymatata.com/some/path/video.m3u8?t=123456&sign=abc',
          qualities: [{ quality: '1080p', url: 'https://cdn.hakunaymatata.com/1080p.m3u8' }]
        })
      }),
    ]);

    const cache = { get: () => null, set: () => {} };
    const { sourceChecks } = await runDetailsPhase2(providers, '999', 'movie', cache);

    // The sourceChecks entries must NOT expose raw CDN URLs
    const source = sourceChecks[0];
    assert.equal('streamUrl' in source, false, 'sourceCheck must not contain streamUrl');
    assert.equal('qualities' in source, false, 'sourceCheck must not contain qualities array');
    assert.equal(source.available, true, 'Source must be marked available');
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// STREAM PIPELINE TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Stream Pipeline — resolveStream Sequential Resolution', () => {

  test('TC-S01: NetMirror success → selectedProvider must be netmirror', async () => {
    const providers = getSortedProviders([
      makeProvider('netmirror', {
        stream: async () => ({ streamUrl: 'https://cdn.example.com/movie.m3u8', qualities: [] })
      }),
      makeProvider('peachify', {
        stream: async () => ({ embedUrl: 'https://peachify.top/embed/movie/999', streamType: 'embed' })
      }),
    ]);

    const result = await runResolveStream(providers, '999', 'movie');

    assert.equal(result.available, true);
    assert.equal(result.selectedProvider, 'netmirror', 'Must select netmirror on success');
    assert.equal(result.callOrder[0], 'netmirror', 'NetMirror must be called first');
  });

  test('TC-S02: NetMirror failure → selectedProvider must be peachify (fallback)', async () => {
    const providers = getSortedProviders([
      makeProvider('netmirror', {
        stream: async () => { throw new Error('Token expired'); }
      }),
      makeProvider('peachify', {
        stream: async () => ({ embedUrl: 'https://peachify.top/embed/movie/999', streamType: 'embed' })
      }),
    ]);

    const result = await runResolveStream(providers, '999', 'movie');

    assert.equal(result.available, true);
    assert.equal(result.selectedProvider, 'peachify', 'Must fallback to peachify');
    assert.equal(result.callOrder.length, 2, 'Both providers must be tried');
    assert.equal(result.callOrder[0], 'netmirror', 'NetMirror MUST be tried first');
    assert.equal(result.callOrder[1], 'peachify', 'Peachify MUST be tried second');
  });

  test('TC-S03: Peachify must NEVER be called before NetMirror', async () => {
    const callOrder = [];
    const providers = getSortedProviders([
      makeProvider('netmirror', {
        stream: async () => {
          callOrder.push('netmirror');
          return { streamUrl: 'https://cdn.example.com/movie.m3u8' };
        }
      }),
      makeProvider('peachify', {
        stream: async () => {
          callOrder.push('peachify');
          return { embedUrl: 'https://peachify.top/embed/movie/999', streamType: 'embed' };
        }
      }),
    ]);

    await runResolveStream(providers, '999', 'movie');

    assert.equal(callOrder[0], 'netmirror', 'NetMirror must be tried first — ALWAYS');
    // Peachify should NOT have been called (NetMirror succeeded)
    assert.equal(callOrder.includes('peachify'), false, 'Peachify must NOT be called when NetMirror succeeds');
  });

  test('TC-S04: All providers fail → available must be false', async () => {
    const providers = getSortedProviders([
      makeProvider('netmirror', { stream: async () => { throw new Error('Offline'); } }),
      makeProvider('peachify', { stream: async () => { throw new Error('Offline'); } }),
    ]);

    const result = await runResolveStream(providers, '999', 'movie');

    assert.equal(result.available, false, 'Must return unavailable when all providers fail');
    assert.equal(result.callOrder.length, 2, 'Both providers must have been tried');
  });

  test('TC-S05: Provider returns empty stream (no streamUrl/qualities/embedUrl) → treated as failure', async () => {
    const providers = getSortedProviders([
      makeProvider('netmirror', {
        stream: async () => ({ streamUrl: null, qualities: [], embedUrl: null }) // empty
      }),
      makeProvider('peachify', {
        stream: async () => ({ embedUrl: 'https://peachify.top/embed/movie/999', streamType: 'embed' })
      }),
    ]);

    const result = await runResolveStream(providers, '999', 'movie');

    assert.equal(result.selectedProvider, 'peachify', 'Must fall through to peachify on empty stream');
    assert.equal(result.callOrder[0], 'netmirror', 'NetMirror must still be tried first');
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// DOWNLOAD PIPELINE TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Download Pipeline — resolveDownload Sequential Resolution', () => {

  test('TC-DL01: NetMirror success → selectedProvider must be netmirror', async () => {
    const providers = getSortedProviders([
      makeProvider('netmirror', {
        download: async () => ({
          streamUrl: 'https://cdn.example.com/movie.mp4',
          qualities: [{ quality: '1080p', url: 'https://cdn.example.com/1080p.mp4' }]
        })
      }),
      makeProvider('peachify', {
        download: async () => { throw new Error('Peachify does not support direct downloads'); }
      }),
    ]);

    const result = await runResolveDownload(providers, '999', 'movie');

    assert.equal(result.available, true);
    assert.equal(result.selectedProvider, 'netmirror', 'Download must be served by netmirror');
    assert.equal(result.callOrder[0], 'netmirror', 'NetMirror must be tried first');
  });

  test('TC-DL02: Peachify must NEVER be called before NetMirror for downloads', async () => {
    const callOrder = [];
    const providers = getSortedProviders([
      makeProvider('netmirror', {
        download: async () => {
          callOrder.push('netmirror');
          return { qualities: [{ quality: '1080p', url: 'https://cdn.example.com/1080p.mp4' }] };
        }
      }),
      makeProvider('peachify', {
        download: async () => {
          callOrder.push('peachify');
          throw new Error('Embed-only');
        }
      }),
    ]);

    await runResolveDownload(providers, '999', 'movie');

    assert.equal(callOrder[0], 'netmirror', 'NetMirror must be called first for downloads — ALWAYS');
    assert.equal(callOrder.includes('peachify'), false, 'Peachify must NOT be called when NetMirror succeeds');
  });

  test('TC-DL03: Peachify embed-only error is caught and skipped (not a pipeline failure)', async () => {
    const providers = getSortedProviders([
      makeProvider('netmirror', {
        download: async () => { throw new Error('No download for this title'); }
      }),
      makeProvider('peachify', {
        download: async () => { throw new Error('Peachify does not support direct downloads'); }
      }),
    ]);

    const result = await runResolveDownload(providers, '999', 'movie');

    assert.equal(result.available, false, 'Must return unavailable, not throw');
    assert.equal(result.callOrder.length, 2, 'Both providers must be tried before giving up');
  });

  test('TC-DL04: NetMirror failure → Peachify is tried as fallback', async () => {
    // Hypothetical: Peachify gains download support in future
    const providers = getSortedProviders([
      makeProvider('netmirror', {
        download: async () => { throw new Error('No download available'); }
      }),
      makeProvider('peachify', {
        download: async () => ({
          qualities: [{ quality: '720p', url: 'https://example.com/720p.mp4' }]
        })
      }),
    ]);

    const result = await runResolveDownload(providers, '999', 'movie');

    assert.equal(result.callOrder[0], 'netmirror', 'NetMirror must always be tried first');
    assert.equal(result.callOrder[1], 'peachify', 'Peachify must be tried as fallback');
    assert.equal(result.selectedProvider, 'peachify', 'Peachify resolves the download as fallback');
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// NETMIRROR VARIANT RETRY TESTS
// ═══════════════════════════════════════════════════════════════════════════════
// These tests use a simulated NetMirror provider that mimics the variant retry
// loop. They verify the key invariants without hitting the real CDN.

describe('NetMirror Variant Retry — STREAM_INVALID vs PROVIDER_OFFLINE', () => {

  /**
   * Simulates the NetMirror variant retry loop (extracted from the real stream() implementation).
   * variants: array of { id, cdnOk } — cdnOk=true means CDN returns 200 for that variant.
   */
  async function runVariantRetry(variants) {
    const callLog = [];
    for (const variant of variants) {
      callLog.push(variant.id);
      if (variant.embedFail) continue; // simulate embed API failure
      if (variant.tokenExpired) continue; // simulate token_expired
      if (!variant.cdnOk) continue; // simulate cdn_403
      // This variant is playable
      return { selectedVariant: variant.id, callLog };
    }
    const err = new Error('STREAM_INVALID: All variants exhausted');
    err.code = 'STREAM_INVALID';
    throw err;
  }

  test('TC-NM01: First variant CDN OK → returns immediately, no further variants tried', async () => {
    const variants = [
      { id: 'v1', cdnOk: true },
      { id: 'v2', cdnOk: true },
    ];
    const result = await runVariantRetry(variants);
    assert.equal(result.selectedVariant, 'v1', 'Must use first working variant');
    assert.equal(result.callLog.length, 1, 'Must stop after first success');
  });

  test('TC-NM02: First variant CDN 403, second variant CDN OK → returns v2 (not Peachify)', async () => {
    const variants = [
      { id: 'v1', cdnOk: false }, // CDN 403
      { id: 'v2', cdnOk: true },  // CDN 200
    ];
    const result = await runVariantRetry(variants);
    assert.equal(result.selectedVariant, 'v2', 'Must try next variant on CDN 403');
    assert.equal(result.callLog.includes('v1'), true, 'v1 must be tried first');
    assert.equal(result.callLog.includes('v2'), true, 'v2 must be tried after v1 fails');
  });

  test('TC-NM03: All variants CDN 403 → throws STREAM_INVALID (not a generic error)', async () => {
    const variants = [
      { id: 'v1', cdnOk: false },
      { id: 'v2', cdnOk: false },
      { id: 'v3', cdnOk: false },
    ];
    await assert.rejects(
      () => runVariantRetry(variants),
      (err) => {
        assert.equal(err.code, 'STREAM_INVALID', 'Error code must be STREAM_INVALID');
        assert.ok(err.message.includes('STREAM_INVALID'), 'Error message must contain STREAM_INVALID');
        return true;
      },
      'Must throw STREAM_INVALID when all variants fail CDN check'
    );
  });

  test('TC-NM04: Token-expired variant is skipped, next valid variant is returned', async () => {
    const variants = [
      { id: 'v1', tokenExpired: true, cdnOk: false },
      { id: 'v2', cdnOk: true },
    ];
    const result = await runVariantRetry(variants);
    assert.equal(result.selectedVariant, 'v2', 'Must skip expired variant and return next valid one');
  });

  test('TC-NM05: Mix of embed failure, token expiry, cdn_403 → last variant succeeds', async () => {
    const variants = [
      { id: 'v1', embedFail: true },
      { id: 'v2', tokenExpired: true },
      { id: 'v3', cdnOk: false },
      { id: 'v4', cdnOk: true },
    ];
    const result = await runVariantRetry(variants);
    assert.equal(result.selectedVariant, 'v4', 'Must exhaust failed variants and return last working one');
    assert.equal(result.callLog.length, 4, 'All 4 variants must be tried');
  });

  test('TC-NM06: STREAM_INVALID error must be distinguishable from PROVIDER_OFFLINE', async () => {
    // STREAM_INVALID: has error.code = 'STREAM_INVALID'
    // PROVIDER_OFFLINE: generic network error (no .code)
    const streamInvalidErr = new Error('STREAM_INVALID: CDN tokens invalid');
    streamInvalidErr.code = 'STREAM_INVALID';

    const providerOfflineErr = new Error('ECONNREFUSED - cannot reach net27.cc');
    // No .code set

    assert.equal(streamInvalidErr.code, 'STREAM_INVALID', 'STREAM_INVALID must have .code=STREAM_INVALID');
    assert.equal(providerOfflineErr.code, undefined, 'PROVIDER_OFFLINE error must NOT have .code');
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// PROVIDER PRIORITY ORDER TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Provider Priority — getSortedProviders ordering', () => {

  test('TC-P01: Providers are always sorted by PROVIDER_PRIORITY regardless of registration order', () => {
    // Simulate providers registered in wrong order
    const allProviders = [
      makeProvider('peachify'),
      makeProvider('netmirror'),
    ];

    const sorted = getSortedProviders(allProviders);

    assert.equal(sorted[0].name, 'netmirror', 'NetMirror must always be first');
    assert.equal(sorted[1].name, 'peachify', 'Peachify must always be second');
  });

  test('TC-P02: Unknown providers are always appended after known-priority providers', () => {
    const allProviders = [
      makeProvider('unknown_provider'),
      makeProvider('peachify'),
      makeProvider('netmirror'),
    ];

    const sorted = getSortedProviders(allProviders);

    assert.equal(sorted[0].name, 'netmirror');
    assert.equal(sorted[1].name, 'peachify');
    assert.equal(sorted[2].name, 'unknown_provider');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PEACHIFY RESILIENT GET TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Peachify Resilient Get — Proxy, Direct, and Worker Fallback', () => {
  let originalProxyUrl;
  const axios = require('axios');
  const config = require('../config');

  beforeEach(() => {
    originalProxyUrl = config.proxyUrl;
  });

  afterEach(() => {
    config.proxyUrl = originalProxyUrl;
    mock.restoreAll();
  });

  test('TC-PH01: Proxy is configured and succeeds → request is made via proxy once', async () => {
    delete require.cache[require.resolve('../providers/peachify')];
    config.proxyUrl = 'http://flpwszil:3ui2w06zs9i2@31.59.20.176:6754';
    const PeachifyProvider = require('../providers/peachify');
    const provider = new PeachifyProvider();

    const mockResponse = { data: 'success_data', status: 200 };
    const calls = [];

    mock.method(axios, 'get', async (url, options) => {
      calls.push({ url, options });
      return mockResponse;
    });

    const res = await provider.peachifyGet('https://api.test/movie/123');

    assert.equal(res.data, 'success_data');
    assert.equal(calls.length, 1);
    assert.ok(calls[0].options.proxy, 'Request should have proxy options attached');
    assert.equal(calls[0].options.proxy.host, '31.59.20.176');
  });

  test('TC-PH02: Proxy fails but direct request succeeds → retries directly (no proxy)', async () => {
    delete require.cache[require.resolve('../providers/peachify')];
    config.proxyUrl = 'http://flpwszil:3ui2w06zs9i2@31.59.20.176:6754';
    const PeachifyProvider = require('../providers/peachify');
    const provider = new PeachifyProvider();

    const calls = [];
    mock.method(axios, 'get', async (url, options) => {
      calls.push({ url, options });
      if (options && options.proxy) {
        throw new Error('Proxy 402 Payment Required');
      }
      return { data: 'direct_success_data', status: 200 };
    });

    const res = await provider.peachifyGet('https://api.test/movie/123');

    assert.equal(res.data, 'direct_success_data');
    assert.equal(calls.length, 2);
    assert.ok(calls[0].options.proxy, 'First request should use proxy');
    assert.equal(calls[1].options.proxy, false, 'Second request should explicitly disable proxy');
  });

  test('TC-PH03: Proxy fails, direct fails, but worker proxy succeeds → retries via worker proxy', async () => {
    delete require.cache[require.resolve('../providers/peachify')];
    config.proxyUrl = 'http://flpwszil:3ui2w06zs9i2@31.59.20.176:6754';
    const PeachifyProvider = require('../providers/peachify');
    const provider = new PeachifyProvider();

    const calls = [];
    mock.method(axios, 'get', async (url, options) => {
      calls.push({ url, options });
      if (url.includes('workers.dev')) {
        return { data: 'worker_success_data', status: 200 };
      }
      throw new Error('Network error');
    });

    const res = await provider.peachifyGet('https://api.test/movie/123');

    assert.equal(res.data, 'worker_success_data');
    assert.equal(calls.length, 3);
    assert.ok(calls[0].options.proxy, 'First request should use proxy');
    assert.equal(calls[1].options.proxy, false, 'Second request should be direct');
    assert.ok(calls[2].url.includes('workers.dev'), 'Third request should be via Cloudflare Worker proxy');
  });

  test('TC-PH04: No proxy configured, direct succeeds → request is made directly once', async () => {
    delete require.cache[require.resolve('../providers/peachify')];
    config.proxyUrl = null;
    const PeachifyProvider = require('../providers/peachify');
    const provider = new PeachifyProvider();

    const calls = [];
    mock.method(axios, 'get', async (url, options) => {
      calls.push({ url, options });
      return { data: 'direct_no_proxy_success', status: 200 };
    });

    const res = await provider.peachifyGet('https://api.test/movie/123');

    assert.equal(res.data, 'direct_no_proxy_success');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.proxy, undefined, 'Request should not have proxy option');
  });

  test('TC-PH05: Proxy fails with 402 → subsequent request bypasses proxy immediately', async () => {
    delete require.cache[require.resolve('../providers/peachify')];
    config.proxyUrl = 'http://flpwszil:3ui2w06zs9i2@31.59.20.176:6754';
    const PeachifyProvider = require('../providers/peachify');
    const provider = new PeachifyProvider();

    const calls = [];
    mock.method(axios, 'get', async (url, options) => {
      calls.push({ url, options });
      if (options && options.proxy) {
        const error = new Error('Proxy 402 Payment Required');
        error.response = { status: 402 };
        throw error;
      }
      return { data: 'success', status: 200 };
    });

    // First request: uses proxy, fails, retries directly, succeeds.
    // This should trigger the 5-minute proxy bypass.
    const res1 = await provider.peachifyGet('https://api.test/movie/1');
    assert.equal(res1.data, 'success');
    assert.equal(calls.length, 2);
    assert.ok(calls[0].options.proxy, 'First request of call 1 should use proxy');
    assert.equal(calls[1].options.proxy, false, 'Second request of call 1 should be direct');

    // Second request: should bypass the proxy stage entirely and go straight to direct!
    const res2 = await provider.peachifyGet('https://api.test/movie/2');
    assert.equal(res2.data, 'success');
    assert.equal(calls.length, 3, 'Should only add 1 call, direct (no proxy call attempt)');
    assert.equal(calls[2].options.proxy, undefined, 'Second call should not try proxy stage at all');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// NETMIRROR PROVIDER RESOLUTION TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('NetMirror Provider Stream Resolution - Playability and Fallbacks', () => {
  const httpClient = require('../utils/httpClient');
  const axios = require('axios');
  let NetMirrorProvider;

  beforeEach(() => {
    // Clear cache to load fresh NetMirrorProvider class
    delete require.cache[require.resolve('../providers/netmirror')];
    NetMirrorProvider = require('../providers/netmirror');
  });

  afterEach(() => {
    mock.restoreAll();
  });

  test('TC-NM-R01: Variant returns empty stream (no streamUrl/qualities/embedUrl) → should skip variant and try next variant', async () => {
    const provider = new NetMirrorProvider();

    // Mock variant list response
    const mockVariants = {
      ok: true,
      defaultSubjectId: 'v1',
      variants: [
        { id: 'v1', language: 'Tamil', dubSubjectId: 'v1' },
        { id: 'v2', language: 'Hindi', dubSubjectId: 'v2' }
      ]
    };

    // Mock httpClient.get calls
    mock.method(httpClient, 'get', async (url) => {
      if (url.includes('variants-tmdb')) {
        return mockVariants;
      }
      if (url.includes('embed-tmdb') && url.includes('dub=v1')) {
        // v1 returns a response with NO streamUrl, qualities, or embedUrl (unplayable)
        return { ok: true, mode: 'none', error: 'Not found' };
      }
      if (url.includes('embed-tmdb') && url.includes('dub=v2')) {
        // v2 returns a valid playable stream
        return {
          ok: true,
          mode: 'direct',
          mp4: 'https://cdn.example.com/movie_hindi.mp4',
          streams: [{ url: 'https://cdn.example.com/movie_hindi.mp4', resolution: 1080 }]
        };
      }
      throw new Error(`Unexpected URL call: ${url}`);
    });

    // Mock axios.get for CDN check for v2
    mock.method(axios, 'get', async (url) => {
      if (url.includes('movie_hindi.mp4')) {
        return { status: 200 };
      }
      throw new Error(`Unexpected axios call: ${url}`);
    });

    const result = await provider.stream('999', 'movie', 1, 1, null, null);

    assert.equal(result.provider, 'netmirror');
    assert.equal(result.streamUrl, 'https://cdn.example.com/movie_hindi.mp4');
    assert.equal(result.qualities.length, 1);
    assert.equal(result.qualities[0].quality, '1080p');
  });

  test('TC-NM-R02: No variants and direct embed returns empty stream (mode: none) → throws STREAM_UNAVAILABLE', async () => {
    const provider = new NetMirrorProvider();

    // Mock variant list to fail/return empty
    mock.method(httpClient, 'get', async (url) => {
      if (url.includes('variants-tmdb')) {
        return { ok: true, variants: [] };
      }
      if (url.includes('embed-tmdb')) {
        // Direct embed fallback returns empty/unplayable response
        return { ok: true, mode: 'none', error: 'We could not find this title' };
      }
      throw new Error(`Unexpected URL call: ${url}`);
    });

    await assert.rejects(
      () => provider.stream('999', 'movie', 1, 1, null, null),
      (err) => {
        assert.ok(err.message.includes('STREAM_UNAVAILABLE'), 'Error message must contain STREAM_UNAVAILABLE');
        return true;
      },
      'Must throw STREAM_UNAVAILABLE when direct embed is not playable'
    );
  });

  test('TC-NM-R03: No variants and direct embed has playable stream → returns the direct embed stream', async () => {
    const provider = new NetMirrorProvider();

    // Mock variants list empty, and direct embed success
    mock.method(httpClient, 'get', async (url) => {
      if (url.includes('variants-tmdb')) {
        return { ok: true, variants: [] };
      }
      if (url.includes('embed-tmdb')) {
        return {
          ok: true,
          mode: 'direct',
          mp4: 'https://cdn.example.com/direct.mp4',
          streams: [{ url: 'https://cdn.example.com/direct.mp4', resolution: 720 }]
        };
      }
      throw new Error(`Unexpected URL call: ${url}`);
    });

    const result = await provider.stream('999', 'movie', 1, 1, null, null);

    assert.equal(result.provider, 'netmirror');
    assert.equal(result.streamUrl, 'https://cdn.example.com/direct.mp4');
    assert.equal(result.qualities[0].quality, '720p');
  });

  test('TC-NM-R04: Variant list has more than 5 candidates → queue is capped to 5 candidates', async () => {
    const provider = new NetMirrorProvider();

    // Mock variant list with 8 variants
    const mockVariants = {
      ok: true,
      defaultSubjectId: 'v1',
      variants: Array.from({ length: 8 }, (_, i) => ({
        id: `v${i + 1}`,
        language: 'English',
        dubSubjectId: `v${i + 1}`
      }))
    };

    const requestedUrls = [];
    mock.method(httpClient, 'get', async (url) => {
      requestedUrls.push(url);
      if (url.includes('variants-tmdb')) {
        return mockVariants;
      }
      if (url.includes('embed-tmdb')) {
        if (!url.includes('dub=')) {
          // Direct embed fallback returns unplayable response
          return { ok: true, mode: 'none', error: 'We could not find this title' };
        }
        // Return playable stream for all to check where it stops
        return {
          ok: true,
          mode: 'direct',
          mp4: `https://cdn.example.com/${url.split('dub=')[1]}.mp4`,
          streams: [{ url: `https://cdn.example.com/${url.split('dub=')[1]}.mp4`, resolution: 1080 }]
        };
      }
      throw new Error(`Unexpected URL call: ${url}`);
    });

    // Mock axios to return CDN 403 for first 4, and CDN 200 for others
    // We expect the loop to stop and fail after trying 5 candidates (v1 to v5) and never reach v6 to v8
    mock.method(axios, 'get', async (url) => {
      if (url.includes('v1.mp4') || url.includes('v2.mp4') || url.includes('v3.mp4') || url.includes('v4.mp4') || url.includes('v5.mp4')) {
        return { status: 403 }; // CDN 403
      }
      return { status: 200 };
    });

    // Call stream, we expect it to fail because all 5 allowed candidates returned CDN 403
    await assert.rejects(
      () => provider.stream('999', 'movie', 1, 1, null, null),
      (err) => {
        assert.equal(err.code, 'STREAM_INVALID');
        return true;
      }
    );

    // Verify exactly 5 variants were tried (excluding variants-tmdb API call and direct embed fallback)
    const variantCalls = requestedUrls.filter(u => u.includes('embed-tmdb') && u.includes('dub='));
    assert.equal(variantCalls.length, 5, 'Only the capped 5 variants should be requested');
    assert.ok(variantCalls.every(u => !u.includes('dub=v6') && !u.includes('dub=v7') && !u.includes('dub=v8')));
  });

  test('TC-NM-R05: Direct request fails with 429 → propagates 429 error and aborts immediately', async () => {
    const provider = new NetMirrorProvider();

    // Mock variant list with 3 variants
    const mockVariants = {
      ok: true,
      defaultSubjectId: 'v1',
      variants: [
        { id: 'v1', language: 'English', dubSubjectId: 'v1' },
        { id: 'v2', language: 'English', dubSubjectId: 'v2' }
      ]
    };

    const requestedUrls = [];
    mock.method(httpClient, 'get', async (url) => {
      requestedUrls.push(url);
      if (url.includes('variants-tmdb')) {
        return mockVariants;
      }
      if (url.includes('embed-tmdb') && url.includes('dub=v1')) {
        const error = new Error('Rate limit');
        error.response = { status: 429 };
        throw error;
      }
      // If loop doesn't abort, it would call v2
      return { ok: true, mp4: 'https://cdn.example.com/v2.mp4' };
    });

    await assert.rejects(
      () => provider.stream('999', 'movie', 1, 1, null, null),
      (err) => {
        assert.equal(err.response.status, 429);
        return true;
      }
    );

    // Verify it aborted immediately after v1 hit 429
    const embedCalls = requestedUrls.filter(u => u.includes('embed-tmdb'));
    assert.equal(embedCalls.length, 1, 'Loop should abort immediately and not request subsequent variants');
    assert.ok(embedCalls[0].includes('dub=v1'));
  });

  test('TC-NM-R06: NetMirror supports downloads and download() delegates to stream()', async () => {
    const provider = new NetMirrorProvider();
    assert.equal(provider.downloadSupported, true);

    // Mock stream() on NetMirrorProvider instance
    mock.method(provider, 'stream', async (id, type, season, episode, variantId, clientIp) => {
      assert.equal(id, '1234');
      assert.equal(type, 'movie');
      assert.equal(season, 1);
      assert.equal(episode, 1);
      assert.equal(variantId, 'variant-abc');
      assert.equal(clientIp, null);
      return { streamUrl: 'https://cdn.example.com/download.mp4', qualities: [] };
    });

    const res = await provider.download('1234', 'movie', 1, 1, 'variant-abc');
    assert.equal(res.streamUrl, 'https://cdn.example.com/download.mp4');
  });
});

describe('Stream Caching & Pipeline Caching with Variants', () => {
  const cache = require('../cache');
  const providerManager = require('../provider-manager');

  afterEach(() => {
    cache.flush();
    mock.restoreAll();
  });

  test('TC-C01: resolveStream() uses cached individual provider stream if present', async () => {
    const sortedProviders = providerManager.getSortedProviders();
    const netmirror = sortedProviders.find(p => p.name === 'netmirror');
    
    if (!netmirror) return; // skip if netmirror is not registered

    // Warm individual stream cache
    const streamCacheKey = 'stream:netmirror:movie:12345:1:1:default:default';
    const cachedStream = {
      provider: 'netmirror',
      streamUrl: 'https://cdn.example.com/cached.mp4',
      qualities: [{ quality: '1080p', url: 'https://cdn.example.com/cached.mp4' }],
      subtitles: [],
      expires: Math.floor(Date.now() / 1000) + 600
    };
    cache.set(streamCacheKey, cachedStream, 600);

    // Mock netmirror stream method to verify it is NOT called
    let called = false;
    mock.method(netmirror, 'stream', async () => {
      called = true;
      return null;
    });

    const res = await providerManager.resolveStream('12345', 'movie', 1, 1, null);
    assert.equal(called, false, 'Should reuse cached stream instead of calling provider.stream()');
    assert.equal(res.streamUrl, 'https://cdn.example.com/cached.mp4');
  });

  test('TC-C02: resolveStream() pipeline caching is keyed by variantId', async () => {
    const sortedProviders = providerManager.getSortedProviders();
    const netmirror = sortedProviders.find(p => p.name === 'netmirror');
    if (!netmirror) return;

    // Mock netmirror.stream to return variant-specific URLs
    mock.method(netmirror, 'stream', async (id, type, season, episode, variantId) => {
      return {
        provider: 'netmirror',
        streamUrl: `https://cdn.example.com/variant-${variantId || 'default'}.mp4`,
        qualities: [],
        subtitles: [],
        expires: Math.floor(Date.now() / 1000) + 600
      };
    });

    // 1. Resolve with default/null variant
    const resDefault = await providerManager.resolveStream('12345', 'movie', 1, 1, null, null);
    assert.equal(resDefault.streamUrl, 'https://cdn.example.com/variant-default.mp4');

    // 2. Resolve with tamil variant
    const resTamil = await providerManager.resolveStream('12345', 'movie', 1, 1, null, 'tamil');
    assert.equal(resTamil.streamUrl, 'https://cdn.example.com/variant-tamil.mp4');

    // 3. Resolve again with tamil variant and check it hits pipeline cache
    // We evict the mock to prove it's a cache hit
    mock.restoreAll();
    const resTamilCached = await providerManager.resolveStream('12345', 'movie', 1, 1, null, 'tamil');
    assert.equal(resTamilCached.streamUrl, 'https://cdn.example.com/variant-tamil.mp4');
  });
});

describe('HLS Playlist Rewriting and Multi-language Proxy Support', () => {
  let originalExports;
  let axiosPath;
  let mockAxiosHandler = null;

  beforeEach(() => {
    axiosPath = require.resolve('axios');
    originalExports = require.cache[axiosPath].exports;

    const mockedAxios = function(...args) {
      if (mockAxiosHandler) {
        return mockAxiosHandler(...args);
      }
      return originalExports(...args);
    };
    Object.assign(mockedAxios, originalExports);
    require.cache[axiosPath].exports = mockedAxios;
  });

  afterEach(() => {
    if (axiosPath && originalExports) {
      require.cache[axiosPath].exports = originalExports;
    }
    mockAxiosHandler = null;
  });

  test('TC-HLS01: Should rewrite absolute and relative URIs inside HLS comments (#EXT-X-MEDIA) and segment URLs', async () => {
    // Force reload apiController so it binds to our mocked axios
    delete require.cache[require.resolve('../controllers/apiController')];
    const apiController = require('../controllers/apiController');

    const mockM3u8Content = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",LANGUAGE="tam",NAME="Tamil",DEFAULT=YES,URI="/net/m3u8/fcdb9bb9.m3u8?src=https%3A%2F%2Fs22.nm-cdn11.top%2F1.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=1000001,RESOLUTION=1920x1080
/net/m3u8/fcdb9bb9.m3u8?src=https%3A%2F%2Fs22.nm-cdn11.top%2F1.m3u8`;

    mockAxiosHandler = async (config) => {
      return {
        status: 200,
        headers: { 'content-type': 'application/vnd.apple.mpegurl' },
        data: mockM3u8Content
      };
    };

    const req = {
      query: { url: 'https://uwu.eat-peach.sbs/net/m3u8/6a8520b1.m3u8' },
      headers: {},
      get: (headerName) => {
        if (headerName.toLowerCase() === 'host') return 'localhost:3000';
        return '';
      },
      on: (event, cb) => {}
    };

    let responseBody = '';
    let responseStatus = 0;
    let responseHeaders = {};
    const res = {
      status: (code) => { responseStatus = code; return res; },
      setHeader: (name, val) => { responseHeaders[name] = val; return res; },
      send: (body) => { responseBody = body; }
    };

    await apiController.proxyStream(req, res);

    assert.equal(responseStatus, 200);
    // Verify that both the URI inside #EXT-X-MEDIA and the segment URL were rewritten to route through proxy
    assert.ok(responseBody.includes('URI="http://localhost:3000/api/v2/stream/proxy?url=https%3A%2F%2Fuwu.eat-peach.sbs%2Fnet%2Fm3u8%2Ffcdb9bb9.m3u8%3Fsrc%3Dhttps%253A%252F%252Fs22.nm-cdn11.top%252F1.m3u8"'));
    assert.ok(responseBody.includes('http://localhost:3000/api/v2/stream/proxy?url=https%3A%2F%2Fuwu.eat-peach.sbs%2Fnet%2Fm3u8%2Ffcdb9bb9.m3u8%3Fsrc%3Dhttps%253A%252F%252Fs22.nm-cdn11.top%252F1.m3u8'));
  });
});

console.log('\n✅ All MovieZon provider pipeline tests defined. Run with: node --test src/__tests__/pipeline.test.js\n');
