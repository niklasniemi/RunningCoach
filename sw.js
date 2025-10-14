/* Minimal cache for production; dev registration is disabled */
const CACHE = 'marathon-cache-v54';
const ASSETS = ['./','./index.html','./styles.css?v=54','./app.js?v=54','./manifest.json?v=54'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k!==CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (u.origin !== location.origin) return;
  e.respondWith(caches.match(e.request).then(res => res || fetch(e.request)));
});
