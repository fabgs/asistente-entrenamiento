import type {
  ExerciseType,
  IsoWeekday,
  ProgressionKind,
  ProgressionMode,
  RepTarget,
  RepUnit,
} from '@/domain/types';
import type { Meal } from '@/domain/diet';
import type { Sex } from '@/domain/nutrition';

/** Shape of data/seed/seed.json (PLAN.md §3). */
export interface SeedData {
  schemaVersion: number;
  profile: {
    sex: Sex;
    birthDate: string | null;
    heightCm: number | null;
    weightKg: number | null;
    activityFactor: number;
    deficitKcal: number;
    proteinGPerKg: number;
    fatGPerKg: number;
    waterLPerKg: number;
  };
  settings: {
    restSecondsDefault: number;
    defaultIncrementKg: number;
    progressionMode: ProgressionMode;
    sessionsBelowToDecrease: number;
    dailyReminderTime: string;
    dailyReminderEnabled: boolean;
  };
  exercises: { name: string; type: ExerciseType; equipment: string | null }[];
  routines: SeedRoutine[];
  cardio: {
    weekday: IsoWeekday;
    name: string;
    target: string | null;
    intensity: string | null;
    notes: string | null;
  }[];
  foods: { name: string; fatPer100g: number; carbsPer100g: number; proteinPer100g: number }[];
  dietPlan: { weekday: IsoWeekday; meal: Meal; food: string; grams: number }[];
}

export type { Meal };

export interface SeedRoutine {
  name: string;
  weekdays: IsoWeekday[];
  slots: SeedSlot[];
}

export interface SeedSlot {
  exercise: string;
  sets: number;
  weightKg: number | null;
  target: RepTarget;
  perSide: boolean;
  unit: RepUnit;
  progression: ProgressionKind;
  allowDecrease: boolean;
  incrementKg: number | null;
  restSeconds: number | null;
  note: string | null;
  history: { label: 'anterior' | 'hoy'; weightKg: number | null; reps: number[] }[];
}
