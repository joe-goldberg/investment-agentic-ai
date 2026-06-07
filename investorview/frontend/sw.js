// InvestorView service worker — app-shell caching + notification support.
const CACHE = "investorview-v1";
const SHELL = [
  "./index.html",
  "./styles.css",
  "./app.js",
  "./i18n.js",
  "./manifest.json",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Cache-first for the app shell; network-first for API/data calls.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  const isApi = /\/(analyze|project|chart|portfolio|markets|health)$/.test(url.pathname);
  if (isApi) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
  } else {
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
  }
});

// Show notifications pushed from the backend (Web Push). Payload: {title, body}.
self.addEventListener("push", (e) => {
  let data = { title: "InvestorView", body: "Analisis baru tersedia." };
  try { data = e.data.json(); } catch (_) {}
  e.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    icon: "icon-192.png",
    badge: "icon-192.png",
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.openWindow("./index.html"));
});
