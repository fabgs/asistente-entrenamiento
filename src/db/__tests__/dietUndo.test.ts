import type { IsoWeekday } from '@/domain/types';
import type { Db } from '../db';
import { DEMO_SEED } from '../demoSeed';
import {
  copyDietDay,
  listDietItems,
  removeDietItem,
  restoreDietDays,
  restoreDietItem,
} from '../repositories/diet';
import { importSeed } from '../seed';
import { createTestDb } from './testDb';

async function seededDb(): Promise<Db> {
  const db = await createTestDb();
  await importSeed(db, DEMO_SEED, new Date(2026, 10, 3));
  return db;
}

const day = async (db: Db, weekday: IsoWeekday) => (await listDietItems(db)).filter((i) => i.weekday === weekday);
const shape = (items: Awaited<ReturnType<typeof day>>) => items.map((i) => [i.id, i.meal, i.foodName, i.grams]);

describe('undo in the diet plan', () => {
  it('puts a removed food back in its place with its grams', async () => {
    const db = await seededDb();
    const before = await day(db, 2);
    const middle = before[1];

    const removed = await removeDietItem(db, middle.id);
    expect(removed).toMatchObject({ id: middle.id, weekday: 2, meal: middle.meal, grams: middle.grams });
    expect((await day(db, 2)).some((i) => i.id === middle.id)).toBe(false);

    await restoreDietItem(db, removed!);
    expect(shape(await day(db, 2))).toEqual(shape(before));
  });

  it('returns null when the item no longer exists', async () => {
    const db = await seededDb();
    expect(await removeDietItem(db, 99_999)).toBeNull();
  });

  it('undoes copying a day over others', async () => {
    const db = await seededDb();
    const tuesday = await day(db, 2);
    const thursday = await day(db, 4);
    const sunday = await day(db, 7);

    const replaced = await copyDietDay(db, 1, [4, 7]);
    expect(replaced).toHaveLength(thursday.length + sunday.length);
    expect((await day(db, 4)).map((i) => i.foodName)).toEqual((await day(db, 1)).map((i) => i.foodName));

    await restoreDietDays(db, [4, 7], replaced);
    expect(shape(await day(db, 4))).toEqual(shape(thursday));
    expect(shape(await day(db, 7))).toEqual(shape(sunday));
    expect(shape(await day(db, 2))).toEqual(shape(tuesday));
  });

  it('copies nothing onto the same day', async () => {
    const db = await seededDb();
    const monday = await day(db, 1);
    expect(await copyDietDay(db, 1, [1])).toEqual([]);
    expect(shape(await day(db, 1))).toEqual(shape(monday));
  });
});
