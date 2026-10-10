import { describe, expect, it } from 'vitest';
import {
  cacheName,
  isStaleCache,
  parsePrecache,
  shouldHandle,
} from './sw-core';

const ORIGIN = 'https://dli7319.github.io';

describe('parsePrecache', () => {
  it('accepts the JSON text form', () => {
    expect(parsePrecache('["./index.html","./index.js"]')).toEqual([
      './index.html',
      './index.js',
    ]);
  });

  it('accepts an already-built array', () => {
    expect(parsePrecache(['./index.html'])).toEqual(['./index.html']);
  });

  it('rejects an empty manifest - a worker that precaches nothing is broken', () => {
    expect(() => parsePrecache([])).toThrow(/empty/);
    expect(() => parsePrecache('[]')).toThrow(/empty/);
  });

  it('rejects anything that is not an array of strings', () => {
    expect(() => parsePrecache('not json')).toThrow();
    expect(() => parsePrecache({})).toThrow(/not an array/);
    expect(() => parsePrecache(['./a', 42])).toThrow(/non-empty strings/);
    expect(() => parsePrecache([''])).toThrow(/non-empty strings/);
  });
});

describe('cacheName', () => {
  it('names the cache after the build', () => {
    expect(cacheName('abc123def456')).toBe('screen-recorder-abc123def456');
  });

  it('refuses a version that was never injected', () => {
    // A worker built without build-sw.ts would otherwise cache under a name
    // shared by every build, which is exactly the stale-forever failure.
    expect(() => cacheName('')).toThrow(/not injected/);
    expect(() => cacheName('__CACHE_VERSION__')).toThrow(/not injected/);
    expect(() => cacheName('some__thing')).toThrow(/not injected/);
  });
});

describe('isStaleCache', () => {
  const current = 'screen-recorder-aaa';

  it('drops caches from other builds', () => {
    expect(isStaleCache('screen-recorder-bbb', current)).toBe(true);
  });

  it('keeps the cache belonging to this build', () => {
    expect(isStaleCache(current, current)).toBe(false);
  });

  it('leaves caches belonging to anything else alone', () => {
    // Deleting another app's or a library's cache would be destructive.
    expect(isStaleCache('other-app-v1', current)).toBe(false);
    expect(isStaleCache('workbox-precache', current)).toBe(false);
    expect(isStaleCache('screen-recorder', current)).toBe(false);
  });
});

describe('shouldHandle', () => {
  it('handles same-origin GET requests', () => {
    expect(
      shouldHandle({
        method: 'GET',
        url: `${ORIGIN}/html-screen-recorder/index.js`,
        origin: ORIGIN,
      })
    ).toBe(true);
  });

  it('ignores non-GET requests', () => {
    expect(
      shouldHandle({
        method: 'POST',
        url: `${ORIGIN}/html-screen-recorder/`,
        origin: ORIGIN,
      })
    ).toBe(false);
  });

  it('ignores cross-origin requests', () => {
    // Caching a third-party response would be a privacy leak. This is also the
    // guard that keeps the app from ever becoming dependent on a CDN again.
    expect(
      shouldHandle({
        method: 'GET',
        url: 'https://fonts.googleapis.com/css2?family=Roboto',
        origin: ORIGIN,
      })
    ).toBe(false);
    expect(
      shouldHandle({
        method: 'GET',
        url: 'https://example.com/x.js',
        origin: ORIGIN,
      })
    ).toBe(false);
  });

  it('ignores unparseable URLs instead of throwing', () => {
    expect(
      shouldHandle({ method: 'GET', url: 'not a url', origin: ORIGIN })
    ).toBe(false);
  });

  it('treats the same path on another scheme as cross-origin', () => {
    expect(
      shouldHandle({
        method: 'GET',
        url: `http://dli7319.github.io/html-screen-recorder/`,
        origin: ORIGIN,
      })
    ).toBe(false);
  });
});
