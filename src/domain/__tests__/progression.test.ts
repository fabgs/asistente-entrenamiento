import seedJson from '../../../data/seed/seed.json';
import type { SeedData, SeedSlot } from '@/db/seedTypes';
import { DEFAULT_PROGRESSION, deloadExample, deloadWeight, lowerExamples, raiseExamples, recommend, sanitizeProgression } from '../progression';
import type { ProgressionSettings, SlotRule } from '../types';

const seed = seedJson as SeedData;
const settings: ProgressionSettings = {
  defaultIncrementKg: 2.5,
  mode: 'average',
  sessionsBelowToDecrease: 2,
};

const ruleOf = (s: SeedSlot): SlotRule => ({
  sets: s.sets,
  target: s.target,
  progression: s.progression,
  allowDecrease: s.allowDecrease,
  incrementKg: s.incrementKg,
  weightKg: s.weightKg,
});
const historyOf = (s: SeedSlot) =>
  [...s.history].reverse().map((h) => ({ weightKg: h.weightKg, reps: h.reps }));

const range = (min: number, max: number) => ({ kind: 'range' as const, min, max });
const slot = (overrides: Partial<SlotRule> = {}): SlotRule => ({
  sets: 3,
  target: range(10, 12),
  progression: 'load',
  allowDecrease: true,
  incrementKg: null,
  weightKg: 35,
  ...overrides,
});

describe('recommend() with the Excel seed (PLAN.md §6.2)', () => {
  const expected: Record<string, [string, number | null]> = {
    '0:Fondos en paralelas lastrados': ['keep', 15],
    '0:Dominadas pronas': ['manual', null],
    '0:Flexiones declinadas diamond': ['manual', null],
    '0:Remo con barra (90º)': ['increase', 37.5],
    '0:Floor Press con barra': ['increase', 37.5],
    '0:Elevaciones laterales mancuerna': ['decrease', 2.5],
    '0:Curl bíceps barra Z': ['decrease', 17.5],
    '1:Sentadilla Búlgara lastrada': ['increase', 12.5],
    '1:Peso Muerto Rumano barra': ['keep', 35],
    '1:Zancadas caminando': ['increase', 12.5],
    '1:Curl femoral deslizante': ['manual', null],
    '1:Gemelos a 1 pierna': ['keep', 0],
    '1:Toes to bar': ['manual', null],
    '2:Dominadas supinas lastradas': ['increase', 10],
    '2:Fondos paralelas': ['manual', null],
    '2:Remo mentón barra Z': ['increase', 17.5],
    '2:Flexiones arqueras': ['manual', null],
    '2:Elevaciones laterales mancuerna': ['decrease', 2.5],
    '2:Australianas (homb post)': ['keep', 0],
    '2:Rompecráneos suelo': ['keep', 15],
    '3:Sentadilla Goblet/Frontal': ['keep', 35],
    '3:Hip Thrust a 1 pierna': ['decrease', 17.5],
    '3:Extensiones cuád. (Sissy)': ['manual', null],
    '3:Gemelos a 1 pierna': ['keep', 0],
    '3:Toes to bar': ['keep', 0],
  };

  const cases = seed.routines.flatMap((routine, ri) =>
    routine.slots.map((s) => [`${ri}:${s.exercise}`, s] as const),
  );

  it('covers every slot of the seed', () => {
    expect(cases.map(([key]) => key).sort()).toEqual(Object.keys(expected).sort());
  });

  it.each(cases)('%s', (key, s) => {
    const result = recommend(ruleOf(s), null, historyOf(s), settings);
    const [action, toKg] = expected[key];
    expect(result.action).toBe(action);
    expect(result.toKg).toBe(toKg);
  });

  it('explains why it increases', () => {
    const remo = seed.routines[0].slots.find((s) => s.exercise === 'Remo con barra (90º)')!;
    expect(recommend(ruleOf(remo), null, historyOf(remo), settings).reason).toBe(
      'Media de 14,7 reps, por encima de 12',
    );
  });

  it('warns after a single session below the range', () => {
    const aus = seed.routines[2].slots.find((s) => s.exercise === 'Australianas (homb post)')!;
    expect(recommend(ruleOf(aus), null, historyOf(aus), settings).reason).toContain(
      'si se repite, te sugerirá bajar',
    );
  });
});

