import { describe, expect, it } from 'vitest';
import { byWerknummer, hasWerknummer, locationLabel } from '../src/lib/location';
import type { WorkLocation } from '../src/types';

const location = (werknummer: string, name: string, address = ''): WorkLocation => ({
  id: `${werknummer}-${name}`,
  werknummer,
  name,
  address,
  lat: 0,
  lng: 0,
  radius: 150,
  archived: false,
});

describe('locations without a werknummer', () => {
  it('labels them by name or address', () => {
    expect(locationLabel(location('2026-014', 'Verbouwing'))).toBe('2026-014 · Verbouwing');
    expect(locationLabel(location('2026-014', ''))).toBe('2026-014');
    expect(locationLabel(location('', 'Verbouwing'))).toBe('Verbouwing (geen werknummer)');
    expect(locationLabel(location(' ', '', 'Kerkweg 3'))).toBe('Kerkweg 3 (geen werknummer)');
    expect(locationLabel(undefined)).toBe('Onbekende locatie');
    expect(hasWerknummer(location('  ', 'x'))).toBe(false);
  });

  it('sorts them after the numbered ones', () => {
    const sorted = [
      location('', 'Schuur'),
      location('2026-10', 'B'),
      location('', 'Dakkapel'),
      location('2026-9', 'A'),
    ].sort(byWerknummer);
    expect(sorted.map(locationLabel)).toEqual([
      '2026-9 · A',
      '2026-10 · B',
      'Dakkapel (geen werknummer)',
      'Schuur (geen werknummer)',
    ]);
  });
});
