/* Service worker: offline cache + Android share target.
   The version and the asset list are filled in by the build (see vite.config.ts). */
const VERSION = '__VERSION__';
const ASSETS = self.__ASSETS__ || ['./'];
const CACHE = `urenstaat-${VERSION}`;
const SHARE_CACHE = 'urenstaat-share';

/**
 * Stores this version's files. They are fetched past the browser's own HTTP cache
 * (cache: 'reload'): from there the start page could still be the previous version's,
 * pointing to files the host has already deleted, which left the app blank.
 * As a last check, the stored start page must refer only to files of this version;
 * if not, the install fails and the browser tries again later, keeping the old version.
 */
async function precache() {
  const cache = await caches.open(CACHE);
  await cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' })));
  const page = await (await cache.match('./')).text();
  const refs = [...page.matchAll(/(?:src|href)="(\.\/[^"]+)"/g)].map((m) => m[1]);
  if (refs.some((ref) => !ASSETS.includes(ref))) {
    await caches.delete(CACHE);
    throw new Error('The start page does not belong to this version');
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => {
        // Keep the version just before this one (keys are in the order they were made):
        // a screen still open from it may load one of its files later, like the PDF code.
        const old = keys.filter((k) => k !== CACHE && k !== SHARE_CACHE);
        return Promise.all(old.slice(0, -1).map((k) => caches.delete(k)));
      })
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
      const options = { ignoreSearch: request.mode === 'navigate', ignoreVary: true };
      // The start page always comes from this version; other files may also come from the previous one.
      const cached =
        (await cache.match(request, options)) ||
        (request.mode === 'navigate' ? undefined : await caches.match(request, options));
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
