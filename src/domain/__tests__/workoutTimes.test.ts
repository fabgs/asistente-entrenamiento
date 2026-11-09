import {
  exerciseRestAcross,
  exerciseSpan,
  exerciseTimes,
  formatOverPlan,
  formatRest,
  isImplausibleSet,
  MAX_REST_MS,
  median,
  restsOf,
  restStats,
  sessionTimes,
  setDuration,
  warmupDuration,
  workoutDuration,
  type TimedSet,
} from '../workoutTimes';

const S = 1000;
const MIN = 60 * S;

const set = (slotId: number, startedAt: number | null, completedAt: number, over: Partial<TimedSet> = {}): TimedSet => ({
  slotId,
  isWarmup: false,
  reps: 10,
  startedAt,
  completedAt,
  restSeconds: 150,
  ...over,
});

describe('set times', () => {
  it('a set lasts from its start to «Serie hecha»', () => {
    expect(setDuration(set(1, 0, 45 * S))).toBe(45 * S);
    expect(setDuration(set(1, null, 45 * S))).toBeNull();
  });

  it('one shorter than 5 s or a second per rep was done with the rest on screen', () => {
    expect(isImplausibleSet(set(1, 0, 3 * S))).toBe(true);
    expect(isImplausibleSet(set(1, 0, 8 * S, { reps: 12 }))).toBe(true);
    expect(isImplausibleSet(set(1, 0, 30 * S, { reps: 12 }))).toBe(false);
    // A hold of 60 s cannot be logged 20 s after it started.
    expect(isImplausibleSet(set(1, 0, 20 * S, { reps: 60 }))).toBe(true);
    expect(isImplausibleSet(set(1, null, 1 * S))).toBe(false);
  });
});

describe('restsOf', () => {
  it('measures from each work set to the start of the next one', () => {
    const sets = [set(1, 0, 40 * S), set(1, 3 * MIN, 3 * MIN + 40 * S), set(2, 6 * MIN, 6 * MIN + 30 * S)];
    const rests = restsOf(sets);
    expect(rests.map((r) => [r.ms, r.change])).toEqual([
      [3 * MIN - 40 * S, false],
      [6 * MIN - (3 * MIN + 40 * S), true],
    ]);
  });

  it('none after a warm-up set, after the last set or before a set without a start', () => {
    const sets = [
      set(1, 0, 20 * S, { isWarmup: true }),
      set(1, 20 * S, 60 * S),
      set(1, null, 4 * MIN),
    ];
    expect(restsOf(sets)).toEqual([]);
  });

  it('a set done with the rest on screen leaves the rest before it unmeasured', () => {
    const sets = [set(1, 0, 40 * S), set(1, 5 * MIN, 5 * MIN + 2 * S), set(1, 7 * MIN, 7 * MIN + 40 * S)];
    expect(restsOf(sets).map((r) => r.ms)).toEqual([7 * MIN - (5 * MIN + 2 * S)]);
  });

  it('a rest longer than 10 min is an interruption', () => {
    const sets = [set(1, 0, 40 * S), set(1, 40 * S + MAX_REST_MS + S, 12 * MIN)];
    expect(restsOf(sets)[0].interruption).toBe(true);
  });

  it('goes in time order whatever the order given', () => {
    const sets = [set(2, 6 * MIN, 6 * MIN + 30 * S), set(1, 0, 40 * S), set(1, 3 * MIN, 3 * MIN + 40 * S)];
    expect(restsOf(sets).map((r) => r.after.completedAt)).toEqual([40 * S, 3 * MIN + 40 * S]);
  });
});

describe('exerciseSpan', () => {
  it('goes from the start of its first set, warm-ups included, to its last «Serie hecha»', () => {
    const sets = [set(1, 2 * MIN, 2 * MIN + 30 * S), set(1, 0, 20 * S, { isWarmup: true }), set(1, 5 * MIN, 5 * MIN + 40 * S)];
    expect(exerciseSpan(sets)).toBe(5 * MIN + 40 * S);
  });

  it('is unknown without a start or without sets', () => {
    expect(exerciseSpan([set(1, null, 40 * S), set(1, 3 * MIN, 4 * MIN)])).toBeNull();
    expect(exerciseSpan([])).toBeNull();
  });
});

describe('warmupDuration and median', () => {
  it('a warm-up counts once it has ended', () => {
    expect(warmupDuration({ warmupStartedAt: 1000, warmupEndedAt: 1000 + 8 * MIN })).toBe(8 * MIN);
    expect(warmupDuration({ warmupStartedAt: 1000, warmupEndedAt: null })).toBeNull();
    expect(warmupDuration({ warmupStartedAt: null, warmupEndedAt: null })).toBeNull();
    // Tapped straight through: as no warm-up.
    expect(warmupDuration({ warmupStartedAt: 1000, warmupEndedAt: 1000 + 20 * S })).toBeNull();
  });

  it('the median is not moved by one long value', () => {
    expect(median([160, 160, 170, 1500])).toBe(165);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([])).toBeNull();
  });
});

