export type Sex = 'male' | 'female';

export interface BodyProfile {
  sex: Sex;
  heightCm: number;
  weightKg: number;
  age: number;
  activityFactor: number;
  deficitKcal: number;
  proteinGPerKg: number;
  fatGPerKg: number;
  waterLPerKg: number;
}

export interface NutritionTargets {
  bmr: number;
  tdee: number;
  targetKcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  waterL: number;
  bmi: number;
}

export interface Macros {
  fat: number;
  carbs: number;
  protein: number;
  kcal: number;
}

export interface FoodPer100g {
  fatPer100g: number;
  carbsPer100g: number;
  proteinPer100g: number;
}

/** Full years between two local dates in 'YYYY-MM-DD' format. */
export function ageOn(birthDate: string, today: string): number {
  const [by, bm, bd] = birthDate.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  const hadBirthday = tm > bm || (tm === bm && td >= bd);
  return ty - by - (hadBirthday ? 0 : 1);
}

/** Mifflin-St Jeor BMR and the derived daily targets (PLAN.md §4). */
export function computeTargets(p: BodyProfile): NutritionTargets {
  const bmr = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age + (p.sex === 'male' ? 5 : -161);
  const tdee = bmr * p.activityFactor;
  const targetKcal = tdee - p.deficitKcal;
  const proteinG = p.weightKg * p.proteinGPerKg;
  const fatG = p.weightKg * p.fatGPerKg;
  const carbsG = (targetKcal - proteinG * 4 - fatG * 9) / 4;
  const heightM = p.heightCm / 100;
  return {
    bmr,
    tdee,
    targetKcal,
    proteinG,
    fatG,
    carbsG,
    waterL: p.weightKg * p.waterLPerKg,
    bmi: p.weightKg / (heightM * heightM),
  };
}

export function kcalOf(fat: number, carbs: number, protein: number): number {
  return fat * 9 + carbs * 4 + protein * 4;
}

export function macrosFor(food: FoodPer100g, grams: number): Macros {
  const k = grams / 100;
  const fat = food.fatPer100g * k;
  const carbs = food.carbsPer100g * k;
  const protein = food.proteinPer100g * k;
  return { fat, carbs, protein, kcal: kcalOf(fat, carbs, protein) };
}

export function sumMacros(items: Macros[]): Macros {
  return items.reduce(
    (acc, m) => ({
      fat: acc.fat + m.fat,
      carbs: acc.carbs + m.carbs,
      protein: acc.protein + m.protein,
      kcal: acc.kcal + m.kcal,
    }),
    { fat: 0, carbs: 0, protein: 0, kcal: 0 },
  );
}

export type Deviation = 'ok' | 'near' | 'off';

/** How far a planned amount is from its target: within 5 %, within 10 %, or further. */
export function deviation(value: number, target: number): Deviation {
  if (target <= 0) return 'ok';
  const off = Math.abs(value - target) / target;
  if (off <= 0.05) return 'ok';
  if (off <= 0.1) return 'near';
  return 'off';
}

export function averageMacros(days: Macros[]): Macros {
  const total = sumMacros(days);
  const n = Math.max(1, days.length);
  return { fat: total.fat / n, carbs: total.carbs / n, protein: total.protein / n, kcal: total.kcal / n };
}
