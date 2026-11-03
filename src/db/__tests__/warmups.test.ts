import type { Db } from '../db';
import { exerciseSessions, exercisesWithHistory } from '../repositories/progress';
import { listRoutines, listSlots, type Slot } from '../repositories/routines';
import {
  deleteSet,
  finishSession,
  finishedRoutinesOn,
  getSession,
  lastWarmups,
  listFinishedSessions,
  listSets,
  logSet,
  logWarmupSet,
  openNextSet,
  restoreSet,
  setSessionTitle,
  slotHistory,
  startSession,
  updateSessionState,
} from '../repositories/sessions';
import { getSettings, toProgressionSettings } from '../repositories/settings';
import { listChangesForSession, listOpenChanges } from '../repositories/weightChanges';
import { DEMO_SEED } from '../demoSeed';
import { importSeed } from '../seed';
import { createTestDb } from './testDb';

const NOW = new Date(2026, 10, 2, 7, 0); // Monday

async function seededDb(): Promise<Db> {
  const db = await createTestDb();
  await importSeed(db, DEMO_SEED, NOW);
  return db;
}

const floorPress = async (db: Db): Promise<Slot> => {
  const routine = (await listRoutines(db))[0];
  return (await listSlots(db, routine.id)).find((s) => s.exerciseName === 'Floor Press con barra')!;
};

const finish = async (db: Db, sessionId: number) =>
  finishSession(db, sessionId, toProgressionSettings(await getSettings(db)), NOW.getTime() + 3_600_000);

describe('warm-up sets', () => {
  it('are kept apart: they never count as sets, volume, records or progression', async () => {
    const db = await seededDb();
    const floor = await floorPress(db); // 35 kg, 2 × 10–15; the import left "↑ 37,5 kg" pending
    const sessionId = await startSession(db, floor.routineId, NOW);
    await logWarmupSet(db, sessionId, floor, 20, 10, 1);
    await logWarmupSet(db, sessionId, floor, 30, 5, 2);
    await logSet(db, sessionId, floor, 12, 3);
    await logSet(db, sessionId, floor, 12, 4);

    const sets = await listSets(db, sessionId);
    expect(sets.map((s) => [s.isWarmup, s.setIndex, s.weightKg, s.reps, s.isExtra])).toEqual([
      [true, 1, 20, 10, false],
      [true, 2, 30, 5, false],
      [false, 1, 35, 12, false],
      [false, 2, 35, 12, false],
    ]);

    await finish(db, sessionId);
    // Only 12 + 12 at 35 kg count: in range, so no change and the old suggestion expires.
    expect(await listChangesForSession(db, sessionId)).toHaveLength(0);
    expect((await listOpenChanges(db)).some((c) => c.slotId === floor.id)).toBe(false);
    expect((await slotHistory(db, floor.id, 1))[0]).toMatchObject({ weightKg: 35, reps: [12, 12] });
    expect((await listFinishedSessions(db)).find((s) => s.id === sessionId)?.setCount).toBe(2);
    expect((await finishedRoutinesOn(db, '2026-11-02')).get(floor.routineId)?.setCount).toBe(2);
    expect((await exerciseSessions(db, floor.exerciseId))[0].sets).toEqual([
      { weightKg: 35, reps: 12 },
      { weightKg: 35, reps: 12 },
    ]);
  });

  it('alone do not make an exercise trained', async () => {
    const db = await seededDb();
    const floor = await floorPress(db);
    const sessionId = await startSession(db, floor.routineId, NOW);
    await logWarmupSet(db, sessionId, floor, 20, 10, 1);
    await finish(db, sessionId);
    expect((await listOpenChanges(db)).find((c) => c.slotId === floor.id)?.status).toBe('pending');
    const overview = (await exercisesWithHistory(db)).find((e) => e.id === floor.exerciseId)!;
    expect(overview.lastDate).not.toBe('2026-11-02');
  });

  it('are proposed again from the last session that had them', async () => {
    const db = await seededDb();
    const floor = await floorPress(db);
    expect(await lastWarmups(db, floor.id)).toEqual([]);
    const first = await startSession(db, floor.routineId, NOW);
    await logWarmupSet(db, first, floor, 20, 10, 1);
    await logWarmupSet(db, first, floor, 30, 5, 2);
    await logSet(db, first, floor, 12, 3);
    await finish(db, first);
    // A later session without warm-ups does not hide them.
    const second = await startSession(db, floor.routineId, new Date(NOW.getTime() + 86_400_000));
    await logSet(db, second, floor, 12, 86_400_000);
    await finish(db, second);
    expect(await lastWarmups(db, floor.id)).toEqual([
      { weightKg: 20, reps: 10 },
      { weightKg: 30, reps: 5 },
    ]);
  });

  it('are numbered apart from the working sets when one is deleted', async () => {
    const db = await seededDb();
    const floor = await floorPress(db);
    const sessionId = await startSession(db, floor.routineId, NOW);
    const first = await logWarmupSet(db, sessionId, floor, 20, 10, 1);
    await logSet(db, sessionId, floor, 12, 2);
    await logWarmupSet(db, sessionId, floor, 30, 5, 3);
    await deleteSet(db, first);
    expect((await listSets(db, sessionId)).map((s) => [s.isWarmup, s.setIndex])).toEqual([
      [false, 1],
      [true, 1],
    ]);
  });
});

