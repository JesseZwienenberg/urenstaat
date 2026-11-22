/** Dutch display formats. */
import { weekdayOf } from './tz';

const DAY_SHORT = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
const DAY_LONG = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];

/** "2026-11-16" → "16-11-2026" */
export function formatDate(dateKey: string): string {
  const [y, m, d] = dateKey.split('-');
  return `${d}-${m}-${y}`;
}

/** "2026-11-16" → "ma 16-11-2026" */
export function formatDayDate(dateKey: string): string {
  return `${DAY_SHORT[weekdayOf(dateKey)]} ${formatDate(dateKey)}`;
}

/** "2026-11-16" → "ma 16-11" */
export function formatDayShort(dateKey: string): string {
  const [, m, d] = dateKey.split('-');
  return `${DAY_SHORT[weekdayOf(dateKey)]} ${d}-${m}`;
}

export function dayName(dateKey: string): string {
  return DAY_LONG[weekdayOf(dateKey)];
}

/** Hours with a decimal comma: 7.5 → "7,5", 8 → "8". */
export function formatHours(hours: number): string {
  return String(Math.round(hours * 100) / 100).replace('.', ',');
}

/** 320 → "5 u 20 min" */
export function formatMinutes(minutes: number): string {
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} u` : `${h} u ${m} min`;
}
