// Jot service worker — app-shell caching so the notebook opens instantly, online or not.
const CACHE_NAME = "jot-shell-v1";
const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/app.js",
  "./js/firebase-config.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Network-first for Firestore/Google calls (never cache live data),
// cache-first for the app shell so the UI always paints instantly.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const isRemoteData = url.hostname.includes("googleapis.com") || url.hostname.includes("firebaseio.com") || url.hostname.includes("gstatic.com");

  if (isRemoteData) {
    event.respondWith(
      fetch(event.request).catch(() => new Response(null, { status: 503, statusText: "Offline" }))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response && response.status === 200 && event.request.method === "GET") {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
