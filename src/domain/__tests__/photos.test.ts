import { buildSamples, distanceM, type TrackPoint } from '../gps';
import { exifPlace, exifTakenAt, gapToRoute, photoPlace, photosWithoutSession, placeAtTime, placeFromFix, type WalkTrack } from '../photos';
import { formatBytes } from '../format';

const DEG_PER_M = 1 / 111_195;
const START = { lat: 38.07, lon: -0.97 };
const T0 = new Date(2026, 10, 5, 9, 51, 0).getTime();

/** Walking north at 1,5 m/s for `seconds`, one fix every 3 s, without pauses. */
function straightWalk(seconds: number): WalkTrack {
  const points: TrackPoint[] = [];
  for (let s = 0; s <= seconds; s += 3) {
    points.push({ t: T0 + s * 1000, lat: START.lat + s * 1.5 * DEG_PER_M, lon: START.lon, accuracy: 5, segment: 0 });
  }
  return {
    startedAt: T0,
    finishedAt: T0 + seconds * 1000,
    pausedMs: 0,
    segments: [points.map(({ lat, lon }) => ({ lat, lon }))],
    samples: buildSamples([points], T0),
  };
}

describe('exifTakenAt', () => {
  it('reads the local time of the camera', () => {
    expect(exifTakenAt({ DateTimeOriginal: '2026:11:05 10:12:30' })).toBe(new Date(2026, 10, 5, 10, 12, 30).getTime());
  });

  it('uses the offset when the camera wrote it', () => {
    expect(exifTakenAt({ DateTimeOriginal: '2026:11:05 10:12:30', OffsetTimeOriginal: '+01:00' })).toBe(
      Date.UTC(2026, 10, 5, 9, 12, 30),
    );
    expect(exifTakenAt({ DateTimeOriginal: '2026:11:05 10:12:30', OffsetTimeOriginal: '-03:30' })).toBe(
      Date.UTC(2026, 10, 5, 13, 42, 30),
    );
  });

  it('falls back to the other dates of the EXIF', () => {
    expect(exifTakenAt({ DateTime: '2026:11:05 10:00:00' })).toBe(new Date(2026, 10, 5, 10, 0, 0).getTime());
  });

  it('is null without a date or with an impossible one', () => {
    expect(exifTakenAt(null)).toBeNull();
    expect(exifTakenAt({})).toBeNull();
    expect(exifTakenAt({ DateTimeOriginal: '0000:00:00 00:00:00' })).toBeNull();
    expect(exifTakenAt({ DateTimeOriginal: '2026:13:05 10:00:00' })).toBeNull();
    expect(exifTakenAt({ DateTimeOriginal: 'ayer' })).toBeNull();
  });
});

describe('exifPlace', () => {
  it('reads the signed degrees of Android', () => {
    expect(exifPlace({ GPSLatitude: 38.07, GPSLongitude: -0.97, GPSLatitudeRef: 'N', GPSLongitudeRef: 'W' })).toEqual({
      lat: 38.07,
      lon: -0.97,
    });
  });

  it('applies S and W to unsigned degrees', () => {
    expect(exifPlace({ GPSLatitude: 33.9, GPSLongitude: 18.4, GPSLatitudeRef: 'S', GPSLongitudeRef: 'E' })).toEqual({
      lat: -33.9,
      lon: 18.4,
    });
    expect(exifPlace({ GPSLatitude: 38.07, GPSLongitude: 0.97, GPSLongitudeRef: 'W' })).toEqual({ lat: 38.07, lon: -0.97 });
  });

  it('is null when the picker removed it or it is impossible', () => {
    expect(exifPlace({ DateTimeOriginal: '2026:11:05 10:12:30' })).toBeNull();
    expect(exifPlace({ GPSLatitude: 0, GPSLongitude: 0 })).toBeNull();
    expect(exifPlace({ GPSLatitude: 95, GPSLongitude: 3 })).toBeNull();
    expect(exifPlace({ GPSLatitude: '38', GPSLongitude: '-0.9' })).toBeNull();
  });
});

