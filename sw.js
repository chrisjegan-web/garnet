/* Carnet de Voyage — offline service worker.
   Strategy:
   - App shell + icons + manifest: precached on install.
   - Hero/accommodation images: precached from trip.json on install, plus
     stale-while-revalidate at runtime (so newly-viewed ones get cached).
   - Navigations (index.html) + trip.json: NETWORK-FIRST, so a fresh push to
     GitHub Pages always lands when online; falls back to cache when offline.
   - Cross-origin requests (e.g. the live weather API): passed straight
     through, never cached.
   Bump VERSION whenever this file's strategy or precache list changes — the
   activate step deletes any cache that isn't the current VERSION.
*/
const VERSION = 'carnet-v1';
const SHELL = ['./', 'index.html', 'trip.json', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(VERSION).then(function (c) {
      return c.addAll(SHELL).then(function () {
        // Pull image paths out of trip.json and precache them (tolerating any misses).
        return fetch('trip.json', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (t) {
          var imgs = {};
          Object.keys(t.cities || {}).forEach(function (k) { if (t.cities[k].hero) imgs[t.cities[k].hero] = 1; });
          Object.keys(t.stays || {}).forEach(function (k) {
            var s = t.stays[k];
            if (s.photo) imgs[s.photo] = 1;
            if (s.hostPhoto) imgs[s.hostPhoto] = 1;
            (s.gallery || []).forEach(function (g) { imgs[g] = 1; });
          });
          return Promise.all(Object.keys(imgs).map(function (u) { return c.add(u).catch(function () {}); }));
        }).catch(function () {});
      });
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return; // weather API etc. — leave alone

  var isNav = req.mode === 'navigate' || (req.headers.get('accept') || '').indexOf('text/html') > -1;
  var isData = url.pathname.indexOf('trip.json') > -1;

  // Network-first for the page and the data, so GitHub updates always win when online.
  if (isNav || isData) {
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(VERSION).then(function (c) { c.put(isNav ? 'index.html' : req, copy); });
        return res;
      }).catch(function () {
        return caches.match(isNav ? 'index.html' : req).then(function (m) { return m || caches.match('index.html'); });
      })
    );
    return;
  }

  // Everything else same-origin (images, icons, manifest): stale-while-revalidate.
  e.respondWith(
    caches.match(req).then(function (cached) {
      var net = fetch(req).then(function (res) {
        if (res && res.status === 200) {
          var copy = res.clone();
          caches.open(VERSION).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return cached; });
      return cached || net;
    })
  );
});
