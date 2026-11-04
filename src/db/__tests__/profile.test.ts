import {
  countWeights,
  deleteWeight,
  getProfile,
  latestWeight,
  listWeightsPage,
  loadNutritionTargets,
  logWeight,
  nutritionTargetsOf,
  updateProfile,
} from '../repositories/settings';
import { importSeed } from '../seed';
import { SEED } from '../seedData';
import { createTestDb } from './testDb';

const TODAY = '2026-11-03';

async function freshDb() {
  const db = await createTestDb();
  await importSeed(db, SEED, new Date(2026, 10, 3));
  return db;
}

describe('profile and daily targets', () => {
  it('has no targets until birth date, height and weight are known', async () => {
    const db = await freshDb();
    expect(await loadNutritionTargets(db, TODAY)).toBeNull();
    await updateProfile(db, { birthDate: '2002-06-25', heightCm: 184 });
    expect(await loadNutritionTargets(db, TODAY)).toBeNull();
    await logWeight(db, TODAY, 84);
    // PLAN.md §4: 84 kg, 184 cm, 24 years, male, 1.5, deficit 400.
    expect((await loadNutritionTargets(db, TODAY))!.targetKcal).toBeCloseTo(2412.5);
  });

  it('computes the same targets for a profile being edited', async () => {
    const db = await freshDb();
    const profile = { ...(await getProfile(db)), birthDate: '2002-06-25', heightCm: 184, deficitKcal: -300 };
    const targets = nutritionTargetsOf(profile, 84, TODAY)!;
    expect(targets.tdee).toBeCloseTo(2812.5);
    // A negative deficit is a surplus.
    expect(targets.targetKcal).toBeCloseTo(3112.5);
    expect(nutritionTargetsOf({ ...profile, heightCm: null }, 84, TODAY)).toBeNull();
    expect(nutritionTargetsOf(profile, null, TODAY)).toBeNull();
  });

  it('replaces the weight of the same day and never deletes the only weigh-in', async () => {
    const db = await freshDb();
    await logWeight(db, '2026-11-01', 84.6);
    await logWeight(db, TODAY, 84.2);
    await logWeight(db, TODAY, 84.3);
    expect(await latestWeight(db)).toBe(84.3);

    expect(await deleteWeight(db, TODAY)).toBe(true);
    expect(await latestWeight(db)).toBe(84.6);
    expect(await deleteWeight(db, '2026-11-01')).toBe(false);
    expect(await latestWeight(db)).toBe(84.6);
  });
});

describe('all the weigh-ins, a page at a time', () => {
  it('reads them newest first, page after page', async () => {
    const db = await freshDb();
    for (let day = 1; day <= 25; day++) await logWeight(db, `2026-10-${String(day).padStart(2, '0')}`, 80 + day / 10);
    expect(await countWeights(db)).toBe(25);
    const first = await listWeightsPage(db, 10, 0);
    expect(first.map((w) => w.date)).toEqual(Array.from({ length: 10 }, (_, i) => `2026-10-${25 - i}`));
    const last = await listWeightsPage(db, 10, 20);
    expect(last.map((w) => w.date)).toEqual(['2026-10-05', '2026-10-04', '2026-10-03', '2026-10-02', '2026-10-01']);
    expect(await listWeightsPage(db, 10, 30)).toEqual([]);
  });
});
