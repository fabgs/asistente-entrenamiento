import { formatNumber, NBSP } from './format';

/** What the user wants to do with their weight. The profile keeps it as a signed deficit. */
export type Goal = 'lose' | 'keep' | 'gain';

export const GOAL_NAMES: Record<Goal, string> = { lose: 'Perder', keep: 'Mantener', gain: 'Ganar' };

/** A positive deficit loses weight, a negative one (a surplus) gains it. */
export function goalOf(deficitKcal: number): { goal: Goal; kcal: number } {
  if (deficitKcal > 0) return { goal: 'lose', kcal: deficitKcal };
  if (deficitKcal < 0) return { goal: 'gain', kcal: -deficitKcal };
  return { goal: 'keep', kcal: 0 };
}

export function deficitFor(goal: Goal, kcal: number): number {
  const amount = Math.abs(kcal);
  if (goal === 'keep' || amount === 0) return 0;
  return goal === 'lose' ? amount : -amount;
}

/** "Perder 400 kcal", "Mantener" or "Ganar 300 kcal". */
export function goalLabel(deficitKcal: number): string {
  const { goal, kcal } = goalOf(deficitKcal);
  return goal === 'keep' ? GOAL_NAMES.keep : `${GOAL_NAMES[goal]} ${formatNumber(kcal, 0)}${NBSP}kcal`;
}

/** The activity factors of PLAN.md §4, from the least to the most active. */
export const ACTIVITY_LEVELS: { factor: number; name: string }[] = [
  { factor: 1.2, name: 'Sedentaria' },
  { factor: 1.375, name: 'Ligera' },
  { factor: 1.5, name: 'Moderada' },
  { factor: 1.55, name: 'Activa' },
  { factor: 1.725, name: 'Alta' },
];

export const sameFactor = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/** "Moderada · 1,5"; a factor outside the list (an old backup) shows only its number. */
export function activityLabel(factor: number): string {
  const level = ACTIVITY_LEVELS.find((l) => sameFactor(l.factor, factor));
  const value = formatNumber(factor, 3);
  return level ? `${level.name} · ${value}` : value;
}

/** What the daily targets still need, or null when nothing is missing: "Faltan la altura y el peso". */
export function missingForTargets(p: { birthDate: string | null; heightCm: number | null; weightKg: number | null }): string | null {
  const missing = [
    !p.birthDate && 'la fecha de nacimiento',
    !p.heightCm && 'la altura',
    !p.weightKg && 'el peso',
  ].filter((m): m is string => !!m);
  if (missing.length === 0) return null;
  const list = missing.length > 1 ? `${missing.slice(0, -1).join(', ')} y ${missing.at(-1)}` : missing[0];
  return `${missing.length > 1 ? 'Faltan' : 'Falta'} ${list}`;
}

/** Change of body weight with its sign: "+1,2 kg", "−2,3 kg" (a true minus) or "0 kg". */
export function formatWeightDelta(kg: number): string {
  const rounded = Math.round(kg * 10) / 10;
  const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : '';
  return `${sign}${formatNumber(Math.abs(rounded), 1)}${NBSP}kg`;
}
