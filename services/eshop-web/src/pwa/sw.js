// eShop service worker (ADR 0006, #59). Built into dist/sw.js by the serviceWorker() plugin in vite.config.ts,
// which replaces the two placeholders below with this build's static files and a hash of their contents.
//
// What it does, and only this:
// - pre-caches the build's static files (hashed /assets/*, icons, manifest) and the offline page;
// - answers requests for those files from the cache;
// - lets page loads (navigations) go to the network and shows the offline page when the network is unreachable;
// - never touches /api/*, /images/* or /thirdparty-mock/*: those requests are not intercepted at all, so
//   Applications, Offers, Contracts, Payments and Bids are always live, and sign-in works as without a worker;
// - on a new deploy (a new hash, so a byte-different sw.js) it installs, takes over at once and deletes every
//   other cache, so nobody stays on an old version.

const VERSION = '__ESHOP_VERSION__'
const PRECACHE = '__ESHOP_PRECACHE__' // an array of paths after the build
const CACHE = `eshop-static-${VERSION}`
const OFFLINE_PAGE = '/offline.html'

/** Same-origin paths the worker never handles: the Gateway routes them to other services. */
const NETWORK_ONLY = ['/api/', '/images/', '/thirdparty-mock/', '/healthz']

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      // cache: 'reload' skips the HTTP cache, so a file is never pre-cached from an older deploy's response.
      await cache.addAll(PRECACHE.map((path) => new Request(path, { cache: 'reload' })))
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // This worker owns Cache Storage on the origin: anything but this build's cache is from an older deploy.
      for (const name of await caches.keys()) {
        if (name !== CACHE) await caches.delete(name)
      }
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return
  if (NETWORK_ONLY.some((prefix) => url.pathname === prefix.replace(/\/$/, '') || url.pathname.startsWith(prefix))) {
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => offlinePage()))
    return
  }

  if (PRECACHE.includes(url.pathname)) {
    event.respondWith(caches.match(url.pathname, { cacheName: CACHE }).then((cached) => cached ?? fetch(request)))
  }
  // Anything else (e.g. the favicon of an older build) is not intercepted.
})

async function offlinePage() {
  const cached = await caches.match(OFFLINE_PAGE, { cacheName: CACHE })
  return cached ?? new Response('ออฟไลน์', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
