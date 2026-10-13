// Network-first: siempre intenta la versión más reciente y usa la copia guardada si no hay conexión.
const C = "playlog-v1", A = ["./", "index.html", "manifest.webmanifest", "icon.svg"];
self.addEventListener("install", e => { e.waitUntil(caches.open(C).then(c => c.addAll(A))); self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== C).map(x => caches.delete(x))))); self.clients.claim(); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || u.pathname.startsWith("/.netlify")) return;
  e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(C).then(c => c.put(e.request, cp)); return r; })
    .catch(() => caches.match(e.request).then(m => m || caches.match("index.html"))));
});
