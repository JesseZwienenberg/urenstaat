/** Display helpers for work locations. The werknummer may still be empty while it is not known yet. */
import type { WorkLocation } from '../types';
import { compareNames } from './search';

export function hasWerknummer(location: WorkLocation): boolean {
  return location.werknummer.trim() !== '';
}

/** Name of the place without the werknummer: the name, else the address. */
export function placeName(location: WorkLocation): string {
  return location.name.trim() || location.address.trim() || 'Locatie';
}

/** "2026-014 · Verbouwing", "2026-014", or "Verbouwing (geen werknummer)" while the number is not known. */
export function locationLabel(location: WorkLocation | undefined): string {
  if (!location) return 'Onbekende locatie';
  const number = location.werknummer.trim();
  const name = location.name.trim();
  if (number) return name ? `${number} · ${name}` : number;
  return `${placeName(location)} (geen werknummer)`;
}

/** The address as a small second line, or '' when it is empty or already the label itself. */
export function addressLine(location: WorkLocation | undefined): string {
  if (!location) return '';
  const address = location.address.trim();
  const inLabel = location.werknummer.trim() === '' && location.name.trim() === '';
  return inLabel ? '' : address;
}

/** By werknummer (2026-9 before 2026-10). Locations without one come last, by name. */
export function byWerknummer(a: WorkLocation, b: WorkLocation): number {
  const x = a.werknummer.trim();
  const y = b.werknummer.trim();
  if (!x !== !y) return x ? -1 : 1;
  return compareNames(x, y) || compareNames(placeName(a), placeName(b));
}
