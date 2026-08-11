const CACHE_NAME = "school-mgmt-shell-v3";
// Next.js routes have no .html extension and are SSR/RSC-rendered, and CSS/JS
// ship as hashed /_next/static/ chunks that can't be listed by name here.
// Precache the navigable routes themselves plus the few static assets that
// do have stable, unhashed paths under /public.
const SHELL_FILES = [
  "/login","/dashboard","/students","/staff","/fees","/expenses",
  "/left-students","/left-staff","/permissions","/receipts","/tracking","/balance-sheet",
  "/manifest.json","/icon-192.png","/icon-512.png","/school-logo.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((c) =>
      // Cache each entry independently so one missing/failing asset can't
      // fail the whole install (Cache.addAll is all-or-nothing).
      Promise.all(
        SHELL_FILES.map((url) =>
          c.add(url).catch((err) => {
            console.warn("[sw] failed to precache", url, err);
          })
        )
      )
    )
  );
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith("/api/")) return; // never cache API calls
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE_NAME).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request))
  );
});