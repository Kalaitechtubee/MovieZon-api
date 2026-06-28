'use strict';

/**
 * VidSrc Provider Unit Tests
 *
 * Tests the core VidSrc streaming behaviour — specifically:
 *   1. When the direct JSON API returns 404, the provider MUST still return
 *      a valid embed-type stream (not throw an error).
 *   2. When the API succeeds, an HLS stream is returned.
 *   3. Health, exists(), and embed URL construction work correctly.
 *
 * Bug reproduced: VidSrc was NOT showing in the Streaming Servers UI because
 * the 404 from the direct API was re-thrown, causing the details pipeline to
 * mark VidSrc as unavailable even though the embed URLs still work.
 */

const { test, describe, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');

const VidSrcProvider = require('../providers/vidsrc');

describe('VidSrc Provider Unit Tests', () => {
  let provider;

  beforeEach(() => {
    provider = new VidSrcProvider();
  });

  afterEach(() => {
    mock.restoreAll();
  });

  /* ─── Basic Provider Properties ─────────────────────────────────────────── */



  test('exists() should always return true (embed providers are always attempted)', async () => {
    const res = await provider.exists('1007757', 'movie');
    assert.equal(res, true);
  });

  test('search() should return an empty array', async () => {
    const res = await provider.search('some movie');
    assert.deepEqual(res, []);
  });

  test('details() should return null (not a catalogue provider)', async () => {
    const res = await provider.details('1007757', 'movie');
    assert.equal(res, null);
  });

  /* ─── THE KEY BUG TEST ───────────────────────────────────────────────────
   *
   * Regression test for: "VidSrc not showing in Streaming Servers UI"
   *
   * Root cause: stream.js re-threw 404 errors from the direct API, which
   * caused the details pipeline to mark VidSrc as UNAVAILABLE even though
   * the embed URLs (vidsrc-embed.ru/embed/movie?tmdb=...) still work fine.
   *
   * Expected behaviour AFTER fix: a 404 from the direct API should fall
   * through silently to the embed fallback, returning a valid streamType:'embed'
   * response so VidSrc always appears in the UI.
   * ───────────────────────────────────────────────────────────────────────── */

  test('[BUG FIX] stream() MUST return embed fallback when direct API returns 404', async () => {
    // Simulate the direct API returning HTTP 404 (movie not in VidSrc API index)
    mock.method(axios, 'get', async (url) => {
      const err = new Error('Request failed with status code 404');
      err.response = { status: 404 };
      throw err;
    });

    // This must NOT throw — it must return a valid embed stream
    let result;
    try {
      result = await provider.stream('1007757', 'movie');
    } catch (err) {
      assert.fail(
        `stream() threw an error on 404 — VidSrc will be hidden from UI!\n` +
        `Error: ${err.message}\n` +
        `Fix: remove the "throw err" inside the 404 catch block in vidsrc/stream.js`
      );
    }

    // Must be an embed-type response with valid embed URLs
    assert.equal(result.streamType, 'embed',
      'streamType must be "embed" when direct API fails');

    assert.ok(result.embedUrl && result.embedUrl.length > 0,
      'embedUrl must be populated even when direct API fails');

    assert.ok(
      result.embedUrl.includes('vidsrc-embed.ru') ||
      result.embedUrl.includes('vsembed.su') ||
      result.embedUrl.includes('vidsrc'),
      `embedUrl should point to a known VidSrc mirror, got: ${result.embedUrl}`
    );

    assert.ok(Array.isArray(result.embedFallbacks) && result.embedFallbacks.length > 0,
      'embedFallbacks must be a non-empty array');

    assert.equal(result.provider, 'vidsrc',
      'provider must be "vidsrc"');
  });

  /* ─── Embed URL Construction ─────────────────────────────────────────────── */

  test('stream() embed URL for movie uses correct ?tmdb= query param format', async () => {
    mock.method(axios, 'get', async () => {
      const err = new Error('Request failed with status code 404');
      err.response = { status: 404 };
      throw err;
    });

    const result = await provider.stream('385687', 'movie');
    assert.equal(result.streamType, 'embed');
    assert.ok(
      result.embedUrl.includes('385687'),
      `embedUrl should contain the movie ID 385687, got: ${result.embedUrl}`
    );
    // Documented format: ?tmdb=ID not /movie/ID
    assert.ok(
      result.embedUrl.includes('?tmdb=') || result.embedUrl.includes('/385687'),
      `embedUrl should reference the ID via ?tmdb= param or path, got: ${result.embedUrl}`
    );
  });

  test('stream() embed URL for TV uses correct season/episode params', async () => {
    mock.method(axios, 'get', async () => {
      const err = new Error('Request failed with status code 404');
      err.response = { status: 404 };
      throw err;
    });

    const result = await provider.stream('1399', 'tv', 1, 1);
    assert.equal(result.streamType, 'embed');
    assert.ok(result.embedUrl.includes('1399'), 'TV embedUrl should contain TMDB ID');
    // Should contain season info
    assert.ok(
      result.embedUrl.includes('season') || result.embedUrl.includes('/1/'),
      `TV embedUrl should contain season info, got: ${result.embedUrl}`
    );
  });

  test('stream() should return multiple embed fallbacks (>= 3 mirrors)', async () => {
    mock.method(axios, 'get', async () => {
      const err = new Error('Request failed with status code 404');
      err.response = { status: 404 };
      throw err;
    });

    const result = await provider.stream('1007757', 'movie');
    assert.ok(
      result.embedFallbacks.length >= 3,
      `Expected at least 3 mirror fallbacks, got: ${result.embedFallbacks.length}`
    );
  });

  /* ─── Direct HLS Stream (API Success Path) ──────────────────────────────── */

  test('stream() should return HLS streamType when direct API succeeds', async () => {
    mock.method(axios, 'get', async (url) => {
      if (url.includes('/api/v1/stream/')) {
        return {
          status: 200,
          data: { url: 'https://cdn.example.com/movie/master.m3u8' }
        };
      }
      throw new Error('unexpected call');
    });

    const result = await provider.stream('1007757', 'movie');
    assert.equal(result.streamType, 'hls',
      'streamType must be "hls" when direct API returns a stream URL');
    assert.ok(result.streamUrl.includes('.m3u8'),
      'streamUrl must be an HLS (.m3u8) URL');
    assert.ok(result.qualities.length > 0,
      'qualities array must not be empty for HLS streams');
  });

  /* ─── Health Check ───────────────────────────────────────────────────────── */

  test('health() should return "healthy" when vidsrc-embed.ru is reachable', async () => {
    mock.method(axios, 'get', async () => {
      return { status: 200, data: '<html>ok</html>' };
    });

    const health = await provider.health();
    assert.equal(health.status, 'healthy');
    assert.ok(typeof health.responseTimeMs === 'number',
      'responseTimeMs must be a number');
  });

  test('health() should return "degraded" (not "unhealthy") when vidsrc-embed.ru is unreachable', async () => {
    mock.method(axios, 'get', async () => {
      throw new Error('ECONNREFUSED');
    });

    const health = await provider.health();
    // Embed providers must NEVER return 'unhealthy' — they resolve client-side
    assert.equal(health.status, 'degraded',
      'Embed providers must return "degraded" not "unhealthy" so pipeline does not skip them');
  });
});
