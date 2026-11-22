import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { haversineMeters, matchLocation } from '../src/lib/geo';
import { applyProposals, emptyWeek, measureWeek, proposeHours } from '../src/lib/hours';
import { parseTimelineText, sliceTimeline } from '../src/lib/timeline/parser';
import { addDays, dateKeyOf, startOfDayMs } from '../src/lib/tz';
import { isoWeekOf, previousWeekOf, weekDates, weekId, weekRangeMs } from '../src/lib/week';
import { DEFAULT_SETTINGS, type WorkLocation } from '../src/types';

const location = (id: string, lat: number, lng: number, extra: Partial<WorkLocation> = {}): WorkLocation => ({
  id,
  werknummer: id,
  name: id,
  address: '',
  lat,
  lng,
  radius: 150,
  archived: false,
  ...extra,
});

const jobA = location('A', 52.1561, 5.3878);
const jobB = location('B', 52.0116, 5.045);

describe('time zone and weeks', () => {
  it('finds Amsterdam midnight in winter and summer', () => {
    expect(new Date(startOfDayMs('2026-11-16')).toISOString()).toBe('2026-11-15T23:00:00.000Z');
    expect(new Date(startOfDayMs('2026-07-01')).toISOString()).toBe('2026-06-30T22:00:00.000Z');
  });
  it('handles the DST change days', () => {
    // Clocks go forward on 29 March 2026 and back on 25 October 2026.
    const hours = (day: string) => (startOfDayMs(addDays(day, 1)) - startOfDayMs(day)) / 3_600_000;
    expect(hours('2026-03-29')).toBe(23);
    expect(hours('2026-10-25')).toBe(25);
    expect(dateKeyOf(Date.parse('2026-10-25T22:59:59Z'))).toBe('2026-10-25');
    expect(dateKeyOf(Date.parse('2026-10-25T23:00:00Z'))).toBe('2026-10-26');
  });
  it('uses ISO week numbers', () => {
    expect(isoWeekOf('2026-11-16')).toEqual({ isoYear: 2026, isoWeek: 47 });
    expect(isoWeekOf('2027-01-03')).toEqual({ isoYear: 2026, isoWeek: 53 });
    expect(isoWeekOf('2024-12-30')).toEqual({ isoYear: 2025, isoWeek: 1 });
    expect(weekDates({ isoYear: 2026, isoWeek: 47 })).toEqual([
      '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22',
    ]);
    expect(weekDates({ isoYear: 2026, isoWeek: 1 })[0]).toBe('2025-12-29');
    expect(previousWeekOf('2026-11-22')).toEqual({ isoYear: 2026, isoWeek: 46 });
    expect(previousWeekOf('2026-01-01')).toEqual({ isoYear: 2025, isoWeek: 52 });
    expect(weekId({ isoYear: 2026, isoWeek: 7 })).toBe('2026-W07');
  });
});

describe('matching', () => {
  it('measures distance', () => {
    // Amsterdam Dam → Utrecht Dom is roughly 35 km.
    const d = haversineMeters(52.3731, 4.8926, 52.0907, 5.1214);
    expect(d).toBeGreaterThan(34_000);
    expect(d).toBeLessThan(36_000);
  });
  it('picks the nearest location within its radius', () => {
    const near = location('near', 52.0, 5.0);
    const nearer = location('nearer', 52.0005, 5.0);
    expect(matchLocation(52.0004, 5.0, [near, nearer])?.id).toBe('nearer');
    expect(matchLocation(52.01, 5.0, [near, nearer])).toBeNull(); // ~1.1 km away
  });
  it('skips archived locations', () => {
    expect(matchLocation(52.0, 5.0, [location('x', 52.0, 5.0, { archived: true })])).toBeNull();
  });
});

describe('proposeHours', () => {
  const hours = (minutes: Record<string, number>, norm = 8) =>
    Object.fromEntries(proposeHours(minutes, norm).map((e) => [e.locationId, e.hours]));

  it('gives one location the whole day', () => {
    expect(hours({ A: 300 })).toEqual({ A: 8 });
  });
  it('splits in proportion, in whole hours, adding up to the norm', () => {
    expect(hours({ A: 240, B: 240 })).toEqual({ A: 4, B: 4 });
    expect(hours({ A: 300, B: 100 })).toEqual({ A: 6, B: 2 });
    expect(hours({ A: 200, B: 150, C: 130 })).toEqual({ A: 3, B: 3, C: 2 });
  });
  it('gives a short visit of at least 20 minutes one hour', () => {
    expect(hours({ A: 460, B: 20 })).toEqual({ A: 7, B: 1 });
  });
  it('drops visits under 20 minutes', () => {
    expect(hours({ A: 460, B: 19 })).toEqual({ A: 8 });
    expect(hours({ B: 19 })).toEqual({});
  });
  it('returns nothing for a day without data', () => {
    expect(hours({})).toEqual({});
  });
  it('always adds up to the norm', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const count = (seed % 6) + 1;
      const minutes: Record<string, number> = {};
      for (let i = 0; i < count; i++) minutes[`L${i}`] = 20 + ((seed * (i + 7) * 37) % 400);
      for (const norm of [4, 8, 9]) {
        const entries = proposeHours(minutes, norm);
        expect(entries.reduce((s, e) => s + e.hours, 0)).toBe(norm);
        expect(entries.every((e) => Number.isInteger(e.hours) && e.hours >= 1)).toBe(true);
      }
    }
  });
  it('copes with more locations than hours', () => {
    const minutes = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`L${i}`, 30 + i]));
    const entries = proposeHours(minutes, 8);
    expect(entries).toHaveLength(8);
    expect(entries.every((e) => e.hours === 1)).toBe(true);
  });
});

