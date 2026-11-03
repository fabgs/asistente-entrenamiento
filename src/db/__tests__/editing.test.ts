import seedJson from '../../../data/seed/seed.json';
import type { Db } from '../db';
import { addCardio, archiveCardio, cardioForWeekday, updateCardio } from '../repositories/cardio';
import {
  archiveExercise,
  createExercise,
  exerciseNameTaken,
  listExercises,
} from '../repositories/exercises';
import {
  addSlot,
  archiveRoutine,
  archiveSlot,
  createRoutine,
  getSlot,
  listRoutines,
  listSlots,
  moveSlot,
  renameRoutine,
  routinesForWeekday,
  setRoutineWeekdays,
  updateSlotPrescription,
} from '../repositories/routines';
import { listSets, logSet, startSession } from '../repositories/sessions';
import { deleteWeight, latestWeight, listWeights, logWeight } from '../repositories/settings';
import { listOpenChanges } from '../repositories/weightChanges';
import { exportBackup, restoreBackup } from '../maintenance';
import { importSeed } from '../seed';
import type { SeedData } from '../seedTypes';
import { createTestDb } from './testDb';

const NOW = new Date(2026, 10, 2, 7, 0);

async function seededDb(): Promise<Db> {
  const db = await createTestDb();
  await importSeed(db, seedJson as SeedData, NOW);
  return db;
}

describe('routine editing', () => {
  it('creates a routine, renames it and assigns weekdays', async () => {
    const db = await seededDb();
    const id = await createRoutine(db, 'Nueva rutina');
    await renameRoutine(db, id, 'Día 5: Brazos');
    await setRoutineWeekdays(db, id, [3, 6, 3]);
    expect((await listRoutines(db)).at(-1)).toMatchObject({ id, name: 'Día 5: Brazos', weekdays: [3, 6] });
    expect((await routinesForWeekday(db, 3)).map((r) => r.id)).toEqual([id]);
  });

  it('archives a routine and frees its weekdays', async () => {
    const db = await seededDb();
    const monday = (await routinesForWeekday(db, 1))[0];
    await archiveRoutine(db, monday.id);
    expect(await routinesForWeekday(db, 1)).toEqual([]);
    expect((await listRoutines(db)).some((r) => r.id === monday.id)).toBe(false);
  });

  it('adds an exercise at the end with a default prescription', async () => {
    const db = await seededDb();
    const routine = (await listRoutines(db))[0];
    const exerciseId = await createExercise(db, {
      name: 'Press militar',
      type: 'external',
      equipment: 'barra',
      incrementKg: null,
      notes: null,
      pair: false,
    });
    const slotId = await addSlot(db, routine.id, { id: exerciseId, type: 'external' });
    const slots = await listSlots(db, routine.id);
    expect(slots.at(-1)).toMatchObject({
      id: slotId,
      exerciseName: 'Press militar',
      weightKg: 0,
      sets: 3,
      target: { kind: 'range', min: 8, max: 12 },
      progression: 'load',
    });
  });

  it('updates the prescription without touching the weight', async () => {
    const db = await seededDb();
    const slot = (await listSlots(db, (await listRoutines(db))[0].id))[0];
    await updateSlotPrescription(db, slot.id, {
      sets: 4,
      target: { kind: 'fixed', reps: 6 },
      perSide: true,
      unit: 'reps',
      progression: 'manual',
      allowDecrease: false,
      incrementKg: 1.25,
      restSeconds: 180,
      note: 'Pausa abajo',
    });
    expect(await getSlot(db, slot.id)).toMatchObject({
      weightKg: slot.weightKg,
      sets: 4,
      target: { kind: 'fixed', reps: 6 },
      perSide: true,
      progression: 'manual',
      allowDecrease: false,
      incrementKg: 1.25,
      restSeconds: 180,
      note: 'Pausa abajo',
    });
  });

  it('reorders exercises', async () => {
    const db = await seededDb();
    const routineId = (await listRoutines(db))[0].id;
    const [first, second] = await listSlots(db, routineId);
    await moveSlot(db, second.id, -1);
    expect((await listSlots(db, routineId)).slice(0, 2).map((s) => s.id)).toEqual([second.id, first.id]);
    await moveSlot(db, second.id, -1); // already first: no-op
    expect((await listSlots(db, routineId))[0].id).toBe(second.id);
  });

  it('removes an exercise but keeps its sets and drops its suggestion', async () => {
    const db = await seededDb();
    const routine = (await listRoutines(db))[0];
    const remo = (await listSlots(db, routine.id)).find((s) => s.exerciseName === 'Remo con barra (90º)')!;
    const sessionId = await startSession(db, routine.id, NOW);
    await logSet(db, sessionId, remo, 12);

    await archiveSlot(db, remo.id);
    expect((await listSlots(db, routine.id)).some((s) => s.id === remo.id)).toBe(false);
    expect((await listSets(db, sessionId)).map((s) => s.slotId)).toEqual([remo.id]);
    expect((await listOpenChanges(db)).some((c) => c.slotId === remo.id)).toBe(false);
  });
});

