import type { SprintFix } from '../sprint';

/** A 73 m sprint northwards, one fix a second from the GPS chip: start at k = 0 (`T0`), top speed 8 m/s, stopped from k = 12. */
export const T0 = 1_000_000;
export const LAT0 = 41.3655;
export const LON0 = 2.1585;
const M_PER_DEG_LAT = (6_371_008.8 * Math.PI) / 180;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((LAT0 * Math.PI) / 180);

export function speedAt(k: number): number {
  if (k <= 0) return 0;
  if (k === 1) return 4;
  if (k === 2) return 7;
  if (k <= 9) return 8;
  if (k === 10) return 5;
  if (k === 11) return 1;
  return 0;
}

/** The trapezoidal integral of `speedAt`. */
export function distanceAt(k: number): number {
  if (k <= 0) return 0;
  if (k === 1) return 2;
  if (k === 2) return 7.5;
  if (k <= 9) return 15 + 8 * (k - 3);
  if (k === 10) return 69.5;
  if (k === 11) return 72.5;
  return 73;
}

export const fixAt = (k: number, over: Partial<SprintFix> = {}): SprintFix => ({
  t: T0 + 1000 * k,
  lat: LAT0 + distanceAt(k) / M_PER_DEG_LAT,
  lon: LON0,
  accuracy: 4,
  speed: speedAt(k),
  receivedAt: null,
  gnss: true,
  ...over,
});

/** k = −3 … 14 */
export const straight = (): SprintFix[] => Array.from({ length: 18 }, (_, i) => fixAt(i - 3));

/** Moves a fix `metres` east. */
export const eastOf = (fix: SprintFix, metres: number): SprintFix => ({ ...fix, lon: fix.lon + metres / M_PER_DEG_LON });

/** Standing still for `seconds`: Doppler 0,3 m/s and positions jumping ±2 m. */
export const standing = (seconds: number): SprintFix[] =>
  Array.from({ length: seconds + 4 }, (_, i) => ({
    t: T0 + 1000 * (i - 3),
    lat: LAT0 + (i % 2 ? 2 : -2) / M_PER_DEG_LAT,
    lon: LON0,
    accuracy: 4,
    speed: 0.3,
    receivedAt: null,
    gnss: true,
  }));
