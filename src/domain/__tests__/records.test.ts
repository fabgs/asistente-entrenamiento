import type { TrackSample } from '../gps';
import {
  exerciseBest,
  formatRecordDate,
  longestWalkText,
  recordOf,
  recordReading,
  recordText,
  sessionHasRecord,
  usualUnit,
  walkRecords,
  workoutsPerWeek,
  type ExerciseBest,
  type RecordSet,
  type WalkRow,
} from '../records';

const set = (sessionId: number, date: string, weightKg: number | null, reps: number, over: Partial<RecordSet> = {}): RecordSet => ({
  exerciseId: 1,
  sessionId,
  date,
  startedAt: Date.parse(date),
  imported: false,
  unit: 'reps',
  weightKg,
  reps,
  ...over,
});

describe('exerciseBest', () => {
  it('is the heaviest set, ties to more reps and then to the first time', () => {
    const best = exerciseBest(
      [
        set(1, '2025-03-12', 40, 6, { imported: true }),
        set(2, '2026-11-02', 40, 8),
        set(3, '2026-11-05', 40, 8),
        set(3, '2026-11-05', 35, 12),
      ],
      'reps',
    );
    expect(best).toEqual({ kind: 'load', kg: 40, reps: 8, date: '2026-11-02', sessionId: 2, imported: false });
  });

  it('says when the record comes from the notes', () => {
    expect(exerciseBest([set(1, '2025-03-12', 50, 6, { imported: true }), set(2, '2026-11-02', 40, 8)], 'reps')).toMatchObject({
      kg: 50,
      imported: true,
    });
  });

  it('without any load, the set with the most; only in the unit asked for', () => {
    const sets = [set(1, '2026-10-01', null, 18), set(2, '2026-11-01', 0, 22), set(3, '2026-11-02', null, 420, { unit: 'seconds' })];
    expect(exerciseBest(sets, 'reps')).toEqual({ kind: 'amount', amount: 22, date: '2026-11-01', sessionId: 2, imported: false });
    expect(exerciseBest(sets, 'seconds')).toMatchObject({ kind: 'amount', amount: 420 });
    expect(exerciseBest(sets, 'steps')).toBeNull();
  });

  it('a bodyweight exercise with ballast once has its heaviest ballast as the record', () => {
    const sets = [set(1, '2026-10-01', null, 12), set(2, '2026-11-01', 7.5, 6)];
    expect(exerciseBest(sets, 'reps')).toMatchObject({ kind: 'load', kg: 7.5, reps: 6 });
  });

  it('the usual unit is that of most of its sets', () => {
    expect(usualUnit([set(1, 'x', null, 60, { unit: 'seconds' }), set(1, 'x', null, 60, { unit: 'seconds' }), set(2, 'x', null, 10)])).toBe(
      'seconds',
    );
    expect(usualUnit([])).toBe('reps');
  });
});

describe('workoutsPerWeek', () => {
  it('counts the weeks of the year so far, or from the first workout ever', () => {
    // 2026 to 9 November: 313 days.
    expect(workoutsPerWeek(155, '2026', '2024-03-04', '2026-11-09')).toBeCloseTo(155 / (313 / 7));
    // A whole past year.
    expect(workoutsPerWeek(182, '2025', '2024-03-04', '2026-11-09')).toBeCloseTo(182 / (365 / 7));
    // The first year starts at the first workout.
    expect(workoutsPerWeek(100, '2024', '2024-03-04', '2026-11-09')).toBeCloseTo(100 / (303 / 7));
  });

  it('never divides by less than a week', () => {
    expect(workoutsPerWeek(2, '2026', '2026-11-08', '2026-11-09')).toBe(2);
  });
});

