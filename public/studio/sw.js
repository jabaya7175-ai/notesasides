// Notes & Asides Studio: lets the installed app open quickly and survive a dropped connection.
// Pages and the app's own files: network first, cached copy if offline. Everything else
// (Supabase, fonts, YouTube) goes straight to the network.
const CACHE = 'studio-v1';
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      if (res.ok && (req.mode === 'navigate' || /\/(_astro|studio)\//.test(url.pathname))) cache.put(req.mode === 'navigate' ? new URL('./', self.registration.scope).href : req, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(req.mode === 'navigate' ? new URL('./', self.registration.scope).href : req);
      if (hit) return hit;
      throw err;
    }
  })());
});
