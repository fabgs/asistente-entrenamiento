import { archiveExercise, createExercise, isExerciseArchived, listArchivedExercises, listExercises, restoreExercise } from '../repositories/exercises';
import { exerciseUnit } from '../repositories/progress';
import { getSlot, listRoutines, listSlots, LOOSE_ROUTINE, looseSlotFor, updateSlotPrescription } from '../repositories/routines';
import { finishSession, logSet, startLooseSession } from '../repositories/sessions';
import { getSettings, toProgressionSettings } from '../repositories/settings';
import { DEMO_SEED } from '../demoSeed';
import { importSeed } from '../seed';
import { createTestDb } from './testDb';

const NOW = new Date(2026, 10, 6, 9, 0);
const T0 = NOW.getTime();

async function seededDb() {
  const db = await createTestDb();
  await importSeed(db, DEMO_SEED, NOW);
  return db;
}

const exerciseNamed = async (db: Awaited<ReturnType<typeof seededDb>>, name: string) =>
  (await listExercises(db)).find((e) => e.name === name)!;

describe('loose exercise from the catalog', () => {
  it('uses its slot of an active routine', async () => {
    const db = await seededDb();
    const remo = await exerciseNamed(db, 'Remo con barra (90º)');
    const slot = (await getSlot(db, await looseSlotFor(db, remo)))!;
    expect(slot.exerciseId).toBe(remo.id);
    expect(slot.looseOnly).toBe(false);
    expect((await listRoutines(db)).map((r) => r.id)).toContain(slot.routineId);
  });

  it('gives an exercise in no routine its own slot, once, in a hidden routine', async () => {
    const db = await seededDb();
    const id = await createExercise(db, { name: 'Press militar', type: 'external', equipment: null, incrementKg: null, notes: null, pair: false });
    const exercise = { id, type: 'external' as const };
    const first = await looseSlotFor(db, exercise);
    expect(await looseSlotFor(db, exercise)).toBe(first);
    const slot = (await getSlot(db, first))!;
    // Hidden: not among the routines, so not in Rutinas, Hoy or the plan of the week.
    expect((await listRoutines(db)).map((r) => r.id)).not.toContain(slot.routineId);
    const hidden = await db.getFirstAsync<{ name: string; archived: number }>('SELECT name, archived FROM routine WHERE id = ?', slot.routineId);
    expect(hidden).toEqual({ name: LOOSE_ROUTINE, archived: 1 });
    // The workout says «Editar series y peso», not «de la rutina».
    expect(slot.looseOnly).toBe(true);

    // Done loose, its weight stays for the next time.
    const session = (await startLooseSession(db, first, NOW))!;
    await logSet(db, session, { ...slot, weightKg: 40 }, 10, T0 + 1);
    await finishSession(db, session, toProgressionSettings(await getSettings(db)), T0 + 1000);
    const other = await createExercise(db, { name: 'Jalón al pecho', type: 'external', equipment: null, incrementKg: null, notes: null, pair: false });
    const jalon = (await getSlot(db, await looseSlotFor(db, { id: other, type: 'external' })))!;
    expect(jalon.routineId).toBe(slot.routineId);
    expect(jalon.weightKg).toBe(0);
  });

  it('starts from the heaviest set of the last time, not the back-off set', async () => {
    const db = await seededDb();
    const remo = await exerciseNamed(db, 'Remo con barra (90º)');
    const routineSlot = (await getSlot(db, await looseSlotFor(db, remo)))!;
    const session = (await startLooseSession(db, routineSlot.id, NOW))!;
    await logSet(db, session, { ...routineSlot, weightKg: 42.5 }, 10, T0 + 1);
    await logSet(db, session, { ...routineSlot, weightKg: 35 }, 12, T0 + 2);
    await finishSession(db, session, toProgressionSettings(await getSettings(db)), T0 + 1000);
    // Taken out of its routine, it gets its own slot with that weight.
    await db.runAsync('UPDATE routine_slot SET archived = 1 WHERE exercise_id = ?', remo.id);
    const own = (await getSlot(db, await looseSlotFor(db, remo)))!;
    expect(own.weightKg).toBe(42.5);
  });

  it('never borrows a slot of another archived routine (imported history)', async () => {
    const db = await seededDb();
    const id = await createExercise(db, { name: 'Jaca', type: 'external', equipment: null, incrementKg: null, notes: null, pair: false });
    const old = (await db.runAsync('INSERT INTO routine (name, position, archived) VALUES (?, 99, 1)', 'Notas antiguas')).lastInsertRowId;
    await db.runAsync(
      `INSERT INTO routine_slot (routine_id, exercise_id, position, sets, target_kind, failure_minus, progression, archived)
       VALUES (?, ?, 0, 3, 'failure', 0, 'manual', 1)`,
      old,
      id,
    );
    const slot = (await getSlot(db, await looseSlotFor(db, { id, type: 'external' })))!;
    expect(slot.routineId).not.toBe(old);
  });
});

describe('archived exercises', () => {
  it('are listed apart and can come back to the catalog', async () => {
    const db = await seededDb();
    const remo = await exerciseNamed(db, 'Remo con barra (90º)');
    await archiveExercise(db, remo.id);
    expect((await listExercises(db)).map((e) => e.id)).not.toContain(remo.id);
    expect((await listArchivedExercises(db)).map((e) => e.name)).toEqual(['Remo con barra (90º)']);
    expect(await isExerciseArchived(db, remo.id)).toBe(true);
    await restoreExercise(db, remo.id);
    expect(await isExerciseArchived(db, remo.id)).toBe(false);
    expect(await listArchivedExercises(db)).toEqual([]);
  });
});

describe('exercise unit', () => {
  it('is that of the slots it was done with, reps by default', async () => {
    const db = await seededDb();
    const remo = await exerciseNamed(db, 'Remo con barra (90º)');
    expect(await exerciseUnit(db, remo.id)).toBe('reps');
    const slot = (await listSlots(db, (await listRoutines(db))[0].id)).find((s) => s.exerciseId === remo.id)!;
    await updateSlotPrescription(db, slot.id, { ...slot, unit: 'seconds' });
    expect(await exerciseUnit(db, remo.id)).toBe('seconds');
    const id = await createExercise(db, { name: 'Plancha', type: 'bodyweight', equipment: null, incrementKg: null, notes: null, pair: false });
    expect(await exerciseUnit(db, id)).toBe('reps');
  });
});
