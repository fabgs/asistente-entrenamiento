import type { Db } from '../db';
import { DEMO_SEED } from '../demoSeed';
import { exportBackup, restoreBackup } from '../maintenance';
import { MIGRATIONS } from '../migrations';
import { getRoutine, listRoutines, listSlots, setRoutineWarmup } from '../repositories/routines';
import {
  endRest,
  endWarmup,
  finishSession,
  getSession,
  isWarmingUp,
  lastWarmupOf,
  listSets,
  logSet,
  logWarmupSet,
  openSlot,
  startLooseSession,
  startSession,
} from '../repositories/sessions';
import { getSettings, toProgressionSettings } from '../repositories/settings';
import { importSeed } from '../seed';
import { createTestDb } from './testDb';

const NOW = new Date(2026, 10, 9, 7, 0);
const T0 = NOW.getTime();
const S = 1000;

async function seeded(): Promise<Db> {
  const db = await createTestDb();
  await importSeed(db, DEMO_SEED, NOW);
  return db;
}

describe('warm-up and set times (migration 11)', () => {
  it('a routine has no warm-up until it is switched on', async () => {
    const db = await seeded();
    const routine = (await listRoutines(db))[0];
    expect(routine.warmup).toBe(false);
    await setRoutineWarmup(db, routine.id, true);
    expect((await getRoutine(db, routine.id))?.warmup).toBe(true);
    expect((await listRoutines(db))[0].warmup).toBe(true);
  });

  it('without a warm-up, the first set starts with the workout', async () => {
    const db = await seeded();
    const routine = (await listRoutines(db))[0];
    const id = await startSession(db, routine.id, NOW);
    const session = (await getSession(db, id))!;
    expect(session).toMatchObject({ warmupStartedAt: null, warmupEndedAt: null, setStartedAt: T0 });
    expect(isWarmingUp(session)).toBe(false);
  });

  it('times the warm-up, each set and each rest', async () => {
    const db = await seeded();
    const routine = (await listRoutines(db))[0];
    const [first] = await listSlots(db, routine.id);
    await setRoutineWarmup(db, routine.id, true);

    const id = await startSession(db, routine.id, NOW);
    expect(isWarmingUp((await getSession(db, id))!)).toBe(true);
    expect((await getSession(db, id))!.setStartedAt).toBeNull();

    await endWarmup(db, id, first.id, T0 + 480 * S);
    const warmedUp = (await getSession(db, id))!;
    expect(warmedUp).toMatchObject({
      warmupStartedAt: T0,
      warmupEndedAt: T0 + 480 * S,
      setStartedAt: T0 + 480 * S,
      currentSlotId: first.id,
    });
    expect(isWarmingUp(warmedUp)).toBe(false);
    // Ending it again changes nothing.
    await endWarmup(db, id, null, T0 + 999 * S);
    expect((await getSession(db, id))!.warmupEndedAt).toBe(T0 + 480 * S);

    // A warm-up set: the first work set starts when it ends.
    await logWarmupSet(db, id, first, 20, 10, T0 + 520 * S);
    await logSet(db, id, first, 12, T0 + 600 * S);
    expect((await getSession(db, id))!.setStartedAt).toBeNull();
    // The rest ends at «Siguiente serie».
    await endRest(db, id, 'same', T0 + 780 * S);
    await logSet(db, id, first, 11, T0 + 830 * S);

    const sets = await listSets(db, id);
    expect(sets.map((s) => [s.isWarmup, s.startedAt, s.completedAt])).toEqual([
      [true, T0 + 480 * S, T0 + 520 * S],
      [false, T0 + 520 * S, T0 + 600 * S],
      [false, T0 + 780 * S, T0 + 830 * S],
    ]);
    // The rest planned after each work set, as it was that day (the seed's default is 150 s).
    const planned = first.restSeconds ?? (await getSettings(db)).restSecondsDefault;
    expect(sets.map((s) => s.restSeconds)).toEqual([null, planned, planned]);
  });

  it('opening an exercise starts its set unless one had started already', async () => {
    const db = await seeded();
    const routine = (await listRoutines(db))[0];
    const [first, second] = await listSlots(db, routine.id);
    const id = await startSession(db, routine.id, NOW);
    await openSlot(db, id, second.id, [], T0 + 60 * S);
    expect((await getSession(db, id))!).toMatchObject({ currentSlotId: second.id, setStartedAt: T0 });

    await logSet(db, id, second, 10, T0 + 120 * S);
    // The rest is left from the list: opening another exercise ends it now.
    await openSlot(db, id, first.id, [], T0 + 300 * S);
    expect((await getSession(db, id))!).toMatchObject({ currentSlotId: first.id, setStartedAt: T0 + 300 * S, restEndsAt: null });
  });

  it('a loose exercise starts its first set at once', async () => {
    const db = await seeded();
    const [slot] = await listSlots(db, (await listRoutines(db))[0].id);
    const id = (await startLooseSession(db, slot.id, NOW))!;
    expect((await getSession(db, id))!).toMatchObject({ setStartedAt: T0, warmupStartedAt: null });
  });

  it('finishing during the warm-up closes it', async () => {
    const db = await seeded();
    const routine = (await listRoutines(db))[0];
    await setRoutineWarmup(db, routine.id, true);
    const id = await startSession(db, routine.id, NOW);
    expect(await lastWarmupOf(db, routine.id)).toBeNull();
    await finishSession(db, id, toProgressionSettings(await getSettings(db)), T0 + 300 * S);
    expect((await getSession(db, id))!).toMatchObject({ status: 'finished', warmupEndedAt: T0 + 300 * S, setStartedAt: null });
    expect(await lastWarmupOf(db, routine.id)).toBe(300 * S);
  });

  it('restores a backup from before migration 11 without times', async () => {
    const db = await seeded();
    const backup = await exportBackup(db, NOW);
    for (const row of backup.tables.routine ?? []) delete row.warmup;
    for (const row of backup.tables.set_log ?? []) {
      delete row.started_at;
      delete row.rest_seconds;
    }
    for (const row of backup.tables.settings ?? []) delete row.muscle_map_mode;
    for (const row of backup.tables.workout_session ?? []) {
      delete row.warmup_started_at;
      delete row.warmup_ended_at;
      delete row.set_started_at;
    }
    await restoreBackup(db, { ...backup, schemaVersion: 10 });
    expect((await listRoutines(db)).every((r) => !r.warmup)).toBe(true);
    const sets = await db.getAllAsync<{ started_at: number | null }>('SELECT started_at FROM set_log');
    expect(sets.length).toBeGreaterThan(0);
    expect(sets.every((s) => s.started_at === null)).toBe(true);
    expect((await getSettings(db)).muscleMapMode).toBe('week');
    expect((await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))!.user_version).toBe(MIGRATIONS.length);
  });

  it('migrates a database of version 10', async () => {
    const db = await createTestDb({ upTo: 10 });
    await db.execAsync(MIGRATIONS[10]);
    const columns = async (table: string) =>
      (await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`)).map((c) => c.name);
    expect(await columns('routine')).toContain('warmup');
    expect(await columns('workout_session')).toEqual(expect.arrayContaining(['warmup_started_at', 'warmup_ended_at', 'set_started_at']));
    expect(await columns('set_log')).toEqual(expect.arrayContaining(['started_at', 'rest_seconds']));
    expect(await columns('settings')).toContain('muscle_map_mode');
  });
});
