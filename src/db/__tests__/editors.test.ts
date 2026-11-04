import seedJson from '../../../data/seed/seed.json';
import { DEFAULT_PLANS } from '@/domain/cardioPlan';
import type { Db } from '../db';
import {
  addCardio,
  archiveCardio,
  cardioFieldsOf,
  cardioForWeekday,
  getCardio,
  sameCardioFields,
  unarchiveCardio,
  updateCardio,
} from '../repositories/cardio';
import {
  getSlot,
  listRoutines,
  listSlots,
  prescriptionOf,
  routinesForWeekday,
  samePrescription,
  setRoutineOnWeekday,
  updateSlotPrescription,
} from '../repositories/routines';
import { importSeed } from '../seed';
import type { SeedData } from '../seedTypes';
import { createTestDb } from './testDb';

const NOW = new Date(2026, 10, 2, 7, 0);

async function seededDb(): Promise<Db> {
  const db = await createTestDb();
  await importSeed(db, seedJson as SeedData, NOW);
  return db;
}

describe('editor of a day', () => {
  it('puts a routine on one weekday and takes it off without touching its other days', async () => {
    const db = await seededDb();
    const monday = (await routinesForWeekday(db, 1))[0];

    await setRoutineOnWeekday(db, monday.id, 3, true);
    await setRoutineOnWeekday(db, monday.id, 3, true); // twice: still once
    expect((await listRoutines(db)).find((r) => r.id === monday.id)?.weekdays).toEqual([1, 3]);

    await setRoutineOnWeekday(db, monday.id, 1, false);
    expect((await listRoutines(db)).find((r) => r.id === monday.id)?.weekdays).toEqual([3]);
    expect(await routinesForWeekday(db, 1)).toEqual([]);
  });
});

describe('editor of a routine slot', () => {
  it('saves its own prescription back unchanged', async () => {
    const db = await seededDb();
    const slot = (await listSlots(db, (await listRoutines(db))[0].id))[0];
    await updateSlotPrescription(db, slot.id, prescriptionOf(slot));
    expect(await getSlot(db, slot.id)).toEqual(slot);
  });

  it('tells a change in any field of the prescription', async () => {
    const db = await seededDb();
    const slot = (await listSlots(db, (await listRoutines(db))[0].id))[0];
    const saved = prescriptionOf(slot);
    expect(samePrescription(saved, { ...saved, target: { ...saved.target } })).toBe(true);
    expect(samePrescription({ ...saved, note: 'Pausa abajo ' }, { ...saved, note: 'Pausa abajo' })).toBe(true);
    expect(samePrescription({ ...saved, note: '  ' }, { ...saved, note: null })).toBe(true);
    expect(samePrescription(saved, { ...saved, sets: saved.sets + 1 })).toBe(false);
    expect(samePrescription(saved, { ...saved, restSeconds: 150 })).toBe(false);
    expect(samePrescription(saved, { ...saved, target: { kind: 'failure', minus: 0 } })).toBe(false);
  });
});

describe('weekly cardio editor', () => {
  it('removes an activity and brings it back with «Deshacer»', async () => {
    const db = await seededDb();
    const id = await addCardio(db, 7, { name: 'Bici', target: '45 min', intensity: null, notes: null });
    await archiveCardio(db, id);
    expect((await cardioForWeekday(db, 7)).some((c) => c.id === id)).toBe(false);

    await unarchiveCardio(db, id);
    expect((await cardioForWeekday(db, 7)).find((c) => c.id === id)).toMatchObject({ name: 'Bici', target: '45 min' });
  });

  it('compares the fields of the form, keeping a plan only for the timer', async () => {
    const db = await seededDb();
    const id = await addCardio(db, 6, {
      name: 'Bici',
      target: null,
      intensity: null,
      notes: null,
      tracking: 'timer',
      plan: DEFAULT_PLANS.miss,
    });
    const fields = cardioFieldsOf((await getCardio(db, id))!);
    expect(fields).toMatchObject({ tracking: 'timer', plan: DEFAULT_PLANS.miss });

    const reordered = { cooldownMin: 5, mainMin: 20, warmupMin: 5, kind: 'miss' } as const;
    expect(sameCardioFields(fields, { ...fields, plan: reordered })).toBe(true);
    expect(sameCardioFields(fields, { ...fields, plan: { ...DEFAULT_PLANS.miss, mainMin: 25 } })).toBe(false);
    expect(sameCardioFields(fields, { ...fields, name: 'Bici estática' })).toBe(false);
    expect(sameCardioFields({ ...fields, target: ' 30 min ' }, { ...fields, target: '30 min' })).toBe(true);
    expect(sameCardioFields({ ...fields, notes: '' }, { ...fields, notes: null })).toBe(true);
    expect(cardioFieldsOf({ ...(await getCardio(db, id))!, tracking: 'check' }).plan).toBeNull();
  });

  it('keeps the plan of the sprints in the same column', async () => {
    const db = await seededDb();
    const sprint = { kind: 'sprint', sprints: 8, restSec: 120 } as const;
    const id = await addCardio(db, 3, { name: 'Sprints', target: null, intensity: null, notes: null, tracking: 'sprint', sprint });
    const saved = (await getCardio(db, id))!;
    expect(saved).toMatchObject({ tracking: 'sprint', plan: null, sprint });
    const fields = cardioFieldsOf(saved);
    expect(sameCardioFields(fields, { ...fields, sprint: { restSec: 120, sprints: 8, kind: 'sprint' } })).toBe(true);
    expect(sameCardioFields(fields, { ...fields, sprint: { ...sprint, sprints: 6 } })).toBe(false);
    await updateCardio(db, id, { ...fields, tracking: 'timer', plan: DEFAULT_PLANS.hiit, sprint: null });
    expect(await getCardio(db, id)).toMatchObject({ tracking: 'timer', plan: DEFAULT_PLANS.hiit, sprint: null });
  });
});
