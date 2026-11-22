/**
 * From Timeline data to proposed hours.
 *
 * 1. measureWeek: minutes per day per work location, within working hours.
 *    A stay counts for the location it matches; travel and work-related
 *    stops count for the location they lead to.
 * 2. proposeHours: split the workday norm (8 h) over the day's locations in
 *    half-hour steps, in proportion to the measured time. A regie location gets
 *    its measured time rounded up instead; the other locations share the rest.
 */
import type {
  DayRecord,
  HourEntry,
  MarkedPlace,
  Settings,
  Travel,
  Visit,
  WeekRecord,
  WorkLocation,
} from '../types';
import { matchLocation, nearestWithin } from './geo';
import { addDays, atLocalHourMs, dateKeyOf, isWeekend, startOfDayMs } from './tz';
import { weekDates } from './week';

/** A location needs at least this much measured time to get an hour. */
export const MIN_MINUTES_FOR_HOUR = 20;
/** Hours are proposed and edited in steps of half an hour. */
export const HOUR_STEP = 0.5;
/** What a location gets at the least once it counts. */
export const MIN_HOURS_PER_LOCATION = 1;

const MINUTE = 60_000;

export interface UnknownVisit extends Visit {
  date: string;
}

export interface WeekMeasure {
  /** date → locationId → minutes */
  days: Record<string, Record<string, number>>;
  /** Stays during working hours that match no active location and no marked place. */
  unknown: UnknownVisit[];
}

const overlapMs = (aStart: number, aEnd: number, bStart: number, bEnd: number) =>
  Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));

export interface MeasureOptions {
  minStayMinutes: number;
  /** Only time between these hours (Amsterdam clock) counts. */
  workStartHour: number;
  workEndHour: number;
  places?: MarkedPlace[];
}

/**
 * @param dates the days to measure (day keys); anything outside them is ignored
 */
export function measureWeek(
  visits: Visit[],
  travels: Travel[],
  locations: WorkLocation[],
  dates: string[],
  options: MeasureOptions,
): WeekMeasure {
  const places = options.places ?? [];
  const ms: Record<string, Record<string, number>> = {};
  const windows = new Map<string, { start: number; end: number }>();
  // Regie is paid per hour, so at a regie location the whole day counts, not only working hours.
  const wholeDays = new Map<string, { start: number; end: number }>();
  for (const date of dates) {
    ms[date] = {};
    windows.set(date, {
      start: atLocalHourMs(date, options.workStartHour),
      end: atLocalHourMs(date, options.workEndHour),
    });
    wholeDays.set(date, { start: startOfDayMs(date), end: startOfDayMs(addDays(date, 1)) });
  }
  const windowsFor = (location: WorkLocation) => (location.regie ? wholeDays : windows);
  const unknown: UnknownVisit[] = [];
  const add = (date: string, locationId: string, value: number) => {
    if (value > 0) ms[date][locationId] = (ms[date][locationId] ?? 0) + value;
  };

  // Short stops (traffic light, petrol station) are dropped before anything else,
  // so travel through them still counts towards the next real stay.
  const stays = visits
    .filter((v) => v.endMs - v.startMs >= options.minStayMinutes * MINUTE)
    .sort((a, b) => a.startMs - b.startMs)
    .map((stay) => {
      const location = matchLocation(stay.lat, stay.lng, locations);
      return { ...stay, location, place: location ? null : nearestWithin(stay.lat, stay.lng, places) };
    });

  stays.forEach((stay, index) => {
    const startDate = dateKeyOf(stay.startMs);

    if (!stay.location) {
      // Unmarked places are listed for review, but only if he was there during working hours.
      const window = windows.get(startDate);
      if (!stay.place && window && overlapMs(stay.startMs, stay.endMs, window.start, window.end) > 0) {
        const { location: _location, place: _place, ...visit } = stay;
        unknown.push({ ...visit, date: startDate });
      }
      return;
    }

    // Time at the location, per day, within working hours (whole day for regie).
    for (const [date, window] of windowsFor(stay.location)) {
      add(date, stay.location.id, overlapMs(stay.startMs, stay.endMs, window.start, window.end));
    }

    // The way there: travel since the previous stay, plus any work-related stops
    // (builders' merchant, workshop) made on the way. Same day, within working hours.
    const window = windowsFor(stay.location).get(startDate);
    if (!window) return;
    let first = index;
    while (first > 0 && stays[first - 1].place?.kind === 'work' && stays[first - 1].startMs >= window.start) {
      first -= 1;
    }
    const previousEnd = first > 0 ? stays[first - 1].endMs : -Infinity;
    const from = Math.max(previousEnd, window.start);
    const to = Math.min(stay.startMs, window.end);
    let onTheWay = 0;
    for (const travel of travels) onTheWay += overlapMs(travel.startMs, travel.endMs, from, to);
    for (let i = first; i < index; i++) onTheWay += overlapMs(stays[i].startMs, stays[i].endMs, from, to);
    add(startDate, stay.location.id, onTheWay);
  });

  const days: Record<string, Record<string, number>> = {};
  for (const date of dates) {
    days[date] = {};
    for (const [id, value] of Object.entries(ms[date])) days[date][id] = Math.round(value / MINUTE);
  }
  return { days, unknown };
}

