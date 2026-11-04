/**
 * Muscles an exercise works and the sets each muscle gets (PLAN.md §6.9). The keys are stored in
 * `exercise_muscle.muscle`; the shoulder goes in three heads because the catalog trains them apart
 * (lateral raises, rear-delt rows). Each key notes its name in exercemus, in case it is ever imported.
 */
import { formatNumber, normalizeForSearch } from './format';
import { dateOfWeekday, localDateString, parseLocalDate } from './schedule';

export const MUSCLE_KEYS = [
  'chest', // chest
  'lats', // lats
  'upper_back', // middle back
  'traps', // traps
  'lower_back', // lower back
  'front_delts', // shoulders
  'side_delts', // shoulders
  'rear_delts', // shoulders
  'biceps', // biceps (+ brachialis)
  'triceps', // triceps
  'forearms', // forearms
  'quads', // quads
  'hamstrings', // hamstrings
  'glutes', // glutes (+ abductors)
  'adductors', // adductors
  'calves', // calves (+ soleus)
  'abs', // abs
  'obliques', // obliques
] as const;

export type Muscle = (typeof MUSCLE_KEYS)[number];
export type MuscleGroup = 'chest' | 'back' | 'shoulders' | 'arms' | 'legs' | 'core';
export type MuscleRole = 'primary' | 'secondary';

export const MUSCLE_GROUPS: readonly { key: MuscleGroup; label: string }[] = [
  { key: 'chest', label: 'Pecho' },
  { key: 'back', label: 'Espalda' },
  { key: 'shoulders', label: 'Hombros' },
  { key: 'arms', label: 'Brazos' },
  { key: 'legs', label: 'Piernas' },
  { key: 'core', label: 'Core' },
];

export const MUSCLE_INFO: Record<Muscle, { label: string; group: MuscleGroup }> = {
  chest: { label: 'Pecho', group: 'chest' },
  lats: { label: 'Dorsal', group: 'back' },
  upper_back: { label: 'Espalda alta', group: 'back' },
  traps: { label: 'Trapecio', group: 'back' },
  lower_back: { label: 'Lumbar', group: 'back' },
  front_delts: { label: 'Hombro anterior', group: 'shoulders' },
  side_delts: { label: 'Hombro lateral', group: 'shoulders' },
  rear_delts: { label: 'Hombro posterior', group: 'shoulders' },
  biceps: { label: 'Bíceps', group: 'arms' },
  triceps: { label: 'Tríceps', group: 'arms' },
  forearms: { label: 'Antebrazo', group: 'arms' },
  quads: { label: 'Cuádriceps', group: 'legs' },
  hamstrings: { label: 'Isquios', group: 'legs' },
  glutes: { label: 'Glúteo', group: 'legs' },
  adductors: { label: 'Aductores', group: 'legs' },
  calves: { label: 'Gemelo', group: 'legs' },
  abs: { label: 'Abdomen', group: 'core' },
  obliques: { label: 'Oblicuos', group: 'core' },
};

export const muscleLabel = (m: Muscle) => MUSCLE_INFO[m].label;

export const musclesOfGroup = (group: MuscleGroup): Muscle[] => MUSCLE_KEYS.filter((m) => MUSCLE_INFO[m].group === group);

export function isMuscle(value: string): value is Muscle {
  return (MUSCLE_KEYS as readonly string[]).includes(value);
}

export interface ExerciseMuscles {
  primary: Muscle[];
  secondary: Muscle[];
}

export const NO_MUSCLES: ExerciseMuscles = { primary: [], secondary: [] };

export const hasMuscles = (m: ExerciseMuscles | undefined): boolean => (m?.primary.length ?? 0) > 0;

/** In the order of MUSCLE_KEYS, without repeats. */
export const sortMuscles = (list: readonly Muscle[]): Muscle[] => MUSCLE_KEYS.filter((m) => list.includes(m));

/**
 * Builds an exercise's muscles from stored rows: unknown keys (a taxonomy from a newer version) are
 * dropped, and a muscle both primary and secondary stays primary.
 */
export function musclesFromRows(rows: readonly { muscle: string; role: string }[]): ExerciseMuscles {
  const primary = sortMuscles(rows.filter((r) => r.role === 'primary').map((r) => r.muscle).filter(isMuscle));
  const secondary = sortMuscles(
    rows.filter((r) => r.role === 'secondary').map((r) => r.muscle).filter(isMuscle),
  ).filter((m) => !primary.includes(m));
  return { primary, secondary };
}

/** What one set of the exercise gives the muscle: 1 if primary, 0.5 if secondary (fractional sets). */
export function setShare(muscles: ExerciseMuscles, muscle: Muscle): number {
  if (muscles.primary.includes(muscle)) return 1;
  if (muscles.secondary.includes(muscle)) return 0.5;
  return 0;
}

