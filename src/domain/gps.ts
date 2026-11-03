export interface LatLon {
  lat: number;
  lon: number;
}

export interface TrackPoint extends LatLon {
  /** Epoch ms. */
  t: number;
  /** Metres; null when the provider does not say. */
  accuracy: number | null;
  /** Metres from GPS (rough, ±10–20 m); null if unknown. */
  altitude?: number | null;
  /** A new segment starts after every pause; distance never joins two segments. */
  segment: number;
}

/** Fixes worse than this are ignored. */
export const MAX_ACCURACY_M = 30;
/** Faster than this between two fixes is a GPS jump, not walking or running (36 km/h). */
export const MAX_SPEED_MS = 10;
/** Smallest step counted, so standing still does not add jitter to the distance. */
export const MIN_STEP_M = 5;
/** Window used for the current speed. */
export const SPEED_WINDOW_MS = 30_000;

const EARTH_RADIUS_M = 6_371_008.8;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in metres (haversine). */
export function distanceM(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Drops inaccurate fixes, impossible jumps and the jitter of standing still. A point is kept only
 * when it is at least MIN_STEP_M (or the mean accuracy of both fixes) away from the last kept one, so
 * slow walking still adds up: the gap grows until it passes the threshold.
 */
export function filterTrack(points: TrackPoint[]): TrackPoint[] {
  const kept: TrackPoint[] = [];
  let last: TrackPoint | null = null;
  for (const p of points) {
    if (p.accuracy !== null && p.accuracy > MAX_ACCURACY_M) continue;
    if (!last || p.segment !== last.segment) {
      kept.push(p);
      last = p;
      continue;
    }
    const seconds = (p.t - last.t) / 1000;
    if (seconds <= 0) continue;
    const d = distanceM(last, p);
    if (d / seconds > MAX_SPEED_MS) continue;
    const noise = Math.max(MIN_STEP_M, ((last.accuracy ?? 0) + (p.accuracy ?? 0)) / 2);
    if (d < noise) continue;
    kept.push(p);
    last = p;
  }
  return kept;
}

/** Points of a (filtered) track grouped by segment, in order. */
export function splitSegments<T extends { segment: number }>(points: T[]): T[][] {
  const segments: T[][] = [];
  for (const p of points) {
    const current = segments.at(-1);
    if (current && current[0].segment === p.segment) current.push(p);
    else segments.push([p]);
  }
  return segments;
}

export function pathLengthM(points: LatLon[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distanceM(points[i - 1], points[i]);
  return total;
}

export interface TrackSummary {
  distanceM: number;
  /** Speed over the last SPEED_WINDOW_MS, 0 when stopped. */
  currentSpeedMs: number;
  /** Kept points, split by segment, ready to draw. */
  segments: TrackPoint[][];
}

export function summarizeTrack(points: TrackPoint[], now: number): TrackSummary {
  const segments = splitSegments(filterTrack(points));
  const distance = segments.reduce((sum, seg) => sum + pathLengthM(seg), 0);
  const lastSegment = segments.at(-1) ?? [];
  const recent = lastSegment.filter((p) => p.t >= now - SPEED_WINDOW_MS);
  let currentSpeedMs = 0;
  if (recent.length >= 2) {
    const seconds = (recent.at(-1)!.t - recent[0].t) / 1000;
    if (seconds > 0) currentSpeedMs = pathLengthM(recent) / seconds;
  }
  return { distanceM: distance, currentSpeedMs, segments };
}

/** Active time of a session: pauses (finished or still running) do not count. */
export function activeMs(
  session: { startedAt: number; finishedAt: number | null; pausedAt: number | null; pausedMs: number },
  now: number,
): number {
  const end = session.finishedAt ?? now;
  const pausedNow = session.pausedAt !== null && session.finishedAt === null ? now - session.pausedAt : 0;
  return Math.max(0, end - session.startedAt - session.pausedMs - pausedNow);
}

/** Below this the pace is meaningless (standing). */
const MIN_PACE_SPEED_MS = 0.3;

/** "10:24" minutes per km, or null when not moving. */
export function paceMinPerKm(speedMs: number): string | null {
  if (speedMs < MIN_PACE_SPEED_MS) return null;
  const secondsPerKm = Math.round(1000 / speedMs);
  return `${Math.floor(secondsPerKm / 60)}:${String(secondsPerKm % 60).padStart(2, '0')}`;
}

/** A point of the stored profile of a walk: active seconds, metres so far and altitude. */
export interface TrackSample {
  s: number;
  d: number;
  a: number | null;
}

/** One stored sample every this many seconds of activity (a 1 h walk is ~360 samples, ~6 KB). */
export const SAMPLE_EVERY_S = 10;

/**
 * Time/distance/altitude profile of a (filtered) track for its charts and splits. Time is active
 * time: the gap between segments is a pause and is left out.
 */
export function buildSamples(segments: TrackPoint[][], startedAt: number): TrackSample[] {
  const samples: TrackSample[] = [];
  let elapsed = 0;
  let distance = 0;
  let prev: TrackPoint | null = null;
  let current: TrackSample | null = null;
  for (const [k, segment] of segments.entries()) {
    for (const [i, p] of segment.entries()) {
      if (prev && i > 0) {
        elapsed += (p.t - prev.t) / 1000;
        distance += distanceM(prev, p);
      } else if (k === 0 && i === 0) {
        elapsed = Math.max(0, (p.t - startedAt) / 1000);
      }
      prev = p;
      current = {
        s: Math.round(elapsed),
        d: Math.round(distance),
        a: p.altitude == null ? null : Math.round(p.altitude * 10) / 10,
      };
      const last = samples.at(-1);
      if (!last || current.s - last.s >= SAMPLE_EVERY_S) samples.push(current);
    }
  }
  if (current && samples.at(-1) !== current) samples.push(current);
  return samples;
}

/** Speed (m/s) at each sample, averaged over the previous `windowS` seconds to smooth GPS noise. */
export function speedSeries(samples: TrackSample[], windowS = 30): { s: number; speed: number }[] {
  const series: { s: number; speed: number }[] = [];
  let j = 0;
  for (let i = 1; i < samples.length; i++) {
    while (j < i - 1 && samples[i].s - samples[j + 1].s >= windowS) j++;
    const seconds = samples[i].s - samples[j].s;
    series.push({ s: samples[i].s, speed: seconds > 0 ? (samples[i].d - samples[j].d) / seconds : 0 });
  }
  return series;
}

/** GPS altitude smoothed with a moving average, by distance. */
export function altitudeProfile(samples: TrackSample[], window = 5): { s: number; d: number; a: number }[] {
  const known = samples.filter((x): x is TrackSample & { a: number } => x.a !== null);
  const half = Math.floor(window / 2);
  return known.map((x, i) => {
    const around = known.slice(Math.max(0, i - half), i + half + 1);
    return { s: x.s, d: x.d, a: around.reduce((sum, y) => sum + y.a, 0) / around.length };
  });
}

/** Metres along the route (not joining segments) to the vertex closest to `p`: a tap on the map. */
export function distanceAlong(segments: LatLon[][], p: LatLon): number | null {
  let walked = 0;
  let best: { d: number; gap: number } | null = null;
  for (const segment of segments) {
    for (let i = 0; i < segment.length; i++) {
      if (i > 0) walked += distanceM(segment[i - 1], segment[i]);
      const gap = distanceM(segment[i], p);
      if (!best || gap < best.gap) best = { d: walked, gap };
    }
  }
  return best?.d ?? null;
}

/**
 * Where the walker was after `d` metres, interpolated along the route. Distance does not join
 * segments (as in `buildSamples`), so a distance at a pause is the end of the earlier segment.
 */
export function positionAtDistance(segments: LatLon[][], d: number): LatLon | null {
  let walked = 0;
  let last: LatLon | null = null;
  for (const segment of segments) {
    for (let i = 1; i < segment.length; i++) {
      const step = distanceM(segment[i - 1], segment[i]);
      if (walked + step >= d) {
        const f = step > 0 ? Math.max(0, d - walked) / step : 0;
        return {
          lat: segment[i - 1].lat + (segment[i].lat - segment[i - 1].lat) * f,
          lon: segment[i - 1].lon + (segment[i].lon - segment[i - 1].lon) * f,
        };
      }
      walked += step;
    }
    last = segment.at(-1) ?? last;
  }
  return last;
}

/** Total climb and descent, ignoring changes smaller than `threshold` metres (GPS noise). */
export function elevationChange(profile: { a: number }[], threshold = 3): { gain: number; loss: number } {
  let gain = 0;
  let loss = 0;
  let ref = profile[0]?.a ?? 0;
  for (const { a } of profile) {
    if (a - ref >= threshold) {
      gain += a - ref;
      ref = a;
    } else if (ref - a >= threshold) {
      loss += ref - a;
      ref = a;
    }
  }
  return { gain, loss };
}

export interface Split {
  /** 1000 for a full kilometre; the last one may be shorter. */
  distanceM: number;
  seconds: number;
}

/** Time of each kilometre (interpolated between samples), plus the last partial one if ≥ 50 m. */
export function kmSplits(samples: TrackSample[]): Split[] {
  const splits: Split[] = [];
  if (samples.length < 2) return splits;
  let startS = samples[0].s;
  let km = 1;
  for (let i = 1; i < samples.length; i++) {
    const [a, b] = [samples[i - 1], samples[i]];
    while (b.d >= km * 1000 && b.d > a.d) {
      const at = a.s + ((km * 1000 - a.d) / (b.d - a.d)) * (b.s - a.s);
      splits.push({ distanceM: 1000, seconds: at - startS });
      startS = at;
      km++;
    }
  }
  const last = samples[samples.length - 1];
  const rest = last.d - (km - 1) * 1000;
  if (rest >= 50) splits.push({ distanceM: rest, seconds: last.s - startS });
  return splits;
}

// Stored as [[s, d, a], ...] to keep backups small.
export const encodeSamples = (samples: TrackSample[]) => JSON.stringify(samples.map((x) => [x.s, x.d, x.a]));

export function decodeSamples(json: string | null): TrackSample[] {
  if (!json) return [];
  try {
    return (JSON.parse(json) as [number, number, number | null][]).map(([s, d, a]) => ({ s, d, a }));
  } catch {
    return [];
  }
}

// Google's encoded polyline format (precision 5): about 5 bytes per point instead of a table row.

function encodeValue(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let out = '';
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  return out + String.fromCharCode(v + 63);
}

export function encodePolyline(points: LatLon[]): string {
  let prevLat = 0;
  let prevLon = 0;
  let out = '';
  for (const p of points) {
    const lat = Math.round(p.lat * 1e5);
    const lon = Math.round(p.lon * 1e5);
    out += encodeValue(lat - prevLat) + encodeValue(lon - prevLon);
    prevLat = lat;
    prevLon = lon;
  }
  return out;
}

export function decodePolyline(encoded: string): LatLon[] {
  const points: LatLon[] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  const next = () => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    lat += next();
    lon += next();
    points.push({ lat: lat / 1e5, lon: lon / 1e5 });
  }
  return points;
}

// Segments are separated by a space, which is not part of the polyline alphabet.
export const encodeRoute = (segments: LatLon[][]) =>
  segments.filter((s) => s.length > 0).map(encodePolyline).join(' ');

export const decodeRoute = (route: string | null): LatLon[][] =>
  route ? route.split(' ').filter(Boolean).map(decodePolyline) : [];
