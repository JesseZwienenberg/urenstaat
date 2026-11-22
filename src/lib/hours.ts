/**
 * From Timeline data to proposed hours.
 *
 * 1. measureWeek: minutes per day per work location. A stay counts for the
 *    location it matches; travel counts for the location it leads to.
 * 2. proposeHours: split the workday norm (8 h) over the day's locations in
 *    whole hours, in proportion to the measured time.
 */
import type { DayRecord, HourEntry, Settings, Travel, Visit, WeekRecord, WorkLocation } from '../types';
import { matchLocation } from './geo';
import { addDays, dateKeyOf, isWeekend, startOfDayMs } from './tz';
import { weekDates } from './week';

/** A location needs at least this much measured time to get an hour. */
export const MIN_MINUTES_FOR_HOUR = 20;

const MINUTE = 60_000;

export interface UnknownVisit extends Visit {
  date: string;
}

export interface WeekMeasure {
  /** date → locationId → minutes */
  days: Record<string, Record<string, number>>;
  /** Stays on the given days that match no active location. */
  unknown: UnknownVisit[];
}

const overlapMs = (aStart: number, aEnd: number, bStart: number, bEnd: number) =>
  Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));

/**
 * @param dates the days to measure (day keys); anything outside them is ignored
 */
export function measureWeek(
  visits: Visit[],
  travels: Travel[],
  locations: WorkLocation[],
  dates: string[],
  minStayMinutes: number,
): WeekMeasure {
  const dateSet = new Set(dates);
  const ms: Record<string, Record<string, number>> = {};
  for (const date of dates) ms[date] = {};
  const unknown: UnknownVisit[] = [];

  // Short stops (traffic light, petrol station) are dropped before anything else,
  // so travel through them still counts towards the next real stay.
  const stays = visits
    .filter((v) => v.endMs - v.startMs >= minStayMinutes * MINUTE)
    .sort((a, b) => a.startMs - b.startMs);

  stays.forEach((stay, index) => {
    const location = matchLocation(stay.lat, stay.lng, locations);
    const startDate = dateKeyOf(stay.startMs);

    if (!location) {
      if (dateSet.has(startDate)) unknown.push({ ...stay, date: startDate });
      return;
    }

    // Time at the location, split per day if the stay crosses midnight.
    for (const date of dates) {
      const dayStart = startOfDayMs(date);
      const dayEnd = startOfDayMs(addDays(date, 1));
      const part = overlapMs(stay.startMs, stay.endMs, dayStart, dayEnd);
      if (part > 0) ms[date][location.id] = (ms[date][location.id] ?? 0) + part;
    }

    // Travel towards the location: everything driven since the previous stay, same day only.
    if (dateSet.has(startDate)) {
      const previousEnd = index > 0 ? stays[index - 1].endMs : -Infinity;
      const windowStart = Math.max(previousEnd, startOfDayMs(startDate));
      let travelMs = 0;
      for (const travel of travels) {
        travelMs += overlapMs(travel.startMs, travel.endMs, windowStart, stay.startMs);
      }
      if (travelMs > 0) ms[startDate][location.id] = (ms[startDate][location.id] ?? 0) + travelMs;
    }
  });

  const days: Record<string, Record<string, number>> = {};
  for (const date of dates) {
    days[date] = {};
    for (const [id, value] of Object.entries(ms[date])) days[date][id] = Math.round(value / MINUTE);
  }
  return { days, unknown };
}

/**
 * Splits `normHours` over the locations in whole hours.
 * - One location: it gets all hours.
 * - Several: in proportion to the measured minutes; every location with at
 *   least 20 measured minutes gets at least 1 hour, shorter ones are dropped.
 * - The total is always exactly `normHours`.
 */
export function proposeHours(minutesByLocation: Record<string, number>, normHours: number): HourEntry[] {
  const norm = Math.max(0, Math.round(normHours));
  const candidates = Object.entries(minutesByLocation)
    .filter(([, minutes]) => minutes >= MIN_MINUTES_FOR_HOUR)
    .map(([locationId, minutes]) => ({ locationId, minutes }))
    // Longest first; ties in a fixed order so the result never flips between runs.
    .sort((a, b) => b.minutes - a.minutes || a.locationId.localeCompare(b.locationId))
    .slice(0, norm); // cannot give more locations an hour than there are hours

  if (candidates.length === 0 || norm === 0) return [];

  const total = candidates.reduce((sum, c) => sum + c.minutes, 0);
  const rows = candidates.map((c) => {
    const ideal = (c.minutes / total) * norm;
    return { ...c, ideal, hours: Math.max(1, Math.floor(ideal)) };
  });

  let assigned = rows.reduce((sum, r) => sum + r.hours, 0);
  while (assigned < norm) {
    // Give an hour to whoever is furthest below their fair share.
    const row = rows.reduce((best, r) => (r.ideal - r.hours > best.ideal - best.hours ? r : best));
    row.hours += 1;
    assigned += 1;
  }
  while (assigned > norm) {
    // Take an hour from whoever is furthest above their fair share (never below 1).
    const row = rows
      .filter((r) => r.hours > 1)
      .reduce((best, r) => (r.hours - r.ideal > best.hours - best.ideal ? r : best));
    row.hours -= 1;
    assigned -= 1;
  }

  return rows.map((r) => ({ locationId: r.locationId, hours: r.hours, measuredMinutes: r.minutes }));
}

export function dayTotal(day: DayRecord | undefined): number {
  return day ? day.entries.reduce((sum, e) => sum + e.hours, 0) : 0;
}

export function weekTotal(week: WeekRecord): number {
  return Object.values(week.days).reduce((sum, day) => sum + dayTotal(day), 0);
}

/** Monday–Friday of the week: the only days that get automatic proposals. */
export function workdaysOf(week: WeekRecord): string[] {
  return weekDates(week).filter((date) => !isWeekend(date));
}

/**
 * Recalculates the proposals for a week from its stored Timeline data.
 * Days he edited by hand keep their hours; only their measured times are refreshed.
 */
export function applyProposals(
  week: WeekRecord,
  locations: WorkLocation[],
  settings: Settings,
): { week: WeekRecord; unknown: UnknownVisit[] } {
  const workdays = workdaysOf(week);
  const measure = measureWeek(week.visits, week.travels, locations, workdays, settings.minStayMinutes);
  const days: Record<string, DayRecord> = { ...week.days };

  for (const date of workdays) {
    const minutes = measure.days[date];
    const existing = days[date];
    if (existing?.manual) {
      days[date] = {
        ...existing,
        entries: existing.entries.map((e) => ({ ...e, measuredMinutes: minutes[e.locationId] ?? 0 })),
      };
    } else if (week.importedAt !== null) {
      days[date] = { date, manual: false, entries: proposeHours(minutes, settings.normHours) };
    }
  }
  return { week: { ...week, days }, unknown: measure.unknown };
}

export function emptyWeek(isoYear: number, isoWeek: number, id: string): WeekRecord {
  return {
    id,
    isoYear,
    isoWeek,
    visits: [],
    travels: [],
    importedAt: null,
    days: {},
    tools: [],
    updatedAt: Date.now(),
  };
}
