import {
  ACTIVITY_LEVELS,
  DEFAULT_PER_KG,
  gramsPerKgLabel,
  mlPerKgLabel,
  PER_KG_LIMITS,
  waterLPerKg,
  waterMlPerKg,
  activityLabel,
  deficitFor,
  formatWeightDelta,
  goalLabel,
  goalOf,
  missingForTargets,
} from '../bodyProfile';

describe('goal and signed deficit', () => {
  it('reads the goal from the sign of the deficit', () => {
    expect(goalOf(400)).toEqual({ goal: 'lose', kcal: 400 });
    expect(goalOf(-300)).toEqual({ goal: 'gain', kcal: 300 });
    expect(goalOf(0)).toEqual({ goal: 'keep', kcal: 0 });
  });

  it('writes the goal back as a signed deficit', () => {
    expect(deficitFor('lose', 450)).toBe(450);
    expect(deficitFor('gain', 250)).toBe(-250);
    expect(deficitFor('gain', -250)).toBe(-250);
    expect(deficitFor('keep', 400)).toBe(0);
    expect(deficitFor('lose', 0)).toBe(0);
  });

  it('round-trips every goal', () => {
    for (const deficit of [500, 0, -350]) {
      const { goal, kcal } = goalOf(deficit);
      expect(deficitFor(goal, kcal)).toBe(deficit);
    }
  });

  it('labels the goal for its row', () => {
    expect(goalLabel(400)).toBe('Perder 400 kcal');
    expect(goalLabel(-300)).toBe('Ganar 300 kcal');
    expect(goalLabel(0)).toBe('Mantener');
  });
});

describe('activity levels', () => {
  it('names the five factors of the plan, in order', () => {
    expect(ACTIVITY_LEVELS.map((l) => l.factor)).toEqual([1.2, 1.375, 1.5, 1.55, 1.725]);
    expect(activityLabel(1.2)).toBe('Sedentaria · 1,2');
    expect(activityLabel(1.5)).toBe('Moderada · 1,5');
    expect(activityLabel(1.725)).toBe('Alta · 1,725');
  });

  it('shows only the number of a factor outside the list', () => {
    expect(activityLabel(1.6)).toBe('1,6');
  });
});

describe('missingForTargets', () => {
  it('lists what the targets still need', () => {
    expect(missingForTargets({ birthDate: null, heightCm: 184, weightKg: 84 })).toBe('Falta la fecha de nacimiento');
    expect(missingForTargets({ birthDate: '1995-06-25', heightCm: null, weightKg: null })).toBe(
      'Faltan la altura y el peso',
    );
    expect(missingForTargets({ birthDate: null, heightCm: null, weightKg: null })).toBe(
      'Faltan la fecha de nacimiento, la altura y el peso',
    );
    expect(missingForTargets({ birthDate: '1995-06-25', heightCm: 184, weightKg: 84 })).toBeNull();
  });
});

describe('formatWeightDelta', () => {
  it('signs the change with a true minus and keeps the unit together', () => {
    expect(formatWeightDelta(1.24)).toBe('+1,2 kg');
    expect(formatWeightDelta(-2.3)).toBe('−2,3 kg');
    expect(formatWeightDelta(0.01)).toBe('0 kg');
  });
});

describe('protein, fat and water per kg', () => {
  it('edits water in ml per kg and keeps it in L per kg, both ways', () => {
    expect(waterMlPerKg(0.035)).toBe(35);
    expect(waterLPerKg(36)).toBeCloseTo(0.036);
    expect(waterMlPerKg(waterLPerKg(41))).toBe(41);
  });

  it('writes the values with their unit', () => {
    expect(gramsPerKgLabel(2)).toBe('2 g/kg');
    expect(gramsPerKgLabel(1.2)).toBe('1,2 g/kg');
    expect(mlPerKgLabel(35)).toBe('35 ml/kg');
  });

  it('starts within its limits', () => {
    expect(DEFAULT_PER_KG.proteinGPerKg).toBeGreaterThanOrEqual(PER_KG_LIMITS.protein.min);
    expect(DEFAULT_PER_KG.proteinGPerKg).toBeLessThanOrEqual(PER_KG_LIMITS.protein.max);
    expect(DEFAULT_PER_KG.fatGPerKg).toBeGreaterThanOrEqual(PER_KG_LIMITS.fat.min);
    expect(DEFAULT_PER_KG.waterMlPerKg).toBeLessThanOrEqual(PER_KG_LIMITS.water.max);
  });
});
