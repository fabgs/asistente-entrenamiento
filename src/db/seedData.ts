import catalog from '../../data/seed/catalog.json';
import { DEFAULT_PER_KG, waterLPerKg } from '@/domain/bodyProfile';
import { DEFAULT_PROGRESSION } from '@/domain/progression';
import type { SeedData } from './seedTypes';

/**
 * What a new install starts with (PLAN.md §3): the exercise and food catalogues and default
 * settings. No routines, cardio, diet or body data: each user sets up their own.
 */
export const SEED: SeedData = {
  schemaVersion: 1,
  profile: {
    sex: 'male',
    birthDate: null,
    heightCm: null,
    weightKg: null,
    activityFactor: 1.5,
    deficitKcal: 400,
    proteinGPerKg: DEFAULT_PER_KG.proteinGPerKg,
    fatGPerKg: DEFAULT_PER_KG.fatGPerKg,
    waterLPerKg: waterLPerKg(DEFAULT_PER_KG.waterMlPerKg),
  },
  settings: {
    restSecondsDefault: 150,
    defaultIncrementKg: DEFAULT_PROGRESSION.defaultIncrementKg,
    progressionMode: DEFAULT_PROGRESSION.mode,
    sessionsBelowToDecrease: DEFAULT_PROGRESSION.sessionsBelowToDecrease,
    dailyReminderTime: '07:00',
    // Nothing to remind about until there is a plan; it is switched on in Ajustes.
    dailyReminderEnabled: false,
  },
  exercises: catalog.exercises as SeedData['exercises'],
  foods: catalog.foods,
  routines: [],
  cardio: [],
  dietPlan: [],
};
