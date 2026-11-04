import { localDateString } from '@/domain/schedule';
import { DEFAULT_SPRINT_PLAN, encodeLapFixes, encodeLaps, measureLaps, withMeasures, type Lap, type SprintFix } from '@/domain/sprint';
import type { Db } from './db';
import { finishSprintSession } from './repositories/cardioSessions';

/**
 * Six made-up sprints of about 75 m back and forth, a fix a second: test data for the sprints
 * detail and its image in development builds (the emulator gives no Doppler speed). The fourth
 * one has a weak GPS. Release builds never import it.
 */

const START = { lat: 41.3655, lon: 2.1585 };
const M_PER_DEG_LAT = (6_371_008.8 * Math.PI) / 180;
/** Top speeds in m/s: 7,6 to 8,6. */
const TOPS = [8.2, 8.6, 8.4, 7.9, 8.0, 7.6];
const STOP_AFTER_MS = [11_600, 11_200, 11_400, 12_100, 11_900, 12_500];

/** Speed at second `k` of a sprint whose top is 8 m/s, as a share of that top. */
function shape(k: number): number {
  if (k <= 0) return 0;
  if (k === 1) return 0.5;
  if (k === 2) return 0.875;
  if (k <= 9) return 1;
  if (k === 10) return 0.625;
  if (k === 11) return 0.125;
  return 0;
}

export function generateDemoSprints(firstBeep: number): { laps: Lap[]; fixes: SprintFix[] } {
  const laps: Lap[] = [];
  const fixes: SprintFix[] = [];
  let beep = firstBeep;
  TOPS.forEach((top, i) => {
    const direction = i % 2 === 0 ? 1 : -1;
    const from = i % 2 === 0 ? 0 : 75;
    let d = 0;
    for (let k = -3; k <= 14; k++) {
      const v = shape(k) * top;
      if (k > 0) d += ((shape(k - 1) * top + v) / 2) * 1;
      const t = beep + k * 1000;
      fixes.push({
        t,
        lat: START.lat + (from + direction * d + Math.sin(t / 997) * 0.8) / M_PER_DEG_LAT,
        lon: START.lon,
        accuracy: i === 3 ? 12 : 4,
        speed: v,
        receivedAt: t + 300,
      });
    }
    const stopAt = beep + STOP_AFTER_MS[i];
    laps.push({ startAt: beep, stopAt, distanceM: null, topSpeedMs: null, quality: null });
    beep = stopAt + DEFAULT_SPRINT_PLAN.restSec * 1000;
  });
  return { laps, fixes };
}

/** Adds the demo sprints as a session of today that ended a few minutes before `now`. */
export async function addDemoSprints(db: Db, now = Date.now()): Promise<number> {
  const startedAt = now - 20 * 60_000;
  const { laps, fixes } = generateDemoSprints(startedAt + 60_000);
  const { lastInsertRowId: id } = await db.runAsync(
    `INSERT INTO cardio_session (name, date, tracking, started_at, plan, laps) VALUES (?, ?, 'sprint', ?, ?, ?)`,
    'Sprints + Bouncing',
    localDateString(new Date(startedAt)),
    startedAt,
    JSON.stringify(DEFAULT_SPRINT_PLAN),
    encodeLaps(laps),
  );
  const measured = withMeasures(laps, measureLaps(fixes, laps, Infinity));
  await finishSprintSession(db, id, laps.at(-1)!.stopAt! + 30_000, measured, encodeLapFixes(measured, fixes));
  return id;
}
