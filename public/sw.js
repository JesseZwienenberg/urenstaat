/* Service worker: offline cache + Android share target.
   The version and the asset list are filled in by the build (see vite.config.ts). */
const VERSION = '__VERSION__';
const ASSETS = self.__ASSETS__ || ['./'];
const CACHE = `urenstaat-${VERSION}`;
const SHARE_CACHE = 'urenstaat-share';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE && k !== SHARE_CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/** Stores a shared Timeline file so the app can pick it up after the redirect. */
async function handleShare(request) {
  const target = new URL('./?shared=1', self.registration.scope).href;
  try {
    const form = await request.formData();
    const file = form.get('file');
    if (file && typeof file !== 'string') {
      const cache = await caches.open(SHARE_CACHE);
      await cache.put(
        new URL('./shared-timeline', self.registration.scope).href,
        new Response(file, { headers: { 'Content-Type': 'application/json' } }),
      );
    }
  } catch {
    // Fall through to the redirect; the app shows its normal start screen.
  }
  return Response.redirect(target, 303);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // e.g. address search: always network

  if (request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    event.respondWith(handleShare(request));
    return;
  }
  if (request.method !== 'GET') return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      // ignoreVary: some hosts add Vary headers that would otherwise make offline lookups miss.
      const cached = await cache.match(request, {
        ignoreSearch: request.mode === 'navigate',
        ignoreVary: true,
      });
      if (cached) return cached;
      try {
        return await fetch(request);
      } catch (err) {
        if (request.mode === 'navigate') {
          const shell = await cache.match('./', { ignoreVary: true });
          if (shell) return shell;
        }
        throw err;
      }
    }),
  );
});
