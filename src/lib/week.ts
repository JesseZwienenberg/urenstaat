/** ISO 8601 weeks (Monday–Sunday), as used in the Netherlands. */
import { addDays as addDaysFns, format, getISOWeek, getISOWeekYear, startOfISOWeek } from 'date-fns';
import { addDays, startOfDayMs } from './tz';

export interface IsoWeek {
  isoYear: number;
  isoWeek: number;
}

/** A device-local Date at noon for a day key: safe input for date-fns calendar functions. */
function calendarDate(dateKey: string): Date {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

export function isoWeekOf(dateKey: string): IsoWeek {
  const date = calendarDate(dateKey);
  return { isoYear: getISOWeekYear(date), isoWeek: getISOWeek(date) };
}

export function weekId({ isoYear, isoWeek }: IsoWeek): string {
  return `${isoYear}-W${String(isoWeek).padStart(2, '0')}`;
}

/** The seven day keys of an ISO week, Monday first. */
export function weekDates({ isoYear, isoWeek }: IsoWeek): string[] {
  // 4 January is always in ISO week 1.
  const mondayOfWeek1 = startOfISOWeek(new Date(isoYear, 0, 4, 12));
  const monday = format(addDaysFns(mondayOfWeek1, (isoWeek - 1) * 7), 'yyyy-MM-dd');
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** The week before the one containing the given day. */
export function previousWeekOf(dateKey: string): IsoWeek {
  return isoWeekOf(addDays(dateKey, -7));
}

export function shiftWeek(week: IsoWeek, by: number): IsoWeek {
  return isoWeekOf(addDays(weekDates(week)[0], by * 7));
}

/** Start (Monday 00:00) and end (next Monday 00:00) of the week as instants. */
export function weekRangeMs(week: IsoWeek): { startMs: number; endMs: number } {
  const dates = weekDates(week);
  return { startMs: startOfDayMs(dates[0]), endMs: startOfDayMs(addDays(dates[6], 1)) };
}