describe('walkRecords', () => {
  // A walk at a steady pace: one sample a minute.
  const samples = (km: number, secondsPerKm: number): TrackSample[] =>
    Array.from({ length: Math.ceil((km * secondsPerKm) / 60) + 1 }, (_, i) => ({ s: i * 60, d: Math.min(km * 1000, (i * 60 * 1000) / secondsPerKm), a: null }));
  const walk = (id: number, date: string, km: number, secondsPerKm: number, key = 'caminar'): WalkRow => ({
    id,
    key,
    name: key === 'caminar' ? 'Caminar' : 'Ruta',
    date,
    startedAt: Date.parse(date),
    distanceM: km * 1000,
    samples: samples(km, secondsPerKm),
  });

  it('groups the walks of one activity: total, longest and fastest kilometre', () => {
    const [caminar, ruta] = walkRecords([
      walk(1, '2026-11-03', 5, 660),
      walk(2, '2026-11-05', 8.2, 600),
      walk(3, '2026-11-07', 4, 588),
      walk(4, '2026-11-01', 3, 700, 'ruta'),
    ]);
    expect(caminar).toMatchObject({ name: 'Caminar', count: 3, since: '2026-11-03', longest: { distanceM: 8200, sessionId: 2 } });
    expect(caminar.totalM).toBeCloseTo(17_200);
    expect(caminar.bestKm).toMatchObject({ sessionId: 3, date: '2026-11-07' });
    expect(caminar.bestKm!.seconds).toBeCloseTo(588);
    expect(ruta).toMatchObject({ name: 'Ruta', count: 1 });
  });

  it('a walk under a kilometre has no fastest kilometre', () => {
    const [only] = walkRecords([walk(1, '2026-11-03', 0.8, 600)]);
    expect(only.bestKm).toBeNull();
    expect(only.longest?.distanceM).toBe(800);
  });
});

describe('recordReading', () => {
  const TODAY = '2026-11-09';
  const load = (over: Partial<Extract<ExerciseBest, { kind: 'load' }>> = {}) => ({
    kind: 'load' as const,
    kg: 40,
    reps: 8,
    date: '2025-03-12',
    sessionId: 1,
    imported: false,
    ...over,
  });

  it('a load: the weight, then its reps, the date and the weight of now', () => {
    const reading = recordReading({ best: load(), unit: 'reps', bodyweight: false, pair: false, slotWeightKg: 35 }, TODAY);
    expect(reading.figure).toEqual({ value: '40', unit: 'kg' });
    expect(reading.subtitle).toBe('8\u00a0reps · 12 mar 2025 · ahora 35\u00a0kg');
  });

  it('says nothing of now when the slot is at the record, nor the year this year', () => {
    const reading = recordReading({ best: load({ date: '2026-10-23' }), unit: 'reps', bodyweight: false, pair: false, slotWeightKg: 40 }, TODAY);
    expect(reading.subtitle).toBe('8\u00a0reps · 23 oct');
  });

  it('ballast, two dumbbells and a record from the notes', () => {
    expect(recordReading({ best: load({ kg: 15 }), unit: 'reps', bodyweight: true, pair: false, slotWeightKg: null }, TODAY)).toEqual({
      figure: { value: '15', unit: 'kg', caption: 'lastre' },
      subtitle: '8\u00a0reps · 12 mar 2025 · ahora peso corporal',
    });
    const pair = recordReading({ best: load({ kg: 20, imported: true }), unit: 'reps', bodyweight: false, pair: true }, TODAY);
    expect(pair.figure.value).toBe('2\u00a0×\u00a020');
    expect(pair.subtitle).toBe('8\u00a0reps · 12 mar 2025 · Importado');
  });

  it('without load, the most in its unit over the date', () => {
    const amount = (n: number) => ({ kind: 'amount' as const, amount: n, date: '2026-11-01', sessionId: 1, imported: false });
    expect(recordReading({ best: amount(22), unit: 'reps', bodyweight: true, pair: false }, TODAY)).toEqual({
      figure: { value: '22', unit: 'reps', caption: '1 nov' },
      subtitle: null,
    });
    expect(recordReading({ best: amount(420), unit: 'seconds', bodyweight: true, pair: false }, TODAY).figure).toMatchObject({ value: '7', unit: 'min' });
    expect(recordReading({ best: amount(40), unit: 'steps', bodyweight: false, pair: false }, TODAY).figure).toMatchObject({ value: '40', unit: 'pasos' });
  });

  it('dates carry the year only when it is not this one', () => {
    expect(formatRecordDate('2026-03-12', TODAY)).toBe('12 mar');
    expect(formatRecordDate('2025-03-12', TODAY)).toBe('12 mar 2025');
  });
});

