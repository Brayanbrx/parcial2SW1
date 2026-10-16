/* global self, caches, fetch, URL, __CACHE_NAME__, __ASSETS__ */
const CACHE = __CACHE_NAME__;
const ASSETS = __ASSETS__;

self.addEventListener('install', (event) => {
  // A partial download cannot replace a working build. Updates wait until all
  // old tabs close, so an active editor never mixes incompatible asset versions.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith('uml-shell-v1-') && key !== CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Never cache identities, tokens, API responses, or collaboration traffic.
  if (/^\/(?:api|collab)(?:\/|$)/.test(url.pathname)) return;
  const appRoute =
    request.mode === 'navigate' &&
    /^\/(?:$|index\.html$|entrar\/?$|activar\/?$|restablecer\/?$|cuenta\/?$|sin-conexion\/?$|proyectos(?:\/[^/]+)?\/?$|pizarras\/[^/]+\/?$)/.test(
      url.pathname,
    );
  if (!appRoute && !ASSETS.includes(url.pathname)) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      return (await cache.match(appRoute ? '/index.html' : url.pathname)) ?? fetch(request);
    })(),
  );
});
