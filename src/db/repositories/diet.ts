import {
  MEAL_KEYS,
  planSource,
  weekdaySource,
  type DietSource,
  type EatenFood,
  type Meal,
  type MealOverride,
  type PlannedFood,
} from '@/domain/diet';
import { macrosFor, sumMacros, type Macros } from '@/domain/nutrition';
import type { IsoWeekday } from '@/domain/types';
import type { Db, SqlValue } from '../db';

const MEAL_LABELS: Record<Meal, string> = { desayuno: 'Desayuno', comida: 'Comida', merienda: 'Merienda', cena: 'Cena' };

export const MEALS: { key: Meal; label: string }[] = MEAL_KEYS.map((key) => ({ key, label: MEAL_LABELS[key] }));

/** A food of a plan: of a weekday (`planId` null) or of a plan of the user's (`weekday` null). */
export interface DietItem extends PlannedFood {
  foodId: number;
  foodName: string;
}

export async function listDietItems(db: Db): Promise<DietItem[]> {
  // The weekday of a food of a plan means nothing (see migration 15): it is read as null.
  return db.getAllAsync<DietItem>(
    `SELECT d.id, CASE WHEN d.plan_id IS NULL THEN d.weekday END AS weekday, d.plan_id AS planId, d.meal,
            d.food_id AS foodId, f.name AS foodName, d.grams,
            f.fat_per_100g AS fatPer100g, f.carbs_per_100g AS carbsPer100g, f.protein_per_100g AS proteinPer100g
     FROM diet_item d JOIN food f ON f.id = d.food_id
     ORDER BY d.plan_id IS NOT NULL, d.plan_id, d.weekday, d.position, d.id`,
  );
}

export interface Food {
  id: number;
  name: string;
  fatPer100g: number;
  carbsPer100g: number;
  proteinPer100g: number;
}

export type FoodFields = Omit<Food, 'id'>;

const FOOD_SELECT = `
  SELECT id, name, fat_per_100g AS fatPer100g, carbs_per_100g AS carbsPer100g, protein_per_100g AS proteinPer100g
  FROM food`;

export async function listFoods(db: Db): Promise<Food[]> {
  return db.getAllAsync<Food>(`${FOOD_SELECT} WHERE archived = 0 ORDER BY name COLLATE NOCASE`);
}

export async function getFood(db: Db, id: number): Promise<Food | null> {
  return db.getFirstAsync<Food>(`${FOOD_SELECT} WHERE id = ?`, id);
}

export async function foodNameTaken(db: Db, name: string, exceptId?: number): Promise<boolean> {
  const row = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM food WHERE name = ? COLLATE NOCASE AND archived = 0 AND id IS NOT ?',
    name.trim(),
    exceptId ?? null,
  );
  return row !== null;
}

export async function updateFood(db: Db, id: number, f: FoodFields): Promise<void> {
  await db.runAsync(
    'UPDATE food SET name = ?, fat_per_100g = ?, carbs_per_100g = ?, protein_per_100g = ? WHERE id = ?',
    f.name.trim(),
    f.fatPer100g,
    f.carbsPer100g,
    f.proteinPer100g,
    id,
  );
}

/** Creates a food; an archived one with the same name is brought back instead. */
export async function createFood(db: Db, f: FoodFields): Promise<number> {
  const archived = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM food WHERE name = ? COLLATE NOCASE AND archived = 1',
    f.name.trim(),
  );
  if (archived) {
    await updateFood(db, archived.id, f);
    await db.runAsync('UPDATE food SET archived = 0 WHERE id = ?', archived.id);
    return archived.id;
  }
  const result = await db.runAsync(
    'INSERT INTO food (name, fat_per_100g, carbs_per_100g, protein_per_100g) VALUES (?, ?, ?, ?)',
    f.name.trim(),
    f.fatPer100g,
    f.carbsPer100g,
    f.proteinPer100g,
  );
  return result.lastInsertRowId;
}

/** Hides it from the catalog; days of the plan that use it keep it. */
export async function archiveFood(db: Db, id: number): Promise<void> {
  await db.runAsync('UPDATE food SET archived = 1 WHERE id = ?', id);
}

/** The rows of a plan in SQL: those of a weekday are the ones of no plan of the user's. */
function whereSource(source: DietSource): { sql: string; params: SqlValue[] } {
  return source.kind === 'weekday'
    ? { sql: 'plan_id IS NULL AND weekday = ?', params: [source.weekday] }
    : { sql: 'plan_id = ?', params: [source.planId] };
}

