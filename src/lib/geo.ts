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

/** The nearest active location whose radius contains the point, or null. */
export function matchLocation(
  lat: number,
  lng: number,
  locations: WorkLocation[],
): WorkLocation | null {
  let best: WorkLocation | null = null;
  let bestDistance = Infinity;
  for (const location of locations) {
    if (location.archived) continue;
    const distance = haversineMeters(lat, lng, location.lat, location.lng);
    if (distance <= location.radius && distance < bestDistance) {
      best = location;
      bestDistance = distance;
    }
  }
  return best;
}
