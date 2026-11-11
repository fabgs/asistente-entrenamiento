import { decodeLaps, DEFAULT_SPRINT_PLAN, encodeLapFixes, encodeLaps, markedStraight, type Lap, type SprintFix } from '@/domain/sprint';
import type { Db } from '../db';
import { DEMO_SEED as SEED } from '../demoSeed';
import { exportBackup, restoreBackup } from '../maintenance';
import { MIGRATIONS } from '../migrations';
import { cardioLogOn, getCardio, listCardio } from '../repositories/cardio';
import {
  finishSprintSession,
  getCardioSession,
  NO_STRAIGHT,
  setSprintLaps,
  setSprintNumbers,
  setSprintStraight,
  sprintLapFixes,
  startCardioSession,
} from '../repositories/cardioSessions';
import { cardioHistory } from '../repositories/progress';
import { importSeed } from '../seed';
import { createTestDb } from './testDb';

const NOW = new Date(2026, 10, 11, 7, 30);
const T0 = NOW.getTime();

const measured = (startAt: number, quality: Lap['quality']): Lap => ({ startAt, stopAt: startAt + 8000, distanceM: 17, topSpeedMs: 2.03, quality });
/** What the 1.5.1 stored for sprints the fused location had smoothed away: «good». */
const OLD_LAPS = encodeLaps([measured(T0, 'good'), measured(T0 + 100_000, 'weak'), measured(T0 + 200_000, 'none')]);

async function oldSprints(db: Db): Promise<number> {
  await db.runAsync(`INSERT INTO cardio_activity (weekday, name, tracking, plan) VALUES (3, 'Sprints', 'sprint', '{"kind":"sprint","sprints":6,"restSec":90}')`);
  const result = await db.runAsync(
    `INSERT INTO cardio_session (activity_id, name, date, tracking, status, started_at, finished_at, plan, laps)
     VALUES (1, 'Sprints', '2026-11-11', 'sprint', 'finished', ?, ?, '{"kind":"sprint","sprints":6,"restSec":90}', ?)`,
    T0,
    T0 + 600_000,
    OLD_LAPS,
  );
  return result.lastInsertRowId;
}

describe('sprints with the GPS chip (1.5.2, migration 16)', () => {
  it('says where each fix came from, and the sprints measured until now stop counting as well measured', async () => {
    const db = await createTestDb({ upTo: 15 });
    const id = await oldSprints(db);
    await db.runAsync(`INSERT INTO cardio_point (session_id, segment, t, lat, lon, accuracy, speed) VALUES (?, 0, ?, 40.4, -3.7, 4, 2)`, id, T0);
    await db.execAsync(MIGRATIONS[15]);

    const columns = (await db.getAllAsync<{ name: string }>('PRAGMA table_info(cardio_point)')).map((c) => c.name);
    expect(columns).toEqual(expect.arrayContaining(['source', 'speed_accuracy']));
    // A fix stored before is one of the fused location.
    expect(await db.getFirstAsync('SELECT source, speed_accuracy FROM cardio_point')).toEqual({ source: 0, speed_accuracy: null });
    const laps = (await getCardioSession(db, id))!.laps;
    expect(laps.map((l) => l.quality)).toEqual(['weak', 'weak', 'none']);
    // Nothing else of them changes: the figures stay, marked as rough.
    expect(laps[0]).toMatchObject({ distanceM: 17, topSpeedMs: 2.03 });
  });

  it('does the same to a copy made before it, and leaves alone the ones made after', async () => {
    const db = await createTestDb();
    await importSeed(db, SEED, NOW);
    const sprints = (await listCardio(db)).find((a) => a.tracking === 'sprint')!;
    await db.runAsync(
      `INSERT INTO cardio_session (activity_id, name, date, tracking, status, started_at, finished_at, plan, laps)
       VALUES (?, 'Sprints', '2026-11-11', 'sprint', 'finished', ?, ?, '{"kind":"sprint","sprints":6,"restSec":90}', ?)`,
      sprints.id,
      T0,
      T0 + 600_000,
      OLD_LAPS,
    );
    const backup = await exportBackup(db, NOW);
    const qualities = async () =>
      decodeLaps((await db.getFirstAsync<{ laps: string }>(`SELECT laps FROM cardio_session WHERE tracking = 'sprint'`))!.laps).map((l) => l.quality);

    await restoreBackup(db, backup);
    expect(await qualities()).toEqual(['good', 'weak', 'none']);
    await restoreBackup(db, { ...backup, schemaVersion: 15 });
    expect(await qualities()).toEqual(['weak', 'weak', 'none']);
  });
});

