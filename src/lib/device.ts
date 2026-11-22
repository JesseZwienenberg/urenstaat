/** Phone features: address search, GPS, sharing, downloading, the share target. */

export interface AddressResult {
  label: string;
  lat: number;
  lng: number;
}

/**
 * Looks up an address with OpenStreetMap Nominatim. This is the only place
 * the app sends anything over the network, and it only sends the typed address.
 * Called on a button tap, never per keystroke (Nominatim allows 1 request/second).
 */
export async function searchAddress(query: string): Promise<AddressResult[]> {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '5');
  url.searchParams.set('countrycodes', 'nl,be,de');
  url.searchParams.set('accept-language', 'nl');
  url.searchParams.set('q', query);
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Nominatim ${response.status}`);
  const rows = (await response.json()) as { display_name?: string; lat?: string; lon?: string }[];
  return rows
    .map((row) => ({ label: row.display_name ?? '', lat: Number(row.lat), lng: Number(row.lon) }))
    .filter((r) => r.label !== '' && Number.isFinite(r.lat) && Number.isFinite(r.lng));
}

export function currentPosition(): Promise<{ lat: number; lng: number; accuracy: number }> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('unsupported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }),
      reject,
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  });
}

export function canShareFile(file: File): boolean {
  return typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
}

/** Opens the Android share sheet. Resolves false if the user closed it. */
export async function shareFile(file: File, title: string): Promise<boolean> {
  try {
    await navigator.share({ files: [file], title });
    return true;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return false;
    throw err;
  }
}

export function downloadFile(file: File) {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const SHARE_CACHE = 'urenstaat-share';

/**
 * Picks up a file that was shared into the app from another Android app.
 * The service worker stored it in a cache and redirected to "?shared=1".
 */
export async function takeSharedFile(): Promise<File | null> {
  const params = new URLSearchParams(window.location.search);
  if (!params.has('shared')) return null;
  window.history.replaceState(null, '', window.location.pathname);
  if (!('caches' in window)) return null;
  try {
    const cache = await caches.open(SHARE_CACHE);
    const key = new URL('./shared-timeline', document.baseURI).href;
    const response = await cache.match(key);
    if (!response) return null;
    const blob = await response.blob();
    await cache.delete(key);
    return new File([blob], 'Tijdlijn.json', { type: 'application/json' });
  } catch {
    return null;
  }
}

export function registerServiceWorker() {
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {
        // The app still works online without it.
      });
    });
  }
}
