// Service worker: offline app shell and Web Push display.
// Bump VERSION when shell files change so phones pick up the new copy.
const VERSION = 'pilltime-v7';
const SHELL = [
  './', 'index.html', 'styles.css', 'app.js',
  'lib/schedule.js', 'lib/format.js', 'lib/github.js', 'lib/demo.js',
  'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-180.png',
  'icons/icon-192.png', 'icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first for the shell so updates arrive quickly; cache when offline.
// cache: 'no-cache' makes the browser check with the server every time
// instead of reusing its own copy for up to 10 minutes.
// Never touch GitHub API requests: they carry the token and must stay fresh.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(url.href, { cache: 'no-cache', credentials: 'same-origin' })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request).then((r) => r || caches.match('index.html')))
  );
});

// iOS revokes the subscription if a push arrives without a visible notification,
// so always show one.
self.addEventListener('push', (event) => {
  let msg = {};
  try { msg = event.data ? event.data.json() : {}; } catch { msg = { body: event.data && event.data.text() }; }
  const title = msg.title || 'Dog medication due';
  event.waitUntil(self.registration.showNotification(title, {
    body: msg.body || 'Open PillTime to see what is due.',
    tag: msg.tag || 'pilltime',
    renotify: true,
    requireInteraction: true,
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    data: { url: self.registration.scope }
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || self.registration.scope;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) if ('focus' in c) return c.focus();
      return self.clients.openWindow(target);
    })
  );
});