describe('placeFromFix', () => {
  const fix = { t: T0, lat: START.lat, lon: START.lon, accuracy: 6 };

  it('takes the last fix when it is recent and precise', () => {
    expect(placeFromFix(fix, T0 + 10_000)).toEqual(START);
    expect(placeFromFix({ ...fix, accuracy: null }, T0)).toEqual(START);
  });

  it('is null with an old or imprecise fix, or without one', () => {
    expect(placeFromFix(fix, T0 + 31_000)).toBeNull();
    expect(placeFromFix({ ...fix, accuracy: 80 }, T0)).toBeNull();
    expect(placeFromFix(null, T0)).toBeNull();
  });
});

describe('placeAtTime', () => {
  const walk = straightWalk(600);

  it('places a moment of a walk without pauses on its route', () => {
    const at = placeAtTime(walk, T0 + 200_000)!;
    expect(distanceM(START, at)).toBeCloseTo(300, -1);
    expect(placeAtTime(walk, T0)).toEqual(walk.segments[0][0]);
    expect(distanceM(placeAtTime(walk, walk.finishedAt)!, walk.segments[0].at(-1)!)).toBeLessThan(1);
  });

  it('is null outside the walk', () => {
    expect(placeAtTime(walk, T0 - 1000)).toBeNull();
    expect(placeAtTime(walk, walk.finishedAt + 1000)).toBeNull();
  });

  it('is null with pauses: active time is not the clock any more', () => {
    expect(placeAtTime({ ...walk, pausedMs: 60_000 }, T0 + 200_000)).toBeNull();
    expect(placeAtTime({ ...walk, segments: [walk.segments[0], walk.segments[0]] }, T0 + 200_000)).toBeNull();
  });
});

describe('photoPlace', () => {
  const walk = straightWalk(600);
  const onRoute = { lat: START.lat + 300 * DEG_PER_M, lon: START.lon + 40 * DEG_PER_M };
  const elsewhere = { lat: START.lat + 300 * DEG_PER_M, lon: START.lon + 900 * DEG_PER_M };

  it('keeps the own GPS of a photo taken on the route', () => {
    expect(photoPlace(walk, { takenAt: null, place: onRoute })).toEqual(onRoute);
    // 40 m of longitude east is 31,5 m at this latitude.
    expect(gapToRoute(walk.segments, onRoute)).toBeCloseTo(31.5, 0);
  });

  it('drops a photo taken somewhere else, even within the time of the walk', () => {
    expect(photoPlace(walk, { takenAt: T0 + 200_000, place: elsewhere })).toBeNull();
  });

  it('uses the time without GPS', () => {
    expect(distanceM(START, photoPlace(walk, { takenAt: T0 + 200_000, place: null })!)).toBeCloseTo(300, -1);
    expect(photoPlace(walk, { takenAt: null, place: null })).toBeNull();
  });
});

describe('pictures without a session', () => {
  it('are the files of the folder that no photo uses, with their size', () => {
    const onDisk = [
      { name: 'a.jpg', size: 400_000 },
      { name: 'b.jpg', size: 500_000 },
      { name: 'c.jpg', size: 750_000 },
    ];
    expect(photosWithoutSession(onDisk, ['b.jpg'])).toEqual({ files: ['a.jpg', 'c.jpg'], bytes: 1_150_000 });
    expect(photosWithoutSession(onDisk, ['a.jpg', 'b.jpg', 'c.jpg', 'gone.jpg'])).toEqual({ files: [], bytes: 0 });
    expect(photosWithoutSession([], ['a.jpg'])).toEqual({ files: [], bytes: 0 });
  });

  it('say how much they take', () => {
    expect(formatBytes(1_150_000)).toBe('1,2 MB');
    expect(formatBytes(850_400)).toBe('850 kB');
    expect(formatBytes(120)).toBe('1 kB');
  });
});
