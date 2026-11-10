import { weekdaySource } from '@/domain/diet';
import type { Db } from '../db';
import {
  addDietItem,
  archiveFood,
  copyDietDay,
  createFood,
  deleteDietItem,
  foodNameTaken,
  listDietItems,
  listFoods,
  updateDietItemGrams,
  updateFood,
} from '../repositories/diet';
import { importSeed } from '../seed';
import { DEMO_SEED as SEED } from '../demoSeed';
import { createTestDb } from './testDb';

async function seededDb(): Promise<Db> {
  const db = await createTestDb();
  await importSeed(db, SEED, new Date(2026, 10, 2));
  return db;
}

const TODAY = '2026-11-02';

const day = async (db: Db, weekday: number) => (await listDietItems(db)).filter((i) => i.weekday === weekday);

describe('food catalog', () => {
  it('creates, edits and detects duplicate names', async () => {
    const db = await seededDb();
    expect(await foodNameTaken(db, 'LECHE ENTERA')).toBe(true);
    const id = await createFood(db, { name: 'Avena', fatPer100g: 7, carbsPer100g: 59, proteinPer100g: 13.5 });
    await updateFood(db, id, { name: 'Copos de avena', fatPer100g: 7, carbsPer100g: 60, proteinPer100g: 13 });
    expect((await listFoods(db)).find((f) => f.id === id)).toMatchObject({ name: 'Copos de avena', carbsPer100g: 60 });
  });

  it('archives a food without removing it from the plan', async () => {
    const db = await seededDb();
    const milk = (await listFoods(db)).find((f) => f.name === 'Leche entera')!;
    await archiveFood(db, milk.id);
    expect((await listFoods(db)).some((f) => f.id === milk.id)).toBe(false);
    expect((await day(db, 1)).some((i) => i.foodId === milk.id)).toBe(true);
  });

  it('brings back an archived food with the same name', async () => {
    const db = await seededDb();
    const kiwi = (await listFoods(db)).find((f) => f.name === 'Kiwi')!;
    await archiveFood(db, kiwi.id);
    expect(await createFood(db, { name: 'kiwi', fatPer100g: 0.5, carbsPer100g: 15, proteinPer100g: 1 })).toBe(kiwi.id);
    expect((await listFoods(db)).some((f) => f.id === kiwi.id)).toBe(true);
  });
});

describe('weekly plan', () => {
  it('adds, changes and removes foods in a meal', async () => {
    const db = await seededDb();
    const before = (await day(db, 3)).length;
    const food = (await listFoods(db))[0];
    const id = await addDietItem(db, weekdaySource(3), 'cena', food.id, 150);
    expect((await day(db, 3)).at(-1)).toMatchObject({ id, meal: 'cena', grams: 150 });

    await updateDietItemGrams(db, id, 200, TODAY);
    expect((await day(db, 3)).find((i) => i.id === id)?.grams).toBe(200);

    await deleteDietItem(db, id);
    expect(await day(db, 3)).toHaveLength(before);
  });

  it('copies a day over other days, keeping the source as is', async () => {
    const db = await seededDb();
    const monday = await day(db, 1);
    await copyDietDay(db, weekdaySource(1), [2, 1, 6], TODAY);

    const shape = (items: Awaited<ReturnType<typeof day>>) => items.map((i) => [i.meal, i.foodName, i.grams]);
    expect(shape(await day(db, 2))).toEqual(shape(monday));
    expect(shape(await day(db, 6))).toEqual(shape(monday));
    expect(shape(await day(db, 1))).toEqual(shape(monday));
    expect((await day(db, 3)).length).toBeGreaterThan(0);
  });
});
