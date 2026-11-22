import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  parseLatLng,
  parseTimeline,
  parseTimelineText,
  sliceTimeline,
  TimelineParseError,
} from '../src/lib/timeline/parser';
import { weekRangeMs } from '../src/lib/week';

const sampleText = readFileSync(new URL('./fixtures/sample-timeline.json', import.meta.url), 'utf8');

describe('parseLatLng', () => {
  it('reads the Android degree string', () => {
    expect(parseLatLng('52.3676°, 4.9041°')).toEqual({ lat: 52.3676, lng: 4.9041 });
  });
  it('reads negative coordinates and odd spacing', () => {
    expect(parseLatLng('-33.8688° ,151.2093°')).toEqual({ lat: -33.8688, lng: 151.2093 });
  });
  it('reads the iOS geo: string', () => {
    expect(parseLatLng('geo:52.3676,4.9041')).toEqual({ lat: 52.3676, lng: 4.9041 });
  });
  it('reads a nested latLng object', () => {
    expect(parseLatLng({ latLng: '52.1°, 5.2°' })).toEqual({ lat: 52.1, lng: 5.2 });
  });
  it('reads E7 integers', () => {
    expect(parseLatLng({ latitudeE7: 523676000, longitudeE7: 49041000 })).toEqual({
      lat: 52.3676,
      lng: 4.9041,
    });
  });
  it('rejects junk and out-of-range values', () => {
    expect(parseLatLng('hallo')).toBeNull();
    expect(parseLatLng('95.0°, 4.0°')).toBeNull();
    expect(parseLatLng(null)).toBeNull();
    expect(parseLatLng(42)).toBeNull();
  });
});

describe('parseTimeline', () => {
  it('parses the sample export', () => {
    const timeline = parseTimelineText(sampleText);
    expect(timeline.visits.length).toBe(19);
    expect(timeline.travels.length).toBe(18);
    const first = timeline.visits[0];
    expect(first.lat).toBeCloseTo(52.0907, 4);
    expect(first.lng).toBeCloseTo(5.1214, 4);
    // Sorted by start time.
    const starts = timeline.visits.map((v) => v.startMs);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });

  it('keeps only the selected week when sliced', () => {
    const timeline = parseTimelineText(sampleText);
    const { startMs, endMs } = weekRangeMs({ isoYear: 2026, isoWeek: 46 });
    const week46 = sliceTimeline(timeline, startMs, endMs);
    expect(week46.visits.length).toBe(3); // home, job A, home
    expect(week46.travels.length).toBe(2);
  });

  it('drops duplicate segments', () => {
    const data = JSON.parse(sampleText);
    data.semanticSegments = [...data.semanticSegments, ...data.semanticSegments];
    expect(parseTimeline(data).visits.length).toBe(19);
  });

  it('skips broken segments instead of failing', () => {
    const good = {
      startTime: '2026-11-16T08:00:00.000+01:00',
      endTime: '2026-11-16T09:00:00.000+01:00',
      visit: { topCandidate: { placeLocation: { latLng: '52.0°, 5.0°' } } },
    };
    const timeline = parseTimeline({
      semanticSegments: [
        null,
        'text',
        { startTime: 'nonsense', endTime: 'nonsense', visit: {} },
        { ...good, endTime: good.startTime }, // zero length
        { ...good, visit: { topCandidate: { placeLocation: { latLng: 'unknown' } } } },
        { ...good, visit: { hierarchyLevel: 1, topCandidate: good.visit.topCandidate } },
        { startTime: good.startTime, endTime: good.endTime }, // neither visit nor activity
        good,
      ],
    });
    expect(timeline.visits).toHaveLength(1);
  });

  it('picks up what the export says about a place', () => {
    const timeline = parseTimelineText(sampleText);
    expect(timeline.visits[0].name).toBe('Thuis'); // semanticType HOME
    expect(timeline.visits.find((v) => Math.abs(v.lat - 52.1561) < 0.0001)?.name).toBeUndefined();
    const old = parseTimeline({
      timelineObjects: [
        {
          placeVisit: {
            location: { latitudeE7: 521012000, longitudeE7: 50627000, name: 'Bouwmarkt Jansen', address: 'Industrieweg 4, Utrecht' },
            duration: { startTimestamp: '2023-05-01T06:00:00Z', endTimestamp: '2023-05-01T07:00:00Z' },
          },
        },
      ],
    });
    expect(old.visits[0]).toMatchObject({ name: 'Bouwmarkt Jansen', address: 'Industrieweg 4, Utrecht' });
  });

  it('accepts placeLocation as a plain string', () => {
    const timeline = parseTimeline({
      semanticSegments: [
        {
          startTime: '2026-11-16T08:00:00Z',
          endTime: '2026-11-16T09:00:00Z',
          visit: { topCandidate: { placeLocation: '52.0°, 5.0°' } },
        },
      ],
    });
    expect(timeline.visits[0]).toMatchObject({ lat: 52, lng: 5 });
  });

  it('accepts the iOS layout (top-level array)', () => {
    const timeline = parseTimeline([
      {
        startTime: '2026-11-16T08:00:00.000+01:00',
        endTime: '2026-11-16T12:00:00.000+01:00',
        visit: { topCandidate: { placeLocation: 'geo:52.156100,5.387800' } },
      },
      {
        startTime: '2026-11-16T07:30:00.000+01:00',
        endTime: '2026-11-16T08:00:00.000+01:00',
        activity: { distanceMeters: '1200' },
      },
    ]);
    expect(timeline.visits).toHaveLength(1);
    expect(timeline.travels).toHaveLength(1);
  });

  it('accepts the older timelineObjects layout', () => {
    const timeline = parseTimeline({
      timelineObjects: [
        {
          placeVisit: {
            location: { latitudeE7: 521561000, longitudeE7: 53878000 },
            duration: {
              startTimestamp: '2023-05-01T06:00:00Z',
              endTimestamp: '2023-05-01T14:00:00Z',
            },
          },
        },
        {
          activitySegment: {
            duration: {
              startTimestamp: '2023-05-01T05:30:00Z',
              endTimestamp: '2023-05-01T06:00:00Z',
            },
          },
        },
      ],
    });
    expect(timeline.visits[0].lat).toBeCloseTo(52.1561, 4);
    expect(timeline.travels).toHaveLength(1);
  });

  it('reports unreadable files with a Dutch message', () => {
    const codeOf = (fn: () => unknown) => {
      try {
        fn();
      } catch (err) {
        expect(err).toBeInstanceOf(TimelineParseError);
        expect((err as Error).message.length).toBeGreaterThan(20);
        return (err as TimelineParseError).code;
      }
      return 'no error';
    };
    expect(codeOf(() => parseTimelineText('not json {'))).toBe('invalid-json');
    expect(codeOf(() => parseTimelineText('{"foo": 1}'))).toBe('unknown-format');
    expect(codeOf(() => parseTimelineText('"text"'))).toBe('unknown-format');
    expect(codeOf(() => parseTimelineText('{"semanticSegments": []}'))).toBe('no-visits');
  });
});
