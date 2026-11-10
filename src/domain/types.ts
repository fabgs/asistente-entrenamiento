/** ISO weekday: 1 = Monday … 7 = Sunday. */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type RepTarget =
  | { kind: 'range'; min: number; max: number }
  | { kind: 'fixed'; reps: number }
  | { kind: 'failure'; minus: number };

export type RepUnit = 'reps' | 'steps' | 'seconds';
export type ExerciseType = 'external' | 'bodyweight';
export type ProgressionKind = 'load' | 'manual';
export type ProgressionMode = 'average' | 'strict';

/** What the progression engine needs to know about a routine slot. */
export interface SlotRule {
  sets: number;
  target: RepTarget;
  progression: ProgressionKind;
  allowDecrease: boolean;
  incrementKg: number | null;
  weightKg: number | null;
}

/** Everything done on one slot during one finished session. */
export interface SessionPerformance {
  weightKg: number | null;
  reps: number[];
}

export interface ProgressionSettings {
  defaultIncrementKg: number;
  mode: ProgressionMode;
  sessionsBelowToDecrease: number;
}

export type RecommendationAction = 'increase' | 'decrease' | 'keep' | 'manual' | 'none';

export interface Recommendation {
  action: RecommendationAction;
  fromKg: number | null;
  toKg: number | null;
  reason: string;
  repsToBeat?: number[];
  /** A «bajar» that is a deload after stalling (PLAN.md §6.2, rule 12): the only one of more than one increment. */
  deload?: boolean;
}
