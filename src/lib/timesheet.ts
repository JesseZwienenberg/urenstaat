/**
 * What is on the weekly timesheet. The PDF, the preview on screen and the
 * plain-text copy are all made from this, so they always show the same rows.
 */
import type { Settings, Tool, WeekRecord, WorkLocation } from '../types';
import { formatDate, formatDayDate, formatHours } from './format';
import { weekDates } from './week';

export interface TimesheetInput {
  week: WeekRecord;
  settings: Settings;
  locations: WorkLocation[];
  tools: Tool[];
}

export interface Table {
  title: string;
  head: string[];
  rows: string[][];
  /** Shown in place of the rows when there are none. */
  empty: string;
}

export interface Timesheet {
  title: string;
  /** Name, company (when filled in) and the dates of the week. */
  lines: string[];
  hours: Table;
  tools: Table;
}

/** The address column: the address, or the name when the address is empty. */
export function addressOf(location: WorkLocation | undefined): string {
  return location ? location.address.trim() || location.name.trim() : '';
}

export function buildTimesheet({ week, settings, locations, tools }: TimesheetInput): Timesheet {
  const dates = weekDates(week);
  const locationById = new Map(locations.map((l) => [l.id, l]));
  const toolById = new Map(tools.map((t) => [t.id, t]));

  const hourRows: string[][] = [];
  for (const date of dates) {
    for (const entry of week.days[date]?.entries ?? []) {
      const location = locationById.get(entry.locationId);
      const number = location?.werknummer.trim() ?? '';
      const address = addressOf(location);
      // Partly regie: the normal hours first, then a row of their own for the regie hours.
      const regie = location?.regie ? 0 : Math.min(entry.regieHours ?? 0, entry.hours);
      if (entry.hours - regie > 0) hourRows.push([formatDayDate(date), number, address, formatHours(entry.hours - regie)]);
      if (regie > 0) hourRows.push([formatDayDate(date), number, `${address} (regie)`.trim(), formatHours(regie)]);
    }
  }

  const toolRows = week.tools
    .filter((usage) => toolById.has(usage.toolId))
    .map((usage) => {
      const location = locationById.get(usage.locationId);
      return [
        toolById.get(usage.toolId)!.name,
        usage.amount?.trim() ?? '',
        location?.werknummer.trim() ?? '',
        addressOf(location),
      ];
    });

  return {
    title: `Urenstaat week ${week.isoWeek} ${week.isoYear}`,
    lines: [
      ...[settings.name, settings.company].filter((s) => s.trim() !== ''),
      `${formatDate(dates[0])} t/m ${formatDate(dates[6])}`,
    ],
    hours: { title: 'Uren', head: ['Datum', 'Werknummer', 'Adres', 'Uren'], rows: hourRows, empty: 'Geen uren ingevuld' },
    tools: {
      title: 'Gebruikte materialen',
      head: ['Materiaal', 'Hoeveelheid', 'Werknummer', 'Adres'],
      rows: toolRows,
      empty: 'Geen materialen ingevuld',
    },
  };
}

/**
 * The timesheet as plain text, columns separated by tabs: pasted into Excel or
 * Google Sheets the columns land in their own cells; in Word or a note it stays readable.
 */
export function timesheetText(sheet: Timesheet): string {
  const table = (t: Table) => [t.title, t.head.join('\t'), ...(t.rows.length > 0 ? t.rows : [[t.empty]]).map((r) => r.join('\t'))];
  return [sheet.title, ...sheet.lines, '', ...table(sheet.hours), '', ...table(sheet.tools), ''].join('\n');
}
