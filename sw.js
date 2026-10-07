const V = 'squeeze-v3';
const CORE = ['./', 'compress.html', 'style.css', 'hub.js', 'tools.js', 'app.js', 'zip.js', 'gs-worker.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png',
  'vendor/pdf-lib.min.js', 'vendor/pdf.min.mjs', 'vendor/pdf.worker.min.mjs'];
const OPTIONAL = ['vendor/gs.mjs', 'vendor/gs.wasm']; // cached at install if you vendored them

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(V);
    await c.addAll(CORE);
    await Promise.all(OPTIONAL.map(u => c.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || (u.origin !== location.origin && u.hostname !== 'cdn.jsdelivr.net')) return;
  const key = r;
  e.respondWith((async () => {
    const c = await caches.open(V);
    const hit = await c.match(key, { ignoreSearch: true });
    const net = fetch(key)
      .then(res => { if (res.status === 200) c.put(key, res.clone()).catch(() => {}); return res; })
      .catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    const res = await net;
    if (res) return res;
    return (r.mode === 'navigate' && await c.match('./')) || Response.error();
  })());
});
