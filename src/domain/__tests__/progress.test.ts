import {
  capitalize,
  computeRecords,
  countOf,
  distinctRecords,
  formatDayMonth,
  formatMonth,
  groupByMonth,
  niceScale,
  splitUnit,
  summarize,
  thinSegments,
  type ExerciseSession,
} from '../progress';

const session = (
  date: string,
  startedAt: number,
  sets: [number | null, number][],
): ExerciseSession => ({
  sessionId: startedAt,
  date,
  startedAt,
  title: null,
  routineName: 'Día 1',
  imported: false,
  sets: sets.map(([weightKg, reps]) => ({ weightKg, reps })),
});

describe('summarize', () => {
  it('computes top weight, reps and volume', () => {
    expect(
      summarize([
        { weightKg: 35, reps: 12 },
        { weightKg: 35, reps: 10 },
        { weightKg: null, reps: 5 },
      ]),
    ).toEqual({ topWeightKg: 35, totalReps: 27, volumeKg: 770, bestSetReps: 12 });
  });
});

describe('computeRecords', () => {
  const history = [
    session('2026-10-20', 1, [
      [35, 12],
      [35, 11],
    ]),
    session('2026-10-27', 2, [
      [37.5, 10],
      [37.5, 9],
    ]),
    session('2026-11-03', 3, [
      [37.5, 10],
      [35, 14],
    ]),
  ];

  it('finds the heaviest set and keeps the first time it happened', () => {
    expect(computeRecords(history).maxWeight).toEqual({ kg: 37.5, reps: 10, date: '2026-10-27', sessionId: 2 });
  });

  it('finds the set with most reps', () => {
    expect(computeRecords(history).maxReps).toEqual({ reps: 14, kg: 35, date: '2026-11-03', sessionId: 3 });
  });

  it('finds the session with most volume', () => {
    expect(computeRecords(history).maxVolume).toEqual({ kg: 865, date: '2026-11-03', sessionId: 3 });
  });

  it('works regardless of input order', () => {
    expect(computeRecords([...history].reverse())).toEqual(computeRecords(history));
  });

  it('has no weight or volume records for bodyweight-only work', () => {
    const records = computeRecords([session('2026-11-01', 1, [[null, 10], [0, 12]])]);
    expect(records.maxWeight).toBeNull();
    expect(records.maxVolume).toBeNull();
    expect(records.maxReps).toEqual({ reps: 12, kg: 0, date: '2026-11-01', sessionId: 1 });
  });

  it('is empty without sessions', () => {
    expect(computeRecords([])).toEqual({ maxWeight: null, maxReps: null, maxVolume: null });
  });
});

describe('distinctRecords', () => {
  it('does not repeat the heaviest set as the one with most reps', () => {
    // Curl with the bar: 20 kg × 10 is both the heaviest set and the longest one.
    const records = computeRecords([
      session('2026-10-19', 1, [
        [20, 10],
        [20, 9],
        [20, 9],
      ]),
      session('2026-10-26', 2, [
        [20, 10],
        [20, 9],
        [20, 9],
      ]),
    ]);
    expect(distinctRecords(records)).toEqual({
      maxWeight: { kg: 20, reps: 10, date: '2026-10-19', sessionId: 1 },
      maxReps: null,
      maxVolume: { kg: 560, date: '2026-10-19', sessionId: 1 },
    });
  });

  it('keeps both when the most reps were done with less weight', () => {
    const records = computeRecords([session('2026-11-03', 3, [[37.5, 10], [35, 14]])]);
    expect(distinctRecords(records)).toEqual(records);
  });

  it('keeps the reps of bodyweight work, which has no weight record', () => {
    const records = computeRecords([session('2026-11-01', 1, [[null, 12]])]);
    expect(distinctRecords(records).maxReps).toEqual({ reps: 12, kg: 0, date: '2026-11-01', sessionId: 1 });
  });
});

