// Service worker: lets the /map page (and the JS it needs) load with no internet.
// It deliberately caches NOTHING else: no trips, bikes, expenses or API responses.
const CACHE = "lrp-shell-v3";

const isAllowed = (url) =>
  url.origin === self.location.origin &&
  (url.pathname === "/map" || url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/map/fonts/") || url.pathname.startsWith("/map/vendor/"));

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// The page tells us which files it already loaded (they were fetched before this worker took over).
self.addEventListener("message", (event) => {
  if (!event.data || event.data.type !== "cache" || !Array.isArray(event.data.urls)) return;
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(
        event.data.urls.slice(0, 1000).map((u) => {
          const url = new URL(u, self.location.origin);
          if (!isAllowed(url)) return null;
          return fetch(url.href, { credentials: "same-origin" })
            .then((res) => (res.ok ? cache.put(url.href, res) : null))
            .catch(() => null);
        }),
      ),
    ),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isStatic = url.pathname.startsWith("/_next/static/");
  const isMapAsset = url.pathname.startsWith("/map/fonts/") || url.pathname.startsWith("/map/vendor/");
  const isMapPage = req.mode === "navigate" && url.pathname === "/map";

  if (isStatic || isMapAsset) {
    // Content-hashed or immutable: cache first.
    event.respondWith(
      caches.match(req, { ignoreVary: true }).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })),
    );
  } else if (isMapPage) {
    // The page shell contains no personal data. Network first, fall back to the last copy when offline.
    event.respondWith(
      fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(url.href, copy)); }
        return res;
      }).catch(() => caches.match(url.href, { ignoreVary: true, ignoreSearch: true }).then((hit) => hit || Response.error())),
    );
  }
});
