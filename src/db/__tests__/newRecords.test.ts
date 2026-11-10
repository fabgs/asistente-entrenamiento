import { encodeRoute, type LatLon } from '@/domain/gps';
import { recordOf } from '@/domain/records';
import { routeLengthM } from '@/domain/routes';
import { LINE, LOOP, reversed, walkAlong, type Corner } from '@/domain/__tests__/routeFixtures';
import type { Db } from '../db';
import { DEMO_SEED } from '../demoSeed';
import { recordSetsOf, sessionRecordExercises, walkRecordText } from '../repositories/records';
import { linkToRepeatedRoute, saveWalkAsRoute } from '../repositories/routes';
import { listRoutines, listSlots, type Slot } from '../repositories/routines';
import { finishSession, logSet, logWarmupSet, startSession, updateSetReps } from '../repositories/sessions';
import { getSettings, toProgressionSettings } from '../repositories/settings';
import { importSeed } from '../seed';
import { createTestDb } from './testDb';

const DAY = 24 * 3_600_000;
const NOW = new Date(2026, 10, 9, 7, 0);

/** The demo data and «Curl bíceps barra Z»: two imported workouts at 20 kg, with 10 reps as its best set. */
async function seeded(): Promise<{ db: Db; slot: Slot; routineId: number }> {
  const db = await createTestDb();
  await importSeed(db, DEMO_SEED, NOW);
  const routine = (await listRoutines(db))[0];
  const slot = (await listSlots(db, routine.id)).find((s) => s.exerciseName.startsWith('Curl bíceps'))!;
  return { db, slot, routineId: routine.id };
}

/** A finished workout `days` after NOW with those reps of the slot. */
async function workout(db: Db, routineId: number, slot: Slot, days: number, reps: number[]): Promise<{ id: number; setIds: number[] }> {
  const at = new Date(NOW.getTime() + days * DAY);
  const id = await startSession(db, routineId, at);
  const setIds: number[] = [];
  for (const [i, r] of reps.entries()) setIds.push(await logSet(db, id, slot, r, at.getTime() + (i + 1) * 60_000));
  await finishSession(db, id, toProgressionSettings(await getSettings(db)), at.getTime() + 3_600_000);
  return { id, setIds };
}

describe('a new record, from the database', () => {
  it('compares a set with the finished workouts and the sets of this one, never with a warm-up', async () => {
    const { db, slot, routineId } = await seeded();
    expect(slot.weightKg).toBe(20);
    await workout(db, routineId, slot, 1, [10, 9, 9]);
    const id = await startSession(db, routineId, new Date(NOW.getTime() + 2 * DAY));
    await logWarmupSet(db, id, slot, 60, 20);

    const before = await recordSetsOf(db, slot.exerciseId, id);
    expect(new Set(before.map((s) => s.sessionId)).size).toBe(3);
    expect(before.every((s) => s.weightKg === 20)).toBe(true);
    expect(recordOf(before, { weightKg: 20, reps: 11 }, slot.unit, id)).toEqual({ kind: 'amountAtWeight', kg: 20, amount: 11, before: 10 });
    expect(recordOf(before, { weightKg: 20, reps: 10 }, slot.unit, id)).toBeNull();

    // After that set, the same again says nothing.
    await logSet(db, id, slot, 11);
    const after = await recordSetsOf(db, slot.exerciseId, id);
    expect(after).toHaveLength(before.length + 1);
    expect(recordOf(after, { weightKg: 20, reps: 11 }, slot.unit, id)).toBeNull();
  });

  it('with only the two imported workouts, nothing is a record yet', async () => {
    const { db, slot, routineId } = await seeded();
    const id = await startSession(db, routineId, NOW);
    expect(recordOf(await recordSetsOf(db, slot.exerciseId, id), { weightKg: 50, reps: 20 }, slot.unit, id)).toBeNull();
  });

  it('tags in its summary the workout that beat the best set, and a correction moves the tag', async () => {
    const { db, slot, routineId } = await seeded();
    const usual = await workout(db, routineId, slot, 1, [10, 9, 9]);
    const better = await workout(db, routineId, slot, 2, [10, 12, 9]);
    const later = await workout(db, routineId, slot, 3, [11, 10, 10]);
    expect(await sessionRecordExercises(db, usual.id)).toEqual([]);
    expect(await sessionRecordExercises(db, better.id)).toEqual([slot.exerciseId]);
    // 11 does not beat the 12 of the day before.
    expect(await sessionRecordExercises(db, later.id)).toEqual([]);

    await updateSetReps(db, better.setIds[1], 10);
    expect(await sessionRecordExercises(db, better.id)).toEqual([]);
    expect(await sessionRecordExercises(db, later.id)).toEqual([slot.exerciseId]);
    // An imported workout is the history: never tagged.
    const imported = await db.getFirstAsync<{ id: number }>('SELECT id FROM workout_session WHERE imported = 1 ORDER BY started_at DESC');
    expect(await sessionRecordExercises(db, imported!.id)).toEqual([]);
  });
});

describe('a record walk, from the database', () => {
  /** A finished walk on day `day` of November along `corners`, `minutes` long. */
  async function addWalk(db: Db, corners: Corner[], day: number, minutes: number, seed = 2): Promise<number> {
    const route: LatLon[][] = [walkAlong(corners, { seed })];
    const startedAt = new Date(2026, 10, day, 9, 0).getTime();
    const { lastInsertRowId } = await db.runAsync(
      `INSERT INTO cardio_session (name, date, tracking, status, started_at, finished_at, paused_ms, distance_m, route)
       VALUES ('Caminar', ?, 'gps', 'finished', ?, ?, 0, ?, ?)`,
      `2026-11-${String(day).padStart(2, '0')}`,
      startedAt,
      startedAt + minutes * 60_000,
      routeLengthM(route),
      encodeRoute(route),
    );
    return lastInsertRowId;
  }

  it('says the best time of the route it repeats, from the third time on', async () => {
    const db = await createTestDb();
    const first = await addWalk(db, LOOP, 1, 20);
    await saveWalkAsRoute(db, first, 'Manzana', NOW.getTime());
    const second = await addWalk(db, LOOP, 2, 19, 3);
    await linkToRepeatedRoute(db, second);
    // Faster than the only one before: «la otra vez», not yet a record.
    expect(await walkRecordText(db, second)).toBeNull();
    const third = await addWalk(db, reversed(LOOP), 3, 18, 4);
    await linkToRepeatedRoute(db, third);
    expect(await walkRecordText(db, third)).toBe('Nuevo récord en esta ruta · 18:00 · antes 19:00');
    const slower = await addWalk(db, LOOP, 4, 18.1, 5);
    await linkToRepeatedRoute(db, slower);
    expect(await walkRecordText(db, slower)).toBeNull();
  });

  it('says the longest walk of the activity when it repeats no route', async () => {
    const db = await createTestDb();
    for (const day of [1, 2, 3, 4, 5]) await addWalk(db, LOOP, day, 20, day);
    // The same block again is never the longest: its metres differ only by the GPS.
    expect(await walkRecordText(db, await addWalk(db, LOOP, 6, 20, 9))).toBeNull();
    const far: Corner[] = [...LINE, ...reversed(LINE).slice(1), ...LINE.slice(1)];
    const text = await walkRecordText(db, await addWalk(db, far, 7, 60));
    expect(text).toMatch(/^Nuevo récord de distancia · \d,\d\d km · antes 1,\d\d km$/);
    expect(await walkRecordText(db, 999)).toBeNull();
  });
});
