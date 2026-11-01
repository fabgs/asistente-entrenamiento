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
