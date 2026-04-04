const CACHE_NAME = 'tx-sync-v2';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './crypto-utils.js',
  './manifest.json',
  './icons/icon.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Always network for Google APIs and GitHub APIs
  if (url.hostname.includes('googleapis.com') || 
      url.hostname.includes('google.com') || 
      url.hostname.includes('github.com')) {
    return; // Fall through to default browser behavior
  }

  // Network-first for local assets to ensure we see updates, fallback to cache
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Update cache with new version
        if (response.ok && ASSETS.some(asset => event.request.url.endsWith(asset.replace('./', '')))) {
          const resClone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, resClone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
