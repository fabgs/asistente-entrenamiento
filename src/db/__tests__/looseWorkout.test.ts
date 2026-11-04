import type { Db } from '../db';
import { archiveSlot, listRoutines, listSlots, type Slot } from '../repositories/routines';
import {
  addLooseExercise,
  finishedSessionsOn,
  finishSession,
  getSession,
  lastReps,
  listFinishedSessions,
  listSets,
  logSet,
  logWarmupSet,
  openNextSet,
  sessionSlots,
  startLooseSession,
  startSession,
  updateSessionState,
} from '../repositories/sessions';
import { getSettings, toProgressionSettings } from '../repositories/settings';
import { listChangesForSession, listOpenChanges } from '../repositories/weightChanges';
import { DEMO_SEED } from '../demoSeed';
import { importSeed } from '../seed';
import { createTestDb } from './testDb';

const NOW = new Date(2026, 10, 2, 7, 0);
const T0 = NOW.getTime();

async function seededDb(): Promise<Db> {
  const db = await createTestDb();
  await importSeed(db, DEMO_SEED, NOW);
  return db;
}

async function day1Slot(db: Db, name: string): Promise<Slot> {
  const routine = (await listRoutines(db))[0];
  return (await listSlots(db, routine.id)).find((s) => s.exerciseName === name)!;
}

const remo = (db: Db) => day1Slot(db, 'Remo con barra (90º)');
const floor = (db: Db) => day1Slot(db, 'Floor Press con barra');
const finish = async (db: Db, id: number, at = T0 + 3_600_000) =>
  finishSession(db, id, toProgressionSettings(await getSettings(db)), at);
const slotsOf = async (db: Db, id: number) => {
  const session = (await getSession(db, id))!;
  return (await sessionSlots(db, session, await listSets(db, id))).map((s) => s.id);
};

/** The remo in its routine, finished: [14,14,14] leaves «Subir a 37,5 kg» pending. */
async function trainRemoInRoutine(db: Db, reps: number[], at: number): Promise<number> {
  const slot = await remo(db);
  const id = await startSession(db, slot.routineId, new Date(at));
  for (const [i, r] of reps.entries()) await logSet(db, id, slot, r, at + i);
  await finish(db, id, at + 100);
  return id;
}

async function looseRemo(db: Db, reps: number[], at: number): Promise<number> {
  const slot = await remo(db);
  const id = (await startLooseSession(db, slot.id, new Date(at)))!;
  for (const [i, r] of reps.entries()) await logSet(db, id, slot, r, at + i);
  await finish(db, id, at + 100);
  return id;
}

