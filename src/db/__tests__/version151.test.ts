import {
  dayPlan,
  dayProgress,
  dietLine,
  mealSources,
  overridesOf,
  planSource,
  switchDayPlan,
  tickedMeals,
  weekdaySource,
  type DietSource,
} from '@/domain/diet';
import type { IsoWeekday } from '@/domain/types';
import type { Db } from '../db';
import { DEMO_SEED as SEED } from '../demoSeed';
import { exportBackup, parseBackup, restoreBackup, wipeAllData } from '../maintenance';
import { MIGRATIONS } from '../migrations';
import {
  addDietItem,
  copyDietDay,
  createDietPlan,
  deleteDietPlan,
  dietDayOverrides,
  dietLogOn,
  dietPlanNameTaken,
  eatenByDate,
  listDietItems,
  listDietPlans,
  listFoods,
  loadDietDay,
  removeDietItem,
  renameDietPlan,
  restoreDietDays,
  restoreDietItem,
  setDietDayOverrides,
  setEaten,
  updateDietItemGrams,
  type DietItem,
} from '../repositories/diet';
import { getSettings, updateSettings } from '../repositories/settings';
import { importSeed } from '../seed';
import { createTestDb } from './testDb';

const NBSP = ' ';
const NOW = new Date(2026, 10, 2, 7, 0);
const T0 = NOW.getTime();
/** A Monday. */
const TODAY = '2026-11-02';
const YESTERDAY = '2026-11-01';
const MONDAY = weekdaySource(1);

async function seededDb(): Promise<Db> {
  const db = await createTestDb();
  await importSeed(db, SEED, NOW);
  return db;
}

const count = async (db: Db, table: string) => (await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))!.n;
const of = async (db: Db, source: DietSource): Promise<DietItem[]> =>
  (await listDietItems(db)).filter((i) => (source.kind === 'weekday' ? i.planId === null && i.weekday === source.weekday : i.planId === source.planId));
const shape = (items: DietItem[]) => items.map((i) => [i.meal, i.foodName, i.grams]);
const ids = (items: DietItem[]) => items.map((i) => i.id);

/** The day as the screens work it out. */
async function today(db: Db, weekday: IsoWeekday = 1, date = TODAY) {
  const day = await loadDietDay(db, date);
  const sources = mealSources(weekday, day.overrides);
  return { ...day, sources, progress: dayProgress(day.items, sources, day.eaten) };
}

describe('planes de día (migration 15)', () => {
  it('migrates a database of version 14: the weekly plan stays as it was', async () => {
    const db = await createTestDb({ upTo: 14 });
    await db.runAsync("INSERT INTO food (name, fat_per_100g, carbs_per_100g, protein_per_100g) VALUES ('Arroz', 1, 78, 7)");
    await db.runAsync("INSERT INTO diet_item (weekday, meal, food_id, grams) VALUES (3, 'comida', 1, 120)");
    await db.runAsync('INSERT INTO settings (id) VALUES (1)');
    await db.execAsync(MIGRATIONS[14]);
    expect(await listDietItems(db)).toMatchObject([{ weekday: 3, planId: null, meal: 'comida', foodName: 'Arroz', grams: 120 }]);
    expect(await listDietPlans(db)).toEqual([]);
    expect((await getSettings(db)).dietInToday).toBe(true);
    for (const table of ['diet_plan', 'diet_day_meal', 'diet_log']) expect(await count(db, table)).toBe(0);
  });

  it('creates a plan, empty or as a copy of a weekday, apart from the week', async () => {
    const db = await seededDb();
    const monday = await of(db, MONDAY);
    const total = await count(db, 'diet_item');

    const empty = await createDietPlan(db, '  Ayuno  ');
    const rest = await createDietPlan(db, 'Día de descanso', MONDAY);
    expect(await listDietPlans(db)).toEqual([
      { id: empty, name: 'Ayuno' },
      { id: rest, name: 'Día de descanso' },
    ]);
    expect(await of(db, planSource(empty))).toEqual([]);
    const copied = await of(db, planSource(rest));
    expect(shape(copied)).toEqual(shape(monday));
    // Of the plan, and of no weekday: Monday still has only its own.
    expect(copied.every((i) => i.weekday === null && i.planId === rest)).toBe(true);
    expect(ids(await of(db, MONDAY))).toEqual(ids(monday));
    expect(await count(db, 'diet_item')).toBe(total + monday.length);

    // A copy of another plan, and its own foods from then on.
    const variant = await createDietPlan(db, 'Descanso sin cena', planSource(rest));
    const dinner = (await of(db, planSource(variant))).filter((i) => i.meal === 'cena');
    for (const item of dinner) await removeDietItem(db, item.id, TODAY);
    expect((await of(db, planSource(variant))).length).toBe(monday.length - dinner.length);
    expect((await of(db, planSource(rest))).length).toBe(monday.length);
  });

  it('adds foods to a plan, renames it and knows a name in use', async () => {
    const db = await seededDb();
    const plan = await createDietPlan(db, 'Comida fuera', MONDAY);
    const food = (await listFoods(db))[0];
    const id = await addDietItem(db, planSource(plan), 'cena', food.id, 150);
    expect((await of(db, planSource(plan))).at(-1)).toMatchObject({ id, meal: 'cena', grams: 150, planId: plan, weekday: null });
    expect((await of(db, MONDAY)).some((i) => i.id === id)).toBe(false);

    expect(await dietPlanNameTaken(db, 'comida FUERA')).toBe(true);
    expect(await dietPlanNameTaken(db, 'Comida fuera', plan)).toBe(false);
    expect(await dietPlanNameTaken(db, 'Otro')).toBe(false);
    await renameDietPlan(db, plan, ' Restaurante ');
    expect(await listDietPlans(db)).toEqual([{ id: plan, name: 'Restaurante' }]);
  });

  it('copies a plan over weekdays and undoes it', async () => {
    const db = await seededDb();
    const plan = await createDietPlan(db, 'Ligero', weekdaySource(3));
    const light = await of(db, planSource(plan));
    const friday = await of(db, weekdaySource(5));

    const replaced = await copyDietDay(db, planSource(plan), [5], TODAY);
    expect(replaced.items).toHaveLength(friday.length);
    expect(shape(await of(db, weekdaySource(5)))).toEqual(shape(light));
    // The plan is still there, with its own foods.
    expect(ids(await of(db, planSource(plan)))).toEqual(ids(light));

    await restoreDietDays(db, [5], replaced);
    expect(ids(await of(db, weekdaySource(5)))).toEqual(ids(friday));
    expect(ids(await of(db, planSource(plan)))).toEqual(ids(light));
  });
});