describe('the straight marked on the map and the plan changed from the sprints (1.5.2)', () => {
  const NBSP = ' ';
  const DAY = 86_400_000;
  const run = (startAt: number, seconds: number): Lap => ({ startAt, stopAt: startAt + seconds * 1000, distanceM: 17, topSpeedMs: 4, quality: 'weak' });
  const MARKED = markedStraight({ lat: 40.4, lon: -3.7 }, { lat: 40.40032, lon: -3.7 })!;

  async function seeded() {
    const db = await createTestDb();
    await importSeed(db, SEED, NOW);
    const sprints = (await listCardio(db)).find((a) => a.tracking === 'sprint')!;
    return { db, sprints };
  }

  it('goes to the session, to the line of its day and, being the latest of its activity, to the activity for the next day', async () => {
    const { db, sprints } = await seeded();
    const id = await startCardioSession(db, sprints, T0);
    await finishSprintSession(db, id, T0 + 600_000, [run(T0, 8.7), run(T0 + 100_000, 7)], null);
    expect((await cardioLogOn(db, '2026-11-11')).get(sprints.id)?.value).toBe(`2 sprints · mejor 7,0${NBSP}s`);

    expect(MARKED.straightM).toBe(36);
    expect(await setSprintStraight(db, id, MARKED)).toBe(true);
    expect((await getCardioSession(db, id))!.sprint).toEqual({ ...DEFAULT_SPRINT_PLAN, ...MARKED });
    expect((await cardioLogOn(db, '2026-11-11')).get(sprints.id)?.value).toBe(`2 × 36${NBSP}m · mejor 7,0${NBSP}s`);
    const [entry] = (await cardioHistory(db)).flatMap((d) => d.activities).filter((a) => a.kind === 'sprint');
    expect(entry).toMatchObject({ value: `2 × 36${NBSP}m · mejor 7,0${NBSP}s`, sprint: { count: 2, bestTimeMs: 7000, straightM: 36 } });
    // The next session starts with it.
    expect((await getCardio(db, sprints.id))!.sprint).toEqual({ ...DEFAULT_SPRINT_PLAN, ...MARKED });
    const next = await startCardioSession(db, (await getCardio(db, sprints.id))!, T0 + DAY);
    expect((await getCardioSession(db, next))!.sprint).toEqual({ ...DEFAULT_SPRINT_PLAN, ...MARKED });

    // The straight of an old session is its own: today's stays.
    expect(await setSprintStraight(db, id, { straightM: 50, straightEnds: null })).toBe(false);
    expect((await getCardioSession(db, id))!.sprint).toMatchObject({ straightM: 50, straightEnds: null });
    expect((await getCardio(db, sprints.id))!.sprint!.straightM).toBe(36);
    // Taken away from the latest one, it goes from the activity too.
    expect(await setSprintStraight(db, next, NO_STRAIGHT)).toBe(true);
    expect((await getCardio(db, sprints.id))!.sprint).toEqual(DEFAULT_SPRINT_PLAN);
  });

  it('changes how many, the rest and the count of the sprints in progress, and of the activity', async () => {
    const { db, sprints } = await seeded();
    const id = await startCardioSession(db, sprints, T0);
    await setSprintNumbers(db, id, { sprints: 4, restSec: 120, leadSec: 10 });
    const changed = { ...DEFAULT_SPRINT_PLAN, sprints: 4, restSec: 120, leadSec: 10 };
    expect((await getCardioSession(db, id))!.sprint).toEqual(changed);
    expect((await getCardio(db, sprints.id))!.sprint).toEqual(changed);
    // Never fewer than the ones done plus the next one.
    await setSprintLaps(db, id, '[]', encodeLaps([run(T0, 8), run(T0 + 100_000, 8), run(T0 + 200_000, 8)]));
    await setSprintNumbers(db, id, { sprints: 2, restSec: 120, leadSec: 10 });
    expect((await getCardioSession(db, id))!.sprint!.sprints).toBe(4);
    // A finished session is not touched.
    await finishSprintSession(db, id, T0 + 600_000, [run(T0, 8)], null);
    await setSprintNumbers(db, id, { sprints: 9, restSec: 60, leadSec: 5 });
    expect((await getCardioSession(db, id))!.sprint!.sprints).toBe(4);
  });

  it('gives back the fixes kept around each sprint, with the ones of the chip marked', async () => {
    const { db, sprints } = await seeded();
    const id = await startCardioSession(db, sprints, T0);
    const laps = [run(T0, 8)];
    const fix = (ms: number, gnss: boolean): SprintFix => ({ t: T0 + ms, lat: 40.4, lon: -3.7, accuracy: 4, speed: 6, receivedAt: T0 + ms + 60, gnss, speedAccuracy: gnss ? 0.3 : null });
    await finishSprintSession(db, id, T0 + 600_000, laps, encodeLapFixes(laps, [fix(1000, false), fix(1010, true), fix(15_000, true), fix(17_000, true)]));
    const [kept] = await sprintLapFixes(db, id);
    // Up to 8 s after the stop; later ones were not kept.
    expect(kept.map((f) => [f.t - T0, f.gnss ?? false])).toEqual([
      [1000, false],
      [1010, true],
      [15_000, true],
    ]);
    expect(await sprintLapFixes(db, 999)).toEqual([]);
  });
});
