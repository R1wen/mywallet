/*
 * Service worker myWallet (ADR-045). Volontairement minimal : aucune donnée financière
 * n'est mise en cache. Il garde seulement une page « hors ligne » affichée quand une
 * navigation échoue faute de réseau.
 */
const CACHE = "mw-offline-v1";
const OFFLINE = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.add(OFFLINE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(OFFLINE).then((r) => r ?? Response.error())),
  );
});
