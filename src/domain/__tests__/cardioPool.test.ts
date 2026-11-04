import { DEFAULT_PLANS } from '../cardioPlan';
import { cardioKey, cardioPool, doneOnOtherDays, type PoolActivity } from '../cardioPool';
import { DEFAULT_SPRINT_PLAN } from '../sprint';
import type { IsoWeekday } from '../types';

const act = (id: number, weekday: IsoWeekday, over: Partial<PoolActivity>): PoolActivity => ({
  id,
  weekday,
  name: 'Caminar',
  target: '5 km',
  intensity: 'Baja (LISS)',
  tracking: 'gps',
  plan: null,
  sprint: null,
  ...over,
});

/** The 9 activities of the seed, ids 1–9 in order, as the migrations leave them. */
const SEED: PoolActivity[] = [
  act(1, 1, {}),
  act(2, 1, { name: 'Bici estática', target: '30 min', intensity: 'Media (MISS)', tracking: 'timer', plan: { kind: 'liss', minutes: 30 } }),
  act(3, 2, {}),
  act(4, 3, { name: 'Sprints + Bouncing', target: '15 min', intensity: 'Alta (HIIT)', tracking: 'sprint', sprint: DEFAULT_SPRINT_PLAN }),
  act(5, 4, {}),
  act(6, 4, { name: 'Bici estática', target: '30 min', intensity: 'Media (MISS)', tracking: 'timer', plan: DEFAULT_PLANS.miss }),
  act(7, 5, {}),
  act(8, 6, { name: 'Sprints + Bouncing', target: '15 min', intensity: 'Alta (HIIT)', tracking: 'sprint', sprint: DEFAULT_SPRINT_PLAN }),
  act(9, 7, { name: 'Descanso / Caminar', target: 'Opcional', intensity: 'Muy baja' }),
];

const summary = (today: IsoWeekday, done: number[] = []) =>
  cardioPool(SEED, today, new Set(done)).map((e) => [e.activity.id, e.weekdays]);

describe('cardioPool', () => {
  it('on a Wednesday offers the cardio of the other days, each once', () => {
    expect(summary(3)).toEqual([
      [1, [1, 2, 4, 5]],
      [2, [1]],
      [6, [4]],
      [9, [7]],
    ]);
  });

  it('leaves out what is planned for today', () => {
    expect(summary(1)).toEqual([
      [4, [3, 6]],
      [6, [4]],
      [9, [7]],
    ]);
    expect(summary(7)).toEqual([
      [1, [1, 2, 4, 5]],
      [2, [1]],
      [4, [3, 6]],
      [6, [4]],
    ]);
  });

  it('leaves out a group with any of its activities done today', () => {
    expect(summary(3, [5]).map(([id]) => id)).toEqual([2, 6, 9]);
  });

  it('groups by everything but the notes, ignoring case, accents and spaces', () => {
    const base = act(1, 1, {});
    expect(cardioKey(act(2, 2, { name: 'caminar ' }))).toBe(cardioKey(base));
    expect(cardioKey(act(2, 2, { name: 'CAMINAR' }))).toBe(cardioKey(base));
    expect(cardioKey({ ...base, plan: DEFAULT_PLANS.liss })).toBe(cardioKey(base)); // a stray plan on GPS
    const liss = (minutes: number) => act(3, 1, { tracking: 'timer', plan: { kind: 'liss', minutes } });
    expect(cardioKey(liss(30))).not.toBe(cardioKey(liss(45)));
    expect(cardioKey(act(2, 2, { target: '6 km' }))).not.toBe(cardioKey(base));
    expect(cardioKey(act(2, 2, { intensity: 'Alta' }))).not.toBe(cardioKey(base));
    const sprints = (n: number) => act(4, 3, { tracking: 'sprint', sprint: { kind: 'sprint', sprints: n, restSec: 90 } });
    expect(cardioKey(sprints(6))).not.toBe(cardioKey(sprints(8)));
  });

  it('is represented by the lowest id, even when it is not the first one', () => {
    const all = [act(7, 1, {}), act(3, 2, {})];
    expect(cardioPool(all, 5, new Set()).map((e) => e.activity.id)).toEqual([3]);
  });

  it('is empty without cardio or with all of it today', () => {
    expect(cardioPool([], 3, new Set())).toEqual([]);
    expect(cardioPool([act(1, 3, {}), act(2, 3, { name: 'Bici' })], 3, new Set())).toEqual([]);
  });
});

describe('doneOnOtherDays', () => {
  it('lists the activities of other days done today', () => {
    expect(doneOnOtherDays(SEED, 3, new Set([4, 5])).map((a) => a.id)).toEqual([5]);
  });
});
