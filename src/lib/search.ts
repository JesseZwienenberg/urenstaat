/** Search-as-you-type over names, fast enough for a list of a thousand or so materials. */

/** Lower case, accents removed, single spaces: "  Rolsteiger  6 M " → "rolsteiger 6 m". */
export function normalizeName(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// One shared collator: localeCompare with options builds a new one on every call, which is slow.
const collator = new Intl.Collator('nl', { numeric: true });

/** Dutch alphabetical order, with numbers in number order ("2026-9" before "2026-10"). */
export function compareNames(a: string, b: string): number {
  return collator.compare(a, b);
}

/** The item with exactly this name, ignoring case, accents and extra spaces. */
export function findByName<T extends { name: string }>(items: readonly T[], name: string): T | undefined {
  const wanted = normalizeName(name);
  return wanted === '' ? undefined : items.find((item) => normalizeName(item.name) === wanted);
}

/**
 * Items whose name contains every typed word, best match first: names that start with
 * the typed text, then names with a word that starts with it, then the rest.
 * Alphabetical within each group. An empty query returns everything, alphabetically.
 */
export function searchByName<T extends { name: string }>(items: readonly T[], query: string): T[] {
  const q = normalizeName(query);
  if (q === '') return [...items].sort((a, b) => compareNames(a.name, b.name));
  const words = q.split(' ');
  const hits: { item: T; rank: number }[] = [];
  for (const item of items) {
    const name = normalizeName(item.name);
    if (!words.every((word) => name.includes(word))) continue;
    const rank = name.startsWith(q) ? 0 : name.split(/[^\p{L}\p{N}]+/u).some((w) => w.startsWith(words[0])) ? 1 : 2;
    hits.push({ item, rank });
  }
  return hits.sort((a, b) => a.rank - b.rank || compareNames(a.item.name, b.item.name)).map((hit) => hit.item);
}
