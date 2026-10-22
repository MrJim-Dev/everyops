/* EveryOps service worker: makes the app installable and shows a page of its own when there's no connection.
 * It only handles page loads (navigations), always from the network first; nothing else is cached, so a new release
 * is never served stale. Bump VERSION when offline.html changes. */
const VERSION = "everyops-offline-v1";
const OFFLINE = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll([OFFLINE, "/icon-192.png"]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE)));
    return;
  }
  // The offline page's own icon, when there's no network.
  if (new URL(request.url).pathname === "/icon-192.png")
    event.respondWith(fetch(request).catch(() => caches.match("/icon-192.png")));
});