/** The columns that say whose a food is; a food of a plan carries a weekday that means nothing. */
const ownerColumns = (source: DietSource): [number, number | null] =>
  source.kind === 'weekday' ? [source.weekday, null] : [1, source.planId];

export async function addDietItem(db: Db, to: DietSource, meal: Meal, foodId: number, grams: number): Promise<number> {
  const where = whereSource(to);
  const row = await db.getFirstAsync<{ next: number }>(
    `SELECT COALESCE(MAX(position), -1) + 1 AS next FROM diet_item WHERE ${where.sql}`,
    ...where.params,
  );
  const result = await db.runAsync(
    'INSERT INTO diet_item (weekday, plan_id, meal, food_id, grams, position) VALUES (?, ?, ?, ?, ?, ?)',
    ...ownerColumns(to),
    meal,
    foodId,
    grams,
    row?.next ?? 0,
  );
  return result.lastInsertRowId;
}

/** The grams of the plan; if it is ticked on `today`, what was eaten today follows (older days keep theirs). */
export async function updateDietItemGrams(db: Db, id: number, grams: number, today: string): Promise<void> {
  await db.runAsync('UPDATE diet_item SET grams = ? WHERE id = ?', grams, id);
  await db.runAsync('UPDATE diet_log SET grams = ? WHERE item_id = ? AND date = ?', grams, id, today);
}

export async function deleteDietItem(db: Db, id: number): Promise<void> {
  await db.runAsync('DELETE FROM diet_item WHERE id = ?', id);
}

/** A row of the plan as stored, to put it back exactly as it was («Deshacer»). */
export interface StoredDietItem {
  id: number;
  weekday: IsoWeekday;
  planId: number | null;
  meal: Meal;
  foodId: number;
  grams: number;
  position: number;
}

/** A tick as stored, to put it back with the food it was of. */
export interface StoredTick {
  id: number;
  date: string;
  meal: Meal;
  foodId: number;
  grams: number;
  itemId: number;
  createdAt: number;
}

/** Foods taken out of the plan and their ticks of today, which go with them. */
export interface RemovedDiet {
  items: StoredDietItem[];
  ticks: StoredTick[];
}

const STORED_SELECT = 'SELECT id, weekday, plan_id AS planId, meal, food_id AS foodId, grams, position FROM diet_item';

/**
 * Today's ticks of foods about to leave the plan are taken away with them: a food that is no
 * longer on the list cannot stay eaten today. Older days keep theirs (without the food's row).
 */
async function takeTicks(db: Db, itemIds: number[], today: string): Promise<StoredTick[]> {
  if (itemIds.length === 0) return [];
  const marks = itemIds.map(() => '?').join(', ');
  const ticks = await db.getAllAsync<StoredTick>(
    `SELECT id, date, meal, food_id AS foodId, grams, item_id AS itemId, created_at AS createdAt
     FROM diet_log WHERE date = ? AND item_id IN (${marks}) ORDER BY id`,
    today,
    ...itemIds,
  );
  await db.runAsync(`DELETE FROM diet_log WHERE date = ? AND item_id IN (${marks})`, today, ...itemIds);
  return ticks;
}

async function insertStored(db: Db, { items, ticks }: RemovedDiet): Promise<void> {
  // Same ids and positions, so they reappear in their place; ignored if somehow back already.
  for (const item of items) {
    await db.runAsync(
      'INSERT OR IGNORE INTO diet_item (id, weekday, plan_id, meal, food_id, grams, position) VALUES (?, ?, ?, ?, ?, ?, ?)',
      item.id,
      item.weekday,
      item.planId,
      item.meal,
      item.foodId,
      item.grams,
      item.position,
    );
  }
  for (const tick of ticks) {
    await db.runAsync(
      'INSERT OR IGNORE INTO diet_log (id, date, meal, food_id, grams, item_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      tick.id,
      tick.date,
      tick.meal,
      tick.foodId,
      tick.grams,
      tick.itemId,
      tick.createdAt,
    );
  }
}

/** Removes a food from its plan and returns it, so «Deshacer» can bring it back with its grams and its tick of today. */
export async function removeDietItem(db: Db, id: number, today: string): Promise<RemovedDiet | null> {
  const item = await db.getFirstAsync<StoredDietItem>(`${STORED_SELECT} WHERE id = ?`, id);
  if (!item) return null;
  let ticks: StoredTick[] = [];
  await db.withTransactionAsync(async () => {
    ticks = await takeTicks(db, [id], today);
    await deleteDietItem(db, id);
  });
  return { items: [item], ticks };
}

