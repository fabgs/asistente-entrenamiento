import type { IsoWeekday } from '@/domain/types';
import type { Meal } from '../seedTypes';
import type { Db } from '../db';

export const MEALS: { key: Meal; label: string }[] = [
  { key: 'desayuno', label: 'Desayuno' },
  { key: 'comida', label: 'Comida' },
  { key: 'merienda', label: 'Merienda' },
  { key: 'cena', label: 'Cena' },
];

export interface DietItem {
  id: number;
  weekday: IsoWeekday;
  meal: Meal;
  foodId: number;
  foodName: string;
  grams: number;
  fatPer100g: number;
  carbsPer100g: number;
  proteinPer100g: number;
}

export async function listDietItems(db: Db): Promise<DietItem[]> {
  return db.getAllAsync<DietItem>(
    `SELECT d.id, d.weekday, d.meal, d.food_id AS foodId, f.name AS foodName, d.grams,
            f.fat_per_100g AS fatPer100g, f.carbs_per_100g AS carbsPer100g, f.protein_per_100g AS proteinPer100g
     FROM diet_item d JOIN food f ON f.id = d.food_id
     ORDER BY d.weekday, d.position, d.id`,
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

export async function addDietItem(db: Db, weekday: IsoWeekday, meal: Meal, foodId: number, grams: number): Promise<number> {
  const row = await db.getFirstAsync<{ next: number }>(
    'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM diet_item WHERE weekday = ?',
    weekday,
  );
  const result = await db.runAsync(
    'INSERT INTO diet_item (weekday, meal, food_id, grams, position) VALUES (?, ?, ?, ?, ?)',
    weekday,
    meal,
    foodId,
    grams,
    row?.next ?? 0,
  );
  return result.lastInsertRowId;
}

export async function updateDietItemGrams(db: Db, id: number, grams: number): Promise<void> {
  await db.runAsync('UPDATE diet_item SET grams = ? WHERE id = ?', grams, id);
}

export async function deleteDietItem(db: Db, id: number): Promise<void> {
  await db.runAsync('DELETE FROM diet_item WHERE id = ?', id);
}

/** A row of the plan as stored, to put it back exactly as it was («Deshacer»). */
export interface StoredDietItem {
  id: number;
  weekday: IsoWeekday;
  meal: Meal;
  foodId: number;
  grams: number;
  position: number;
}

const STORED_SELECT = 'SELECT id, weekday, meal, food_id AS foodId, grams, position FROM diet_item';

/** Removes an item and returns it, so «Deshacer» can bring it back with its grams. */
export async function removeDietItem(db: Db, id: number): Promise<StoredDietItem | null> {
  const item = await db.getFirstAsync<StoredDietItem>(`${STORED_SELECT} WHERE id = ?`, id);
  if (item) await deleteDietItem(db, id);
  return item;
}

async function insertStored(db: Db, item: StoredDietItem): Promise<void> {
  // Same id and position, so it reappears in its place; ignored if it is somehow back already.
  await db.runAsync(
    'INSERT OR IGNORE INTO diet_item (id, weekday, meal, food_id, grams, position) VALUES (?, ?, ?, ?, ?, ?)',
    item.id,
    item.weekday,
    item.meal,
    item.foodId,
    item.grams,
    item.position,
  );
}

export async function restoreDietItem(db: Db, item: StoredDietItem): Promise<void> {
  await insertStored(db, item);
}

/**
 * Replaces the plan of each target day with a copy of `from`. Returns the items it replaced, for
 * restoreDietDays.
 */
export async function copyDietDay(db: Db, from: IsoWeekday, to: IsoWeekday[]): Promise<StoredDietItem[]> {
  const targets = to.filter((d) => d !== from);
  if (targets.length === 0) return [];
  let replaced: StoredDietItem[] = [];
  await db.withTransactionAsync(async () => {
    replaced = await db.getAllAsync<StoredDietItem>(
      `${STORED_SELECT} WHERE weekday IN (${targets.map(() => '?').join(', ')}) ORDER BY weekday, position, id`,
      ...targets,
    );
    for (const day of targets) {
      await db.runAsync('DELETE FROM diet_item WHERE weekday = ?', day);
      await db.runAsync(
        `INSERT INTO diet_item (weekday, meal, food_id, grams, position)
         SELECT ?, meal, food_id, grams, position FROM diet_item WHERE weekday = ? ORDER BY position, id`,
        day,
        from,
      );
    }
  });
  return replaced;
}

/** Undoes copyDietDay: `days` get back exactly the items they had. */
export async function restoreDietDays(db: Db, days: IsoWeekday[], items: StoredDietItem[]): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (const day of days) await db.runAsync('DELETE FROM diet_item WHERE weekday = ?', day);
    for (const item of items) await insertStored(db, item);
  });
}
