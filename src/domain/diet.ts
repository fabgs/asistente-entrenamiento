import { formatNumber, NBSP } from './format';
import { macrosFor, sumMacros, type FoodPer100g, type Macros } from './nutrition';
import { WEEKDAY_NAMES } from './schedule';
import type { IsoWeekday } from './types';

/**
 * The diet of a day (PLAN.md §5, 1.5.1). The plan is one per weekday plus the «planes de día» the
 * user defines; a date eats the plan of its weekday unless it says otherwise, and what is ticked
 * as eaten is kept by date.
 */
export type Meal = 'desayuno' | 'comida' | 'merienda' | 'cena';

export const MEAL_KEYS: readonly Meal[] = ['desayuno', 'comida', 'merienda', 'cena'];

/** Where the food of a meal comes from: a day of the week or a plan of the user's. */
export type DietSource = { kind: 'weekday'; weekday: IsoWeekday } | { kind: 'plan'; planId: number };

export const weekdaySource = (weekday: IsoWeekday): DietSource => ({ kind: 'weekday', weekday });
export const planSource = (planId: number): DietSource => ({ kind: 'plan', planId });
export const sourceKey = (source: DietSource): string => (source.kind === 'weekday' ? `w${source.weekday}` : `p${source.planId}`);
export const sameSource = (a: DietSource, b: DietSource): boolean => sourceKey(a) === sourceKey(b);

/** A food of a plan: of a weekday (`planId` null) or of a plan of the user's (`weekday` null). */
export interface PlannedFood extends FoodPer100g {
  id: number;
  weekday: IsoWeekday | null;
  planId: number | null;
  meal: Meal;
  grams: number;
}

export const belongsTo = (item: Pick<PlannedFood, 'weekday' | 'planId'>, source: DietSource): boolean =>
  source.kind === 'weekday' ? item.planId === null && item.weekday === source.weekday : item.planId === source.planId;

/** The plan each meal of a date follows. */
export type MealSources = Record<Meal, DietSource>;

/** A meal of a date that does not follow the plan of its weekday. */
export interface MealOverride {
  meal: Meal;
  source: DietSource;
}

/** Every meal follows the weekday of the date, except those the date says otherwise. */
export function mealSources(weekday: IsoWeekday, overrides: readonly MealOverride[]): MealSources {
  const own = weekdaySource(weekday);
  const sources: MealSources = { desayuno: own, comida: own, merienda: own, cena: own };
  for (const o of overrides) sources[o.meal] = o.source;
  return sources;
}

/** What a date has to keep: only the meals that differ from its weekday. */
export function overridesOf(weekday: IsoWeekday, sources: MealSources): MealOverride[] {
  const own = weekdaySource(weekday);
  return MEAL_KEYS.filter((meal) => !sameSource(sources[meal], own)).map((meal) => ({ meal, source: sources[meal] }));
}

/**
 * «Cambiar» the plan of a day: every meal takes `target`, except those with something already
 * ticked, which stay as they were eaten (`kept`, when that leaves them on another plan).
 */
export function switchDayPlan(current: MealSources, ticked: ReadonlySet<Meal>, target: DietSource): { sources: MealSources; kept: Meal[] } {
  const sources = { ...current };
  const kept: Meal[] = [];
  for (const meal of MEAL_KEYS) {
    if (!ticked.has(meal)) sources[meal] = target;
    else if (!sameSource(current[meal], target)) kept.push(meal);
  }
  return { sources, kept };
}

/**
 * The plan a day is on, for its name: the one of the meals still to eat (the most common; on a
 * tie, the later meal) or, with every meal ticked, of all of them.
 */
export function dayPlan(sources: MealSources, ticked: ReadonlySet<Meal>): DietSource {
  const pending = MEAL_KEYS.filter((meal) => !ticked.has(meal));
  const meals = pending.length > 0 ? pending : MEAL_KEYS;
  const count = new Map<string, number>();
  for (const meal of meals) count.set(sourceKey(sources[meal]), (count.get(sourceKey(sources[meal])) ?? 0) + 1);
  let best = sources[meals[0]];
  for (const meal of meals) {
    if (count.get(sourceKey(sources[meal]))! >= count.get(sourceKey(best))!) best = sources[meal];
  }
  return best;
}

/** «Martes», or the name of a plan of the user's. */
export function sourceName(source: DietSource, planNames: ReadonlyMap<number, string>): string {
  return source.kind === 'weekday' ? WEEKDAY_NAMES[source.weekday] : (planNames.get(source.planId) ?? 'Plan borrado');
}

const MEAL_WITH_ARTICLE: Record<Meal, string> = { desayuno: 'el desayuno', comida: 'la comida', merienda: 'la merienda', cena: 'la cena' };

