import type { TrackPoint } from '@/domain/gps';
import { localDateString } from '@/domain/schedule';
import type { Db } from './db';
import { finishCardioSession } from './repositories/cardioSessions';

/**
 * A made-up ~5 km walk around a hill, with two short stops and one pause: test data for the walk
 * detail (map, charts, splits, sharing) in development builds. Release builds never import it.
 */

// Montjuïc (Barcelona): a public park with a hill, so the 3D view has relief.
const CENTER = { lat: 41.3655, lon: 2.1585 };
const RADIUS_M = 760;
const M_PER_DEG_LAT = 111_195;
const STEP_S = 3;

/** Deterministic pseudo-random numbers in [0, 1). */
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

/** Offset in metres from the centre at angle `t` of the loop. */
function loopAt(t: number): { x: number; y: number } {
  const r = RADIUS_M * (1 + 0.22 * Math.sin(2 * t + 0.6) + 0.12 * Math.sin(3 * t + 1.3));
  return { x: r * Math.cos(t), y: r * Math.sin(t) };
}

function altitudeAt(x: number, y: number): number {
  const dx = x - 0.3 * RADIUS_M;
  const dy = y - 0.2 * RADIUS_M;
  return 45 + 125 * Math.exp(-(dx * dx + dy * dy) / (2 * (0.75 * RADIUS_M) ** 2));
}

export function generateDemoWalk(startedAt: number): { points: TrackPoint[]; pausedMs: number; finishedAt: number } {
  const rand = random(42);
  const noise = (m: number) => (rand() - 0.5) * 2 * m;
  const points: TrackPoint[] = [];
  const pauseAtS = 25 * 60;
  const pauseS = 120;
  const stops = [
    { at: 14 * 60, seconds: 40 },
    { at: 38 * 60, seconds: 25 },
  ];
  let t = 0; // angle along the loop
  let clock = 0; // seconds since the start, pauses included
  let segment = 0;
  let paused = false;
  while (t < 2 * Math.PI) {
    if (!paused && clock >= pauseAtS) {
      paused = true;
      clock += pauseS;
      segment = 1;
    }
    const stopped = stops.some((s) => clock >= s.at && clock < s.at + s.seconds);
    if (!stopped) {
      const speed = 1.45 + 0.15 * Math.sin(clock / 97) + 0.1 * Math.sin(clock / 31);
      const here = loopAt(t);
      const ahead = loopAt(t + 0.001);
      const metresPerRadian = Math.hypot(ahead.x - here.x, ahead.y - here.y) / 0.001;
      t += (speed * STEP_S) / metresPerRadian;
    }
    const { x, y } = loopAt(Math.min(t, 2 * Math.PI));
    points.push({
      t: startedAt + clock * 1000,
      lat: CENTER.lat + (y + noise(2.5)) / M_PER_DEG_LAT,
      lon: CENTER.lon + (x + noise(2.5)) / (M_PER_DEG_LAT * Math.cos((CENTER.lat * Math.PI) / 180)),
      accuracy: 4 + Math.round(rand() * 5),
      altitude: altitudeAt(x, y) + noise(2),
      segment,
    });
    clock += STEP_S;
  }
  return { points, pausedMs: pauseS * 1000, finishedAt: startedAt + clock * 1000 };
}

/** Adds the demo walk as a finished session that ended an hour before `now`. */
export async function addDemoWalk(db: Db, now = Date.now()): Promise<number> {
  const draft = generateDemoWalk(0);
  const startedAt = now - 3_600_000 - draft.finishedAt;
  const { points, pausedMs, finishedAt } = generateDemoWalk(startedAt);
  const { lastInsertRowId: id } = await db.runAsync(
    `INSERT INTO cardio_session (name, date, tracking, started_at, paused_ms, segment) VALUES (?, ?, 'gps', ?, ?, 1)`,
    'Caminar',
    localDateString(new Date(startedAt)),
    startedAt,
    pausedMs,
  );
  await db.withTransactionAsync(async () => {
    for (const p of points) {
      await db.runAsync(
        `INSERT INTO cardio_point (session_id, segment, t, lat, lon, accuracy, speed, altitude) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
        id,
        p.segment,
        p.t,
        p.lat,
        p.lon,
        p.accuracy,
        p.altitude ?? null,
      );
    }
  });
  await finishCardioSession(db, id, finishedAt);
  return id;
}
