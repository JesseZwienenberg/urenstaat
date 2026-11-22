import { describe, expect, it } from 'vitest';
import { compareNames, findByName, normalizeName, searchByName } from '../src/lib/search';

const tool = (name: string) => ({ id: name, name });
const tools = ['Rolsteiger 6 m', 'Afkortzaag', 'Steiger', 'Cirkelzaag', 'Zaagbok', 'Découpeerzaag', 'Kitspuit'].map(tool);
const names = (query: string) => searchByName(tools, query).map((t) => t.name);

describe('material search', () => {
  it('ignores case, accents and extra spaces', () => {
    expect(normalizeName('  Découpeer   ZAAG ')).toBe('decoupeer zaag');
    expect(findByName(tools, 'afkortZAAG ')?.name).toBe('Afkortzaag');
    expect(findByName(tools, 'decoupeerzaag')?.name).toBe('Découpeerzaag');
    expect(findByName(tools, 'Afkort')).toBeUndefined();
    expect(findByName(tools, '  ')).toBeUndefined();
  });

  it('puts names that start with the text first, then word starts, then the rest', () => {
    expect(names('zaag')).toEqual(['Zaagbok', 'Afkortzaag', 'Cirkelzaag', 'Découpeerzaag']);
    expect(names('steiger')).toEqual(['Steiger', 'Rolsteiger 6 m']);
    expect(names('6')).toEqual(['Rolsteiger 6 m']);
  });

  it('needs every typed word, in any order', () => {
    expect(names('zaag afk')).toEqual(['Afkortzaag']);
    expect(names('m rol')).toEqual(['Rolsteiger 6 m']);
    expect(names('hamer')).toEqual([]);
  });

  it('lists everything alphabetically for an empty search', () => {
    expect(names('')).toEqual(['Afkortzaag', 'Cirkelzaag', 'Découpeerzaag', 'Kitspuit', 'Rolsteiger 6 m', 'Steiger', 'Zaagbok']);
  });

  it('sorts numbers by value', () => {
    expect(['2026-10', '2026-9', '2026-100'].sort(compareNames)).toEqual(['2026-9', '2026-10', '2026-100']);
  });

  it('stays quick with a thousand materials', () => {
    const many = Array.from({ length: 1000 }, (_, i) => tool(`Materiaal ${i} ${['zaag', 'schroef', 'plaat'][i % 3]}`));
    const t0 = performance.now();
    for (const q of ['z', 'za', 'zaa', 'zaag', 'zaag 12']) searchByName(many, q);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
