/**
 * Service worker.
 *
 * Two jobs: make the app work offline, and let it update. The rules live in
 * sw-core.ts so they can be unit tested; this file is the wiring.
 *
 * ## Why the cache name carries a content hash
 *
 * The shell is served cache-first, which means a stale cache is a permanently
 * stale app. Naming the cache after the hash of the files it holds makes that
 * structurally impossible rather than a matter of discipline - see cacheName()
 * in sw-core.ts. Each deploy produces a differently named cache, `activate`
 * deletes every other one, and the new worker has already fetched fresh copies
 * into its own. Old and new content never mix.
 *
 * scripts/build-sw.ts computes the hash and swaps the two placeholders below
 * after rolldown has compiled this file. They are string literals rather than
 * free identifiers so no minifier can rename them away.
 *
 * ## Why nothing reloads automatically
 *
 * The usual polish is skipWaiting + reload on controllerchange. This is a
 * screen recorder: takes live in memory as blob URLs and an in-flight
 * recording is destroyed by a reload. pwa.ts surfaces a "new version" banner
 * instead and the user picks the moment.
 */

import {
  cacheName,
  isStaleCache,
  parsePrecache,
  shouldHandle,
} from './sw-core';

const PRECACHE_MANIFEST: unknown = '__PRECACHE_MANIFEST__';
const CACHE_VERSION = '__CACHE_VERSION__';

const PRECACHE = parsePrecache(PRECACHE_MANIFEST);
const CACHE = cacheName(CACHE_VERSION);

/*
 * The worker globals, declared minimally. Pulling in TypeScript's
 * `webworker` lib alongside `dom` makes every shared declaration collide, so
 * this names only the handful of members the worker touches. If it starts
 * needing more, extend this rather than mixing the two libs.
 */
type FetchEventLike = {
  waitUntil(promise: Promise<unknown>): void;
  respondWith(response: Promise<Response | undefined>): void;
  request: Request;
};

declare const self: {
  location: { origin: string };
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void> };
  addEventListener(
    type: 'install' | 'activate' | 'fetch',
    handler: (event: FetchEventLike) => void
  ): void;
  addEventListener(
    type: 'message',
    handler: (event: {
      data: unknown;
      waitUntil(promise: Promise<unknown>): void;
    }) => void
  ): void;
};

/*
 * `skipWaiting` is requested by the page, never taken here.
 *
 * Calling it in `install` made the new worker activate the moment it finished
 * installing. `controllerchange` - the very event pwa.ts waits for before
 * reloading - therefore fired *before* anyone was asked. Clicking Refresh then
 * subscribed to a notification that had already been and gone, so the button
 * did nothing at all.
 *
 * Leaving activation to a message means the new worker parks in `waiting`,
 * which is also the only state `armUpdate` can act on. The page says
 * SKIP_WAITING when the user chooses to take the update.
 */
self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | null)?.type === 'SKIP_WAITING') {
    event.waitUntil(self.skipWaiting());
  }
});

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => isStaleCache(key, CACHE))
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (!shouldHandle({ method: request.method, url: request.url })) return;

  // Navigations resolve to the shell so a refresh or a deep link works with
  // the network down. Without this an offline reload 404s even though every
  // asset is cached - and GitHub Pages has no per-subpath 404 to fall back to.
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then((cached) => cached ?? fetch(request))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok && response.type === 'basic') {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached ?? network;
    })
  );
});
