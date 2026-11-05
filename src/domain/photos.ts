import { distanceM, positionAtDistance, type LatLon, type TrackSample } from './gps';
import { walkSnapshot, type WalkSource } from './walkStats';

/** What the gallery tells about a photo (EXIF), as the picker returns it. */
export type Exif = Record<string, unknown> | null | undefined;

/** A fix older than this, when the camera opens, no longer says where the photo was taken. */
export const PHOTO_FIX_MAX_AGE_MS = 30_000;
/** A fix less precise than this does not place a photo. */
export const PHOTO_FIX_MAX_ACCURACY_M = 50;
/** A photo with its own GPS further than this from the route was taken somewhere else. */
export const PHOTO_MAX_OFF_ROUTE_M = 200;

/**
 * When the photo was taken, from its EXIF («2026:11:05 10:12:30»): local time of the camera, or
 * with its offset («+01:00») if the camera wrote it. Null if missing or impossible.
 */
export function exifTakenAt(exif: Exif): number | null {
  if (!exif) return null;
  const raw = exif.DateTimeOriginal ?? exif.DateTimeDigitized ?? exif.DateTime;
  if (typeof raw !== 'string') return null;
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(raw.trim());
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  if (y < 2000 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const offset = exif.OffsetTimeOriginal ?? exif.OffsetTime;
  const o = typeof offset === 'string' ? /^([+-])(\d{2}):(\d{2})$/.exec(offset.trim()) : null;
  if (o) {
    const sign = o[1] === '-' ? -1 : 1;
    return Date.UTC(y, mo - 1, d, h, mi, s) - sign * (Number(o[2]) * 60 + Number(o[3])) * 60_000;
  }
  return new Date(y, mo - 1, d, h, mi, s).getTime();
}

/**
 * Where the photo was taken, from its EXIF. Android gives signed degrees; other sources give them
 * unsigned with «S»/«W» apart. Android's photo picker usually removes it: often null.
 */
export function exifPlace(exif: Exif): LatLon | null {
  if (!exif) return null;
  const rawLat = exif.GPSLatitude;
  const rawLon = exif.GPSLongitude;
  if (typeof rawLat !== 'number' || typeof rawLon !== 'number' || !Number.isFinite(rawLat) || !Number.isFinite(rawLon)) {
    return null;
  }
  const lat = exif.GPSLatitudeRef === 'S' ? -Math.abs(rawLat) : rawLat;
  const lon = exif.GPSLongitudeRef === 'W' ? -Math.abs(rawLon) : rawLon;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) return null;
  return { lat, lon };
}

/** Where a photo taken now, during a walk, goes: the last fix, if recent and precise enough. */
export function placeFromFix(
  fix: { t: number; lat: number; lon: number; accuracy: number | null } | null,
  now: number,
): LatLon | null {
  if (!fix || now - fix.t > PHOTO_FIX_MAX_AGE_MS) return null;
  if (fix.accuracy !== null && fix.accuracy > PHOTO_FIX_MAX_ACCURACY_M) return null;
  return { lat: fix.lat, lon: fix.lon };
}

/** A finished walk, as much of it as placing a photo needs. */
export interface WalkTrack {
  startedAt: number;
  finishedAt: number;
  pausedMs: number;
  segments: LatLon[][];
  samples: TrackSample[];
}

/** The finished walk as photoPlace needs it. */
export function walkTrackOf(session: WalkSource): WalkTrack {
  const { segments, samples } = walkSnapshot(session, null, 0);
  return { startedAt: session.startedAt, finishedAt: session.finishedAt ?? session.startedAt, pausedMs: session.pausedMs, segments, samples };
}

/**
 * Where the walk was at `t`. Only without pauses: the profile counts active seconds, and without
 * pauses those are the clock's seconds since the start (the times of the pauses are not kept).
 */
export function placeAtTime(walk: WalkTrack, t: number): LatLon | null {
  const { samples } = walk;
  if (walk.pausedMs > 0 || walk.segments.length !== 1 || samples.length < 2) return null;
  if (t < walk.startedAt || t > walk.finishedAt) return null;
  const s = (t - walk.startedAt) / 1000;
  let d = samples.at(-1)!.d;
  if (s <= samples[0].s) d = samples[0].d;
  else {
    for (let i = 1; i < samples.length; i++) {
      const [a, b] = [samples[i - 1], samples[i]];
      if (s <= b.s) {
        d = b.s > a.s ? a.d + ((b.d - a.d) * (s - a.s)) / (b.s - a.s) : b.d;
        break;
      }
    }
  }
  return positionAtDistance(walk.segments, d);
}

/** Metres from `p` to the closest point of the route (its vertices, a few metres apart). */
export function gapToRoute(segments: LatLon[][], p: LatLon): number | null {
  let best: number | null = null;
  for (const segment of segments) {
    for (const q of segment) {
      const gap = distanceM(p, q);
      if (best === null || gap < best) best = gap;
    }
  }
  return best;
}

/**
 * Where a photo from the gallery goes on a finished walk: its own GPS if it was taken on the route,
 * else the walk's position at the time it was taken (only for walks without pauses). Null when it
 * cannot be known: the photo is kept, just not on the map.
 */
export function photoPlace(walk: WalkTrack, photo: { takenAt: number | null; place: LatLon | null }): LatLon | null {
  if (photo.place) {
    const gap = gapToRoute(walk.segments, photo.place);
    return gap !== null && gap <= PHOTO_MAX_OFF_ROUTE_M ? photo.place : null;
  }
  return photo.takenAt === null ? null : placeAtTime(walk, photo.takenAt);
}

/**
 * Pictures in the photos folder that no photo row uses any more: removed in tests, or of a copy
 * restored without them. Never deleted on their own: restoring a copy that has them brings them back.
 */
export function photosWithoutSession(onDisk: readonly { name: string; size: number }[], used: Iterable<string>): { files: string[]; bytes: number } {
  const inUse = new Set(used);
  const unused = onDisk.filter((f) => !inUse.has(f.name));
  return { files: unused.map((f) => f.name), bytes: unused.reduce((sum, f) => sum + f.size, 0) };
}