describe('the times of a workout', () => {
  // Remo 3 sets (rest 2:30 planned), then Curl 2 sets (rest 1:30), with a phone call in the curls.
  const sets = [
    set(1, 0, 40 * S),
    set(1, 3 * MIN, 3 * MIN + 40 * S), // rest 2:20
    set(1, 6 * MIN + 30 * S, 7 * MIN + 10 * S), // rest 2:50
    set(2, 9 * MIN, 9 * MIN + 30 * S, { restSeconds: 90 }), // change of exercise
    set(2, 9 * MIN + 30 * S + 25 * MIN, 35 * MIN, { restSeconds: 90 }), // interruption
  ];

  it('the median rest is that between sets of one exercise, without changes or interruptions', () => {
    const times = sessionTimes({ warmupStartedAt: -8 * MIN, warmupEndedAt: 0 }, sets);
    expect(times.warmupMs).toBe(8 * MIN);
    expect(times.rests).toEqual({ medianMs: 155 * S, count: 2, overPlanMs: 5 * S });
    expect(times.interruptions).toEqual([25 * MIN]);
  });

  it('a set without a plan does not count against it', () => {
    const stats = restStats(restsOf([set(1, 0, 40 * S, { restSeconds: null }), set(1, 3 * MIN, 4 * MIN)]));
    expect(stats).toEqual({ medianMs: 140 * S, count: 1, overPlanMs: null });
  });

  it('each exercise lists its rests between sets in order', () => {
    expect(exerciseTimes(1, sets)).toEqual({ spanMs: 7 * MIN + 10 * S, rests: [140 * S, 170 * S] });
    expect(exerciseTimes(2, sets).rests).toEqual([25 * MIN]);
    expect(exerciseTimes(3, sets)).toEqual({ spanMs: null, rests: [] });
    // One set alone: its span would be the time of that set.
    expect(exerciseTimes(1, [set(1, 0, 40 * S)])).toEqual({ spanMs: null, rests: [] });
  });

  it('a workout left open ends at its last set', () => {
    expect(workoutDuration(0, 40 * MIN, 35 * MIN)).toBe(40 * MIN);
    expect(workoutDuration(0, 35 * MIN + 16 * MIN, 35 * MIN)).toBe(35 * MIN);
    expect(workoutDuration(0, 5 * MIN, null)).toBe(5 * MIN);
  });

  it('a workout from before 1.4.7 has no times', () => {
    const old = sets.map((s) => ({ ...s, startedAt: null, restSeconds: null }));
    expect(sessionTimes({ warmupStartedAt: null, warmupEndedAt: null }, old)).toEqual({
      warmupMs: null,
      rests: { medianMs: null, count: 0, overPlanMs: null },
      interruptions: [],
    });
  });

  it('reads the rest against the plan', () => {
    expect(formatRest(161_400)).toBe('2:41');
    expect(formatOverPlan(18 * S)).toBe('18 s más que el plan');
    expect(formatOverPlan(-65 * S)).toBe('1:05 menos que el plan');
    expect(formatOverPlan(4 * S)).toBe('igual que el plan');
  });
});

describe('exerciseRestAcross', () => {
  const workout = (slotId: number, rest: number, plan: number | null = 150) => [
    set(slotId, 0, 40 * S, { restSeconds: plan }),
    set(slotId, 40 * S + rest, 40 * S + rest + 40 * S, { restSeconds: plan }),
    set(9, 10 * MIN, 11 * MIN),
  ];

  it('takes the median of the latest timed workouts of the exercise', () => {
    const workouts = [workout(1, 170 * S, 180), workout(1, 150 * S), workout(2, 60 * S), workout(1, 160 * S)];
    expect(exerciseRestAcross(workouts, (s) => s.slotId === 1)).toEqual({ medianMs: 160 * S, sessions: 3, planSeconds: 180 });
  });

  it('only the latest 8 workouts count, and old ones without times are skipped', () => {
    const old = workout(1, 60 * S).map((s) => ({ ...s, startedAt: null }));
    const workouts = [...Array.from({ length: 8 }, () => workout(1, 150 * S)), workout(1, 30 * MIN), old];
    expect(exerciseRestAcross(workouts, (s) => s.slotId === 1)).toEqual({ medianMs: 150 * S, sessions: 8, planSeconds: 150 });
    expect(exerciseRestAcross([old], (s) => s.slotId === 1)).toEqual({ medianMs: null, sessions: 0, planSeconds: null });
  });
});
