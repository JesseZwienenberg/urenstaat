import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatDayDate, formatHours, formatMinutes } from '../src/lib/format';
import { emptyWeek } from '../src/lib/hours';
import { buildPdf, pdfFileName } from '../src/lib/pdf';
import { DEFAULT_SETTINGS, type WeekRecord, type WorkLocation } from '../src/types';

const locations: WorkLocation[] = [
  { id: 'A', werknummer: '2026-014', name: 'Verbouwing', address: 'Dorpsstraat 12, 3811 AB Amersfoort', lat: 0, lng: 0, radius: 150, archived: false },
  { id: 'B', werknummer: '2026-017', name: 'Dakkapel', address: 'Kerkweg 3, 3401 CD IJsselstein', lat: 0, lng: 0, radius: 150, archived: false },
];

const week: WeekRecord = {
  ...emptyWeek(2026, 47, '2026-W47'),
  days: {
    '2026-11-16': { date: '2026-11-16', manual: false, entries: [{ locationId: 'A', hours: 8, measuredMinutes: 545 }] },
    '2026-11-17': {
      date: '2026-11-17',
      manual: false,
      entries: [
        { locationId: 'A', hours: 4, measuredMinutes: 260 },
        { locationId: 'B', hours: 4, measuredMinutes: 270 },
      ],
    },
    '2026-11-20': { date: '2026-11-20', manual: true, entries: [{ locationId: 'B', hours: 4, measuredMinutes: 0 }] },
  },
  tools: [
    { id: 'u1', toolId: 't1', locationId: 'A', dates: ['2026-11-17', '2026-11-16'] },
    { id: 'u2', toolId: 't2', locationId: 'B', dates: [] },
    { id: 'u3', toolId: 'deleted', locationId: 'B', dates: [] },
  ],
};

describe('formats', () => {
  it('uses Dutch dates and decimal commas', () => {
    expect(formatDayDate('2026-11-16')).toBe('ma 16-11-2026');
    expect(formatDayDate('2026-11-22')).toBe('zo 22-11-2026');
    expect(formatHours(7.5)).toBe('7,5');
    expect(formatHours(8)).toBe('8');
    expect(formatMinutes(320)).toBe('5 u 20 min');
  });
});

describe('PDF', () => {
  it('has the required file name', () => {
    expect(pdfFileName(week)).toBe('Urenstaat week 47 2026.pdf');
  });
  it('builds a one-page A4 document', () => {
    const doc = buildPdf({
      week,
      settings: { ...DEFAULT_SETTINGS, name: 'Jan de Vries', company: 'De Vries Timmerwerken' },
      locations,
      tools: [
        { id: 't1', name: 'Afkortzaag', description: '' },
        { id: 't2', name: 'Steiger (rolsteiger 6 m)', description: '' },
      ],
    });
    expect(doc.getNumberOfPages()).toBe(1);
    const bytes = Buffer.from(doc.output('arraybuffer'));
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    if (process.env.PDF_OUT) {
      mkdirSync(process.env.PDF_OUT, { recursive: true });
      writeFileSync(`${process.env.PDF_OUT}/${pdfFileName(week)}`, bytes);
    }
  });
});
