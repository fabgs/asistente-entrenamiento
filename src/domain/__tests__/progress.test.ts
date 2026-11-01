import { computeRecords, niceScale, summarize, type ExerciseSession } from '../progress';

const session = (
  date: string,
  startedAt: number,
  sets: [number | null, number][],
): ExerciseSession => ({
  sessionId: startedAt,
  date,
  startedAt,
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
    expect(computeRecords(history).maxWeight).toEqual({ kg: 37.5, reps: 10, date: '2026-10-27' });
  });

  it('finds the set with most reps', () => {
    expect(computeRecords(history).maxReps).toEqual({ reps: 14, kg: 35, date: '2026-11-03' });
  });

  it('finds the session with most volume', () => {
    expect(computeRecords(history).maxVolume).toEqual({ kg: 865, date: '2026-11-03' });
  });

  it('works regardless of input order', () => {
    expect(computeRecords([...history].reverse())).toEqual(computeRecords(history));
  });

  it('has no weight or volume records for bodyweight-only work', () => {
    const records = computeRecords([session('2026-11-01', 1, [[null, 10], [0, 12]])]);
    expect(records.maxWeight).toBeNull();
    expect(records.maxVolume).toBeNull();
    expect(records.maxReps).toEqual({ reps: 12, kg: 0, date: '2026-11-01' });
  });

  it('is empty without sessions', () => {
    expect(computeRecords([])).toEqual({ maxWeight: null, maxReps: null, maxVolume: null });
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
});
