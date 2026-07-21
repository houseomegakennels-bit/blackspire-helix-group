/* Blackspire Jarvis service worker.
   Caches only the non-sensitive static shell. API, health, and auth
   responses are NEVER cached — canonical state always comes from the
   control plane, and no privileged action can be replayed from cache. */
'use strict';

const CACHE_NAME = 'jarvis-shell-v3';
const SHELL = ['/jarvis', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function isSensitive(url) {
  return url.pathname.startsWith('/api/') || url.pathname === '/health' || url.pathname === '/ready' || url.pathname === '/telegram/webhook';
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;            // same-origin only
  if (event.request.method !== 'GET') return;                 // never intercept state changes
  if (isSensitive(url)) return;                               // network only, never cached

  if (event.request.mode === 'navigate') {
    if (url.pathname !== '/jarvis' && url.pathname !== '/') return;
    // Network-first shell: fresh UI when online, cached shell offline.
    event.respondWith((async () => {
      try {
        const response = await fetch(event.request);
        const cache = await caches.open(CACHE_NAME);
        if (response.ok) await cache.put('/jarvis', response.clone());
        return response;
      } catch {
        return (await caches.match('/jarvis')) || Response.error();
      }
    })());
    return;
  }

  if (url.pathname === '/manifest.webmanifest') {
    event.respondWith((async () => {
      try {
        const response = await fetch(event.request);
        const cache = await caches.open(CACHE_NAME);
        if (response.ok) await cache.put(event.request, response.clone());
        return response;
      } catch {
        return (await caches.match(event.request)) || Response.error();
      }
    })());
  }
});
