import type { WorkLocation } from '../types';

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in metres. */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** The nearest item whose radius contains the point, or null. */
export function nearestWithin<T extends { lat: number; lng: number; radius: number }>(
  lat: number,
  lng: number,
  items: T[],
): T | null {
  let best: T | null = null;
  let bestDistance = Infinity;
  for (const item of items) {
    const distance = haversineMeters(lat, lng, item.lat, item.lng);
    if (distance <= item.radius && distance < bestDistance) {
      best = item;
      bestDistance = distance;
    }
  }
  return best;
}

/** The nearest active location whose radius contains the point, or null. */
export function matchLocation(lat: number, lng: number, locations: WorkLocation[]): WorkLocation | null {
  return nearestWithin(
    lat,
    lng,
    locations.filter((l) => !l.archived),
  );
}