describe('recommend() rules', () => {
  it('never jumps more than one increment', () => {
    const r = recommend(slot(), null, [{ weightKg: 35, reps: [30, 30, 30] }], settings);
    expect(r).toMatchObject({ action: 'increase', toKg: 37.5 });
  });

  it('uses slot increment, then exercise increment, then default', () => {
    const history = [{ weightKg: 20, reps: [13, 13, 13] }];
    expect(recommend(slot({ incrementKg: 1 }), 5, history, settings).toKg).toBe(21);
    expect(recommend(slot(), 5, history, settings).toKg).toBe(25);
    expect(recommend(slot(), null, history, settings).toKg).toBe(22.5);
  });

  it('strict mode needs every set at the top of the range', () => {
    const strict = { ...settings, mode: 'strict' as const };
    expect(recommend(slot(), null, [{ weightKg: 35, reps: [14, 13, 11] }], strict).action).toBe('keep');
    expect(recommend(slot(), null, [{ weightKg: 35, reps: [12, 12, 12] }], strict).action).toBe(
      'increase',
    );
  });

  it('average mode needs the mean strictly above the max', () => {
    expect(recommend(slot(), null, [{ weightKg: 35, reps: [12, 12, 12] }], settings).action).toBe('keep');
  });

  it('only decreases when the previous sessions at the same weight were also below', () => {
    const below = { weightKg: 35, reps: [8, 8, 8] };
    expect(recommend(slot(), null, [below], settings).action).toBe('keep');
    expect(recommend(slot(), null, [below, { weightKg: 37.5, reps: [8, 8, 8] }], settings).action).toBe(
      'keep',
    );
    expect(recommend(slot(), null, [below, below], settings)).toMatchObject({
      action: 'decrease',
      toKg: 32.5,
    });
    expect(
      recommend(slot(), null, [below], { ...settings, sessionsBelowToDecrease: 1 }).action,
    ).toBe('decrease');
  });

  it('does not decrease without allowDecrease', () => {
    const below = { weightKg: 35, reps: [8, 8, 8] };
    expect(recommend(slot({ allowDecrease: false }), null, [below, below], settings).action).toBe('keep');
  });

  it('never goes below zero', () => {
    const below = { weightKg: 0, reps: [5, 5, 5] };
    const r = recommend(slot({ weightKg: 0 }), null, [below, below], settings);
    expect(r).toMatchObject({ action: 'keep', toKg: 0 });
    expect(r.reason).toContain('variante más fácil');
  });

  it('keeps the load after an incomplete session', () => {
    const r = recommend(slot(), null, [{ weightKg: 35, reps: [20, 20] }], settings);
    expect(r.action).toBe('keep');
    expect(r.reason).toBe('Hiciste 2 de 3 series');
  });

  it('fixed targets increase only when every set is completed', () => {
    const fixed = slot({ target: { kind: 'fixed', reps: 20 }, sets: 2, weightKg: 10 });
    expect(recommend(fixed, null, [{ weightKg: 10, reps: [20, 18] }], settings).action).toBe('keep');
    expect(recommend(fixed, null, [{ weightKg: 10, reps: [20, 20] }], settings).toKg).toBe(12.5);
  });

  it('explains every reason in a plain sentence, without symbols', () => {
    const below = { weightKg: 35, reps: [8, 8, 8] };
    const reasons = [
      recommend(slot(), null, [{ weightKg: 35, reps: [13, 13, 14] }], settings).reason,
      recommend(slot(), null, [below, below], settings).reason,
      recommend(slot({ allowDecrease: false }), null, [below], settings).reason,
      recommend(slot(), null, [{ weightKg: 35, reps: [11, 11, 11] }], settings).reason,
      recommend(slot({ target: { kind: 'fixed', reps: 20 }, sets: 2 }), null, [{ weightKg: 10, reps: [20, 20] }], settings).reason,
      recommend(slot(), null, [{ weightKg: 35, reps: [14, 12, 11] }], { ...settings, mode: 'strict' }).reason,
      recommend(slot(), null, [below], { ...settings, sessionsBelowToDecrease: 3 }).reason,
    ];
    expect(reasons).toEqual([
      'Media de 13,3 reps, por encima de 12',
      'Media de 8, por debajo de 10, dos sesiones seguidas',
      'Media de 8, por debajo de 10; este ejercicio no baja solo',
      'Media de 11, dentro de 10–12',
      'Completaste 2 × 20',
      '2 de 3 series en 12 o más',
      'Media de 8, por debajo de 10: si sigue así dos sesiones más, te sugerirá bajar',
    ]);
    for (const r of reasons) expect(r).not.toMatch(/[<>→=]/);
  });

  it('reports no data without history', () => {
    expect(recommend(slot(), null, [], settings).action).toBe('none');
  });

  it('says why «Todas las series» keeps the weight, even with the average above the range', () => {
    const strict = { ...settings, mode: 'strict' as const };
    // The average of 14, 12 and 11 is 12,3: «dentro de 10–12» would be false.
    expect(recommend(slot(), null, [{ weightKg: 35, reps: [14, 12, 11] }], strict).reason).toBe('2 de 3 series en 12 o más');
    expect(recommend(slot(), null, [{ weightKg: 35, reps: [11, 11, 10] }], strict).reason).toBe('Ninguna serie en 12 o más');
    expect(recommend(slot(), null, [{ weightKg: 35, reps: [12, 12, 12] }], strict).reason).toBe('Todas las series en 12 o más');
  });

  it('counts the sessions still missing before suggesting to lower', () => {
    const below = { weightKg: 35, reps: [8, 8, 8] };
    const three = { ...settings, sessionsBelowToDecrease: 3 };
    expect(recommend(slot(), null, [below], three).reason).toBe('Media de 8, por debajo de 10: si sigue así dos sesiones más, te sugerirá bajar');
    expect(recommend(slot(), null, [below, below], three).reason).toBe('Media de 8, por debajo de 10: si se repite, te sugerirá bajar');
    expect(recommend(slot(), null, [below, below, below], three)).toMatchObject({
      action: 'decrease',
      reason: 'Media de 8, por debajo de 10, tres sesiones seguidas',
    });
    // A session at another weight breaks the run.
    expect(recommend(slot(), null, [below, below, { weightKg: 37.5, reps: [8, 8, 8] }], three).action).toBe('keep');
  });

  it('cleans rules a backup could bring', () => {
    expect(sanitizeProgression(DEFAULT_PROGRESSION)).toEqual(DEFAULT_PROGRESSION);
    expect(
      sanitizeProgression({ defaultIncrementKg: 0, mode: 'fast' as never, sessionsBelowToDecrease: 0 }),
    ).toEqual({ defaultIncrementKg: 2.5, mode: 'average', sessionsBelowToDecrease: 1 });
    expect(sanitizeProgression({ defaultIncrementKg: 25, mode: 'strict', sessionsBelowToDecrease: 9 })).toEqual({
      defaultIncrementKg: 10,
      mode: 'strict',
      sessionsBelowToDecrease: 4,
    });
    expect(sanitizeProgression({ ...DEFAULT_PROGRESSION, defaultIncrementKg: Number.NaN }).defaultIncrementKg).toBe(2.5);
  });
});

