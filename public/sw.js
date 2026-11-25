// Service worker: keeps the app shell and Solo Practice working without a network. It only runs on secure pages
// (https or localhost). Live rooms need the network, so WebSockets and the room and profile APIs are never cached.
const PREFIX = 'openparlor-';
const NETWORK_ONLY = [/^\/api\/room/, /^\/api\/profiles/, /^\/api\/leaderboard/, /^\/api\/history/, /^\/api\/records/, /^\/api\/info/, /^\/qr/, /^\/ws/, /^\/api\/precache/];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const { version, urls } = await (await fetch('/api/precache', { cache: 'no-store' })).json();
    const cache = await caches.open(PREFIX + version);
    // One failed file must not stop the others: Solo Practice is useful even if a plugin file is missing.
    await Promise.all(urls.map((u) => cache.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Keep only the newest cache.
    const names = (await caches.keys()).filter((n) => n.startsWith(PREFIX)).sort();
    await Promise.all(names.slice(0, -1).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

async function currentCache() {
  const names = (await caches.keys()).filter((n) => n.startsWith(PREFIX)).sort();
  return names.length ? caches.open(names[names.length - 1]) : null;
}

// Network first, stored copy as the fallback. Online, everyone always gets the current version of every file (so a
// server update can never leave a phone running old screens against new game code); offline, the stored copy is used.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (NETWORK_ONLY.some((re) => re.test(url.pathname))) return;
  event.respondWith((async () => {
    const cache = await currentCache();
    try {
      const res = await fetch(req);
      if (res.ok && cache) cache.put(req, res.clone());
      return res;
    } catch {
      const hit = cache && (await cache.match(req, { ignoreSearch: true }));
      if (hit) return hit;
      // Offline and never stored: a page falls back to the home page.
      if (req.mode === 'navigate' && cache) return (await cache.match('/')) || Response.error();
      return Response.error();
    }
  })());
});