export async function restoreDietItem(db: Db, removed: RemovedDiet): Promise<void> {
  await db.withTransactionAsync(() => insertStored(db, removed));
}

/**
 * Replaces the plan of each target weekday with a copy of `from` (a weekday or a plan of the
 * user's). Returns what it replaced, for restoreDietDays.
 */
export async function copyDietDay(db: Db, from: DietSource, to: IsoWeekday[], today: string): Promise<RemovedDiet> {
  const targets = to.filter((d) => !(from.kind === 'weekday' && from.weekday === d));
  const replaced: RemovedDiet = { items: [], ticks: [] };
  if (targets.length === 0) return replaced;
  const source = whereSource(from);
  await db.withTransactionAsync(async () => {
    replaced.items = await db.getAllAsync<StoredDietItem>(
      `${STORED_SELECT} WHERE plan_id IS NULL AND weekday IN (${targets.map(() => '?').join(', ')}) ORDER BY weekday, position, id`,
      ...targets,
    );
    replaced.ticks = await takeTicks(db, replaced.items.map((i) => i.id), today);
    for (const day of targets) {
      await db.runAsync('DELETE FROM diet_item WHERE plan_id IS NULL AND weekday = ?', day);
      await db.runAsync(
        `INSERT INTO diet_item (weekday, meal, food_id, grams, position)
         SELECT ?, meal, food_id, grams, position FROM diet_item WHERE ${source.sql} ORDER BY position, id`,
        day,
        ...source.params,
      );
    }
  });
  return replaced;
}

/** Undoes copyDietDay: `days` get back exactly the foods they had, and their ticks of today. */
export async function restoreDietDays(db: Db, days: IsoWeekday[], replaced: RemovedDiet): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (const day of days) await db.runAsync('DELETE FROM diet_item WHERE plan_id IS NULL AND weekday = ?', day);
    await insertStored(db, replaced);
  });
}

/** A plan of a day of the user's («Día de descanso», «Comida fuera»): four meals, like a weekday. */
export interface DietPlan {
  id: number;
  name: string;
}

export async function listDietPlans(db: Db): Promise<DietPlan[]> {
  return db.getAllAsync<DietPlan>('SELECT id, name FROM diet_plan ORDER BY position, id');
}

export async function dietPlanNameTaken(db: Db, name: string, exceptId?: number): Promise<boolean> {
  const row = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM diet_plan WHERE name = ? COLLATE NOCASE AND id IS NOT ?',
    name.trim(),
    exceptId ?? null,
  );
  return row !== null;
}

/** A new plan, empty or starting as a copy of `copyFrom` (a weekday or another plan). */
export async function createDietPlan(db: Db, name: string, copyFrom: DietSource | null = null): Promise<number> {
  let id = 0;
  await db.withTransactionAsync(async () => {
    const row = await db.getFirstAsync<{ next: number }>('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM diet_plan');
    id = (await db.runAsync('INSERT INTO diet_plan (name, position) VALUES (?, ?)', name.trim(), row?.next ?? 0)).lastInsertRowId;
    if (!copyFrom) return;
    const source = whereSource(copyFrom);
    await db.runAsync(
      `INSERT INTO diet_item (weekday, plan_id, meal, food_id, grams, position)
       SELECT 1, ?, meal, food_id, grams, position FROM diet_item WHERE ${source.sql} ORDER BY position, id`,
      id,
      ...source.params,
    );
  });
  return id;
}

export async function renameDietPlan(db: Db, id: number, name: string): Promise<void> {
  await db.runAsync('UPDATE diet_plan SET name = ? WHERE id = ?', name.trim(), id);
}

/**
 * Deletes a plan with its foods. The meals of any date that followed it go back to their weekday,
 * and today's ticks of its foods go with them; what was ticked on older days stays.
 */
export async function deleteDietPlan(db: Db, id: number, today: string): Promise<void> {
  await db.withTransactionAsync(async () => {
    const items = await db.getAllAsync<{ id: number }>('SELECT id FROM diet_item WHERE plan_id = ?', id);
    await takeTicks(db, items.map((i) => i.id), today);
    // Its foods and the meals that followed it go with it (ON DELETE CASCADE).
    await db.runAsync('DELETE FROM diet_plan WHERE id = ?', id);
  });
}

