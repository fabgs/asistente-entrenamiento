import {
  belongsTo,
  dayPlan,
  dayProgress,
  dietLine,
  eatenLine,
  keptMealsLine,
  mealSources,
  mealsLine,
  overridesOf,
  planSource,
  sameSource,
  sourceKey,
  sourceName,
  switchDayPlan,
  tickedMeals,
  weekdaySource,
  type EatenFood,
  type Meal,
  type PlannedFood,
} from '../diet';

const NBSP = ' ';
const TUESDAY = weekdaySource(2);
const OUT = planSource(7);

let nextId = 1;
/** 100 g of something with 10 g of protein and nothing else: 40 kcal. */
function food(meal: Meal, where: { weekday?: 1 | 2 | 3; planId?: number }, grams = 100): PlannedFood {
  return {
    id: nextId++,
    weekday: where.planId === undefined ? (where.weekday ?? 2) : null,
    planId: where.planId ?? null,
    meal,
    grams,
    fatPer100g: 0,
    carbsPer100g: 0,
    proteinPer100g: 10,
  };
}
const eat = (item: PlannedFood, grams = item.grams): EatenFood => ({ ...item, itemId: item.id, grams });

describe('where the food of a day comes from', () => {
  it('follows the weekday unless the date says otherwise', () => {
    expect(mealSources(2, [])).toEqual({ desayuno: TUESDAY, comida: TUESDAY, merienda: TUESDAY, cena: TUESDAY });
    const sources = mealSources(2, [{ meal: 'cena', source: OUT }]);
    expect(sources.cena).toEqual(OUT);
    expect(sources.comida).toEqual(TUESDAY);
    // Only what differs from the weekday is kept.
    expect(overridesOf(2, sources)).toEqual([{ meal: 'cena', source: OUT }]);
    expect(overridesOf(2, mealSources(2, [{ meal: 'cena', source: TUESDAY }]))).toEqual([]);
  });

  it('tells a food of a weekday from one of a plan', () => {
    const tuesday = food('comida', { weekday: 2 });
    const out = food('comida', { planId: 7 });
    expect(belongsTo(tuesday, TUESDAY)).toBe(true);
    expect(belongsTo(tuesday, weekdaySource(3))).toBe(false);
    expect(belongsTo(tuesday, OUT)).toBe(false);
    expect(belongsTo(out, OUT)).toBe(true);
    expect(belongsTo(out, planSource(8))).toBe(false);
    // A food of a plan never counts for a weekday, whatever its column says.
    expect(belongsTo({ weekday: 2, planId: 7 }, TUESDAY)).toBe(false);
    expect(sourceKey(TUESDAY)).toBe('w2');
    expect(sourceKey(OUT)).toBe('p7');
    expect(sameSource(planSource(7), OUT)).toBe(true);
  });

  it('changes the plan of every meal with nothing ticked', () => {
    const { sources, kept } = switchDayPlan(mealSources(2, []), new Set(), OUT);
    expect(sources).toEqual({ desayuno: OUT, comida: OUT, merienda: OUT, cena: OUT });
    expect(kept).toEqual([]);
  });

  it('leaves a meal with something ticked as it was eaten', () => {
    const { sources, kept } = switchDayPlan(mealSources(2, []), new Set<Meal>(['desayuno']), OUT);
    expect(sources).toEqual({ desayuno: TUESDAY, comida: OUT, merienda: OUT, cena: OUT });
    expect(kept).toEqual(['desayuno']);
    // Back to the weekday: breakfast was already on it, so nothing is «kept».
    expect(switchDayPlan(sources, new Set<Meal>(['desayuno']), TUESDAY)).toEqual({ sources: mealSources(2, []), kept: [] });
  });

  it('says which meals stay as they were', () => {
    expect(keptMealsLine([])).toBeNull();
    expect(keptMealsLine(['desayuno'])).toBe('El desayuno se queda como estaba');
    expect(keptMealsLine(['comida'])).toBe('La comida se queda como estaba');
    expect(keptMealsLine(['desayuno', 'comida'])).toBe('El desayuno y la comida se quedan como estaban');
    expect(keptMealsLine(['desayuno', 'comida', 'merienda'])).toBe('El desayuno, la comida y la merienda se quedan como estaban');
  });

  it('names the day after the plan of what is left to eat', () => {
    const mixed = mealSources(2, [
      { meal: 'comida', source: OUT },
      { meal: 'merienda', source: OUT },
      { meal: 'cena', source: OUT },
    ]);
    expect(dayPlan(mealSources(2, []), new Set())).toEqual(TUESDAY);
    expect(dayPlan(mixed, new Set<Meal>(['desayuno']))).toEqual(OUT);
    // Breakfast unticked again: three meals against one.
    expect(dayPlan(mixed, new Set())).toEqual(OUT);
    // Two against two: the later meal.
    expect(dayPlan(mealSources(2, [{ meal: 'merienda', source: OUT }, { meal: 'cena', source: OUT }]), new Set())).toEqual(OUT);
    // Everything ticked: of all the meals.
    expect(dayPlan(mixed, new Set<Meal>(['desayuno', 'comida', 'merienda', 'cena']))).toEqual(OUT);
    const names = new Map([[7, 'Comida fuera']]);
    expect(sourceName(TUESDAY, names)).toBe('Martes');
    expect(sourceName(OUT, names)).toBe('Comida fuera');
    expect(sourceName(planSource(9), names)).toBe('Plan borrado');
  });
});

