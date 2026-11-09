import type { LatLon } from '../gps';

/** Walks for the tests of Mis rutas: shapes in metres around Montjuïc, as `scripts/simulate_walk.py`. */

export const HOME = { lat: 41.3655, lon: 2.1585 };
const M_PER_DEG_LAT = 111_195;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((HOME.lat * Math.PI) / 180);

export const at = (x: number, y: number): LatLon => ({ lat: HOME.lat + y / M_PER_DEG_LAT, lon: HOME.lon + x / M_PER_DEG_LON });

export type Corner = [number, number];

/**
 * A walk through `corners` (metres east and north of home), a point every `step` metres, with the
 * slow drift of a phone's GPS (a different one for each `seed`) and a little jitter.
 */
export function walkAlong(corners: Corner[], { drift = 8, step = 8, seed = 1 } = {}): LatLon[] {
  let state = seed * 7919;
  const jitter = () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return (state / 2_147_483_648 - 0.5) * 2;
  };
  const points: LatLon[] = [];
  let along = 0;
  for (let i = 1; i < corners.length; i++) {
    const [ax, ay] = corners[i - 1];
    const [bx, by] = corners[i];
    const length = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.round(length / step));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) {
      const s = along + (length * k) / n;
      const f = k / n;
      points.push(
        at(
          ax + (bx - ax) * f + drift * Math.sin(s / 53 + seed) + jitter(),
          ay + (by - ay) * f + drift * Math.cos(s / 71 + 2 * seed) + jitter(),
        ),
      );
    }
    along += length;
  }
  return points;
}

export const reversed = (corners: Corner[]): Corner[] => [...corners].reverse();

/** A block of 400 × 300 m from home, anticlockwise: 1400 m. */
export const LOOP: Corner[] = [
  [0, 0],
  [400, 0],
  [400, 300],
  [0, 300],
  [0, 0],
];
/** Out 700 m along one street and back the same way: 1400 m. */
export const OUT_AND_BACK: Corner[] = [
  [0, 0],
  [700, 0],
  [0, 0],
];
/** From home to a point 1 km away. */
export const LINE: Corner[] = [
  [0, 0],
  [600, 0],
  [600, 400],
];
/** The block with its top street swapped for a parallel one 150 m further north: a variant. */
export const LOOP_DETOUR: Corner[] = [
  [0, 0],
  [400, 0],
  [400, 300],
  [300, 300],
  [300, 450],
  [100, 450],
  [100, 300],
  [0, 300],
  [0, 0],
];
