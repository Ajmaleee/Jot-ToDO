// Jot service worker — app-shell caching so the notebook opens instantly, online or not.
// v2: fetch handler now GUARANTEES a Response for every navigation, which fixes the
// "site can't be reached / moved to a new address" error that showed up in the
// installed (standalone) app — that happens whenever respondWith() resolves to
// undefined, which the old v1 handler could do when a URL wasn't in the cache yet
// and the network request also failed.
const CACHE_NAME = "jot-shell-v2";
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
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
      .catch((err) => console.error("Jot SW: precache failed", err))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  const isRemoteData =
    url.hostname.includes("googleapis.com") ||
    url.hostname.includes("firebaseio.com") ||
    url.hostname.includes("firebasestorage.app") ||
    url.hostname.includes("gstatic.com");

  // Live data (auth/Firestore/SDK): always go to the network, never cache it.
  if (isRemoteData) {
    event.respondWith(
      fetch(req).catch(() => new Response(null, { status: 503, statusText: "Offline" }))
    );
    return;
  }

  // Page navigations (this is what "opening the installed app" actually triggers):
  // try the network first for freshness, but ALWAYS fall back to the cached shell
  // rather than ever letting the promise resolve to nothing.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          return res;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE_NAME);
          return (
            (await cache.match(req)) ||
            (await cache.match("./index.html")) ||
            (await cache.match("./")) ||
            new Response("<h1>Jot is offline</h1><p>Reconnect and reopen the app.</p>", {
              status: 503,
              headers: { "Content-Type": "text/html" }
            })
          );
        })
    );
    return;
  }

  // Everything else (css/js/icons): cache-first, refresh cache in the background.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) {
        fetch(req).then((res) => {
          if (res && res.status === 200) caches.open(CACHE_NAME).then((c) => c.put(req, res));
        }).catch(() => {});
        return cached;
      }
      return fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => new Response(null, { status: 503, statusText: "Offline" }));
    })
  );
});