describe('ticking what is eaten', () => {
  it('ticks and unticks foods of today, once each', async () => {
    const db = await seededDb();
    const monday = await of(db, MONDAY);
    const breakfast = monday.filter((i) => i.meal === 'desayuno');

    await setEaten(db, TODAY, ids(breakfast), true, T0);
    await setEaten(db, TODAY, [breakfast[0].id], true, T0 + 1000);
    const log = await dietLogOn(db, TODAY);
    expect(log.map((l) => [l.itemId, l.meal, l.grams])).toEqual(breakfast.map((i) => [i.id, 'desayuno', i.grams]));

    const day = await today(db);
    expect(day.progress.meals.map((m) => [m.meal, m.done])).toEqual([
      ['desayuno', true],
      ['comida', false],
      ['merienda', false],
      ['cena', false],
    ]);
    // PLAN.md §5: Monday is 2472,34 kcal.
    expect(day.progress.planned.kcal).toBeCloseTo(2472.34, 1);
    expect(dietLine(day.progress)).toMatch(new RegExp(`^1 de 4 comidas · \\d+ de 2472${NBSP}kcal$`));

    await setEaten(db, TODAY, [breakfast[0].id], false, T0);
    expect((await dietLogOn(db, TODAY)).map((l) => l.itemId)).toEqual([breakfast[1].id]);
    expect((await today(db)).progress.mealsDone).toBe(0);
    // Another day has its own ticks.
    expect(await dietLogOn(db, YESTERDAY)).toEqual([]);
  });

  it('keeps what was eaten as it was ticked: the plan changes later, the past does not', async () => {
    const db = await seededDb();
    const item = (await of(db, weekdaySource(7)))[0];
    await setEaten(db, YESTERDAY, [item.id], true, T0 - 86_400_000);
    await setEaten(db, TODAY, [item.id], true, T0);

    // New grams: today's tick follows (it is still on the list), yesterday's does not.
    await updateDietItemGrams(db, item.id, item.grams + 50, TODAY);
    expect((await dietLogOn(db, TODAY))[0].grams).toBe(item.grams + 50);
    expect((await dietLogOn(db, YESTERDAY))[0].grams).toBe(item.grams);

    // Out of the plan: no longer eaten today, still eaten yesterday (without its row of the plan).
    const removed = await removeDietItem(db, item.id, TODAY);
    expect(removed!.ticks).toHaveLength(1);
    expect(await dietLogOn(db, TODAY)).toEqual([]);
    expect(await dietLogOn(db, YESTERDAY)).toMatchObject([{ itemId: null, foodId: item.foodId, grams: item.grams }]);

    // «Deshacer» brings it back with today's tick.
    await restoreDietItem(db, removed!);
    expect((await of(db, weekdaySource(7)))[0]).toMatchObject({ id: item.id, grams: item.grams + 50 });
    expect(await dietLogOn(db, TODAY)).toMatchObject([{ itemId: item.id, grams: item.grams + 50 }]);
  });

  it('takes today\'s ticks with a day copied over, and gives them back on undo', async () => {
    const db = await seededDb();
    const monday = await of(db, MONDAY);
    await setEaten(db, TODAY, ids(monday).slice(0, 3), true, T0);

    const replaced = await copyDietDay(db, weekdaySource(2), [1], TODAY);
    expect(replaced.ticks).toHaveLength(3);
    expect(await dietLogOn(db, TODAY)).toEqual([]);
    expect((await today(db)).progress.eaten.kcal).toBe(0);

    await restoreDietDays(db, [1], replaced);
    expect(ids(await of(db, MONDAY))).toEqual(ids(monday));
    expect((await dietLogOn(db, TODAY)).map((l) => l.itemId)).toEqual(ids(monday).slice(0, 3));
  });

  it('adds up what was eaten each day', async () => {
    const db = await seededDb();
    const sunday = await of(db, weekdaySource(7));
    const monday = await of(db, MONDAY);
    await setEaten(db, YESTERDAY, ids(sunday.filter((i) => i.meal !== 'cena')), true, T0 - 86_400_000);
    await setEaten(db, TODAY, ids(monday), true, T0);

    const days = await eatenByDate(db, '2026-10-27', TODAY);
    expect([...days.keys()]).toEqual([YESTERDAY, TODAY]);
    expect(days.get(YESTERDAY)!.meals).toBe(3);
    expect(days.get(TODAY)).toMatchObject({ meals: 4 });
    expect(days.get(TODAY)!.macros.kcal).toBeCloseTo(2472.34, 1);
    // Out of the range asked for.
    expect((await eatenByDate(db, '2026-10-27', '2026-10-31')).size).toBe(0);
  });
});

