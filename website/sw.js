/* StratEdge portal as an installed app (v33): keeps the app files (scripts, styles, fonts, pictures) close for speed
   and the page shell for when the connection drops. It never stores API answers, files or anyone's data: every
   request to api/ goes straight to the server. */
const CACHE = 'se-shell-20261008.fc374c';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'assets/icon-192.png', 'assets/logo-light.png', 'assets/logo-dark.png'];
self.addEventListener('install', e => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== self.location.origin || u.pathname.includes('/api/') || u.pathname.endsWith('.php') || u.pathname.includes('/application-bot/') || u.pathname.includes('/browser-companion/')) return;
  if (r.mode === 'navigate') {
    // the page: always fresh when online (updates show at once); the last copy when offline
    e.respondWith(
      fetch(r)
        .then(res => {
          // v83: only the page shell itself (/, /index.html, /w/<name>/ served as HTML) replaces the stored shell;
          // robots.txt, security.txt and other same-origin pages no longer take its place for offline use
          if (res.ok && /\/(index\.html)?$/.test(u.pathname) && (res.headers.get('content-type') || '').includes('text/html')) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put('index.html', copy));
          }
          return res;
        })
        .catch(() => caches.match('index.html'))
    );
    return;
  }
  if (/\.(js|css|woff2|png|svg|jpg|jpeg|webp|webmanifest)$/.test(u.pathname)) {
    // app files carry their build in the address (?v=…): the stored copy first, refreshed in the background
    e.respondWith(
      caches.match(r).then(hit => {
        const net = fetch(r)
          .then(res => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then(c => c.put(r, copy));
            }
            return res;
          })
          .catch(() => hit);
        return hit || net;
      })
    );
  }
});