describe('examples of the rules (Ajustes, «Sugerencias de peso»)', () => {
  it('shows the two rules giving opposite outcomes on the same sessions', () => {
    expect(raiseExamples(DEFAULT_PROGRESSION)).toEqual([
      { label: '14, 12 y 11', outcome: 'Subir a 37,5 kg' },
      { label: '12, 12 y 12', outcome: 'Mantener 35 kg' },
    ]);
    expect(raiseExamples({ ...DEFAULT_PROGRESSION, mode: 'strict', defaultIncrementKg: 2 })).toEqual([
      { label: '14, 12 y 11', outcome: 'Mantener 35 kg' },
      { label: '12, 12 y 12', outcome: 'Subir a 37 kg' },
    ]);
  });

  it('shows when the weight goes down, one session short and then enough', () => {
    expect(lowerExamples(DEFAULT_PROGRESSION)).toEqual([
      { label: '9, 9 y 8 una vez', outcome: 'Mantener 20 kg' },
      { label: '9, 9 y 8 dos veces seguidas', outcome: 'Bajar a 17,5 kg' },
    ]);
    expect(lowerExamples({ ...DEFAULT_PROGRESSION, sessionsBelowToDecrease: 1 })).toEqual([
      { label: '9, 9 y 8 una vez', outcome: 'Bajar a 17,5 kg' },
    ]);
    expect(lowerExamples({ ...DEFAULT_PROGRESSION, sessionsBelowToDecrease: 4 })[1].label).toBe('9, 9 y 8 cuatro veces seguidas');
  });
});

