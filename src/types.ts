/** App-wide data types. Everything here is stored in IndexedDB on the phone. */

export interface Settings {
  name: string;
  company: string;
  /** Hours in a normal workday (steps of half an hour). */
  normHours: number;
  /** Stays shorter than this are ignored. */
  minStayMinutes: number;
}

export const DEFAULT_SETTINGS: Settings = {
  name: '',
  company: '',
  normHours: 8,
  minStayMinutes: 15,
};

export interface WorkLocation {
  id: string;
  /** Job number: required and unique. */
  werknummer: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  radius: number;
  archived: boolean;
}

export const DEFAULT_RADIUS = 150;

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
  tools: Tool[];
  weeks: WeekRecord[];
}