describe('sample week 47 of 2026', () => {
  const text = readFileSync(new URL('./fixtures/sample-timeline.json', import.meta.url), 'utf8');
  const isoWeek = { isoYear: 2026, isoWeek: 47 };
  const { startMs, endMs } = weekRangeMs(isoWeek);
  const sliced = sliceTimeline(parseTimelineText(text), startMs - 86_400_000, endMs);
  const workdays = weekDates(isoWeek).slice(0, 5);

  it('measures stay plus travel towards each location', () => {
    const { days, unknown } = measureWeek(sliced.visits, sliced.travels, [jobA, jobB], workdays, 15);
    expect(days['2026-11-16']).toEqual({ A: 510 + 35 }); // 07:40–16:10 + 35 min drive there
    expect(days['2026-11-17']).toEqual({ A: 228 + 32, B: 230 + 40 });
    // Wednesday: only the drive after the builders' merchant counts for job B.
    expect(days['2026-11-18']).toEqual({ B: 490 + 30 });
    // Thursday: the 10-minute petrol stop is ignored, both drives count.
    expect(days['2026-11-19']).toEqual({ A: 475 + 35 });
    expect(days['2026-11-20']).toEqual({ A: 260 + 35, B: 15 + 25 });
    // Unknown stays on workdays: home each day plus the builders' merchant.
    expect(unknown.filter((u) => u.date === '2026-11-18')).toHaveLength(2);
    expect(unknown.every((u) => workdays.includes(u.date))).toBe(true);
  });

  it('proposes whole 8-hour days and leaves the weekend out', () => {
    const week = { ...emptyWeek(2026, 47, '2026-W47'), ...sliced, importedAt: 1 };
    const result = applyProposals(week, [jobA, jobB], DEFAULT_SETTINGS).week;
    const summary = Object.fromEntries(
      Object.values(result.days).map((d) => [
        d.date,
        Object.fromEntries(d.entries.map((e) => [e.locationId, e.hours])),
      ]),
    );
    expect(summary).toEqual({
      '2026-11-16': { A: 8 },
      '2026-11-17': { A: 4, B: 4 },
      '2026-11-18': { B: 8 },
      '2026-11-19': { A: 8 },
      '2026-11-20': { A: 7, B: 1 },
    });
  });

  it('gives the same result when the same file is imported twice', () => {
    const once = { ...emptyWeek(2026, 47, '2026-W47'), ...sliced, importedAt: 1 };
    const first = applyProposals(once, [jobA, jobB], DEFAULT_SETTINGS).week;
    const again = sliceTimeline(parseTimelineText(text), startMs - 86_400_000, endMs);
    const second = applyProposals({ ...first, ...again }, [jobA, jobB], DEFAULT_SETTINGS).week;
    expect(second.days).toEqual(first.days);
    expect(second.visits).toEqual(first.visits);
  });

  it('keeps days he changed by hand when importing again', () => {
    const week = { ...emptyWeek(2026, 47, '2026-W47'), ...sliced, importedAt: 1 };
    const first = applyProposals(week, [jobA, jobB], DEFAULT_SETTINGS).week;
    first.days['2026-11-16'] = {
      date: '2026-11-16',
      manual: true,
      entries: [{ locationId: 'A', hours: 4, measuredMinutes: 0 }],
    };
    const second = applyProposals(first, [jobA, jobB], DEFAULT_SETTINGS).week;
    expect(second.days['2026-11-16'].entries).toEqual([
      { locationId: 'A', hours: 4, measuredMinutes: 545 },
    ]);
    expect(second.days['2026-11-17'].manual).toBe(false);
  });

  it('splits a stay that crosses midnight over both days', () => {
    const nightShift = [
      { startMs: Date.parse('2026-11-16T21:00:00+01:00'), endMs: Date.parse('2026-11-17T02:00:00+01:00'), lat: jobA.lat, lng: jobA.lng },
    ];
    const { days } = measureWeek(nightShift, [], [jobA], workdays, 15);
    expect(days['2026-11-16']).toEqual({ A: 180 });
    expect(days['2026-11-17']).toEqual({ A: 120 });
  });
});
