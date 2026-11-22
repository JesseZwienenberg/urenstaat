/** App-wide data types. Everything here is stored in IndexedDB on the phone. */

export interface Settings {
  name: string;
  company: string;
  /** Hours in a normal workday (steps of half an hour). */
  normHours: number;
  /** Stays shorter than this are ignored. */
  minStayMinutes: number;
  /** Only time between these hours (Amsterdam clock) counts as work. */
  workStartHour: number;
  workEndHour: number;
}

export const DEFAULT_SETTINGS: Settings = {
  name: '',
  company: '',
  normHours: 8,
  minStayMinutes: 15,
  workStartHour: 6,
  workEndHour: 17,
};

export interface WorkLocation {
  id: string;
  /** Job number. Empty while it is not known yet; unique when filled in. */
  werknummer: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  radius: number;
  archived: boolean;
  /**
   * Always "regie": the client pays per hour. Hours are the measured time rounded up to a
   * half hour, also outside working hours. Missing in data saved before regie existed.
   */
  regie?: boolean;
}

export const DEFAULT_RADIUS = 150;

/**
 * A regularly visited place that is not a job.
 * - "private" (home, sports club): never counts, and is hidden from "Onbekende plekken".
 * - "work" (builders' merchant, workshop): counts as work for the next job visited that day.
 */
export interface MarkedPlace {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radius: number;
  kind: 'private' | 'work';
}

export const PLACE_RADIUS = 100;

export interface Tool {
  id: string;
  name: string;
  description: string;
}

/** A stay at one place, taken from the Timeline export. Times are epoch milliseconds. */
export interface Visit {
  startMs: number;
  endMs: number;
  lat: number;
  lng: number;
  /** Name of the place, when the export has one (or says it is home or work). */
  name?: string;
  /** Address of the place, when the export has one. */
  address?: string;
}

/** A stretch of travel between two places, taken from the Timeline export. */
export interface Travel {
  startMs: number;
  endMs: number;
}

export interface HourEntry {
  locationId: string;
  /** Hours written on the timesheet, in steps of half an hour. */
  hours: number;
  /** Time at the location plus travel towards it, from the Timeline. 0 for manual entries. */
  measuredMinutes: number;
  /**
   * The part of `hours` that is regie, for a location that is only partly regie.
   * On the timesheet it gets its own row with "(regie)" after the address.
   */
  regieHours?: number;
}

export interface DayRecord {
  /** yyyy-MM-dd in Europe/Amsterdam. */
  date: string;
  entries: HourEntry[];
  /** True once he changed the day by hand; a new import then leaves it alone. */
  manual: boolean;
}

export interface ToolUsage {
  id: string;
  toolId: string;
  locationId: string;
  /** Free text, e.g. "3" or "12 m". Missing in data saved before amounts existed. */
  amount?: string;
  /** Optional: yyyy-MM-dd dates within the week. */
  dates: string[];
}

export interface WeekRecord {
  /** e.g. "2026-W47". */
  id: string;
  isoYear: number;
  isoWeek: number;
  /** Timeline data for this week only (plus the day before, for travel on Monday morning). */
  visits: Visit[];
  travels: Travel[];
  importedAt: number | null;
  days: Record<string, DayRecord>;
  tools: ToolUsage[];
  updatedAt: number;
}

export interface BackupFile {
  app: 'urenstaat';
  version: 1;
  exportedAt: string;
  settings: Settings;
  locations: WorkLocation[];
  /** Missing in backups made before marked places existed. */
  places?: MarkedPlace[];
  tools: Tool[];
  weeks: WeekRecord[];
}
