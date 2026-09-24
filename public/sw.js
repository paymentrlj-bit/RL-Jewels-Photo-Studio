// The placeholder below is replaced at build time (scripts/stamp-sw.mjs)
// with a hash of this build's own assets. That is the whole fix for a real
// bug: browsers only re-check a service worker when its script's BYTES
// change, and this file used to be a static copy in public/ that was
// byte-identical across every deploy - so the browser never noticed a new
// version existed, and staff phones kept running whatever JS they first
// loaded, sometimes for days, however many times the server itself was
// updated.
const CACHE_NAME = 'rlj-studio-__CACHE_NAME__';
const STATIC_ASSETS = ['/manifest.json', '/favicon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS).catch((err) => {
      console.warn('PWA pre-cache skipped:', err);
    }))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || !url.protocol.startsWith('http')) return;

  // API calls: always the network. A stale cached answer here is actively
  // wrong (a stale queue count, a stale CPC lookup), not just old-looking.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        if (url.pathname === '/api/health') {
          return new Response(
            JSON.stringify({ status: 'offline', offlineMode: true, message: 'Running in offline showroom mode' }),
            { headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(
          JSON.stringify({ error: 'Offline mode: server features will resume once connected to store network.' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
      })
    );
    return;
  }

  // The app shell (the page itself, and its JS/CSS bundles): network-first.
  // This is the piece that actually shipped the scanner fix late - it used
  // to be cache-first, so a phone with a perfectly good connection to the
  // store's own server would still be handed yesterday's JavaScript before
  // ever asking the network. Vite hashes every bundle filename per build, so
  // a stale index.html also means stale (often 404ing) asset URLs.
  //
  // Falls back to cache ONLY when the network request itself fails - true
  // offline, which is what the cached copy exists for.
  const isAppShell = event.request.mode === 'navigate' || /\.(?:js|css)(?:\?|$)/.test(url.pathname);
  if (isAppShell) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match('/index.html')))
    );
    return;
  }

  // Everything else (fonts, images, the manifest): cache-first is the right
  // tradeoff here - these are content-addressed or change rarely, and being
  // instant matters more than being fresh.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        fetch(event.request).then((res) => {
          if (res && res.status === 200) caches.open(CACHE_NAME).then((cache) => cache.put(event.request, res));
        }).catch(() => {});
        return cached;
      }
      return fetch(event.request)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => new Response('Offline', { status: 503, statusText: 'Offline' }));
    })
  );
});
