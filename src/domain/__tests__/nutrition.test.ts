import seedJson from '../../../data/seed/seed.json';
import type { SeedData } from '@/db/seedTypes';
import { ageOn, averageMacros, computeTargets, deviation, macrosFor, sumMacros } from '../nutrition';

const seed = seedJson as SeedData;

describe('computeTargets (PLAN.md §4)', () => {
  const t = computeTargets({
    sex: 'male',
    heightCm: 184,
    weightKg: 84,
    age: 24,
    activityFactor: 1.5,
    deficitKcal: 400,
    proteinGPerKg: 2,
    fatGPerKg: 1,
    waterLPerKg: 0.035,
  });

  it('matches the reference values', () => {
    expect(t.bmr).toBeCloseTo(1875);
    expect(t.tdee).toBeCloseTo(2812.5);
    expect(t.targetKcal).toBeCloseTo(2412.5);
    expect(t.proteinG).toBeCloseTo(168);
    expect(t.fatG).toBeCloseTo(84);
    expect(t.carbsG).toBeCloseTo(246.125);
    expect(t.waterL).toBeCloseTo(2.94);
    expect(t.bmi).toBeCloseTo(24.81, 2);
  });

  it('uses the female constant', () => {
    const female = computeTargets({
      sex: 'female',
      heightCm: 184,
      weightKg: 84,
      age: 24,
      activityFactor: 1,
      deficitKcal: 0,
      proteinGPerKg: 2,
      fatGPerKg: 1,
      waterLPerKg: 0.035,
    });
    expect(female.bmr).toBeCloseTo(1875 - 166);
  });
});

describe('ageOn', () => {
  it('counts full years', () => {
    expect(ageOn('1995-06-25', '2026-11-01')).toBe(31);
    expect(ageOn('1995-11-02', '2026-11-01')).toBe(30);
    expect(ageOn('1995-11-01', '2026-11-01')).toBe(31);
  });
});

describe('diet totals with the seed (PLAN.md §5)', () => {
  const foods = new Map(seed.foods.map((f) => [f.name, f]));
  const dayTotals = (weekday: number) =>
    sumMacros(
      seed.dietPlan
        .filter((i) => i.weekday === weekday)
        .map((i) => macrosFor(foods.get(i.food)!, i.grams)),
    );

  it('reproduces Monday from the Excel', () => {
    const monday = dayTotals(1);
    expect(monday.fat).toBeCloseTo(94.66, 2);
    expect(monday.carbs).toBeCloseTo(247.39, 2);
    expect(monday.protein).toBeCloseTo(157.71, 2);
    expect(monday.kcal).toBeCloseTo(2472.34, 2);
  });

  it('reproduces the weekly average from the Excel', () => {
    const days = [1, 2, 3, 4, 5, 6, 7].map(dayTotals);
    const avg = (k: 'fat' | 'carbs' | 'protein' | 'kcal') =>
      days.reduce((s, d) => s + d[k], 0) / days.length;
    expect(avg('fat')).toBeCloseTo(77.53, 2);
    expect(avg('carbs')).toBeCloseTo(236.4, 2);
    expect(avg('protein')).toBeCloseTo(166.28, 2);
    expect(avg('kcal')).toBeCloseTo(2308.45, 2);
  });
});

describe('deviation', () => {
  it('classifies how far the plan is from the target', () => {
    expect(deviation(2400, 2412.5)).toBe('ok');
    expect(deviation(2250, 2412.5)).toBe('near');
    expect(deviation(2700, 2412.5)).toBe('off');
    expect(deviation(100, 0)).toBe('ok');
  });
});

describe('averageMacros', () => {
  it('averages day totals', () => {
    expect(
      averageMacros([
        { fat: 10, carbs: 20, protein: 30, kcal: 290 },
        { fat: 20, carbs: 40, protein: 50, kcal: 540 },
      ]),
    ).toEqual({ fat: 15, carbs: 30, protein: 40, kcal: 415 });
  });
});