describe('a new record', () => {
  // Three workouts with a load: 40 × 8 is the best set.
  const history = [
    set(1, '2026-10-20', 35, 12),
    set(1, '2026-10-20', 35, 11),
    set(2, '2026-10-27', 37.5, 10),
    set(3, '2026-11-03', 40, 8),
    set(3, '2026-11-03', 40, 7),
  ];
  const plain = { bodyweight: false, pair: false };
  const today = (weightKg: number | null, reps: number, over: Partial<RecordSet> = {}) => set(9, '2026-11-10', weightKg, reps, over);

  it('is a heavier set than ever', () => {
    const record = recordOf(history, { weightKg: 42.5, reps: 5 }, 'reps', 9);
    expect(record).toEqual({ kind: 'weight', kg: 42.5, beforeKg: 40 });
    expect(recordText(record!, 'reps', plain)).toBe('Nuevo récord · 42,5 kg · antes 40 kg');
  });

  it('is more reps with the heaviest weight, and nothing with a lighter one', () => {
    const record = recordOf(history, { weightKg: 40, reps: 9 }, 'reps', 9);
    expect(record).toEqual({ kind: 'amountAtWeight', kg: 40, amount: 9, before: 8 });
    expect(recordText(record!, 'reps', plain)).toBe('Nuevo récord · 9 reps con 40 kg · antes 8');
    expect(recordOf(history, { weightKg: 35, reps: 20 }, 'reps', 9)).toBeNull();
  });

  it('is not to equal the best', () => {
    expect(recordOf(history, { weightKg: 40, reps: 8 }, 'reps', 9)).toBeNull();
    expect(recordOf(history, { weightKg: 40, reps: 7 }, 'reps', 9)).toBeNull();
  });

  it('counts the sets done before it today: the same again says nothing, a better one does', () => {
    const first = [...history, today(42.5, 5)];
    expect(recordOf(first, { weightKg: 42.5, reps: 5 }, 'reps', 9)).toBeNull();
    expect(recordOf(first, { weightKg: 42.5, reps: 6 }, 'reps', 9)).toEqual({ kind: 'amountAtWeight', kg: 42.5, amount: 6, before: 5 });
  });

  it('needs three earlier workouts, without counting today', () => {
    const two = history.filter((s) => s.sessionId !== 1);
    expect(recordOf(two, { weightKg: 45, reps: 5 }, 'reps', 9)).toBeNull();
    expect(recordOf([...two, today(40, 8)], { weightKg: 45, reps: 5 }, 'reps', 9)).toBeNull();
    expect(recordOf(history, { weightKg: 45, reps: 5 }, 'reps', 9)).not.toBeNull();
  });

  it('is not the first day with a load of an exercise noted without one', () => {
    const noted = [1, 2, 3, 4].map((id) => set(id, `2025-0${id}-10`, null, 10, { imported: true }));
    expect(recordOf(noted, { weightKg: 5, reps: 8 }, 'reps', 9)).toBeNull();
    // Nor the next two days with it; from the fourth it is.
    const loaded = [...noted, set(5, '2026-10-01', 5, 8), set(6, '2026-10-08', 5, 8)];
    expect(recordOf(loaded, { weightKg: 7.5, reps: 6 }, 'reps', 9)).toBeNull();
    expect(recordOf([...loaded, set(7, '2026-10-15', 5, 8)], { weightKg: 7.5, reps: 6 }, 'reps', 9)).toMatchObject({ kind: 'weight' });
  });

  it('without any load ever, is more reps, seconds or steps than ever', () => {
    const reps = [1, 2, 3].map((id) => set(id, `2026-10-0${id}`, null, 10 + id));
    const record = recordOf(reps, { weightKg: null, reps: 14 }, 'reps', 9);
    expect(record).toEqual({ kind: 'amount', amount: 14, before: 13 });
    expect(recordText(record!, 'reps', { bodyweight: true, pair: false })).toBe('Nuevo récord · 14 reps · antes 13');
    expect(recordOf(reps, { weightKg: null, reps: 13 }, 'reps', 9)).toBeNull();

    const holds = [1, 2, 3].map((id) => set(id, `2026-10-0${id}`, null, 50 + id * 5, { unit: 'seconds' }));
    const hold = recordOf(holds, { weightKg: null, reps: 130 }, 'seconds', 9)!;
    expect(recordText(hold, 'seconds', { bodyweight: true, pair: false })).toBe('Nuevo récord · 2:10 min · antes 65 s');
    const steps = [1, 2, 3].map((id) => set(id, `2026-10-0${id}`, null, 30 + id * 2, { unit: 'steps' }));
    expect(recordText(recordOf(steps, { weightKg: null, reps: 40 }, 'steps', 9)!, 'steps', plain)).toBe('Nuevo récord · 40 pasos · antes 36');
  });

  it('compares only sets in the unit of the exercise in the routine', () => {
    const mixed = [...history, set(4, '2026-11-05', 40, 90, { unit: 'seconds' })];
    expect(recordOf(mixed, { weightKg: 40, reps: 9 }, 'reps', 9)).toMatchObject({ kind: 'amountAtWeight', before: 8 });
    expect(recordOf(mixed, { weightKg: 40, reps: 95 }, 'seconds', 9)).toBeNull();
    expect(recordOf(history, { weightKg: 50, reps: 0 }, 'reps', 9)).toBeNull();
  });

  it('writes the load as everywhere else', () => {
    const record = { kind: 'weight' as const, kg: 15, beforeKg: 12.5 };
    expect(recordText(record, 'reps', { bodyweight: true, pair: false })).toBe('Nuevo récord · lastre 15 kg · antes 12,5 kg');
    expect(recordText({ kind: 'weight', kg: 20, beforeKg: 17.5 }, 'reps', { bodyweight: false, pair: true })).toBe(
      'Nuevo récord · 2 × 20 kg · antes 2 × 17,5 kg',
    );
    expect(recordText({ kind: 'amountAtWeight', kg: 15, amount: 7, before: 6 }, 'reps', { bodyweight: true, pair: false })).toBe(
      'Nuevo récord · 7 reps con lastre 15 kg · antes 6',
    );
  });

  it('tags the workout that holds a record, and a correction takes the tag away', () => {
    const session = { exerciseId: 1, sessionId: 9, date: '2026-11-10', startedAt: Date.parse('2026-11-10') };
    const sets = [
      { weightKg: 40, reps: 8 },
      { weightKg: 40, reps: 9 },
      { weightKg: 40, reps: 7 },
    ];
    expect(sessionHasRecord(history, sets, 'reps', session)).toBe(true);
    expect(sessionHasRecord(history, [sets[0], { weightKg: 40, reps: 8 }, sets[2]], 'reps', session)).toBe(false);
    expect(sessionHasRecord(history.slice(2), sets, 'reps', session)).toBe(false);
  });
});

