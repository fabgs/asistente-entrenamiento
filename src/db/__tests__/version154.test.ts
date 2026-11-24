import { dayProgress, mealSources, planSource, switchDayPlan, tickedMeals, weekdaySource } from '@/domain/diet';
import type { Db } from '../db';
import { DEMO_SEED } from '../demoSeed';
import { exportBackup, restoreBackup } from '../maintenance';
import { MIGRATIONS } from '../migrations';
import {
  addEatenFood,
  copyDietDay,
  createDietPlan,
  deleteDietPlan,
  dietLogOn,
  listDietItems,
  listFoods,
  loadDietDay,
  removeEatenFood,
  restoreEatenFood,
  setDietDayOverrides,
  setEaten,
  setEatenGrams,
  updateDietItemGrams,
  updateEatenGrams,
} from '../repositories/diet';
import { listRoutines, listSlots } from '../repositories/routines';
import { endRest, getSession, logSet, openSlot, startSession, updateSessionState } from '../repositories/sessions';
import { importSeed } from '../seed';
import { createTestDb } from './testDb';

const NOW = new Date(2026, 10, 24, 7, 0);
const T0 = NOW.getTime();

async function seeded(): Promise<Db> {
  const db = await createTestDb();
  await importSeed(db, DEMO_SEED, NOW);
  return db;
}

/** A workout of the first routine resting after the last set of its first exercise. */
async function restingAfterFirst(db: Db) {
  const routine = (await listRoutines(db))[0];
  const [first, second] = await listSlots(db, routine.id);
  const id = await startSession(db, routine.id, NOW);
  for (let i = 0; i < first.sets; i++) {
    await logSet(db, id, first, 10, T0 + i * 1000);
    await endRest(db, id, 'same', T0 + i * 1000 + 500);
  }
  await updateSessionState(db, id, { restEndsAt: T0 + 150_000 });
  return { id, first, second };
}

describe('one more set chosen during the rest (1.5.4, migration 17)', () => {
  it('adds the column to the workouts there were, with nothing chosen', async () => {
    const db = await createTestDb({ upTo: 16 });
    await db.runAsync(`INSERT INTO routine (name, position) VALUES ('Día 1', 0)`);
    await db.runAsync(
      `INSERT INTO workout_session (routine_id, date, started_at, status, rest_ends_at, current_slot_id) VALUES (1, '2026-11-24', ?, 'in_progress', ?, NULL)`,
      T0,
      T0 + 1000,
    );
    await db.execAsync(MIGRATIONS[16]);
    expect(await getSession(db, 1)).toMatchObject({ restEndsAt: T0 + 1000, nextExtra: false });
  });

  it('is kept while resting and cleared by whatever comes next', async () => {
    const db = await seeded();
    const { id, first, second } = await restingAfterFirst(db);
    expect((await getSession(db, id))!.nextExtra).toBe(false);

    // «Una serie más»: the rest goes on, what comes after it changes.
    await updateSessionState(db, id, { currentSlotId: first.id, nextExtra: true });
    expect(await getSession(db, id)).toMatchObject({ currentSlotId: first.id, nextExtra: true, restEndsAt: T0 + 150_000 });

    // Another exercise chosen in the list: that one comes next, no extra set.
    await updateSessionState(db, id, { currentSlotId: second.id });
    expect(await getSession(db, id)).toMatchObject({ currentSlotId: second.id, nextExtra: false });

    // Leaving the rest into the extra set clears it; so does logging that set.
    await updateSessionState(db, id, { currentSlotId: first.id, nextExtra: true });
    await endRest(db, id, 'same', T0 + 160_000);
    expect(await getSession(db, id)).toMatchObject({ currentSlotId: first.id, nextExtra: false, restEndsAt: null });
    await updateSessionState(db, id, { nextExtra: true });
    await logSet(db, id, first, 9, T0 + 200_000);
    expect((await getSession(db, id))!.nextExtra).toBe(false);

    // Opening an exercise once the rest is over clears it too.
    await updateSessionState(db, id, { restEndsAt: T0 + 210_000, nextExtra: true });
    await openSlot(db, id, second.id, [], T0 + 300_000);
    expect(await getSession(db, id)).toMatchObject({ currentSlotId: second.id, nextExtra: false, restEndsAt: null });
  });

  it('goes in the copy, and an older copy comes back without it', async () => {
    const db = await seeded();
    const { id, first } = await restingAfterFirst(db);
    await updateSessionState(db, id, { currentSlotId: first.id, nextExtra: true });
    const backup = await exportBackup(db, NOW);
    expect(backup.tables.workout_session!.find((r) => r.id === id)).toMatchObject({ next_extra: 1 });

    await restoreBackup(db, backup);
    expect((await getSession(db, id))!.nextExtra).toBe(true);
    const old = {
      ...backup,
      schemaVersion: 16,
      tables: { ...backup.tables, workout_session: backup.tables.workout_session!.map(({ next_extra: _, ...row }) => row) },
    };
    await restoreBackup(db, old);
    expect((await getSession(db, id))!.nextExtra).toBe(false);
  });
});

/** A Tuesday, like NOW. */
const TODAY = '2026-11-24';
const YESTERDAY = '2026-11-23';

async function tuesday(db: Db) {
  const items = (await listDietItems(db)).filter((i) => i.planId === null && i.weekday === 2);
  return { items, breakfast: items.filter((i) => i.meal === 'desayuno') };
}

async function day(db: Db, date = TODAY) {
  const loaded = await loadDietDay(db, date);
  return dayProgress(loaded.items, mealSources(2, loaded.overrides), loaded.eaten);
}

