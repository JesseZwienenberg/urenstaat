/**
 * Parser for the Google Maps Timeline export.
 *
 * The Android export ("Export Timeline data") normally looks like:
 *
 *   { "semanticSegments": [
 *       { "startTime": "...", "endTime": "...",
 *         "visit": { "topCandidate": { "placeLocation": { "latLng": "52.3676°, 4.9041°" } } } },
 *       { "startTime": "...", "endTime": "...", "activity": { ... } },
 *       { "startTime": "...", "endTime": "...", "timelinePath": [ ... ] }
 *   ] }
 *
 * Google has changed this format before, so the parser is deliberately
 * forgiving: unknown fields are ignored, broken segments are skipped, and two
 * other known layouts are accepted (a top-level array as on iOS, and the older
 * "timelineObjects" layout). Error messages are in Dutch because they are
 * shown to the user as-is.
 */
import type { Travel, Visit } from '../../types';

export interface ParsedTimeline {
  visits: Visit[];
  travels: Travel[];
}

export type TimelineErrorCode = 'invalid-json' | 'unknown-format' | 'no-visits';

const MESSAGES: Record<TimelineErrorCode, string> = {
  'invalid-json':
    'Dit bestand kan niet worden gelezen. Kies het Tijdlijn-bestand (eindigt op .json) uit je map Downloads.',
  'unknown-format':
    'Dit lijkt geen Tijdlijn-export te zijn. Exporteer je Tijdlijn opnieuw en kies dat bestand.',
  'no-visits':
    'Er staan geen bezochte plekken in dit bestand. Controleer of Tijdlijn aan staat op je telefoon.',
};

export class TimelineParseError extends Error {
  readonly code: TimelineErrorCode;
  constructor(code: TimelineErrorCode) {
    super(MESSAGES[code]);
    this.name = 'TimelineParseError';
    this.code = code;
  }
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const validCoords = (lat: number, lng: number) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

/**
 * Reads coordinates from any of the shapes seen in exports:
 * "52.3676°, 4.9041°", "geo:52.3676,4.9041", { latLng: "…" },
 * { latitudeE7, longitudeE7 } or { lat/latitude, lng/longitude }.
 */
export function parseLatLng(value: unknown): { lat: number; lng: number } | null {
  if (typeof value === 'string') {
    const match = value.match(/(-?\d+(?:[.,]\d+)?)\s*°?\s*[,;]\s*(-?\d+(?:[.,]\d+)?)/);
    if (!match) return null;
    const lat = Number(match[1].replace(',', '.'));
    const lng = Number(match[2].replace(',', '.'));
    return validCoords(lat, lng) ? { lat, lng } : null;
  }
  if (!isObject(value)) return null;
  if ('latLng' in value) return parseLatLng(value.latLng);
  if (typeof value.latitudeE7 === 'number' && typeof value.longitudeE7 === 'number') {
    const lat = value.latitudeE7 / 1e7;
    const lng = value.longitudeE7 / 1e7;
    return validCoords(lat, lng) ? { lat, lng } : null;
  }
  const lat = value.lat ?? value.latitude;
  const lng = value.lng ?? value.longitude;
  if (typeof lat === 'number' && typeof lng === 'number' && validCoords(lat, lng)) {
    return { lat, lng };
  }
  return null;
}

function parseTime(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const ms = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function parseRange(start: unknown, end: unknown): { startMs: number; endMs: number } | null {
  const startMs = parseTime(start);
  const endMs = parseTime(end);
  if (startMs === null || endMs === null || endMs <= startMs) return null;
  return { startMs, endMs };
}

/** What Google calls the place type, in Dutch, where that is useful as a name. */
const SEMANTIC_NAMES: Record<string, string> = {
  HOME: 'Thuis',
  INFERRED_HOME: 'Thuis',
  WORK: 'Werk',
  INFERRED_WORK: 'Werk',
};

const text = (value: unknown) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined);

/**
 * Name and address of a place, as far as the export has them. The current
 * Android export normally only says whether a place is home or work; older
 * exports carried a real name and address.
 */
function placeDetails(source: unknown): { name?: string; address?: string } {
  if (!isObject(source)) return {};
  const location = isObject(source.placeLocation) ? source.placeLocation : {};
  const semantic = typeof source.semanticType === 'string' ? SEMANTIC_NAMES[source.semanticType.toUpperCase()] : undefined;
  return {
    name: text(source.name) ?? text(location.name) ?? semantic,
    address: text(source.address) ?? text(location.address),
  };
}

class Collector {
  private visitKeys = new Set<string>();
  private travelKeys = new Set<string>();
  readonly visits: Visit[] = [];
  readonly travels: Travel[] = [];

