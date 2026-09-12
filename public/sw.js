const CACHE_NAME = 'jotfield-architecture-1';
const APP_SHELL = ['./', './index.html', './manifest.webmanifest', './jotfield-icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    event.respondWith((async () => {
      const form = await event.request.formData();
      const payload = { title: String(form.get('title') || ''), text: String(form.get('text') || ''), url: String(form.get('url') || '') };
      const cache = await caches.open(CACHE_NAME);
      await cache.put('./pending-share', new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } }));
      return Response.redirect(new URL('./?capture=pending', self.registration.scope).href, 303);
    })());
    return;
  }
  if (event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request).then((response) => {
    const copy = response.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request).then((cached) => cached || caches.match('./index.html'))));
});
