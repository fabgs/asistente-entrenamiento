import seedJson from '../../../data/seed/seed.json';
import type { Db } from '../db';
import { listDietItems } from '../repositories/diet';
import { cardioForWeekday } from '../repositories/cardio';
import { listRoutines, listSlots, routinesForWeekday, type Slot } from '../repositories/routines';
import {
  finishSession,
  getActiveSession,
  listSets,
  logSet,
  slotHistory,
  startSession,
} from '../repositories/sessions';
import { getProfile, getSettings, latestWeight, toProgressionSettings } from '../repositories/settings';
import {
  applyChange,
  dismissChange,
  listChangesForSession,
  listOpenChanges,
  setSlotWeightManually,
  undoChange,
} from '../repositories/weightChanges';
import { importSeed } from '../seed';
import type { SeedData } from '../seedTypes';
import { createTestDb } from './testDb';

const seed = seedJson as SeedData;
const NOW = new Date(2026, 10, 2, 7, 0); // Monday 2 Nov 2026

async function seededDb(): Promise<Db> {
  const db = await createTestDb();
  await importSeed(db, seed, NOW);
  return db;
}

const slotNamed = async (db: Db, routineIndex: number, name: string): Promise<Slot> => {
  const routine = (await listRoutines(db))[routineIndex];
  return (await listSlots(db, routine.id)).find((s) => s.exerciseName === name)!;
};

describe('importSeed', () => {
  it('loads every section of the seed', async () => {
    const db = await seededDb();
    const count = async (table: string) =>
      (await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))!.n;
    expect(await count('routine')).toBe(4);
    expect(await count('exercise')).toBe(22);
    expect(await count('routine_slot')).toBe(25);
    expect(await count('food')).toBe(34);
    expect(await count('diet_item')).toBe(145);
    expect(await count('cardio_activity')).toBe(9);
    expect(await latestWeight(db)).toBe(84);
    expect((await getProfile(db)).birthDate).toBeNull();
    expect((await getSettings(db)).restSecondsDefault).toBe(150);
    expect((await listDietItems(db)).length).toBe(145);
  });

  it('is idempotent', async () => {
    const db = await seededDb();
    expect(await importSeed(db, seed, NOW)).toBe(false);
    expect((await listRoutines(db)).length).toBe(4);
  });

  it('maps routines and cardio to weekdays', async () => {
    const db = await seededDb();
    expect((await routinesForWeekday(db, 1)).map((r) => r.name)).toEqual([
      'Día 1: Torso (Empuje Pesado + Tirón Volumen)',
    ]);
    expect(await routinesForWeekday(db, 3)).toEqual([]);
    expect((await cardioForWeekday(db, 1)).map((c) => c.name)).toEqual(['Caminar', 'Bici estática']);
  });

  it('keeps the Excel weights and creates pending recommendations', async () => {
    const db = await seededDb();
    const remo = await slotNamed(db, 0, 'Remo con barra (90º)');
    expect(remo.weightKg).toBe(35);
    const pending = await listOpenChanges(db);
    expect(pending.find((p) => p.slotId === remo.id)).toMatchObject({ fromKg: 35, toKg: 37.5, source: 'import' });
    expect(pending.map((p) => p.toKg).sort((a, b) => a! - b!)).toEqual([
      2.5, 2.5, 10, 12.5, 12.5, 17.5, 17.5, 17.5, 37.5, 37.5,
    ]);
  });

  it('imports the Excel history newest first', async () => {
    const db = await seededDb();
    const fondos = await slotNamed(db, 0, 'Fondos en paralelas lastrados');
    expect(await slotHistory(db, fondos.id)).toMatchObject([
      { weightKg: 15, reps: [9, 8, 6] },
      { weightKg: 12.5, reps: [10, 9, 8] },
    ]);
  });
});

