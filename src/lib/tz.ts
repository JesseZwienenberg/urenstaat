/**
 * Europe/Amsterdam calendar helpers. All day boundaries in the app use Dutch
 * local time (including DST), whatever time zone the device or export is in.
 * Days are passed around as "yyyy-MM-dd" keys.
 */

export const TZ = 'Europe/Amsterdam';

const partsFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function zonedParts(ms: number): ZonedParts {
  const out: Record<string, number> = {};
  for (const part of partsFormat.formatToParts(new Date(ms))) {
    if (part.type !== 'literal') out[part.type] = Number(part.value);
  }
  return out as unknown as ZonedParts;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function toDateKey(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** The Amsterdam calendar day an instant falls on. */
export function dateKeyOf(ms: number): string {
  const p = zonedParts(ms);
  return toDateKey(p.year, p.month, p.day);
}

/** Amsterdam clock time of an instant, e.g. "07:30". */
export function timeOf(ms: number): string {
  const p = zonedParts(ms);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** Offset of Amsterdam time from UTC at the given instant, in milliseconds. */
function offsetMs(ms: number): number {
  const p = zonedParts(ms);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** The instant at which the Amsterdam clock shows the given hour on the given day. */
export function atLocalHourMs(dateKey: string, hour: number): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  const asUtc = Date.UTC(y, m - 1, d) + hour * 3_600_000;
  // Two passes, so days around a DST change resolve to the right offset.
  const firstGuess = asUtc - offsetMs(asUtc);
  return asUtc - offsetMs(firstGuess);
}

/** The instant at which the given Amsterdam day starts (00:00 local time). */
export function startOfDayMs(dateKey: string): number {
  return atLocalHourMs(dateKey, 0);
}

/** Calendar arithmetic on a day key. */
export function addDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return toDateKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isWeekend(dateKey: string): boolean {
  const day = weekdayOf(dateKey);
  return day === 0 || day === 6;
}

export function todayKey(): string {
  return dateKeyOf(Date.now());
}
