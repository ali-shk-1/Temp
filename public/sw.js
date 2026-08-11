// Bump this version on every deploy that changes cached behavior/shape so
// old caches are torn down and clients pick up fresh assets immediately.
const CACHE_VERSION = "v4";
const CACHE_NAME = `school-mgmt-shell-${CACHE_VERSION}`;

// Only truly static, unhashed files under /public are safe to cache — these
// rarely change and instant-load is a pure win.
const STATIC_ASSETS = [
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
  "/school-logo.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((c) =>
      Promise.all(
        STATIC_ASSETS.map((url) =>
          c.add(url).catch((err) => {
            console.warn("[sw] failed to precache", url, err);
          })
        )
      )
    )
  );
  // Activate the new SW immediately instead of waiting for all tabs to close.
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // Never touch API calls — always live, never cached.
  if (url.pathname.startsWith("/api/")) return;

  // Only handle GET requests; let everything else (POST/PUT/DELETE) pass through untouched.
  if (req.method !== "GET") return;

  // Next.js build output (hashed, content-addressed) is safe and ideal to
  // cache-first: the filename itself changes whenever the content does, so
  // there is no "stale JS" risk here — this is the biggest real speed win.
  if (url.pathname.startsWith("/_next/static/")) {
    e.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          return res;
        });
      })
    );
    return;
  }

  // Static /public assets: stale-while-revalidate — serve instantly from
  // cache if we have it, but always refetch in the background so the cache
  // self-heals instead of trapping a permanently stale copy.
  if (STATIC_ASSETS.includes(url.pathname)) {
    e.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(req).then((cached) => {
          const network = fetch(req)
            .then((res) => {
              cache.put(req, res.clone());
              return res;
            })
            .catch(() => cached);
          return cached || network;
        })
      )
    );
    return;
  }

  // Navigable app routes (/dashboard, /students, etc.) and any RSC/data
  // requests: ALWAYS go to the network. These are what previously got
  // stuck showing an old version of the app after a deploy. We still fall
  // back to a cached copy only if the network is truly unreachable
  // (offline), so the PWA still works offline, but a live deploy is never
  // masked by a cached page.
  e.respondWith(fetch(req).catch(() => caches.match(req)));
});