/** After changing the plan of a day: «El desayuno se queda como estaba», «El desayuno y la comida se quedan como estaban»; null with none. */
export function keptMealsLine(kept: readonly Meal[]): string | null {
  if (kept.length === 0) return null;
  const names = kept.map((meal) => MEAL_WITH_ARTICLE[meal]);
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} y ${names.at(-1)}` : names[0];
  const text = `${list} ${kept.length > 1 ? 'se quedan como estaban' : 'se queda como estaba'}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Something eaten on a date: a copy of what the plan said then, with the grams of that day (1.5.4:
 * they may differ). `itemId` null is something eaten off the plan: added in Hoy (1.5.4), or a food
 * that has left the plan since (only on older days: leaving the plan takes today's tick with it).
 */
export interface EatenFood extends FoodPer100g {
  itemId: number | null;
  meal: Meal;
  grams: number;
}

/**
 * The meals with a food of the plan ticked: they stay on the plan they were eaten from when the
 * day changes plan. Something eaten off the plan belongs to no plan and pins nothing.
 */
export const tickedMeals = (eaten: readonly Pick<EatenFood, 'meal' | 'itemId'>[]): Set<Meal> =>
  new Set(eaten.filter((e) => e.itemId !== null).map((e) => e.meal));

export interface MealProgress<T, E = EatenFood> {
  meal: Meal;
  source: DietSource;
  items: T[];
  /** The items of the meal ticked as eaten. */
  eatenIds: Set<number>;
  /** The grams eaten of each ticked item: the plan's, or what was set in Hoy for that day (1.5.4). */
  eatenGrams: Map<number, number>;
  /** What was eaten in this meal off the plan (1.5.4). */
  extras: E[];
  /** Everything in it is ticked: its foods of the plan or, with none, it has something off the plan. */
  done: boolean;
  planned: Macros;
  /** The meal as its list reads: its foods with the grams eaten when ticked, and what is off the plan. */
  listed: Macros;
}

export interface DayProgress<T, E = EatenFood> {
  /** The meals with something to eat or eaten off the plan, in order. */
  meals: MealProgress<T, E>[];
  mealsDone: number;
  planned: Macros;
  /** Everything ticked that day, whatever plan it was on. */
  eaten: Macros;
}

/** A day against its plan: each meal with its foods and which are ticked, and the totals. */
export function dayProgress<T extends PlannedFood, E extends EatenFood = EatenFood>(
  items: readonly T[],
  sources: MealSources,
  eaten: readonly E[],
): DayProgress<T, E> {
  const logged = new Map<number, number>();
  for (const e of eaten) if (e.itemId !== null) logged.set(e.itemId, e.grams);
  const meals = MEAL_KEYS.map((meal): MealProgress<T, E> => {
    const own = items.filter((i) => i.meal === meal && belongsTo(i, sources[meal]));
    const eatenGrams = new Map(own.filter((i) => logged.has(i.id)).map((i) => [i.id, logged.get(i.id)!]));
    const extras = eaten.filter((e) => e.meal === meal && e.itemId === null);
    return {
      meal,
      source: sources[meal],
      items: own,
      eatenIds: new Set(eatenGrams.keys()),
      eatenGrams,
      extras,
      done: own.length > 0 ? eatenGrams.size === own.length : extras.length > 0,
      planned: sumMacros(own.map((i) => macrosFor(i, i.grams))),
      listed: sumMacros([...own.map((i) => macrosFor(i, eatenGrams.get(i.id) ?? i.grams)), ...extras.map((e) => macrosFor(e, e.grams))]),
    };
  }).filter((m) => m.items.length > 0 || m.extras.length > 0);
  return {
    meals,
    mealsDone: meals.filter((m) => m.done).length,
    planned: sumMacros(meals.map((m) => m.planned)),
    eaten: sumMacros(eaten.map((e) => macrosFor(e, e.grams))),
  };
}

const mealsWord = (n: number) => (n === 1 ? '1 comida' : `${n} comidas`);
const kcal = (value: number) => formatNumber(value, 0);

/** «2 de 4 comidas», or «4 comidas» once all are eaten; null on a day with nothing planned. */
export function mealsLine(progress: Pick<DayProgress<unknown>, 'meals' | 'mealsDone'>): string | null {
  const total = progress.meals.length;
  if (total === 0) return null;
  return progress.mealsDone === total ? mealsWord(total) : `${progress.mealsDone} de ${mealsWord(total)}`;
}

/** The row of Hoy: «2 de 4 comidas · 1450 de 2472 kcal», «4 comidas · 2472 kcal» with all eaten. */
export function dietLine(progress: DayProgress<unknown>): string | null {
  const meals = mealsLine(progress);
  if (meals === null) return null;
  const done = progress.mealsDone === progress.meals.length;
  const energy = done ? kcal(progress.eaten.kcal) : `${kcal(progress.eaten.kcal)} de ${kcal(progress.planned.kcal)}`;
  return `${meals} · ${energy}${NBSP}kcal`;
}

/** What was ticked on a past day: «2210 kcal en 3 comidas». */
export function eatenLine(day: { kcal: number; meals: number }): string {
  return `${kcal(day.kcal)}${NBSP}kcal en ${mealsWord(day.meals)}`;
}
