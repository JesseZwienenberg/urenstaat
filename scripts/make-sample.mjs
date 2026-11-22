/**
 * Writes tests/fixtures/sample-timeline.json: a made-up Google Maps Timeline
 * export in the Android layout ("semanticSegments"), covering ISO weeks 46 and
 * 47 of 2026. It is NOT real data; replace it with a real export when one is
 * available, to confirm the parser against what the phone actually writes.
 *
 * Run: node scripts/make-sample.mjs
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const PLACES = {
  home: [52.0907, 5.1214],
  jobA: [52.1561, 5.3878], // werknummer 2026-014
  jobB: [52.0116, 5.045], // werknummer 2026-017
  bouwmarkt: [52.1012, 5.0627],
  tankstation: [52.1203, 5.2501],
  sportpark: [52.0789, 5.1466],
};

const latLng = ([lat, lng]) => `${lat.toFixed(7)}°, ${lng.toFixed(7)}°`;
const stamp = (date, time) => `${date}T${time}:00.000+01:00`;

const segments = [];

function visit(date, from, to, place, endDate = date) {
  segments.push({
    startTime: stamp(date, from),
    endTime: stamp(endDate, to),
    startTimeTimezoneUtcOffsetMinutes: 60,
    endTimeTimezoneUtcOffsetMinutes: 60,
    visit: {
      hierarchyLevel: 0,
      probability: 0.87,
      topCandidate: {
        placeId: `ChIJfake_${place}`,
        semanticType: place === 'home' ? 'HOME' : 'UNKNOWN',
        probability: 0.74,
        placeLocation: { latLng: latLng(PLACES[place]) },
      },
    },
  });
}

function drive(date, from, to, origin, destination) {
  segments.push({
    startTime: stamp(date, from),
    endTime: stamp(date, to),
    timelinePath: [
      { point: latLng(PLACES[origin]), time: stamp(date, from) },
      { point: latLng(PLACES[destination]), time: stamp(date, to) },
    ],
  });
  segments.push({
    startTime: stamp(date, from),
    endTime: stamp(date, to),
    startTimeTimezoneUtcOffsetMinutes: 60,
    endTimeTimezoneUtcOffsetMinutes: 60,
    activity: {
      start: { latLng: latLng(PLACES[origin]) },
      end: { latLng: latLng(PLACES[destination]) },
      distanceMeters: 21500.5,
      probability: 0.93,
      topCandidate: { type: 'IN_PASSENGER_VEHICLE', probability: 0.91 },
    },
  });
}

// ---- Week 46 (9–15 Nov 2026): one plain day, so the file holds more than one week.
visit('2026-11-08', '18:00', '07:05', 'home', '2026-11-09');
drive('2026-11-09', '07:05', '07:40', 'home', 'jobA');
visit('2026-11-09', '07:40', '16:05', 'jobA');
drive('2026-11-09', '16:05', '16:40', 'jobA', 'home');
visit('2026-11-09', '16:40', '07:05', 'home', '2026-11-16');

// ---- Week 47 (16–22 Nov 2026)
// Monday: one job all day.
drive('2026-11-16', '07:05', '07:40', 'home', 'jobA');
visit('2026-11-16', '07:40', '16:10', 'jobA');
drive('2026-11-16', '16:10', '16:45', 'jobA', 'home');
visit('2026-11-16', '16:45', '07:10', 'home', '2026-11-17');

// Tuesday: two jobs.
drive('2026-11-17', '07:10', '07:42', 'home', 'jobA');
visit('2026-11-17', '07:42', '11:30', 'jobA');
drive('2026-11-17', '11:30', '12:10', 'jobA', 'jobB');
visit('2026-11-17', '12:10', '16:00', 'jobB');
drive('2026-11-17', '16:00', '16:25', 'jobB', 'home');
visit('2026-11-17', '16:25', '07:00', 'home', '2026-11-18');

// Wednesday: half an hour at the builders' merchant (no work location), then one job.
drive('2026-11-18', '07:00', '07:20', 'home', 'bouwmarkt');
visit('2026-11-18', '07:20', '07:50', 'bouwmarkt');
drive('2026-11-18', '07:50', '08:20', 'bouwmarkt', 'jobB');
visit('2026-11-18', '08:20', '16:30', 'jobB');
drive('2026-11-18', '16:30', '16:55', 'jobB', 'home');
visit('2026-11-18', '16:55', '07:00', 'home', '2026-11-19');

// Thursday: a 10-minute petrol stop on the way (shorter than the 15-minute minimum).
drive('2026-11-19', '07:00', '07:15', 'home', 'tankstation');
visit('2026-11-19', '07:15', '07:25', 'tankstation');
drive('2026-11-19', '07:25', '07:45', 'tankstation', 'jobA');
visit('2026-11-19', '07:45', '15:40', 'jobA');
drive('2026-11-19', '15:40', '16:15', 'jobA', 'home');
visit('2026-11-19', '16:15', '07:05', 'home', '2026-11-20');

// Friday: a long morning on job A, then a short call at job B (15 min + 25 min drive).
drive('2026-11-20', '07:05', '07:40', 'home', 'jobA');
visit('2026-11-20', '07:40', '12:00', 'jobA');
drive('2026-11-20', '12:00', '12:25', 'jobA', 'jobB');
visit('2026-11-20', '12:25', '12:40', 'jobB');
drive('2026-11-20', '12:40', '13:05', 'jobB', 'home');
visit('2026-11-20', '13:05', '09:30', 'home', '2026-11-21');

// Saturday: private trip, and a drive past job A that must not count (weekend).
drive('2026-11-21', '09:30', '09:45', 'home', 'sportpark');
visit('2026-11-21', '09:45', '11:30', 'sportpark');
drive('2026-11-21', '11:30', '11:45', 'sportpark', 'home');
visit('2026-11-21', '11:45', '23:30', 'home', '2026-11-22');

segments.sort((a, b) => a.startTime.localeCompare(b.startTime));

const sample = {
  semanticSegments: segments,
  rawSignals: [
    {
      position: {
        LatLng: latLng(PLACES.home),
        accuracyMeters: 13,
        altitudeMeters: 4.2,
        source: 'WIFI',
        timestamp: stamp('2026-11-22', '10:00'),
        speedMetersPerSecond: 0,
      },
    },
  ],
  userLocationProfile: {
    frequentPlaces: [{ placeId: 'ChIJfake_home', placeLocation: latLng(PLACES.home), label: 'HOME' }],
  },
};

const target = fileURLToPath(new URL('../tests/fixtures/sample-timeline.json', import.meta.url));
writeFileSync(target, `${JSON.stringify(sample, null, 2)}\n`);
console.log(`Wrote ${segments.length} segments to ${target}`);