describe('changing the plan of a day', () => {
  it('follows another plan today only, and goes back', async () => {
    const db = await seededDb();
    const out = planSource(await createDietPlan(db, 'Comida fuera', weekdaySource(3)));
    const before = await today(db);

    const { sources, kept } = switchDayPlan(before.sources, tickedMeals(before.eaten), out);
    await setDietDayOverrides(db, TODAY, overridesOf(1, sources));
    expect(kept).toEqual([]);
    expect(await dietDayOverrides(db, TODAY)).toHaveLength(4);

    const day = await today(db);
    expect(dayPlan(day.sources, tickedMeals(day.eaten))).toEqual(out);
    expect(shape(day.progress.meals.flatMap((m) => m.items))).toEqual(shape(await of(db, out)));
    // Tomorrow, and next Monday, are their weekday's.
    expect((await today(db, 2, '2026-11-03')).sources.comida).toEqual(weekdaySource(2));
    expect((await today(db, 1, '2026-11-09')).sources.comida).toEqual(MONDAY);

    // Back to Monday: nothing is kept for the date.
    const back = switchDayPlan(day.sources, tickedMeals(day.eaten), MONDAY);
    await setDietDayOverrides(db, TODAY, overridesOf(1, back.sources));
    expect(await count(db, 'diet_day_meal')).toBe(0);
    expect(ids((await today(db)).progress.meals.flatMap((m) => m.items))).toEqual(ids(await of(db, MONDAY)));
  });

  it('leaves the meals already ticked on the plan they were eaten from', async () => {
    const db = await seededDb();
    const out = planSource(await createDietPlan(db, 'Comida fuera', weekdaySource(3)));
    const breakfast = (await of(db, MONDAY)).filter((i) => i.meal === 'desayuno');
    await setEaten(db, TODAY, ids(breakfast), true, T0);

    const before = await today(db);
    const { sources, kept } = switchDayPlan(before.sources, tickedMeals(before.eaten), out);
    await setDietDayOverrides(db, TODAY, overridesOf(1, sources));
    expect(kept).toEqual(['desayuno']);

    const day = await today(db);
    expect(day.progress.meals[0]).toMatchObject({ meal: 'desayuno', source: MONDAY, done: true });
    expect(ids(day.progress.meals[0].items)).toEqual(ids(breakfast));
    expect(day.progress.meals.slice(1).every((m) => m.source.kind === 'plan')).toBe(true);
    expect(dayPlan(day.sources, tickedMeals(day.eaten))).toEqual(out);
    expect(day.progress.mealsDone).toBe(1);
  });

  it('goes back to the weekday when its plan is deleted, without today\'s ticks of it', async () => {
    const db = await seededDb();
    const planId = await createDietPlan(db, 'Comida fuera', weekdaySource(3));
    const out = planSource(planId);
    await setDietDayOverrides(db, TODAY, overridesOf(1, switchDayPlan(mealSources(1, []), new Set(), out).sources));
    await setDietDayOverrides(db, YESTERDAY, [{ meal: 'cena', source: out }]);
    const lunch = (await of(db, out)).filter((i) => i.meal === 'comida');
    await setEaten(db, TODAY, ids(lunch), true, T0);
    await setEaten(db, YESTERDAY, [lunch[0].id], true, T0 - 86_400_000);
    const total = await count(db, 'diet_item');

    await deleteDietPlan(db, planId, TODAY);
    expect(await listDietPlans(db)).toEqual([]);
    expect(await count(db, 'diet_item')).toBe(total - (await of(db, weekdaySource(3))).length);
    expect(await count(db, 'diet_day_meal')).toBe(0);
    const day = await today(db);
    expect(day.sources.comida).toEqual(MONDAY);
    expect(day.eaten).toEqual([]);
    // What was eaten yesterday is still eaten.
    expect(await dietLogOn(db, YESTERDAY)).toMatchObject([{ itemId: null, foodId: lunch[0].foodId, grams: lunch[0].grams }]);
  });
});