describe('deload after stalling (PLAN.md §6.2, rule 12)', () => {
  /** Sessions with 35 kg, the newest first, each as its three sets. */
  const sessions = (...reps: number[][]) => reps.map((r) => ({ weightKg: 35, reps: r }));
  const flat = [11, 11, 10];

  it('suggests lowering after three complete sessions within the range that go nowhere', () => {
    const r = recommend(slot(), null, sessions(flat, flat, flat), settings);
    expect(r).toEqual({
      action: 'decrease',
      fromKg: 35,
      toKg: 32.5,
      reason: 'Tres sesiones seguidas sin mejorar las reps: descarga para volver a subir',
      repsToBeat: flat,
      deload: true,
    });
    expect(r.reason).not.toMatch(/[<>→=]/);
  });

  it('says so one session before, and nothing with a single flat session', () => {
    expect(recommend(slot(), null, sessions(flat), settings).reason).toBe('Media de 10,7, dentro de 10–12');
    expect(recommend(slot(), null, sessions(flat, flat), settings)).toMatchObject({
      action: 'keep',
      reason: 'Media de 10,7, dentro de 10–12: si la próxima no mejora, te sugerirá bajar',
    });
    // Better than the session before: no warning.
    expect(recommend(slot(), null, sessions([11, 11, 11], flat), settings).reason).toBe('Media de 11, dentro de 10–12');
    const strict = { ...settings, mode: 'strict' as const };
    expect(recommend(slot(), null, sessions([12, 12, 11], [12, 12, 11]), strict).reason).toBe(
      '2 de 3 series en 12 o más: si la próxima no mejora, te sugerirá bajar',
    );
    expect(recommend(slot(), null, sessions([12, 12, 11], [12, 12, 11], [12, 12, 11]), strict)).toMatchObject({ action: 'decrease', deload: true });
  });

  it('compares the latest session with the oldest of the three, by the sum of its sets', () => {
    // 30, 31, 30: up and back down is not an advance.
    expect(recommend(slot(), null, sessions([10, 10, 10], [11, 10, 10], [10, 10, 10]), settings).action).toBe('decrease');
    // 30, 32, 31 (oldest first): one rep more than three sessions ago.
    expect(recommend(slot(), null, sessions([11, 10, 10], [11, 11, 10], [10, 10, 10]), settings)).toMatchObject({
      action: 'keep',
      reason: 'Media de 10,3, dentro de 10–12',
    });
  });

  it('does not count an extra set', () => {
    // The fourth set of the latest session is not an improvement, nor one of the oldest a handicap.
    expect(recommend(slot(), null, sessions([...flat, 12], flat, flat), settings).action).toBe('decrease');
    expect(recommend(slot(), null, sessions(flat, flat, [...flat, 12]), settings).action).toBe('decrease');
  });

  it('is cut by an incomplete session, another weight or a session below the range', () => {
    const incomplete = { weightKg: 35, reps: [11, 11] };
    expect(recommend(slot(), null, [...sessions(flat), incomplete, ...sessions(flat, flat)], settings)).toMatchObject({
      action: 'keep',
      reason: 'Media de 10,7, dentro de 10–12',
    });
    // The last one incomplete: rule 5.
    expect(recommend(slot(), null, [incomplete, ...sessions(flat, flat, flat)], settings).reason).toBe('Hiciste 2 de 3 series');
    expect(recommend(slot(), null, [...sessions(flat, flat), { weightKg: 32.5, reps: flat }], settings).action).toBe('keep');
    expect(recommend(slot(), null, [...sessions(flat, flat), { weightKg: 35, reps: [9, 9, 8] }], settings).action).toBe('keep');
    // Below the range is the other rule's, with its own count.
    const below = { weightKg: 35, reps: [9, 9, 8] };
    expect(recommend(slot(), null, [below, below, below], { ...settings, sessionsBelowToDecrease: 4 })).toMatchObject({
      action: 'keep',
      reason: 'Media de 8,7, por debajo de 10: si se repite, te sugerirá bajar',
    });
  });

  it('respects «Proponer bajar el peso» and needs a load to take off', () => {
    expect(recommend(slot({ allowDecrease: false }), null, sessions(flat, flat, flat), settings)).toMatchObject({
      action: 'keep',
      reason: 'Media de 10,7, dentro de 10–12',
    });
    expect(recommend(slot({ allowDecrease: false }), null, sessions(flat, flat), settings).reason).toBe('Media de 10,7, dentro de 10–12');
    const at = (kg: number | null) => [0, 1, 2].map(() => ({ weightKg: kg, reps: flat }));
    expect(recommend(slot({ weightKg: 0 }), null, at(0), settings).action).toBe('keep');
    expect(recommend(slot({ weightKg: null }), null, at(null), settings).action).toBe('keep');
    // With one increment of load, a deload would leave nothing.
    expect(recommend(slot({ weightKg: 2.5 }), null, at(2.5), settings)).toMatchObject({ action: 'keep', reason: 'Media de 10,7, dentro de 10–12' });
    expect(recommend(slot({ weightKg: 5 }), null, at(5), settings)).toMatchObject({ action: 'decrease', toKg: 2.5 });
  });

  it('also stalls on a fixed target that is never completed', () => {
    const steps = slot({ target: { kind: 'fixed', reps: 20 }, sets: 2, weightKg: 10 });
    const short = { weightKg: 10, reps: [20, 18] };
    expect(recommend(steps, null, [short, short], settings).reason).toBe('Aún no completas todas las series: si la próxima no mejora, te sugerirá bajar');
    expect(recommend(steps, null, [short, short, short], settings)).toMatchObject({ action: 'decrease', toKg: 7.5, deload: true });
  });

  it('takes off the multiple of the increment closest to 10 %, at least one, the smaller on a tie', () => {
    const by = (inc: number) => (kg: number) => deloadWeight(kg, inc);
    expect([7.5, 20, 35, 37.5, 60].map(by(2.5))).toEqual([5, 17.5, 32.5, 35, 55]);
    expect([7.5, 20, 35, 37.5, 60].map(by(1.25))).toEqual([6.25, 17.5, 31.25, 33.75, 53.75]);
    expect(deloadWeight(20, 0.25)).toBe(18);
    expect(deloadWeight(20, 5)).toBe(15);
    // The only suggestion of more than one increment, with the increment of the slot.
    expect(recommend(slot({ weightKg: 60 }), null, [0, 1, 2].map(() => ({ weightKg: 60, reps: flat })), settings)).toMatchObject({ toKg: 55 });
    expect(recommend(slot({ weightKg: 60, incrementKg: 1.25 }), null, [0, 1, 2].map(() => ({ weightKg: 60, reps: flat })), settings).toKg).toBe(53.75);
    expect(recommend(slot({ weightKg: 60 }), 5, [0, 1, 2].map(() => ({ weightKg: 60, reps: flat })), settings).toKg).toBe(55);
  });

  it('does not insist: ignored, it comes back only after three more flat sessions', () => {
    const n = (count: number) => sessions(...Array.from({ length: count }, () => flat));
    expect([3, 4, 5, 6, 7, 9].map((count) => recommend(slot(), null, n(count), settings).action)).toEqual([
      'decrease',
      'keep',
      'keep',
      'decrease',
      'keep',
      'decrease',
    ]);
    // The fifth warns again, as the second did.
    expect(recommend(slot(), null, n(5), settings).reason).toMatch(/si la próxima no mejora/);
    expect(recommend(slot(), null, n(4), settings).reason).toBe('Media de 10,7, dentro de 10–12');
  });

  it('starts again after it is applied: the sessions with the old weight do not count', () => {
    const lighter = { weightKg: 32.5, reps: [12, 12, 11] };
    expect(recommend(slot({ weightKg: 32.5 }), null, [lighter, ...sessions(flat, flat, flat)], settings)).toMatchObject({
      action: 'keep',
      reason: 'Media de 11,7, dentro de 10–12',
    });
    // And going up from there works as always.
    expect(recommend(slot({ weightKg: 32.5 }), null, [{ weightKg: 32.5, reps: [13, 13, 12] }, ...sessions(flat, flat, flat)], settings)).toMatchObject({
      action: 'increase',
      toKg: 35,
    });
  });

  it('shows its example in Ajustes, worked out by the engine in both modes', () => {
    expect(deloadExample(DEFAULT_PROGRESSION)).toEqual({ label: '11, 11 y 10 tres veces seguidas', outcome: 'Bajar a 17,5 kg' });
    expect(deloadExample({ ...DEFAULT_PROGRESSION, mode: 'strict', sessionsBelowToDecrease: 4 }).outcome).toBe('Bajar a 17,5 kg');
    expect(deloadExample({ ...DEFAULT_PROGRESSION, defaultIncrementKg: 1.25 }).outcome).toBe('Bajar a 17,5 kg');
    expect(deloadExample({ ...DEFAULT_PROGRESSION, defaultIncrementKg: 5 }).outcome).toBe('Bajar a 15 kg');
  });
});