describe('niceScale', () => {
  it('rounds to clean steps around the data', () => {
    expect(niceScale([32.5, 35, 37.5, 40])).toEqual({ min: 32.5, max: 40, ticks: [32.5, 35, 37.5, 40] });
    expect(niceScale([18, 27, 33])).toEqual({ min: 15, max: 35, ticks: [15, 20, 25, 30, 35] });
  });

  it('gives a flat series some room', () => {
    const s = niceScale([20, 20, 20]);
    expect(s.min).toBeLessThan(20);
    expect(s.max).toBeGreaterThan(20);
  });

  it('never goes below zero for positive data', () => {
    expect(niceScale([0, 0]).min).toBe(0);
    expect(niceScale([1, 2]).min).toBeGreaterThanOrEqual(0);
  });

  it('steps whole numbers by 1 at least, so the reps axis never repeats a value', () => {
    // 27, 27.5, 28 would read 27, 28, 28 once rounded.
    expect(niceScale([27, 28]).ticks).toEqual([27, 28]);
    expect(niceScale([10, 11, 12]).ticks).toEqual([10, 11, 12]);
    expect(niceScale([5, 5]).ticks).toEqual([4, 5, 6]);
    expect(niceScale([1, 1]).ticks).toEqual([0, 1, 2]);
    for (const values of [[27, 28], [3, 4, 4], [10, 11, 12], [5, 5], [30, 33, 31], [0, 1]]) {
      const { ticks } = niceScale(values);
      expect(ticks.every(Number.isInteger)).toBe(true);
      expect(new Set(ticks).size).toBe(ticks.length);
    }
  });

  it('keeps fractional steps for decimals such as body weight', () => {
    expect(niceScale([84.2, 84.6]).ticks).toEqual([84.2, 84.4, 84.6]);
  });
});

describe('history lists', () => {
  it('groups consecutive items by month, keeping their order', () => {
    const dates = ['2026-11-03', '2026-11-01', '2026-10-30', '2025-11-20'];
    expect(groupByMonth(dates, (d) => d)).toEqual([
      { month: '2026-11', items: ['2026-11-03', '2026-11-01'] },
      { month: '2026-10', items: ['2026-10-30'] },
      { month: '2025-11', items: ['2025-11-20'] },
    ]);
    expect(groupByMonth([], (d: string) => d)).toEqual([]);
  });

  it('names the month, with the year only if it is not this year', () => {
    const now = new Date(2026, 10, 3);
    expect(formatMonth('2026-11', now)).toBe('Noviembre');
    expect(formatMonth('2025-11', now)).toBe('Noviembre de 2025');
  });

  it('writes a day as «mar 3 nov»', () => {
    expect(formatDayMonth('2026-11-03')).toBe('mar 3 nov');
    expect(capitalize(formatDayMonth('2026-10-30'))).toBe('Vie 30 oct');
  });

  it('counts in singular and plural', () => {
    expect(countOf(1, 'serie', 'series')).toBe('1 serie');
    expect(countOf(11, 'serie', 'series')).toBe('11 series');
  });

  it('splits a figure from its unit', () => {
    expect(splitUnit('5,14 km')).toEqual({ value: '5,14', unit: 'km' });
    expect(splitUnit('20 kg')).toEqual({ value: '20', unit: 'kg' });
    expect(splitUnit('10 250 kg')).toEqual({ value: '10 250', unit: 'kg' });
    expect(splitUnit('59:12')).toEqual({ value: '59:12' });
  });

  it('thins a long route for a thumbnail, keeping the ends of each segment', () => {
    const route = [Array.from({ length: 1000 }, (_, i) => i), Array.from({ length: 200 }, (_, i) => 1000 + i)];
    const thin = thinSegments(route, 100);
    expect(thin.flat().length).toBeLessThanOrEqual(110);
    expect(thin.map((s) => [s[0], s.at(-1)])).toEqual([
      [0, 999],
      [1000, 1199],
    ]);
    const short = [[1, 2, 3]];
    expect(thinSegments(short, 100)).toBe(short);
  });
});
