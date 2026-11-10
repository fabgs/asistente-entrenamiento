import { DEFAULT_PLANS } from '../cardioPlan';
import { cardioKey, cardioPool, poolLine, walksToStart, type PoolActivity } from '../cardioPool';
import { DEFAULT_SPRINT_PLAN } from '../sprint';
import type { IsoWeekday } from '../types';

const act = (id: number, weekday: IsoWeekday | null, over: Partial<PoolActivity>): PoolActivity => ({
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

/** Activities done today: once each, or `[id, times]`. */
const doneMap = (done: (number | [number, number])[]) => new Map(done.map((d) => (typeof d === 'number' ? [d, 1] : d) as [number, number]));
const summary = (today: IsoWeekday, done: (number | [number, number])[] = [], all = SEED) =>
  cardioPool(all, today, doneMap(done)).map((e) => [e.activity.id, e.weekdays]);

describe('cardioPool', () => {
  it('on a Wednesday offers the cardio of the other days, each once', () => {
    expect(summary(3)).toEqual([
      [1, [1, 2, 4, 5]],
      [2, [1]],
      [6, [4]],
      [9, [7]],
    ]);
  });

  it('leaves out what is planned for today and still to do', () => {
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

  it('puts first what was done today with a session, to do it again, with the one done standing for it', () => {
    // A walk of Thursday done on a Wednesday: its group comes first, and picking it repeats that one.
    const pool = cardioPool(SEED, 3, doneMap([[5, 2]]));
    expect(pool.map((e) => e.activity.id)).toEqual([5, 2, 6, 9]);
    expect(pool[0]).toMatchObject({ doneToday: 2, weekdays: [1, 2, 4, 5] });
    expect(poolLine(pool[0])).toBe('Hecho hoy 2 veces');
    expect(poolLine(pool[1])).toBe('Lunes');
    // Today's own, once done, is offered again; while it is pending it is not.
    expect(summary(1, [1, 2])).toEqual([
      [1, [1, 2, 4, 5]],
      [2, [1]],
      [4, [3, 6]],
      [6, [4]],
      [9, [7]],
    ]);
    expect(poolLine(cardioPool(SEED, 1, doneMap([1, 2]))[0])).toBe('Hecho hoy');
    // Done on its other day's copy, but today's still pending: it stays in «Para hoy» only.
    expect(summary(1, [3]).map(([id]) => id)).toEqual([4, 6, 9]);
  });

  it('leaves out an activity that is only checked off once it is', () => {
    const stretch = (id: number, day: IsoWeekday | null) => act(id, day, { name: 'Estirar', target: null, intensity: null, tracking: 'check' });
    const all = [...SEED, stretch(10, 5), stretch(11, null)];
    expect(summary(3, [], all).map(([id]) => id)).toContain(11);
    expect(summary(3, [11], all).map(([id]) => id)).not.toContain(11);
    expect(summary(3, [10], all).map(([id]) => id)).not.toContain(10);
  });

  it('offers the activities of no day after those done today and before the other days', () => {
    const swim = act(10, null, { name: 'Nadar', target: '1 km', intensity: null });
    const all = [...SEED, swim];
    const pool = cardioPool(all, 3, doneMap([2]));
    expect(pool.map((e) => e.activity.id)).toEqual([2, 10, 1, 6, 9]);
    expect(pool[1]).toMatchObject({ weekdays: [], noDay: true, doneToday: 0 });
    expect(poolLine(pool[1])).toBe('Sin día');
    // Never in «Para hoy»: it is in the pool every day.
    for (const day of [1, 2, 3, 4, 5, 6, 7] as const) expect(summary(day, [], all).map(([id]) => id)).toContain(10);
    // The same as one with days: one row, the one of no day standing for it.
    const walkAnyDay = act(12, null, {});
    const merged = cardioPool([...SEED, walkAnyDay], 3, doneMap([]));
    expect(merged.map((e) => e.activity.id)).toEqual([12, 2, 6, 9]);
    expect(merged[0]).toMatchObject({ weekdays: [1, 2, 4, 5], noDay: true });
    expect(poolLine(merged[0])).toBe('Sin día');
  });

  it('groups by everything but the notes, ignoring case, accents and spaces', () => {
    const base = act(1, 1, {});
    expect(cardioKey(act(2, 2, { name: 'caminar ' }))).toBe(cardioKey(base));
    expect(cardioKey(act(2, 2, { name: 'CAMINAR' }))).toBe(cardioKey(base));
    expect(cardioKey(act(2, null, {}))).toBe(cardioKey(base));
    expect(cardioKey({ ...base, plan: DEFAULT_PLANS.liss })).toBe(cardioKey(base)); // a stray plan on GPS
    const liss = (minutes: number) => act(3, 1, { tracking: 'timer', plan: { kind: 'liss', minutes } });
    expect(cardioKey(liss(30))).not.toBe(cardioKey(liss(45)));
    expect(cardioKey(act(2, 2, { target: '6 km' }))).not.toBe(cardioKey(base));
    expect(cardioKey(act(2, 2, { intensity: 'Alta' }))).not.toBe(cardioKey(base));
    const sprints = (n: number, over = {}) => act(4, 3, { tracking: 'sprint', sprint: { ...DEFAULT_SPRINT_PLAN, sprints: n, ...over } });
    expect(cardioKey(sprints(6))).not.toBe(cardioKey(sprints(8)));
    // The count before the beep and the straight are how they are run, not another activity.
    expect(cardioKey(sprints(6, { leadSec: 15, straightM: 60 }))).toBe(cardioKey(sprints(6)));
  });

  it('is represented by the lowest id, even when it is not the first one', () => {
    const all = [act(7, 1, {}), act(3, 2, {})];
    expect(cardioPool(all, 5, new Map()).map((e) => e.activity.id)).toEqual([3]);
  });

  it('is empty without cardio or with all of it today and pending', () => {
    expect(cardioPool([], 3, new Map())).toEqual([]);
    expect(cardioPool([act(1, 3, {}), act(2, 3, { name: 'Bici' })], 3, new Map())).toEqual([]);
  });
});

describe('walksToStart', () => {
  it('is one walk with GPS per group, also the one done today and the one of no day', () => {
    const run = (id: number, day: IsoWeekday | null) => act(id, day, { name: 'Correr', target: '3 km' });
    const all = [...SEED, run(10, 6), run(11, null)];
    expect(walksToStart(all, new Map()).map((a) => a.id)).toEqual([1, 9, 11]);
    // The copy done today stands for its group: its log is the one that grows.
    expect(walksToStart(all, doneMap([5, 10])).map((a) => a.id)).toEqual([5, 9, 10]);
    expect(walksToStart([], new Map())).toEqual([]);
  });
});