export type MuscleSets = Record<Muscle, number>;

export const zeroSets = (): MuscleSets =>
  Object.fromEntries(MUSCLE_KEYS.map((m) => [m, 0])) as MuscleSets;

/**
 * Sets per muscle: each set counts 1 for the primary muscles and 0.5 for the secondary ones, whatever
 * its load, reps, seconds or sides (a set per side is one set: each leg did one). Exercises without
 * muscles add nothing.
 */
export function setsPerMuscle(
  items: Iterable<{ exerciseId: number; sets: number }>,
  musclesOf: ReadonlyMap<number, ExerciseMuscles>,
): MuscleSets {
  const total = zeroSets();
  for (const { exerciseId, sets } of items) {
    const muscles = musclesOf.get(exerciseId);
    if (!muscles) continue;
    for (const m of muscles.primary) total[m] += sets;
    for (const m of muscles.secondary) total[m] += sets * 0.5;
  }
  return total;
}

/** «Esta semana»: from its Monday to `today`, both local dates. */
export function weekSoFar(today: string): { from: string; to: string } {
  return { from: localDateString(dateOfWeekday(parseLocalDate(today), 1, 0)), to: today };
}

/** The whole week before `today`'s, Monday to Sunday. */
export function weekBefore(today: string): { from: string; to: string } {
  const monday = dateOfWeekday(parseLocalDate(today), 1, 1);
  const sunday = dateOfWeekday(parseLocalDate(today), 7, 1);
  return { from: localDateString(monday), to: localDateString(sunday) };
}

export type ExerciseSets = { exerciseId: number; sets: number };

/** Real sets, not shared out between muscles: «34 de 65 series». */
export const totalSets = (items: Iterable<ExerciseSets>): number => [...items].reduce((sum, i) => sum + i.sets, 0);

/**
 * Sets a week where each step of the body map starts. The map paints what was done, not the share of
 * the plan: on Monday it is empty and on Sunday it shows where the work went. 10 opens the 10–20 range
 * that the evidence recommends per muscle, so «in range» is the same colour for every muscle.
 */
export const LEVEL_STARTS = [3, 6, 10] as const;

/** Step of the body map, 0–4: nothing, under 3, under 6, under 10, 10 or more. */
export function muscleLevel(sets: number): number {
  if (sets <= 0) return 0;
  return 1 + LEVEL_STARTS.filter((start) => sets >= start).length;
}

export const muscleLevels = (sets: MuscleSets): Record<Muscle, number> =>
  Object.fromEntries(MUSCLE_KEYS.map((m) => [m, muscleLevel(sets[m])])) as Record<Muscle, number>;

/** «6 de 11» against a plan, or «2 series» without one; `unit` adds «series» after the plan too. */
export function formatSetsOfPlan(done: number, planned: number, unit = false): string {
  const n = (v: number) => formatNumber(v, 1);
  if (planned > 0) return `${n(done)} de ${n(planned)}${unit ? ' series' : ''}`;
  return `${n(done)} ${done === 1 ? 'serie' : 'series'}`;
}

export interface MuscleContribution {
  exerciseId: number;
  role: MuscleRole;
  /** Real sets of the exercise, done this week and planned for it. */
  done: number;
  planned: number;
}

/**
 * The exercises that give sets to a muscle, done this week or in the plan: the primary ones first,
 * then the ones with more sets. It explains a figure («why does lumbar have 3?»).
 */
export function contributionsTo(
  muscle: Muscle,
  done: Iterable<ExerciseSets>,
  planned: Iterable<ExerciseSets>,
  musclesOf: ReadonlyMap<number, ExerciseMuscles>,
): MuscleContribution[] {
  const byExercise = new Map<number, MuscleContribution>();
  const add = (items: Iterable<ExerciseSets>, key: 'done' | 'planned') => {
    for (const { exerciseId, sets } of items) {
      const muscles = musclesOf.get(exerciseId);
      const share = muscles ? setShare(muscles, muscle) : 0;
      if (share === 0) continue;
      const entry = byExercise.get(exerciseId) ?? {
        exerciseId,
        role: share === 1 ? 'primary' : 'secondary',
        done: 0,
        planned: 0,
      };
      entry[key] += sets;
      byExercise.set(exerciseId, entry);
    }
  };
  add(done, 'done');
  add(planned, 'planned');
  return [...byExercise.values()].sort((a, b) =>
    a.role !== b.role ? (a.role === 'primary' ? -1 : 1) : b.planned + b.done - (a.planned + a.done),
  );
}

export interface MuscleWeek {
  muscle: Muscle;
  done: number;
  planned: number;
}