describe('the diet in a backup', () => {
  it('round-trips plans, days and ticks', async () => {
    const source = await seededDb();
    const out = planSource(await createDietPlan(source, 'Comida fuera', weekdaySource(3)));
    await setDietDayOverrides(source, TODAY, [{ meal: 'cena', source: out }, { meal: 'comida', source: weekdaySource(6) }]);
    const monday = await of(source, MONDAY);
    await setEaten(source, TODAY, ids(monday).slice(0, 2), true, T0);
    await updateSettings(source, { dietInToday: false });

    const target = await createTestDb();
    await restoreBackup(target, parseBackup(JSON.stringify(await exportBackup(source, NOW))));
    for (const table of ['diet_plan', 'diet_item', 'diet_day_meal', 'diet_log']) expect(await count(target, table)).toBe(await count(source, table));
    expect(await listDietPlans(target)).toEqual(await listDietPlans(source));
    expect(shape(await of(target, out))).toEqual(shape(await of(source, out)));
    expect(await dietDayOverrides(target, TODAY)).toEqual(await dietDayOverrides(source, TODAY));
    expect(await dietLogOn(target, TODAY)).toEqual(await dietLogOn(source, TODAY));
    expect((await getSettings(target)).dietInToday).toBe(false);
  });

  it('restores a copy older than the plans of a day', async () => {
    const source = await seededDb();
    const backup = await exportBackup(source, NOW);
    // As a copy of version 14 was: no plans, days or ticks, and foods without `plan_id`.
    backup.schemaVersion = 14;
    delete backup.tables.diet_plan;
    delete backup.tables.diet_day_meal;
    delete backup.tables.diet_log;
    backup.tables.diet_item = backup.tables.diet_item!.map(({ plan_id: _, ...row }) => row);
    backup.tables.settings = backup.tables.settings!.map(({ diet_in_today: _, ...row }) => row);

    const target = await seededDb();
    await createDietPlan(target, 'Se va', MONDAY);
    await setEaten(target, TODAY, ids(await of(target, MONDAY)).slice(0, 1), true, T0);
    await restoreBackup(target, parseBackup(JSON.stringify(backup)));
    expect(await listDietPlans(target)).toEqual([]);
    expect(await count(target, 'diet_log')).toBe(0);
    expect(shape(await of(target, MONDAY))).toEqual(shape(await of(source, MONDAY)));
    expect((await listDietItems(target)).every((i) => i.planId === null)).toBe(true);
    expect((await getSettings(target)).dietInToday).toBe(true);
  });

  it('wipes plans, days and ticks with the rest', async () => {
    const db = await seededDb();
    const out = planSource(await createDietPlan(db, 'Comida fuera', MONDAY));
    await setDietDayOverrides(db, TODAY, [{ meal: 'cena', source: out }]);
    await setEaten(db, TODAY, ids(await of(db, MONDAY)).slice(0, 2), true, T0);
    await wipeAllData(db);
    for (const table of ['diet_plan', 'diet_item', 'diet_day_meal', 'diet_log']) expect(await count(db, table)).toBe(0);
  });
});