describe('undo', () => {
  it('puts a deleted set back with the same number and time', async () => {
    const db = await seededDb();
    const floor = await floorPress(db);
    const sessionId = await startSession(db, floor.routineId, NOW);
    for (const [reps, t] of [[12, 1], [11, 2], [10, 3]]) await logSet(db, sessionId, floor, reps, t);
    const second = (await listSets(db, sessionId))[1];
    await deleteSet(db, second.id);
    expect((await listSets(db, sessionId)).map((s) => s.setIndex)).toEqual([1, 2]);
    await restoreSet(db, second);
    expect(await listSets(db, sessionId)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: second.id, setIndex: 2, reps: 11, completedAt: 2 })]),
    );
    expect((await listSets(db, sessionId)).map((s) => s.reps)).toEqual([12, 11, 10]);
  });
});

describe('session titles', () => {
  it('are saved trimmed and an empty one goes back to the routine name', async () => {
    const db = await seededDb();
    const floor = await floorPress(db);
    const sessionId = await startSession(db, floor.routineId, NOW);
    await setSessionTitle(db, sessionId, '  Torso pesado ');
    expect((await getSession(db, sessionId))?.title).toBe('Torso pesado');
    await setSessionTitle(db, sessionId, ' ');
    expect((await getSession(db, sessionId))?.title).toBeNull();
  });
});

describe('opening a workout', () => {
  it('goes straight to the first set, and back to the exercise in progress after the list', async () => {
    const db = await seededDb();
    const floor = await floorPress(db);
    const slots = await listSlots(db, floor.routineId);
    const sessionId = await startSession(db, floor.routineId, NOW);
    await openNextSet(db, sessionId);
    expect((await getSession(db, sessionId))?.currentSlotId).toBe(slots[0].id);

    await logSet(db, sessionId, slots[0], 10, 1);
    await updateSessionState(db, sessionId, { currentSlotId: null });
    await openNextSet(db, sessionId);
    expect((await getSession(db, sessionId))?.currentSlotId).toBe(slots[0].id);
  });

  it('leaves the rest as it is', async () => {
    const db = await seededDb();
    const floor = await floorPress(db);
    const sessionId = await startSession(db, floor.routineId, NOW);
    await updateSessionState(db, sessionId, { currentSlotId: floor.id, restEndsAt: 123 });
    await openNextSet(db, sessionId);
    expect(await getSession(db, sessionId)).toMatchObject({ currentSlotId: floor.id, restEndsAt: 123 });
  });
});