/** The meals of `date` that follow another plan than its weekday's. */
export async function dietDayOverrides(db: Db, date: string): Promise<MealOverride[]> {
  const rows = await db.getAllAsync<{ meal: Meal; weekday: IsoWeekday | null; planId: number | null }>(
    'SELECT meal, weekday, plan_id AS planId FROM diet_day_meal WHERE date = ?',
    date,
  );
  return rows
    .filter((r) => MEAL_KEYS.includes(r.meal))
    .map((r) => ({ meal: r.meal, source: r.planId !== null ? planSource(r.planId) : weekdaySource(r.weekday!) }));
}

/** Replaces what `date` says of its meals: only those that do not follow its weekday are kept. */
export async function setDietDayOverrides(db: Db, date: string, overrides: MealOverride[]): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM diet_day_meal WHERE date = ?', date);
    for (const { meal, source } of overrides) {
      await db.runAsync(
        'INSERT INTO diet_day_meal (date, meal, weekday, plan_id) VALUES (?, ?, ?, ?)',
        date,
        meal,
        source.kind === 'weekday' ? source.weekday : null,
        source.kind === 'plan' ? source.planId : null,
      );
    }
  });
}

/** Something ticked on a date, with its food's macros. */
export interface DietLogEntry extends EatenFood {
  id: number;
  foodId: number;
}

/** What is ticked as eaten on `date`. */
export async function dietLogOn(db: Db, date: string): Promise<DietLogEntry[]> {
  return db.getAllAsync<DietLogEntry>(
    `SELECT l.id, l.item_id AS itemId, l.meal, l.food_id AS foodId, l.grams,
            f.fat_per_100g AS fatPer100g, f.carbs_per_100g AS carbsPer100g, f.protein_per_100g AS proteinPer100g
     FROM diet_log l JOIN food f ON f.id = l.food_id
     WHERE l.date = ? ORDER BY l.id`,
    date,
  );
}

/**
 * Ticks foods of the plan as eaten on `date`, or unticks them. A tick copies what the plan says now
 * (meal, food and grams): the plan may change later, what was eaten that day does not.
 */
export async function setEaten(db: Db, date: string, itemIds: number[], eaten: boolean, now: number): Promise<void> {
  if (itemIds.length === 0) return;
  await db.withTransactionAsync(async () => {
    for (const id of itemIds) {
      if (eaten) {
        await db.runAsync(
          `INSERT INTO diet_log (date, meal, food_id, grams, item_id, created_at)
           SELECT ?, meal, food_id, grams, id, ? FROM diet_item
           WHERE id = ? AND NOT EXISTS (SELECT 1 FROM diet_log WHERE date = ? AND item_id = ?)`,
          date,
          now,
          id,
          date,
          id,
        );
      } else {
        await db.runAsync('DELETE FROM diet_log WHERE date = ? AND item_id = ?', date, id);
      }
    }
  });
}

/** What was ticked each day from `from` to `to` (local dates): its macros and in how many meals. Days with nothing are not there. */
export async function eatenByDate(db: Db, from: string, to: string): Promise<Map<string, { macros: Macros; meals: number }>> {
  const rows = await db.getAllAsync<{ date: string } & EatenFood>(
    `SELECT l.date, l.item_id AS itemId, l.meal, l.grams,
            f.fat_per_100g AS fatPer100g, f.carbs_per_100g AS carbsPer100g, f.protein_per_100g AS proteinPer100g
     FROM diet_log l JOIN food f ON f.id = l.food_id
     WHERE l.date BETWEEN ? AND ? ORDER BY l.date, l.id`,
    from,
    to,
  );
  const byDate = new Map<string, (typeof rows)[number][]>();
  for (const row of rows) byDate.set(row.date, [...(byDate.get(row.date) ?? []), row]);
  return new Map(
    [...byDate].map(([date, day]) => [
      date,
      { macros: sumMacros(day.map((e) => macrosFor(e, e.grams))), meals: new Set(day.map((e) => e.meal)).size },
    ]),
  );
}

/** Everything a day of the diet is made of: the plans, what `date` says of its meals and what is ticked. */
export async function loadDietDay(db: Db, date: string) {
  return {
    items: await listDietItems(db),
    plans: await listDietPlans(db),
    overrides: await dietDayOverrides(db, date),
    eaten: await dietLogOn(db, date),
  };
}
