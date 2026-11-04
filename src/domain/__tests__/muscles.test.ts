import {
  CATALOG_MUSCLES,
  contributionsTo,
  formatSetsOfPlan,
  hasMuscles,
  isMuscle,
  matchesExercise,
  MUSCLE_INFO,
  MUSCLE_KEYS,
  movementPattern,
  muscleLevel,
  muscleLevels,
  musclesFromRows,
  muscleWeek,
  weekBefore,
  setShare,
  setsPerMuscle,
  totalSets,
  weekSoFar,
  withoutMuscles,
  type ExerciseMuscles,
} from '../muscles';

const ROW: ExerciseMuscles = { primary: ['lats', 'upper_back'], secondary: ['lower_back', 'rear_delts', 'biceps'] };
const SQUAT: ExerciseMuscles = { primary: ['quads'], secondary: ['glutes', 'adductors'] };

describe('muscles', () => {
  it('counts 1 per set for each primary muscle and 0,5 for each secondary', () => {
    const sets = setsPerMuscle([{ exerciseId: 1, sets: 3 }], new Map([[1, ROW]]));
    expect(sets.lats).toBe(3);
    expect(sets.upper_back).toBe(3);
    expect(sets.biceps).toBe(1.5);
    expect(sets.rear_delts).toBe(1.5);
    expect(sets.chest).toBe(0);
  });

  it('adds up several exercises on the same muscle', () => {
    const musclesOf = new Map([
      [1, ROW],
      [2, { primary: ['biceps'], secondary: ['forearms'] } as ExerciseMuscles],
    ]);
    const sets = setsPerMuscle(
      [
        { exerciseId: 1, sets: 3 },
        { exerciseId: 2, sets: 3 },
      ],
      musclesOf,
    );
    expect(sets.biceps).toBe(4.5);
    expect(sets.forearms).toBe(1.5);
  });

  it('leaves out exercises without muscles and lists them once', () => {
    const musclesOf = new Map([[1, SQUAT]]);
    const sets = setsPerMuscle(
      [
        { exerciseId: 1, sets: 2 },
        { exerciseId: 9, sets: 4 },
      ],
      musclesOf,
    );
    expect(Object.values(sets).reduce((a, b) => a + b, 0)).toBe(2 + 2 * 0.5 * 2);
    expect(withoutMuscles([1, 9, 9, 7], new Map([...musclesOf, [7, { primary: [], secondary: ['abs'] }]]))).toEqual([9, 7]);
  });

  it('takes this week from its Monday to today', () => {
    expect(weekSoFar('2026-11-04')).toEqual({ from: '2026-11-02', to: '2026-11-04' }); // Wednesday
    expect(weekSoFar('2026-11-02')).toEqual({ from: '2026-11-02', to: '2026-11-02' }); // Monday
    expect(weekSoFar('2026-11-08')).toEqual({ from: '2026-11-02', to: '2026-11-08' }); // Sunday
    expect(weekSoFar('2027-01-01')).toEqual({ from: '2026-12-28', to: '2027-01-01' }); // across the year
  });

  it('pairs what was done with the plan, muscle by muscle, and counts real sets', () => {
    const musclesOf = new Map([[1, ROW]]);
    const week = muscleWeek(
      setsPerMuscle([{ exerciseId: 1, sets: 2 }], musclesOf),
      setsPerMuscle([{ exerciseId: 1, sets: 6 }], musclesOf),
    );
    expect(week.find((w) => w.muscle === 'biceps')).toEqual({ muscle: 'biceps', done: 1, planned: 3 });
    expect(week).toHaveLength(18);
    expect(
      totalSets([
        { exerciseId: 1, sets: 3 },
        { exerciseId: 2, sets: 4 },
      ]),
    ).toBe(7);
  });

  it('paints the map by the sets done, in steps that start at 3, 6 and 10', () => {
    expect([0, 0.5, 2.5, 3, 5.5, 6, 9.5, 10, 25].map(muscleLevel)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4]);
    const levels = muscleLevels(setsPerMuscle([{ exerciseId: 1, sets: 3 }], new Map([[1, ROW]])));
    expect(levels.lats).toBe(2);
    expect(levels.biceps).toBe(1);
    expect(levels.chest).toBe(0);
  });

  it('writes the sets against the plan, or alone without one', () => {
    expect(formatSetsOfPlan(6, 11)).toBe('6 de 11');
    expect(formatSetsOfPlan(4.5, 8, true)).toBe('4,5 de 8 series');
    expect(formatSetsOfPlan(0, 3.5)).toBe('0 de 3,5');
    expect(formatSetsOfPlan(2, 0)).toBe('2 series');
    expect(formatSetsOfPlan(1, 0)).toBe('1 serie');
  });

  it('lists what gives sets to a muscle: primary first, then the most sets', () => {
    const musclesOf = new Map<number, ExerciseMuscles>([
      [1, ROW], // lower_back secondary
      [2, { primary: ['hamstrings', 'glutes'], secondary: ['lower_back'] }],
      [3, { primary: ['lower_back'], secondary: [] }],
      [4, SQUAT],
    ]);
    const done = [
      { exerciseId: 1, sets: 3 },
      { exerciseId: 4, sets: 3 },
    ];
    const planned = [
      { exerciseId: 1, sets: 3 },
      { exerciseId: 2, sets: 6 },
      { exerciseId: 3, sets: 2 },
      { exerciseId: 4, sets: 3 },
    ];
    expect(contributionsTo('lower_back', done, planned, musclesOf)).toEqual([
      { exerciseId: 3, role: 'primary', done: 0, planned: 2 },
      { exerciseId: 1, role: 'secondary', done: 3, planned: 3 },
      { exerciseId: 2, role: 'secondary', done: 0, planned: 6 },
    ]);
  });

  it('knows the week before', () => {
    expect(weekBefore('2026-11-04')).toEqual({ from: '2026-10-26', to: '2026-11-01' });
    expect(weekBefore('2026-11-02')).toEqual({ from: '2026-10-26', to: '2026-11-01' });
  });

  it('gives each muscle its share of one set', () => {
    expect(setShare(SQUAT, 'quads')).toBe(1);
    expect(setShare(SQUAT, 'glutes')).toBe(0.5);
    expect(setShare(SQUAT, 'chest')).toBe(0);
  });

  it('reads stored rows: unknown keys go, primary wins, taxonomy order', () => {
    expect(
      musclesFromRows([
        { muscle: 'glutes', role: 'secondary' },
        { muscle: 'quads', role: 'primary' },
        { muscle: 'neck', role: 'secondary' },
        { muscle: 'quads', role: 'secondary' },
        { muscle: 'adductors', role: 'secondary' },
      ]),
    ).toEqual(SQUAT);
    expect(isMuscle('side_delts')).toBe(true);
    expect(isMuscle('shoulders')).toBe(false);
  });

  it('finds exercises by name or by muscle, without accents', () => {
    const curl: ExerciseMuscles = { primary: ['biceps'], secondary: ['forearms'] };
    expect(matchesExercise('biceps', 'Curl con barra Z', curl)).toBe(true);
    expect(matchesExercise('ANTEBRA', 'Curl con barra Z', curl)).toBe(true);
    expect(matchesExercise('curl', 'Curl con barra Z', undefined)).toBe(true);
    expect(matchesExercise('hombro', 'Curl con barra Z', curl)).toBe(false);
    expect(matchesExercise('  ', 'Curl con barra Z', curl)).toBe(true);
  });

  it('takes the icon pattern from the first primary muscle', () => {
    expect(movementPattern(ROW)).toBe('pull');
    expect(movementPattern(SQUAT)).toBe('legs');
    expect(movementPattern({ primary: ['hamstrings', 'glutes'], secondary: [] })).toBe('hinge');
    expect(movementPattern({ primary: ['side_delts'], secondary: ['traps'] })).toBe('arms');
    expect(movementPattern({ primary: [], secondary: ['abs'] })).toBeNull();
    expect(movementPattern(undefined)).toBeNull();
  });

  it('assigns every catalog exercise at least one primary, never the same muscle twice', () => {
    for (const [name, primary, secondary] of CATALOG_MUSCLES) {
      expect({ name, ok: hasMuscles({ primary, secondary }) }).toEqual({ name, ok: true });
      expect(primary.filter((m) => secondary.includes(m))).toEqual([]);
      expect(new Set([...primary, ...secondary]).size).toBe(primary.length + secondary.length);
    }
    expect(new Set(CATALOG_MUSCLES.map(([name]) => name)).size).toBe(CATALOG_MUSCLES.length);
  });

  it('names every muscle in Spanish and in one of the six groups', () => {
    expect(MUSCLE_KEYS).toHaveLength(18);
    for (const m of MUSCLE_KEYS) expect(MUSCLE_INFO[m].label).toMatch(/^[A-ZÁÉÍÓÚ]/);
  });
});