/**
 * Hours for a regie location: the measured time rounded up to a half hour, except that
 * a day just over the norm (by less than half an hour) is written down as the norm.
 * 7 h 10 min → 7,5 · 8 h 20 min → 8 · 8 h 40 min → 9 (with a norm of 8).
 */
export function regieHours(minutes: number, normHours: number): number {
  const normMinutes = normHours * 60;
  if (minutes > normMinutes && minutes < normMinutes + HOUR_STEP * 60) return normHours;
  return Math.ceil(minutes / (HOUR_STEP * 60)) * HOUR_STEP;
}

/**
 * Proposes the hours for one day, in steps of half an hour.
 * - Regie locations get their measured time rounded up (see regieHours).
 * - The other locations share what is left of `normHours`:
 *   - one location gets all of it;
 *   - several get it in proportion to the measured minutes; every location with at
 *     least 20 measured minutes gets at least 1 hour (or what is left, if less).
 * - Locations with less than 20 measured minutes are dropped.
 * - Without regie, the total is always exactly `normHours`.
 */
export function proposeHours(
  minutesByLocation: Record<string, number>,
  normHours: number,
  regie: ReadonlySet<string> = new Set(),
): HourEntry[] {
  const counted = Object.entries(minutesByLocation).filter(([, minutes]) => minutes >= MIN_MINUTES_FOR_HOUR);
  const regieEntries = counted
    .filter(([id]) => regie.has(id))
    .map(([locationId, minutes]) => ({ locationId, hours: regieHours(minutes, normHours), measuredMinutes: minutes }));
  const regieTotal = regieEntries.reduce((sum, e) => sum + e.hours, 0);
  const others = Object.fromEntries(counted.filter(([id]) => !regie.has(id)));
  return [...regieEntries, ...splitHours(others, normHours - regieTotal)].sort(
    (a, b) => b.measuredMinutes - a.measuredMinutes || a.locationId.localeCompare(b.locationId),
  );
}

/** Splits `hours` over the locations in proportion to their minutes (see proposeHours). */
function splitHours(minutesByLocation: Record<string, number>, hours: number): HourEntry[] {
  // Work in whole steps (half hours) so the arithmetic stays exact.
  const norm = Math.max(0, Math.round(hours / HOUR_STEP));
  if (norm === 0) return [];
  const minimum = Math.min(norm, Math.round(MIN_HOURS_PER_LOCATION / HOUR_STEP));
  const candidates = Object.entries(minutesByLocation)
    .filter(([, minutes]) => minutes >= MIN_MINUTES_FOR_HOUR)
    .map(([locationId, minutes]) => ({ locationId, minutes }))
    // Longest first; ties in a fixed order so the result never flips between runs.
    .sort((a, b) => b.minutes - a.minutes || a.locationId.localeCompare(b.locationId))
    .slice(0, Math.floor(norm / minimum)); // no more locations than the day has room for

  if (candidates.length === 0) return [];

  const total = candidates.reduce((sum, c) => sum + c.minutes, 0);
  const rows = candidates.map((c) => {
    const ideal = (c.minutes / total) * norm;
    return { ...c, ideal, steps: Math.max(minimum, Math.floor(ideal)) };
  });

  let assigned = rows.reduce((sum, r) => sum + r.steps, 0);
  while (assigned < norm) {
    // Give a step to whoever is furthest below their fair share.
    const row = rows.reduce((best, r) => (r.ideal - r.steps > best.ideal - best.steps ? r : best));
    row.steps += 1;
    assigned += 1;
  }
  while (assigned > norm) {
    // Take a step from whoever is furthest above their fair share (never below the minimum).
    const row = rows
      .filter((r) => r.steps > minimum)
      .reduce((best, r) => (r.steps - r.ideal > best.steps - best.ideal ? r : best));
    row.steps -= 1;
    assigned -= 1;
  }

  return rows.map((r) => ({
    locationId: r.locationId,
    hours: r.steps * HOUR_STEP,
    measuredMinutes: r.minutes,
  }));
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
  places: MarkedPlace[] = [],
): { week: WeekRecord; unknown: UnknownVisit[] } {
  const workdays = workdaysOf(week);
  const regie = new Set(locations.filter((l) => l.regie).map((l) => l.id));
  const measure = measureWeek(week.visits, week.travels, locations, workdays, { ...settings, places });
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
      days[date] = { date, manual: false, entries: proposeHours(minutes, settings.normHours, regie) };
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
