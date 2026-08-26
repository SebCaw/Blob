/**
 * A deliberately small service worker.
 *
 * It caches the shell so the app opens instantly and survives a flaky moment on
 * the way to the pub. It does NOT go near /api — a cached game state would be a
 * lie, and this app would rather show "reconnecting" than a stale round.
 */

const CACHE = 'blob-shell-v32';
const SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/ui.js',
  '/net.js',
  '/wake.js',
  '/mascot.js',
  '/qr.js',
  '/screens/common.js',
  '/screens/welcome.js',
  '/screens/lobby.js',
  '/cards.js',
  '/size.js',
  '/sound.js',
  '/games.js',
  '/screens/shelf.js',
  '/screens/bidding.js',
  '/screens/playing.js',
  '/screens/settings.js',
  '/screens/help.js',
  '/screens/reveal.js',
  '/screens/summary.js',
  '/screens/complete.js',
  '/screens/history.js',
  '/screens/election.js',
  '/prefs.js',
  '/screens/help-sillyhead.js',
  '/screens/help-sevens.js',
  '/screens/help-chase.js',
  '/screens/help-cheat.js',
  '/screens/sillyhead/index.js',
  '/screens/sillyhead/home.js',
  '/screens/sillyhead/lobby.js',
  '/screens/sillyhead/sort.js',
  '/screens/sillyhead/table.js',
  '/screens/sillyhead/over.js',
  '/screens/sevens/index.js',
  '/screens/sevens/home.js',
  '/screens/sevens/lobby.js',
  '/screens/sevens/table.js',
  '/screens/sevens/over.js',
  '/screens/chase/index.js',
  '/screens/cheat/index.js',
  '/screens/cheat/home.js',
  '/screens/cheat/lobby.js',
  '/screens/cheat/table.js',
  '/screens/cheat/over.js',
  '/screens/chase/home.js',
  '/screens/chase/lobby.js',
  '/screens/chase/table.js',
  '/screens/chase/over.js',
  '/screens/help-gofish.js',
  '/screens/gofish/index.js',
  '/screens/gofish/home.js',
  '/screens/gofish/lobby.js',
  '/screens/gofish/table.js',
  '/screens/gofish/over.js',
  '/manifest.webmanifest',
  '/icons/blob.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  // Game state and the live stream must always come from the server.
  if (url.pathname.startsWith('/api/')) return;

  // Network first, so a deployed change is picked up straight away, with the
  // cache standing by for when there is no network at all.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((hit) => hit || caches.match('/index.html')))
  );
});