describe('a day against its plan', () => {
  const breakfast = [food('desayuno', {}), food('desayuno', {}, 50)];
  const lunch = [food('comida', {}, 200)];
  const dinner = [food('cena', {})];
  const outLunch = [food('comida', { planId: 7 }, 300)];
  const wednesday = [food('comida', { weekday: 3 })];
  const all = [...breakfast, ...lunch, ...dinner, ...outLunch, ...wednesday];

  it('lists the meals with food, in order, with what is ticked', () => {
    const day = dayProgress(all, mealSources(2, []), [eat(breakfast[0])]);
    expect(day.meals.map((m) => m.meal)).toEqual(['desayuno', 'comida', 'cena']);
    expect(day.meals[0].items).toEqual(breakfast);
    expect([...day.meals[0].eatenIds]).toEqual([breakfast[0].id]);
    expect(day.meals[0].done).toBe(false);
    expect(day.mealsDone).toBe(0);
    // 100 + 50 + 200 + 100 g at 0.4 kcal/g.
    expect(day.planned.kcal).toBeCloseTo(180);
    expect(day.eaten.kcal).toBeCloseTo(40);
    expect(mealsLine(day)).toBe('0 de 3 comidas');
    expect(dietLine(day)).toBe(`0 de 3 comidas · 40 de 180${NBSP}kcal`);
  });

  it('counts a meal once everything in it is ticked', () => {
    const day = dayProgress(all, mealSources(2, []), [eat(breakfast[0]), eat(breakfast[1]), eat(lunch[0])]);
    expect(day.meals.map((m) => m.done)).toEqual([true, true, false]);
    expect(day.mealsDone).toBe(2);
    expect(dietLine(day)).toBe(`2 de 3 comidas · 140 de 180${NBSP}kcal`);
    const whole = dayProgress(all, mealSources(2, []), [...breakfast, ...lunch, ...dinner].map((i) => eat(i)));
    expect(dietLine(whole)).toBe(`3 comidas · 180${NBSP}kcal`);
    expect(mealsLine(whole)).toBe('3 comidas');
  });

  it('takes each meal from its own plan', () => {
    const sources = mealSources(2, [{ meal: 'comida', source: OUT }]);
    const day = dayProgress(all, sources, [eat(breakfast[0]), eat(breakfast[1])]);
    expect(day.meals[1].items).toEqual(outLunch);
    expect(day.meals[1].source).toEqual(OUT);
    // 100 + 50 + 300 + 100 g.
    expect(day.planned.kcal).toBeCloseTo(220);
    expect(day.mealsDone).toBe(1);
  });

  it('counts what was eaten as it was ticked, also off the plan of now', () => {
    // Lunch ticked on Tuesday's plan, then the day moved to another one: it is still eaten.
    const sources = mealSources(2, [{ meal: 'comida', source: OUT }]);
    const day = dayProgress(all, sources, [eat(lunch[0])]);
    expect(day.eaten.kcal).toBeCloseTo(80);
    expect(day.meals[1].eatenIds.size).toBe(0);
    // A food taken out of the plan since, and the grams of then.
    const gone: EatenFood = { ...lunch[0], itemId: null, grams: 250 };
    expect(dayProgress(all, mealSources(2, []), [gone]).eaten.kcal).toBeCloseTo(100);
    // Since 1.5.4 it reads as eaten off the plan: it belongs to no plan, so it does not keep its meal on one.
    expect([...tickedMeals([gone, eat(dinner[0])])]).toEqual(['cena']);
  });

  it('keeps the grams eaten today when they are not the plan\'s (1.5.4)', () => {
    const day = dayProgress(all, mealSources(2, []), [eat(breakfast[0], 150), eat(lunch[0])]);
    const [morning, noon] = day.meals;
    expect(morning.eatenGrams).toEqual(new Map([[breakfast[0].id, 150]]));
    expect(noon.eatenGrams).toEqual(new Map([[lunch[0].id, 200]]));
    // The plan stays the plan; what was eaten and the list of the meal follow the grams of today.
    expect(day.planned.kcal).toBeCloseTo(180);
    expect(day.eaten.kcal).toBeCloseTo(60 + 80);
    expect(morning.planned.kcal).toBeCloseTo(60);
    expect(morning.listed.kcal).toBeCloseTo(60 + 20);
    expect(morning.done).toBe(false);
  });

  it('lists what was eaten off the plan in its meal (1.5.4)', () => {
    const cookies: EatenFood = { meal: 'desayuno', itemId: null, grams: 30, fatPer100g: 20, carbsPer100g: 60, proteinPer100g: 5 };
    const snack: EatenFood = { meal: 'merienda', itemId: null, grams: 50, fatPer100g: 0, carbsPer100g: 0, proteinPer100g: 10 };
    const day = dayProgress(all, mealSources(2, []), [eat(breakfast[0]), cookies, snack]);
    // Tuesday has no merienda: eating one adds the meal, done with what was eaten.
    expect(day.meals.map((m) => m.meal)).toEqual(['desayuno', 'comida', 'merienda', 'cena']);
    const [morning, , afternoon] = day.meals;
    expect(morning.extras).toEqual([cookies]);
    expect(morning.items).toEqual(breakfast);
    // Something off the plan does not tick the meal: its foods of the plan still have to be eaten.
    expect(morning.done).toBe(false);
    expect(afternoon).toMatchObject({ items: [], extras: [snack], done: true });
    // 30 g at 20/60/5 is 6·9 + 18·4 + 1,5·4 = 132 kcal.
    expect(morning.listed.kcal).toBeCloseTo(40 + 20 + 132);
    expect(day.eaten.kcal).toBeCloseTo(40 + 132 + 20);
    expect(day.planned.kcal).toBeCloseTo(180);
    expect(mealsLine(day)).toBe('1 de 4 comidas');
    // Changing the plan of the day moves the meals with nothing of the plan ticked, extras or not.
    expect([...tickedMeals([eat(breakfast[0]), cookies, snack])]).toEqual(['desayuno']);
  });

  it('says nothing of a day with nothing planned', () => {
    const empty = dayProgress(all, mealSources(1, []), []);
    expect(empty.meals).toEqual([]);
    expect(mealsLine(empty)).toBeNull();
    expect(dietLine(empty)).toBeNull();
    const one = dayProgress(wednesday, mealSources(3, []), []);
    expect(dietLine(one)).toBe(`0 de 1 comida · 0 de 40${NBSP}kcal`);
  });

  it('reads a past day', () => {
    expect(eatenLine({ kcal: 2210.4, meals: 3 })).toBe(`2210${NBSP}kcal en 3 comidas`);
    expect(eatenLine({ kcal: 512, meals: 1 })).toBe(`512${NBSP}kcal en 1 comida`);
  });
});
