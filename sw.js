// RoGuPong — offline service worker.
//
// The whole point of this game is two phones on a WiFi network, and plenty of
// those networks have no internet behind them. Cache everything on the first
// visit so the second one works regardless.

const CACHE = 'rogupong-v1';
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'icon.svg',
  'css/style.css',
  'js/main.js',
  'js/ui/pixelfont.js',
  'js/ui/logo.js',
  'js/ui/screens.js',
  'js/net/qr.js',
  'js/net/sdp.js',
  'js/net/peer.js',
  'js/net/scanner.js',
  'js/game/match.js',
  'js/game/render.js',
  'js/game/fx.js',
  'js/game/audio.js',
  'js/game/input.js',
  'js/game/characters.js',
  'js/game/items.js',
  'js/game/stages.js',
  'js/data/leaderboard.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  // Network first so a redeploy is picked up, cache as the fallback that makes
  // an internet-less WiFi work.
  event.respondWith(
    fetch(request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match('index.html'))),
  );
});