describe('loose workouts', () => {
  it('start on one exercise, outside any routine, and only with no other workout running', async () => {
    const db = await seededDb();
    const slot = await remo(db);
    const id = (await startLooseSession(db, slot.id, NOW))!;
    expect(await getSession(db, id)).toMatchObject({
      routineId: null,
      currentSlotId: slot.id,
      looseFirst: 'Remo con barra (90º)',
      looseCount: 0,
      status: 'in_progress',
    });
    expect(await startLooseSession(db, slot.id, NOW)).toBeNull();
  });

  it('are made of the exercises with sets and the one in course', async () => {
    const db = await seededDb();
    const r = await remo(db);
    const f = await floor(db);
    const id = (await startLooseSession(db, r.id, NOW))!;
    expect(await slotsOf(db, id)).toEqual([r.id]);
    await logSet(db, id, r, 12, T0 + 1);
    expect(await addLooseExercise(db, id, f.id)).toBe(true);
    expect(await slotsOf(db, id)).toEqual([r.id, f.id]);
    // Leaving the second one without sets drops it.
    await updateSessionState(db, id, { currentSlotId: null });
    expect(await slotsOf(db, id)).toEqual([r.id]);
    // Warm-ups alone keep an exercise in.
    await addLooseExercise(db, id, f.id);
    await logWarmupSet(db, id, f, 20, 10, T0 + 2);
    await updateSessionState(db, id, { currentSlotId: null });
    expect(await slotsOf(db, id)).toEqual([r.id, f.id]);
  });

  it('do not take another exercise while resting, nor do routine workouts', async () => {
    const db = await seededDb();
    const r = await remo(db);
    const f = await floor(db);
    const id = (await startLooseSession(db, r.id, NOW))!;
    await updateSessionState(db, id, { restEndsAt: T0 + 90_000 });
    expect(await addLooseExercise(db, id, f.id)).toBe(false);
    await finish(db, id);
    const routineId = await startSession(db, r.routineId, NOW);
    expect(await addLooseExercise(db, routineId, f.id)).toBe(false);
  });

  it('open the set to do next', async () => {
    const db = await seededDb();
    const r = await remo(db);
    const id = (await startLooseSession(db, r.id, NOW))!;
    await updateSessionState(db, id, { currentSlotId: null });
    await logSet(db, id, r, 12, T0 + 1);
    await openNextSet(db, id);
    expect((await getSession(db, id))!.currentSlotId).toBe(r.id);
    for (let i = 2; i <= 3; i++) await logSet(db, id, r, 12, T0 + i);
    await updateSessionState(db, id, { currentSlotId: null });
    await openNextSet(db, id);
    expect((await getSession(db, id))!.currentSlotId).toBeNull();
  });

  it('count for their exercise, but a keep never wipes the routine\'s pending suggestion', async () => {
    const db = await seededDb();
    const r = await remo(db);
    await trainRemoInRoutine(db, [14, 14, 14], T0);
    const pending = (await listOpenChanges(db)).find((c) => c.slotId === r.id && c.status === 'pending')!;
    expect(pending.toKg).toBe(37.5);

    // One loose set (incomplete: a keep) leaves it alone.
    await looseRemo(db, [14], T0 + 86_400_000);
    expect((await listOpenChanges(db)).find((c) => c.slotId === r.id)?.id).toBe(pending.id);
    expect(await lastReps(db, r.id)).toEqual([14]);

    // A full loose session above the range proposes again, from itself.
    const loose = await looseRemo(db, [14, 14, 14], T0 + 2 * 86_400_000);
    const open = (await listOpenChanges(db)).filter((c) => c.slotId === r.id);
    expect(open).toHaveLength(1);
    expect(open[0].sessionId).toBe(loose);
    expect((await listChangesForSession(db, loose)).map((c) => c.toKg)).toEqual([37.5]);
  });

  it('still lets a routine workout expire a suggestion (no regression)', async () => {
    const db = await seededDb();
    const r = await remo(db);
    await trainRemoInRoutine(db, [14, 14, 14], T0);
    await trainRemoInRoutine(db, [11, 11, 11], T0 + 86_400_000);
    expect((await listOpenChanges(db)).some((c) => c.slotId === r.id)).toBe(false);
  });

  it('keep the sets of an exercise removed from its routine, without proposing for it', async () => {
    const db = await seededDb();
    const r = await remo(db);
    const id = (await startLooseSession(db, r.id, NOW))!;
    for (let i = 1; i <= 3; i++) await logSet(db, id, r, 15, T0 + i);
    await archiveSlot(db, r.id);
    expect(await slotsOf(db, id)).toEqual([r.id]);
    await finish(db, id);
    expect(await listChangesForSession(db, id)).toEqual([]);
  });

  it('with nothing done are discarded when finished', async () => {
    const db = await seededDb();
    const id = (await startLooseSession(db, (await remo(db)).id, NOW))!;
    expect(await finish(db, id)).toBe('discarded');
    expect(await getSession(db, id)).toBeNull();
  });

  it('show among the workouts of the day, named after their first exercise', async () => {
    const db = await seededDb();
    const r = await remo(db);
    const f = await floor(db);
    await trainRemoInRoutine(db, [12, 12, 12], T0);
    const id = (await startLooseSession(db, r.id, new Date(T0 + 1000)))!;
    await logSet(db, id, r, 12, T0 + 1001);
    await addLooseExercise(db, id, f.id);
    await logSet(db, id, f, 12, T0 + 1002);
    await finish(db, id, T0 + 2000);
    await trainRemoInRoutine(db, [12, 12, 12], T0 + 3000);
    const done = await finishedSessionsOn(db, '2026-11-02');
    expect(done.map((s) => [s.routineId === null, s.looseFirst, s.looseCount])).toEqual([
      [false, null, 0],
      [true, 'Remo con barra (90º)', 2],
      [false, null, 0],
    ]);
    expect((await listFinishedSessions(db)).find((s) => s.id === id)?.looseFirst).toBe('Remo con barra (90º)');
  });
});