/** Each muscle with its sets done this week and those of the plan, in the order of MUSCLE_KEYS. */
export const muscleWeek = (done: MuscleSets, planned: MuscleSets): MuscleWeek[] =>
  MUSCLE_KEYS.map((muscle) => ({ muscle, done: done[muscle], planned: planned[muscle] }));

/** Exercises among `exerciseIds` that have no primary muscle yet (they do not count anywhere). */
export function withoutMuscles(exerciseIds: Iterable<number>, musclesOf: ReadonlyMap<number, ExerciseMuscles>): number[] {
  return [...new Set(exerciseIds)].filter((id) => !hasMuscles(musclesOf.get(id)));
}

/**
 * Search of the exercise pickers: by name or by any of its muscles, without minding accents or case
 * («hombro» finds the lateral raises, «biceps» the curl and the chin-ups).
 */
export function matchesExercise(query: string, name: string, muscles: ExerciseMuscles | undefined): boolean {
  const wanted = normalizeForSearch(query.trim());
  if (!wanted) return true;
  const labels = [...(muscles?.primary ?? []), ...(muscles?.secondary ?? [])].map(muscleLabel);
  return [name, ...labels].some((text) => normalizeForSearch(text).includes(wanted));
}

/** Movement pattern of an exercise, from its first primary muscle: it picks the exercise's icon. */
export type MovementPattern = 'push' | 'pull' | 'arms' | 'legs' | 'hinge' | 'core';

const PATTERN_OF: Record<Muscle, MovementPattern> = {
  chest: 'push',
  triceps: 'push',
  front_delts: 'push',
  lats: 'pull',
  upper_back: 'pull',
  traps: 'pull',
  rear_delts: 'pull',
  biceps: 'arms',
  forearms: 'arms',
  side_delts: 'arms',
  quads: 'legs',
  adductors: 'legs',
  calves: 'legs',
  hamstrings: 'hinge',
  glutes: 'hinge',
  lower_back: 'hinge',
  abs: 'core',
  obliques: 'core',
};

export const PATTERN_LABEL: Record<MovementPattern, string> = {
  push: 'Empuje',
  pull: 'Tirón',
  arms: 'Brazos y hombro',
  legs: 'Pierna',
  hinge: 'Cadera',
  core: 'Core',
};

export function movementPattern(muscles: ExerciseMuscles | undefined): MovementPattern | null {
  const first = muscles?.primary[0];
  return first ? PATTERN_OF[first] : null;
}

/**
 * Muscles assigned on install and to backups made before migration 9, by catalog name. The user
 * reviews them in the exercise editor; renamed exercises get nothing and show as «sin músculos».
 * It is migration 9: later fixes go in a new migration, not here.
 */
export const CATALOG_MUSCLES: readonly [name: string, primary: Muscle[], secondary: Muscle[]][] = [
  ['Fondos en paralelas lastrados', ['chest'], ['triceps', 'front_delts']],
  ['Fondos paralelas', ['chest'], ['triceps', 'front_delts']],
  ['Floor Press con barra', ['chest'], ['triceps', 'front_delts']],
  ['Flexiones arqueras', ['chest'], ['triceps', 'front_delts']],
  ['Flexiones declinadas diamond', ['triceps'], ['chest', 'front_delts']],
  ['Rompecráneos suelo', ['triceps'], []],
  ['Dominadas pronas', ['lats'], ['upper_back', 'biceps']],
  ['Dominadas supinas lastradas', ['lats'], ['upper_back', 'biceps']],
  ['Remo con barra (90º)', ['lats', 'upper_back'], ['lower_back', 'rear_delts', 'biceps']],
  ['Australianas (homb post)', ['upper_back', 'rear_delts'], ['biceps']],
  ['Elevaciones laterales mancuerna', ['side_delts'], []],
  ['Remo mentón barra Z', ['side_delts'], ['traps']],
  ['Curl bíceps barra Z', ['biceps'], ['forearms']],
  ['Sentadilla Búlgara lastrada', ['quads', 'glutes'], ['adductors']],
  ['Zancadas caminando', ['quads', 'glutes'], ['adductors']],
  ['Sentadilla Goblet/Frontal', ['quads'], ['glutes', 'adductors']],
  ['Extensiones cuád. (Sissy)', ['quads'], []],
  ['Gemelos a 1 pierna', ['calves'], []],
  ['Peso Muerto Rumano barra', ['hamstrings', 'glutes'], ['lower_back', 'adductors']],
  ['Curl femoral deslizante', ['hamstrings'], ['glutes']],
  ['Hip Thrust a 1 pierna', ['glutes'], ['hamstrings']],
  ['Toes to bar', ['abs'], ['obliques']],
];