describe('today\'s list beyond ticking (1.5.4)', () => {
  it('eats a food of the plan in other grams today, and the plan stays', async () => {
    const db = await seeded();
    const { breakfast } = await tuesday(db);
    const [first, second] = breakfast;

    // Not ticked yet: setting the grams ticks it.
    await setEatenGrams(db, TODAY, first.id, first.grams + 40, T0);
    // Ticked already: only its grams change.
    await setEaten(db, TODAY, [second.id], true, T0);
    await setEatenGrams(db, TODAY, second.id, 5, T0 + 1000);
    expect((await dietLogOn(db, TODAY)).map((l) => [l.itemId, l.grams])).toEqual([
      [first.id, first.grams + 40],
      [second.id, 5],
    ]);
    const plan = await tuesday(db);
    expect(plan.breakfast.map((i) => i.grams)).toEqual(breakfast.map((i) => i.grams));

    const progress = await day(db);
    expect(progress.meals[0].eatenGrams.get(first.id)).toBe(first.grams + 40);
    expect(progress.meals[0].planned.kcal).toBeCloseTo((await day(db, YESTERDAY)).meals[0].planned.kcal);

    // Unticked, the grams of today go with the tick.
    await setEaten(db, TODAY, [first.id], false, T0);
    await setEaten(db, TODAY, [first.id], true, T0);
    expect((await dietLogOn(db, TODAY)).find((l) => l.itemId === first.id)!.grams).toBe(first.grams);
  });

  it('does not let a change of the plan undo the grams set for today', async () => {
    const db = await seeded();
    const [first, second] = (await tuesday(db)).breakfast;
    await setEaten(db, TODAY, [first.id, second.id], true, T0);
    await setEatenGrams(db, TODAY, first.id, 7, T0);

    await updateDietItemGrams(db, first.id, first.grams + 10, TODAY);
    await updateDietItemGrams(db, second.id, second.grams + 10, TODAY);
    const log = await dietLogOn(db, TODAY);
    // The one set in Hoy keeps its grams; the other follows the plan, as until now.
    expect(log.find((l) => l.itemId === first.id)!.grams).toBe(7);
    expect(log.find((l) => l.itemId === second.id)!.grams).toBe(second.grams + 10);
  });

  it('adds something off the plan to a meal of today, changes it, removes it and brings it back', async () => {
    const db = await seeded();
    const food = (await listFoods(db))[0];
    const id = await addEatenFood(db, TODAY, 'merienda', food.id, 30, T0);
    const before = await day(db);
    const snack = before.meals.find((m) => m.meal === 'merienda')!;
    expect(snack.extras).toMatchObject([{ id, foodId: food.id, foodName: food.name, grams: 30, itemId: null }]);
    // Only today, and the plan does not change.
    expect(await dietLogOn(db, YESTERDAY)).toEqual([]);
    expect((await tuesday(db)).items.some((i) => i.foodId === food.id && i.meal === 'merienda' && i.grams === 30)).toBe(false);

    await updateEatenGrams(db, id, 45);
    expect((await dietLogOn(db, TODAY))[0].grams).toBe(45);
    expect((await day(db)).eaten.kcal).toBeGreaterThan(before.eaten.kcal);

    const removed = await removeEatenFood(db, id);
    expect(await dietLogOn(db, TODAY)).toEqual([]);
    await restoreEatenFood(db, removed!);
    expect(await dietLogOn(db, TODAY)).toMatchObject([{ id, grams: 45, meal: 'merienda', itemId: null }]);

    // A tick of the plan is not removed this way.
    const item = (await tuesday(db)).breakfast[0];
    await setEaten(db, TODAY, [item.id], true, T0);
    const tick = (await dietLogOn(db, TODAY)).find((l) => l.itemId === item.id)!;
    expect(await removeEatenFood(db, tick.id)).toBeNull();
    await updateEatenGrams(db, tick.id, 1);
    expect((await dietLogOn(db, TODAY)).find((l) => l.itemId === item.id)!.grams).toBe(item.grams);
  });

  it('keeps what was eaten off the plan whatever happens to the plans', async () => {
    const db = await seeded();
    const food = (await listFoods(db))[0];
    await addEatenFood(db, TODAY, 'desayuno', food.id, 30, T0);
    const sources = mealSources(2, []);
    // It pins no meal: changing the plan of today moves the breakfast too.
    const eaten = await dietLogOn(db, TODAY);
    expect([...tickedMeals(eaten)]).toEqual([]);
    const out = await createDietPlan(db, 'Comida fuera', weekdaySource(2));
    const { sources: next, kept } = switchDayPlan(sources, tickedMeals(eaten), planSource(out));
    expect(kept).toEqual([]);
    await setDietDayOverrides(db, TODAY, [{ meal: 'desayuno', source: next.desayuno }]);
    await copyDietDay(db, weekdaySource(1), [2], TODAY);
    await deleteDietPlan(db, out, TODAY);
    expect(await dietLogOn(db, TODAY)).toMatchObject([{ itemId: null, grams: 30, meal: 'desayuno' }]);
  });

  it('round-trips what was eaten off the plan and the grams of today', async () => {
    const db = await seeded();
    const food = (await listFoods(db))[0];
    const item = (await tuesday(db)).breakfast[0];
    await addEatenFood(db, TODAY, 'cena', food.id, 30, T0);
    await setEatenGrams(db, TODAY, item.id, 3, T0);
    const backup = await exportBackup(db, NOW);
    await restoreBackup(db, backup);
    expect((await dietLogOn(db, TODAY)).map((l) => [l.meal, l.itemId, l.grams])).toEqual([
      ['cena', null, 30],
      ['desayuno', item.id, 3],
    ]);
  });
});