describe('weight recommendations are never applied automatically', () => {
  it('applies, undoes and dismisses on demand', async () => {
    const db = await seededDb();
    const remo = await slotNamed(db, 0, 'Remo con barra (90º)');
    const change = (await listOpenChanges(db)).find((p) => p.slotId === remo.id)!;

    await applyChange(db, change.id, 1);
    expect((await slotNamed(db, 0, 'Remo con barra (90º)')).weightKg).toBe(37.5);

    await undoChange(db, change.id);
    expect((await slotNamed(db, 0, 'Remo con barra (90º)')).weightKg).toBe(35);
    expect((await listOpenChanges(db)).some((p) => p.id === change.id)).toBe(true);

    await dismissChange(db, change.id, 2);
    expect((await slotNamed(db, 0, 'Remo con barra (90º)')).weightKg).toBe(35);
  });

  it('keeps an ignored recommendation as a suggestion that can still be applied', async () => {
    const db = await seededDb();
    const remo = await slotNamed(db, 0, 'Remo con barra (90º)');
    const change = (await listOpenChanges(db)).find((p) => p.slotId === remo.id)!;

    await dismissChange(db, change.id, 2);
    expect((await listOpenChanges(db)).find((p) => p.id === change.id)?.status).toBe('dismissed');

    await applyChange(db, change.id, 3);
    expect((await slotNamed(db, 0, 'Remo con barra (90º)')).weightKg).toBe(37.5);
    expect((await listOpenChanges(db)).some((p) => p.id === change.id)).toBe(false);
  });

  it('drops an ignored suggestion once newer data replaces it', async () => {
    const db = await seededDb();
    const routine = (await listRoutines(db))[0];
    const remo = await slotNamed(db, 0, 'Remo con barra (90º)');
    const change = (await listOpenChanges(db)).find((p) => p.slotId === remo.id)!;
    await dismissChange(db, change.id, 2);

    const sessionId = await startSession(db, routine.id, NOW);
    for (const reps of [11, 11, 11]) await logSet(db, sessionId, remo, reps, reps);
    await finishSession(db, sessionId, toProgressionSettings(await getSettings(db)), 1000);
    expect((await listOpenChanges(db)).some((p) => p.slotId === remo.id)).toBe(false);
  });

  it('expires open recommendations on a manual change', async () => {
    const db = await seededDb();
    const remo = await slotNamed(db, 0, 'Remo con barra (90º)');
    const change = (await listOpenChanges(db)).find((p) => p.slotId === remo.id)!;
    await dismissChange(db, change.id, 1);
    await setSlotWeightManually(db, remo.id, 40, 1);
    expect((await slotNamed(db, 0, 'Remo con barra (90º)')).weightKg).toBe(40);
    expect((await listOpenChanges(db)).some((p) => p.slotId === remo.id)).toBe(false);
  });
});

describe('a workout session', () => {
  it('logs reps with the slot weight and proposes the next load on finish', async () => {
    const db = await seededDb();
    const routine = (await listRoutines(db))[0];
    const sessionId = await startSession(db, routine.id, NOW);
    expect((await getActiveSession(db))?.id).toBe(sessionId);

    const floor = await slotNamed(db, 0, 'Floor Press con barra');
    const pendingBefore = (await listOpenChanges(db)).find((p) => p.slotId === floor.id)!;
    await applyChange(db, pendingBefore.id, 1);
    const floorNow = await slotNamed(db, 0, 'Floor Press con barra');

    await logSet(db, sessionId, floorNow, 17, 10);
    await logSet(db, sessionId, floorNow, 17, 20);
    await logSet(db, sessionId, floorNow, 16, 30); // extra set
    const sets = await listSets(db, sessionId);
    expect(sets.map((s) => [s.setIndex, s.weightKg, s.reps, s.isExtra])).toEqual([
      [1, 37.5, 17, false],
      [2, 37.5, 17, false],
      [3, 37.5, 16, true],
    ]);

    await finishSession(db, sessionId, toProgressionSettings(await getSettings(db)), 1000);
    expect(await getActiveSession(db)).toBeNull();

    const changes = await listChangesForSession(db, sessionId);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ slotId: floor.id, fromKg: 37.5, toKg: 40, status: 'pending' });
    expect((await slotNamed(db, 0, 'Floor Press con barra')).weightKg).toBe(37.5);
  });

  it('expires an old pending recommendation when the slot is trained again without change', async () => {
    const db = await seededDb();
    const routine = (await listRoutines(db))[0];
    const remo = await slotNamed(db, 0, 'Remo con barra (90º)');
    const sessionId = await startSession(db, routine.id, NOW);
    for (const reps of [11, 11, 11]) await logSet(db, sessionId, remo, reps, reps);
    await finishSession(db, sessionId, toProgressionSettings(await getSettings(db)), 1000);
    expect((await listOpenChanges(db)).some((p) => p.slotId === remo.id)).toBe(false);
  });
});
