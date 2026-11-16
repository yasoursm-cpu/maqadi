// Service Worker: cache-first. غيّر رقم النسخة مع كل تحديث للملفات عشان يتجدد الكاش.
const VERSION = 'v2';
const PREFIX = 'grocery-';
const CACHE = PREFIX + VERSION;
const FILES = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'parser.js',
  'dictionary.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(req, { ignoreSearch: true }).then((hit) =>
        hit || fetch(req).catch(() => (req.mode === 'navigate' ? cache.match('index.html') : Response.error())))),
  );
});
