import { CATALOG_MUSCLES, setsPerMuscle, totalSets } from '@/domain/muscles';
import type { Db } from '../db';
import { exportBackup, restoreBackup } from '../maintenance';
import { migrate } from '../migrations';
import { DEMO_SEED } from '../demoSeed';
import {
  allExerciseMuscles,
  getExerciseMuscles,
  loadMuscleWeek,
  plannedWeekSets,
  setExerciseMuscles,
  workSetsBetween,
  workSetsOfSession,
} from '../repositories/muscles';
import { archiveSlot, listRoutines, listSlots, setRoutineWeekdays } from '../repositories/routines';
import { finishSession, logSet, logWarmupSet, startSession } from '../repositories/sessions';
import { getSettings, toProgressionSettings } from '../repositories/settings';
import { importSeed } from '../seed';
import { SEED } from '../seedData';
import { createTestDb } from './testDb';

const NOW = new Date(2026, 10, 2, 7, 0); // Monday
const WEEK = ['2026-11-02', '2026-11-08'] as const;

async function demoDb(): Promise<Db> {
  const db = await createTestDb();
  await importSeed(db, DEMO_SEED, NOW);
  return db;
}

const idOf = async (db: Db, name: string) =>
  (await db.getFirstAsync<{ id: number }>('SELECT id FROM exercise WHERE name = ?', name))!.id;

describe('exercise muscles', () => {
  it('come with every catalog exercise on a new install', async () => {
    expect(CATALOG_MUSCLES.map(([name]) => name).sort()).toEqual(SEED.exercises.map((e) => e.name).sort());
    const db = await createTestDb();
    await importSeed(db, SEED, NOW);
    const muscles = await allExerciseMuscles(db);
    expect(muscles.size).toBe(22);
    expect(await getExerciseMuscles(db, await idOf(db, 'Remo con barra (90º)'))).toEqual({
      primary: ['lats', 'upper_back'],
      secondary: ['lower_back', 'rear_delts', 'biceps'],
    });
  });

  it('are added by migration 9 to the catalog exercises, not to renamed or new ones', async () => {
    const db = await createTestDb({ upTo: 8 });
    await db.runAsync("INSERT INTO exercise (name, type) VALUES ('Dominadas pronas', 'bodyweight')");
    await db.runAsync("INSERT INTO exercise (name, type) VALUES ('Dominadas (las mías)', 'bodyweight')");
    await db.runAsync("INSERT INTO exercise (name, type) VALUES ('toes to BAR', 'bodyweight')");
    await migrate(db);
    const muscles = await allExerciseMuscles(db);
    expect(muscles.get(1)).toEqual({ primary: ['lats'], secondary: ['upper_back', 'biceps'] });
    expect(muscles.has(2)).toBe(false);
    expect(muscles.get(3)).toEqual({ primary: ['abs'], secondary: ['obliques'] });
  });

  it('are replaced as the editor saves them', async () => {
    const db = await demoDb();
    const id = await idOf(db, 'Toes to bar');
    await setExerciseMuscles(db, id, { primary: ['abs', 'obliques'], secondary: ['lats', 'abs'] });
    expect(await getExerciseMuscles(db, id)).toEqual({ primary: ['abs', 'obliques'], secondary: ['lats'] });
    await setExerciseMuscles(db, id, { primary: [], secondary: [] });
    expect(await getExerciseMuscles(db, id)).toEqual({ primary: [], secondary: [] });
  });

  it('travel in backups: a new one keeps the edits, an old one gets the catalog muscles', async () => {
    const source = await demoDb();
    const id = await idOf(source, 'Toes to bar');
    await setExerciseMuscles(source, id, { primary: ['obliques'], secondary: [] });
    const backup = await exportBackup(source, NOW);
    expect(backup.tables.exercise_muscle?.length).toBeGreaterThan(22);

    const target = await createTestDb();
    await restoreBackup(target, backup);
    expect(await getExerciseMuscles(target, id)).toEqual({ primary: ['obliques'], secondary: [] });

    const old = { ...backup, schemaVersion: 8, tables: { ...backup.tables, exercise_muscle: undefined } };
    await restoreBackup(target, old);
    expect(await getExerciseMuscles(target, id)).toEqual({ primary: ['abs'], secondary: ['obliques'] });
  });
});

