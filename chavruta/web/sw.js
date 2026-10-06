// The app installed on a phone: what lets Android (Samsung Internet above all)
// offer to install it, and lets it open with no signal -- the pages already
// learned are kept in the browser (IndexedDB), so they can still be read.
//
// Always the network first: online, every file is fetched fresh, exactly as
// without this worker, so a new version is never held back; the copy kept
// here is used only when the network fails. It never touches the Worker's
// own routes (/x/: the model, the voice, the record), other sites, anything
// but GET, or a byte range (audio).
//
// If this ever misbehaves: publish a sw.js that only unregisters itself
// (self.registration.unregister()), and every phone lets go of it on its
// next visit.

const KEEP = "chavruta-shell-1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== KEEP) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/x/")
      || req.headers.has("range")) return;
  e.respondWith((async () => {
    const cache = await caches.open(KEEP);
    try {
      const fresh = await fetch(req);
      if (fresh.ok && fresh.type === "basic") e.waitUntil(cache.put(req, fresh.clone()).catch(() => {}));
      return fresh;
    } catch (err) {
      const kept = await cache.match(req, { ignoreSearch: req.mode === "navigate" })
        || (req.mode === "navigate" ? await cache.match("/") : null);
      if (kept) return kept;
      throw err;
    }
  })());
});