describe('the longest walk', () => {
  const walk = (id: number, km: number, key = 'caminar'): WalkRow => ({
    id,
    key,
    name: 'Caminar',
    date: `2026-11-${String(id).padStart(2, '0')}`,
    startedAt: Date.UTC(2026, 10, id, 8),
    distanceM: km * 1000,
    samples: [],
  });
  const usual = [1, 2, 3, 4, 5].map((id) => walk(id, id === 3 ? 6.9 : 5.1));

  it('is more than 5 % over the longest of five before it', () => {
    expect(longestWalkText(walk(6, 7.42), usual)).toBe('Nuevo récord de distancia · 7,42 km · antes 6,90 km');
    expect(longestWalkText(walk(6, 7.2), usual)).toBeNull();
    expect(longestWalkText(walk(6, 5.3), usual)).toBeNull();
  });

  it('needs five earlier walks of the same activity, and ignores the later ones', () => {
    expect(longestWalkText(walk(6, 9), usual.slice(1))).toBeNull();
    expect(longestWalkText(walk(6, 9), [...usual.slice(1), walk(7, 4, 'correr')])).toBeNull();
    expect(longestWalkText(walk(6, 9), [...usual, walk(7, 12)])).toBe('Nuevo récord de distancia · 9,00 km · antes 6,90 km');
    expect(longestWalkText(walk(6, 9), [...usual, walk(6, 9)])).not.toBeNull();
  });
});
