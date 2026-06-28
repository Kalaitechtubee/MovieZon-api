'use strict';

const { test, describe, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');

// Import StreamImdbProvider
const StreamImdbProvider = require('../providers/streamimdb');
const { parseQualitiesFromMaster } = require('../providers/streamimdb/utils');

describe('StreamIMDb Provider Unit Tests', () => {
  let provider;

  beforeEach(() => {
    provider = new StreamImdbProvider();
  });

  afterEach(() => {
    mock.restoreAll();
  });

  test('Should instantiate StreamImdbProvider correctly', () => {
    assert.equal(provider.name, 'streamimdb');
    assert.equal(provider.displayName, 'Streamimdb');
  });

  test('exists() should return true', async () => {
    const res = await provider.exists('tt6485666', 'movie');
    assert.equal(res, true);
  });

  test('search() should return an empty array', async () => {
    const res = await provider.search('test query');
    assert.deepEqual(res, []);
  });

  test('details() should return normalized catalog item', async () => {
    const res = await provider.details('12345', 'movie');
    assert.equal(res.id, '12345');
    assert.equal(res.provider, 'streamimdb');
    assert.equal(res.type, 'movie');
  });

  test('parseQualitiesFromMaster() should parse m3u8 resolutions correctly', async () => {
    const mockM3u8Content = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=721482,RESOLUTION=640x360
/some/path/360p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3055749,RESOLUTION=1280x720
/some/path/720p.m3u8`;

    mock.method(axios, 'get', async () => {
      return { status: 200, data: mockM3u8Content };
    });

    const qualities = await parseQualitiesFromMaster('https://example.com/master.m3u8');
    assert.equal(qualities.length, 2);
    assert.equal(qualities[0].quality, '360p');
    assert.equal(qualities[0].url, 'https://example.com/some/path/360p.m3u8');
    assert.equal(qualities[1].quality, '720p');
    assert.equal(qualities[1].url, 'https://example.com/some/path/720p.m3u8');
  });

  test('stream() should resolve stream successfully with qualities', async () => {
    const mockApiResponse = {
      status_code: '200',
      data: {
        title: 'Test Movie',
        imdb_id: 'tt9999999',
        stream_urls: [
          'https://example.com/movie/master.m3u8'
        ]
      }
    };

    const mockM3u8Content = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1920x1080
1080p.m3u8`;

    let getCallsCount = 0;
    mock.method(axios, 'get', async (url) => {
      getCallsCount++;
      if (url.includes('api.php')) {
        return { status: 200, data: mockApiResponse };
      }
      return { status: 200, data: mockM3u8Content };
    });

    const streamData = await provider.stream('12345', 'movie');
    assert.equal(streamData.provider, 'streamimdb');
    assert.equal(streamData.streamUrl, 'https://example.com/movie/master.m3u8');
    assert.equal(streamData.streamType, 'hls');
    assert.equal(streamData.embedUrl, 'https://streamimdb.ru/embed/movie/tt9999999');
    assert.equal(streamData.qualities.length, 1);
    assert.equal(streamData.qualities[0].quality, '1080p');
    assert.equal(streamData.qualities[0].url, 'https://example.com/movie/1080p.m3u8');
  });



  test('health() should return healthy status if API is reachable', async () => {
    mock.method(axios, 'get', async () => {
      return { status: 200, data: { status_code: '200', data: {} } };
    });

    const healthStatus = await provider.health();
    assert.equal(healthStatus.status, 'healthy');
  });
});
