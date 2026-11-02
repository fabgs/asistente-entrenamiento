import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SEED } from '../seedData';
import { importSeed } from '../seed';
import { createTestDb } from './testDb';

const NOW = new Date(2026, 10, 2, 7, 0);

const count = async (db: Awaited<ReturnType<typeof createTestDb>>, table: string) =>
  (await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))!.n;

describe('first-install seed', () => {
  it('only carries the exercise and food catalogues', () => {
    expect(SEED.exercises).toHaveLength(22);
    expect(SEED.foods).toHaveLength(34);
    expect(SEED.routines).toEqual([]);
    expect(SEED.cardio).toEqual([]);
    expect(SEED.dietPlan).toEqual([]);
    expect(SEED.profile).toMatchObject({ birthDate: null, heightCm: null, weightKg: null });
  });

  it('starts an empty plan and is imported only once', async () => {
    const db = await createTestDb();
    expect(await importSeed(db, SEED, NOW)).toBe(true);
    expect(await count(db, 'exercise')).toBe(22);
    expect(await count(db, 'food')).toBe(34);
    for (const table of ['routine', 'routine_slot', 'cardio_activity', 'diet_item', 'weight_log', 'workout_session']) {
      expect(await count(db, table)).toBe(0);
    }
    expect(await count(db, 'profile')).toBe(1);
    // No routines yet, but the profile exists: opening the app again must not import twice.
    expect(await importSeed(db, SEED, NOW)).toBe(false);
    expect(await count(db, 'exercise')).toBe(22);
  });

  it('keeps the Excel data out of the app code', () => {
    const src = join(__dirname, '..', '..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          if (name !== '__tests__') walk(path);
        } else if (/\.tsx?$/.test(name) && !path.endsWith('demoSeed.ts')) {
          const code = readFileSync(path, 'utf8');
          const imports = code.match(/(from|require\()\s*'[^']+'/g) ?? [];
          const excel = imports.some((i) => i.includes('seed.json'));
          const demo = imports.some((i) => i.includes('demoSeed')) && !code.includes('__DEV__');
          if (excel || demo) offenders.push(path);
        }
      }
    };
    walk(src);
    expect(offenders).toEqual([]);
  });
});
