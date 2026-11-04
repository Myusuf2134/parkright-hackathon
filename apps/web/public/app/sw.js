// App shell only. /api is never intercepted: availability must come from the network or not at all.
const CACHE = 'meridian-shell-v4';
const SHELL = ['/app/', '/app/manifest.webmanifest', '/app/icon.svg', '/app/icon-192.png', '/app/icon-512.png'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', (e) => {
  if (e.data?.type !== 'cache') return;
  // One at a time: a single failed asset must not lose the rest.
  void caches.open(CACHE).then((c) => Promise.all(e.data.urls.filter((u) => !new URL(u).pathname.startsWith('/api/')).map((u) => c.add(u).catch(() => {}))));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).then((r) => {
      // The newest page goes in the cache, so offline launches reference assets that exist.
      if (r.ok) { const copy = r.clone(); void caches.open(CACHE).then((c) => c.put('/app/', copy)); }
      return r;
    }).catch(() => caches.match('/app/')));
    return;
  }
  e.respondWith(caches.match(e.request, { ignoreVary: true, ignoreSearch: false }).then((hit) => hit ?? fetch(e.request).then((r) => {
    if (r.ok) { const copy = r.clone(); void caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return r;
  })));
});
