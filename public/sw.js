// Service worker: makes the whole app work with no WiFi. Static files are cached on
// install; the app is "cache first" with a background refresh.
const VERSION = 'vb-v4';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/ctx.js', 'js/util.js', 'js/store.js', 'js/session.js', 'js/reports.js', 'js/sync.js', 'js/tour.js', 'js/help.js', 'js/sample.js', 'js/video.js',
  'js/engine/engine.js', 'js/sheet/layout.js', 'js/sheet/render.js',
  'js/ui/dashboard.js', 'js/ui/newgame.js', 'js/ui/live.js', 'js/ui/sheetview.js', 'js/ui/stats.js', 'js/ui/reports.js', 'js/ui/account.js', 'js/ui/livevideo.js', 'js/ui/shareapp.js',
  'vendor/pdf-lib.mjs', 'vendor/qrcode.mjs', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req, { ignoreSearch: true });
    const refresh = fetch(req).then((res) => { if (res && res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
    if (hit) { e.waitUntil(refresh); return hit; }
    const res = await refresh;
    if (res) return res;
    if (req.mode === 'navigate') return (await cache.match('index.html')) || (await cache.match('./'));
    return new Response('Offline', { status: 503 });
  })());
});