describe('sets per muscle', () => {
  it('plans the Excel week: sets times days, without removed slots', async () => {
    const db = await demoDb();
    const planned = setsPerMuscle(await plannedWeekSets(db), await allExerciseMuscles(db));
    // Fondos lastrados 3 + Floor Press 2 + Fondos 3 + Arqueras 2, and Diamond 2 × 0,5.
    expect(planned.chest).toBe(11);
    expect(planned.hamstrings).toBe(6);
    expect(planned.calves).toBe(6);
    expect(planned.rear_delts).toBe(3.5);

    const torso = (await listRoutines(db))[0];
    const floor = (await listSlots(db, torso.id)).find((s) => s.exerciseName === 'Floor Press con barra')!;
    await archiveSlot(db, floor.id, NOW.getTime());
    await setRoutineWeekdays(db, torso.id, [1, 4]);
    const after = setsPerMuscle(await plannedWeekSets(db), await allExerciseMuscles(db));
    // Without Floor Press (−2) and the Monday torso twice a week (+3 + 3 + 1 more).
    expect(after.chest).toBe(11 - 2 + 3 + 1);
  });

  it('counts the work sets of finished workouts in the week, not warm-ups or the one in progress', async () => {
    const db = await demoDb();
    const torso = (await listRoutines(db))[0];
    const floor = (await listSlots(db, torso.id)).find((s) => s.exerciseName === 'Floor Press con barra')!;
    const settings = toProgressionSettings(await getSettings(db));

    const done = await startSession(db, torso.id, NOW);
    await logWarmupSet(db, done, floor, 20, 10, NOW.getTime());
    await logSet(db, done, floor, 12, NOW.getTime() + 1);
    await logSet(db, done, floor, 11, NOW.getTime() + 2);
    await finishSession(db, done, settings, NOW.getTime() + 3_600_000);

    const open = await startSession(db, torso.id, NOW);
    await logSet(db, open, floor, 12, NOW.getTime() + 4_000_000);

    expect(await workSetsBetween(db, ...WEEK)).toEqual([{ exerciseId: floor.exerciseId, sets: 2 }]);
    // The Excel import left the Monday torso of two weeks ago, with Floor Press done in 2 sets.
    const before = await workSetsBetween(db, '2026-10-19', '2026-10-25');
    expect(before.find((s) => s.exerciseId === floor.exerciseId)?.sets).toBe(2);

    // One workout, for its silhouette: the same sets, without its warm-up.
    expect(await workSetsOfSession(db, done)).toEqual([{ exerciseId: floor.exerciseId, sets: 2 }]);
    const sessionMuscles = setsPerMuscle(await workSetsOfSession(db, done), await allExerciseMuscles(db));
    expect(sessionMuscles.chest).toBe(2);
    expect(sessionMuscles.triceps).toBe(1);
  });

  it('loads the week: done, plan, last week and the exercises that count nowhere', async () => {
    const db = await demoDb();
    const torso = (await listRoutines(db))[0];
    const slots = await listSlots(db, torso.id);
    await setExerciseMuscles(db, slots[0].exerciseId, { primary: [], secondary: [] });
    // Deleted from the catalog: it cannot be fixed from there, so it is not listed.
    await setExerciseMuscles(db, slots[1].exerciseId, { primary: [], secondary: [] });
    await db.runAsync('UPDATE exercise SET archived = 1 WHERE id = ?', slots[1].exerciseId);

    const week = await loadMuscleWeek(db, '2026-11-11'); // a week after NOW: the import's latest week is behind
    expect(week.done).toEqual([]);
    expect(totalSets(week.planned)).toBe(65);
    expect(week.lastWeek).toBe(0);
    expect(week.unmapped).toEqual([slots[0].exerciseId]);
    expect(week.names.get(slots[0].exerciseId)).toBe(slots[0].exerciseName);

    // The import's sessions of one week ago fall in the week before 2026-11-02.
    expect((await loadMuscleWeek(db, '2026-11-02')).lastWeek).toBeGreaterThan(0);
  });
});

describe('«Últimos días»', () => {
  it('knows the last day each muscle worked, as primary or only as secondary', async () => {
    const db = await createTestDb();
    await importSeed(db, SEED, NOW);
    const routineId = (await db.runAsync("INSERT INTO routine (name, position) VALUES ('Torso', 0)")).lastInsertRowId;
    const remo = await idOf(db, 'Remo con barra (90º)'); // lats, upper back; secondary lower back, rear delts, biceps
    await db.runAsync(
      `INSERT INTO routine_slot (routine_id, exercise_id, position, weight_kg, sets, target_kind, rep_min, rep_max)
       VALUES (?, ?, 0, 35, 3, 'range', 10, 12)`,
      routineId,
      remo,
    );
    const [slot] = await listSlots(db, routineId);
    const settings = toProgressionSettings(await getSettings(db));

    const saturday = new Date(2026, 10, 7, 9, 0);
    const id = await startSession(db, routineId, saturday);
    await logWarmupSet(db, id, slot, 20, 10, saturday.getTime() + 1);
    await logSet(db, id, slot, 12, saturday.getTime() + 2);
    await finishSession(db, id, settings, saturday.getTime() + 3);
    // An unfinished workout today does not count.
    await logSet(db, await startSession(db, routineId, new Date(2026, 10, 9, 7, 0)), slot, 12);

    const week = await loadMuscleWeek(db, '2026-11-09');
    expect(week.lastWorked.lats).toEqual({ date: '2026-11-07', secondaryOnly: false });
    expect(week.lastWorked.biceps).toEqual({ date: '2026-11-07', secondaryOnly: true });
    expect(week.lastWorked.quads).toBeUndefined();
    expect(week.lastWorkout).toBe('2026-11-07');
    // A day before it, nothing yet.
    expect((await loadMuscleWeek(db, '2026-11-06')).lastWorked).toEqual({});
  });
});
