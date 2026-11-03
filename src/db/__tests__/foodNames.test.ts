import { normalizeForSearch } from '@/domain/format';
import type { Db } from '../db';
import { DEMO_SEED } from '../demoSeed';
import { exportBackup, resetData, restoreBackup } from '../maintenance';
import { FOOD_RENAMES, MIGRATIONS, migrate } from '../migrations';
import { listDietItems, listFoods } from '../repositories/diet';
import { importSeed } from '../seed';
import { SEED } from '../seedData';
import { createTestDb } from './testDb';

const NOW = new Date(2026, 10, 3, 7, 0);

async function addFood(db: Db, name: string, archived = 0): Promise<number> {
  return (
    await db.runAsync(
      'INSERT INTO food (name, fat_per_100g, carbs_per_100g, protein_per_100g, archived) VALUES (?, 0.3, 23, 1.1, ?)',
      name,
      archived,
    )
  ).lastInsertRowId;
}

const names = async (db: Db) =>
  (await db.getAllAsync<{ name: string }>('SELECT name FROM food ORDER BY id')).map((f) => f.name);

describe('accents in food names (migration 6)', () => {
  it('renames a food that still has the old name, keeping its id and the plan that uses it', async () => {
    const db = await createTestDb({ upTo: 5 });
    const id = await addFood(db, 'Platano');
    await addFood(db, 'Atun lata', 1);
    await db.runAsync("INSERT INTO diet_item (weekday, meal, food_id, grams) VALUES (2, 'merienda', ?, 120)", id);

    await migrate(db);

    expect(await names(db)).toEqual(['Plátano', 'Atún en lata']);
    expect((await listDietItems(db))[0]).toMatchObject({ foodId: id, foodName: 'Plátano', grams: 120 });
    expect((await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))!.user_version).toBe(
      MIGRATIONS.length,
    );
  });

  it('does not touch anything if the new name already exists', async () => {
    const db = await createTestDb({ upTo: 5 });
    await addFood(db, 'Platano');
    await addFood(db, 'Plátano');
    await addFood(db, 'Salmon');
    await addFood(db, 'salmón');

    await migrate(db);

    expect(await names(db)).toEqual(['Platano', 'Plátano', 'Salmon', 'salmón']);
  });

  it('only renames the exact old name', async () => {
    const db = await createTestDb({ upTo: 5 });
    await addFood(db, 'platano');
    await addFood(db, 'Platano maduro');

    await migrate(db);

    expect(await names(db)).toEqual(['platano', 'Platano maduro']);
  });

  it('fixes every food of the first catalogue', async () => {
    const db = await createTestDb({ upTo: 5 });
    for (const [from] of FOOD_RENAMES) await addFood(db, from);

    await migrate(db);

    expect(await names(db)).toEqual(FOOD_RENAMES.map(([, to]) => to));
  });
});

describe('accents in backups and test data', () => {
  async function oldBackup() {
    // A copy made before migration 6: the Excel data still has the names without accents.
    const source = await createTestDb();
    await importSeed(source, DEMO_SEED, NOW);
    const backup = await exportBackup(source, NOW);
    return { ...backup, schemaVersion: 5 };
  }

  it('fixes the names when restoring a backup from before migration 6', async () => {
    const backup = await oldBackup();
    expect(backup.tables.food!.some((f) => f.name === 'Platano')).toBe(true);

    const db = await createTestDb();
    await restoreBackup(db, backup);

    const foods = (await listFoods(db)).map((f) => f.name);
    expect(foods).toEqual(expect.arrayContaining(['Plátano', 'Proteína', 'Yogur griego', 'Atún en lata']));
    expect(foods).not.toContain('Platano');
    // The plan still points at the same foods.
    expect((await listDietItems(db)).some((i) => i.foodName === 'Plátano')).toBe(true);
  });

  it('leaves the names of a newer backup as they are', async () => {
    const backup = { ...(await oldBackup()), schemaVersion: 6 };
    const db = await createTestDb();
    await restoreBackup(db, backup);
    expect((await listFoods(db)).some((f) => f.name === 'Platano')).toBe(true);
  });

  it('fixes the names of the Excel test data when loading it', async () => {
    const db = await createTestDb();
    await importSeed(db, SEED, NOW);
    await resetData(db, DEMO_SEED, NOW);
    const foods = (await listFoods(db)).map((f) => f.name);
    expect(foods).toContain('Plátano');
    expect(foods).not.toContain('Platano');
  });
});

describe('catalogue of a new install', () => {
  it('has the names with their accents', () => {
    const foods = SEED.foods.map((f) => f.name);
    for (const [from, to] of FOOD_RENAMES) {
      expect(foods).toContain(to);
      expect(foods).not.toContain(from);
    }
  });

  it('finds «Plátano» when searching «platano»', () => {
    const found = SEED.foods.filter((f) => normalizeForSearch(f.name).includes(normalizeForSearch('platano')));
    expect(found.map((f) => f.name)).toEqual(['Plátano']);
  });
});
