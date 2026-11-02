import catalog from '../../data/seed/catalog.json';
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
    proteinGPerKg: 2,
    fatGPerKg: 1,
    waterLPerKg: 0.035,
  },
  settings: {
    restSecondsDefault: 150,
    defaultIncrementKg: 2.5,
    progressionMode: 'average',
    sessionsBelowToDecrease: 2,
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
