import seedJson from '../../../data/seed/seed.json';
import type { SeedData, SeedSlot } from '@/db/seedTypes';
import { DEFAULT_PROGRESSION, lowerExamples, raiseExamples, recommend, sanitizeProgression } from '../progression';
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