describe('exercise catalog', () => {
  it('detects duplicate names regardless of case', async () => {
    const db = await seededDb();
    expect(await exerciseNameTaken(db, 'toes TO bar')).toBe(true);
    expect(await exerciseNameTaken(db, 'Press militar')).toBe(false);
  });

  it('brings back an archived exercise instead of failing on its name', async () => {
    const db = await seededDb();
    const id = await createExercise(db, { name: 'Face pull', type: 'external', equipment: null, incrementKg: null, notes: null, pair: false });
    await archiveExercise(db, id);
    expect((await listExercises(db)).some((e) => e.id === id)).toBe(false);
    const again = await createExercise(db, {
      name: 'face pull',
      type: 'external',
      equipment: 'polea',
      incrementKg: 2.5,
      notes: null,
      pair: false,
    });
    expect(again).toBe(id);
    expect((await listExercises(db)).find((e) => e.id === id)).toMatchObject({ name: 'face pull', equipment: 'polea' });
  });
});

describe('weekly cardio editing', () => {
  it('adds, edits and removes activities', async () => {
    const db = await seededDb();
    const id = await addCardio(db, 7, { name: 'Bici', target: '45 min', intensity: null, notes: null });
    expect((await cardioForWeekday(db, 7)).map((c) => c.name)).toEqual(['Descanso / Caminar', 'Bici']);

    await updateCardio(db, id, { name: 'Bici de carretera', target: '60 min', intensity: 'Baja', notes: null });
    expect((await cardioForWeekday(db, 7))[1]).toMatchObject({ name: 'Bici de carretera', target: '60 min' });

    await archiveCardio(db, id);
    expect((await cardioForWeekday(db, 7)).map((c) => c.name)).toEqual(['Descanso / Caminar']);
  });
});

describe('body weight log', () => {
  it('deletes weigh-ins but keeps the last one', async () => {
    const db = await seededDb();
    await logWeight(db, '2026-11-09', 83.5);
    expect(await latestWeight(db)).toBe(83.5);

    expect(await deleteWeight(db, '2026-11-09')).toBe(true);
    expect(await latestWeight(db)).toBe(84);

    const [only] = await listWeights(db);
    expect(await deleteWeight(db, only.date)).toBe(false);
    expect(await listWeights(db)).toHaveLength(1);
  });
});

describe('two dumbbells', () => {
  it('marks the exercises whose material is «mancuernas» and keeps it in the slots', async () => {
    const db = await seededDb();
    const exercises = await listExercises(db);
    expect(exercises.find((e) => e.name === 'Sentadilla Búlgara lastrada')?.pair).toBe(true);
    expect(exercises.find((e) => e.name === 'Elevaciones laterales mancuerna')?.pair).toBe(false);
    const id = await createExercise(db, { name: 'Press inclinado', type: 'external', equipment: null, incrementKg: null, notes: null, pair: true });
    expect((await listExercises(db)).find((e) => e.id === id)?.pair).toBe(true);
  });

  it('marks them too when restoring a backup from before migration 7', async () => {
    const source = await seededDb();
    const backup = await exportBackup(source, new Date(2026, 10, 3));
    // A copy made before migration 7 has no «pair» column at all.
    const old = {
      ...backup,
      schemaVersion: 6,
      tables: { ...backup.tables, exercise: backup.tables.exercise!.map(({ pair: _, ...row }) => row) },
    };
    const db = await createTestDb();
    await restoreBackup(db, old);
    expect((await listExercises(db)).find((e) => e.name === 'Sentadilla Búlgara lastrada')?.pair).toBe(true);
  });
});
