/* global self, caches, fetch, URL, Response */
const CACHE_NAME = 'lectern-static-v1'
const PRECACHE_ASSETS = [
  '/manifest.webmanifest',
  '/favicon.svg?v=3',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
  '/apple-touch-icon.png',
]

const STATIC_ASSET_RE =
  /\.(?:png|svg|ico|webp|jpg|jpeg|woff2?|webmanifest)$/i

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .catch(() => {
        // Non-fatal if an individual icon fails during dev startup
      })
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // CRITICAL: Strictly bypass all non-GET and cross-origin requests
  // (Firebase, Firestore, Google Auth, WebRTC/TURN, external fonts, etc.)
  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return
  }

  // Never intercept Firebase Auth handlers, server functions, API routes, or Vite dev endpoints
  if (
    url.pathname.startsWith('/__/') ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/_serverFn') ||
    url.pathname.startsWith('/@') ||
    url.pathname.startsWith('/node_modules/')
  ) {
    return
  }

  // Network-first for HTML page navigations
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone()
            void caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(request, copy))
              .catch(() => {})
          }
          return response
        })
        .catch(async () => {
          const cached = await caches.match(request)
          if (cached) return cached
          const homeCached = await caches.match('/')
          if (homeCached) return homeCached
          return new Response(
            '<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Lectern — Offline</title><style>body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#FAF9F5;color:#115E46;font-family:system-ui,-apple-system,sans-serif;padding:24px;text-align:center}main{max-width:360px}h1{font-size:1.25rem;margin:0 0 8px}p{font-size:.9rem;color:#475B53;margin:0 0 16px}button{background:#115E46;color:#FAF9F5;border:0;border-radius:10px;padding:10px 18px;font-weight:600;cursor:pointer}</style></head><body><main><h1>You are offline</h1><p>Reconnect to join live classrooms and sync your whiteboards.</p><button onclick="location.reload()">Try again</button></main></body></html>',
            {
              status: 503,
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
            },
          )
        }),
    )
    return
  }

  // Lightweight stale-while-revalidate for static icons and manifest assets
  if (STATIC_ASSET_RE.test(url.pathname)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request)
        const networkPromise = fetch(request)
          .then((response) => {
            if (response.ok && response.type === 'basic') {
              void cache.put(request, response.clone()).catch(() => {})
            }
            return response
          })
          .catch(() => cached)

        return cached || networkPromise
      }),
    )
  }
})