  addVisit(
    range: { startMs: number; endMs: number },
    coords: { lat: number; lng: number },
    details: { name?: string; address?: string } = {},
  ) {
    const key = `${range.startMs}|${range.endMs}|${coords.lat.toFixed(5)}|${coords.lng.toFixed(5)}`;
    if (this.visitKeys.has(key)) return;
    this.visitKeys.add(key);
    const visit: Visit = { ...range, ...coords };
    if (details.name) visit.name = details.name;
    if (details.address) visit.address = details.address;
    this.visits.push(visit);
  }

  addTravel(range: { startMs: number; endMs: number }) {
    const key = `${range.startMs}|${range.endMs}`;
    if (this.travelKeys.has(key)) return;
    this.travelKeys.add(key);
    this.travels.push({ ...range });
  }

  result(): ParsedTimeline {
    const byStart = (a: { startMs: number }, b: { startMs: number }) => a.startMs - b.startMs;
    return { visits: this.visits.sort(byStart), travels: this.travels.sort(byStart) };
  }
}

/** Current Android layout, and the iOS layout (same segments in a top-level array). */
function readSegments(segments: unknown[], out: Collector) {
  for (const segment of segments) {
    if (!isObject(segment)) continue;
    const range = parseRange(segment.startTime, segment.endTime);
    if (!range) continue;

    if (isObject(segment.visit)) {
      const visit = segment.visit;
      // Level 1+ are places inside another visit (a shop inside a mall): skip to avoid counting twice.
      if (typeof visit.hierarchyLevel === 'number' && visit.hierarchyLevel > 0) continue;
      const candidate = isObject(visit.topCandidate) ? visit.topCandidate : visit;
      const coords = parseLatLng(candidate.placeLocation) ?? parseLatLng(candidate.location);
      if (coords) out.addVisit(range, coords, placeDetails(candidate));
    } else if (isObject(segment.activity)) {
      out.addTravel(range);
    }
    // "timelinePath" segments hold raw GPS points; they overlap visits and activities, so they are not needed.
  }
}

/** Older layout with "timelineObjects" (placeVisit / activitySegment). */
function readTimelineObjects(objects: unknown[], out: Collector) {
  for (const object of objects) {
    if (!isObject(object)) continue;
    if (isObject(object.placeVisit)) {
      const duration = isObject(object.placeVisit.duration) ? object.placeVisit.duration : {};
      const range = parseRange(duration.startTimestamp, duration.endTimestamp);
      const coords = parseLatLng(object.placeVisit.location);
      if (range && coords) out.addVisit(range, coords, placeDetails(object.placeVisit.location));
    } else if (isObject(object.activitySegment)) {
      const duration = isObject(object.activitySegment.duration)
        ? object.activitySegment.duration
        : {};
      const range = parseRange(duration.startTimestamp, duration.endTimestamp);
      if (range) out.addTravel(range);
    }
  }
}

/** Parses already-decoded JSON. Throws TimelineParseError with a Dutch message. */
export function parseTimeline(data: unknown): ParsedTimeline {
  const out = new Collector();
  if (Array.isArray(data)) {
    readSegments(data, out);
  } else if (isObject(data) && Array.isArray(data.semanticSegments)) {
    readSegments(data.semanticSegments, out);
  } else if (isObject(data) && Array.isArray(data.timelineObjects)) {
    readTimelineObjects(data.timelineObjects, out);
  } else {
    throw new TimelineParseError('unknown-format');
  }
  const result = out.result();
  if (result.visits.length === 0) throw new TimelineParseError('no-visits');
  return result;
}

/** Parses the text of an export file. Throws TimelineParseError with a Dutch message. */
export function parseTimelineText(text: string): ParsedTimeline {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new TimelineParseError('invalid-json');
  }
  return parseTimeline(data);
}

/** Keeps only what overlaps [startMs, endMs). */
export function sliceTimeline(timeline: ParsedTimeline, startMs: number, endMs: number): ParsedTimeline {
  const overlaps = (item: { startMs: number; endMs: number }) =>
    item.endMs > startMs && item.startMs < endMs;
  return {
    visits: timeline.visits.filter(overlaps),
    travels: timeline.travels.filter(overlaps),
  };
}
