import { ageOn, computeTargets, type NutritionTargets, type Sex } from '@/domain/nutrition';
import type { ProgressionMode, ProgressionSettings } from '@/domain/types';
import { bool, int, type Db } from '../db';

export interface Settings {
  restSecondsDefault: number;
  defaultIncrementKg: number;
  progressionMode: ProgressionMode;
  sessionsBelowToDecrease: number;
  dailyReminderEnabled: boolean;
  dailyReminderTime: string;
  keepAwake: boolean;
}

interface SettingsRow {
  rest_seconds_default: number;
  default_increment_kg: number;
  progression_mode: ProgressionMode;
  sessions_below_to_decrease: number;
  daily_reminder_enabled: number;
  daily_reminder_time: string;
  keep_awake: number;
}

export async function getSettings(db: Db): Promise<Settings> {
  const row = await db.getFirstAsync<SettingsRow>('SELECT * FROM settings WHERE id = 1');
  if (!row) throw new Error('settings row missing');
  return {
    restSecondsDefault: row.rest_seconds_default,
    defaultIncrementKg: row.default_increment_kg,
    progressionMode: row.progression_mode,
    sessionsBelowToDecrease: row.sessions_below_to_decrease,
    dailyReminderEnabled: bool(row.daily_reminder_enabled),
    dailyReminderTime: row.daily_reminder_time,
    keepAwake: bool(row.keep_awake),
  };
}

export async function updateSettings(db: Db, patch: Partial<Settings>): Promise<void> {
  const columns: Record<keyof Settings, string> = {
    restSecondsDefault: 'rest_seconds_default',
    defaultIncrementKg: 'default_increment_kg',
    progressionMode: 'progression_mode',
    sessionsBelowToDecrease: 'sessions_below_to_decrease',
    dailyReminderEnabled: 'daily_reminder_enabled',
    dailyReminderTime: 'daily_reminder_time',
    keepAwake: 'keep_awake',
  };
  for (const [key, value] of Object.entries(patch) as [keyof Settings, Settings[keyof Settings]][]) {
    const sqlValue = typeof value === 'boolean' ? int(value) : value;
    await db.runAsync(`UPDATE settings SET ${columns[key]} = ? WHERE id = 1`, sqlValue);
  }
}

export function toProgressionSettings(s: Settings): ProgressionSettings {
  return {
    defaultIncrementKg: s.defaultIncrementKg,
    mode: s.progressionMode,
    sessionsBelowToDecrease: s.sessionsBelowToDecrease,
  };
}

export interface Profile {
  name: string | null;
  sex: Sex;
  birthDate: string | null;
  heightCm: number | null;
  activityFactor: number;
  deficitKcal: number;
  proteinGPerKg: number;
  fatGPerKg: number;
  waterLPerKg: number;
}

interface ProfileRow {
  name: string | null;
  sex: Sex;
  birth_date: string | null;
  height_cm: number | null;
  activity_factor: number;
  deficit_kcal: number;
  protein_g_per_kg: number;
  fat_g_per_kg: number;
  water_l_per_kg: number;
}

export async function getProfile(db: Db): Promise<Profile> {
  const row = await db.getFirstAsync<ProfileRow>('SELECT * FROM profile WHERE id = 1');
  if (!row) throw new Error('profile row missing');
  return {
    name: row.name,
    sex: row.sex,
    birthDate: row.birth_date,
    heightCm: row.height_cm,
    activityFactor: row.activity_factor,
    deficitKcal: row.deficit_kcal,
    proteinGPerKg: row.protein_g_per_kg,
    fatGPerKg: row.fat_g_per_kg,
    waterLPerKg: row.water_l_per_kg,
  };
}

export async function updateProfile(db: Db, patch: Partial<Profile>): Promise<void> {
  const columns: Record<keyof Profile, string> = {
    name: 'name',
    sex: 'sex',
    birthDate: 'birth_date',
    heightCm: 'height_cm',
    activityFactor: 'activity_factor',
    deficitKcal: 'deficit_kcal',
    proteinGPerKg: 'protein_g_per_kg',
    fatGPerKg: 'fat_g_per_kg',
    waterLPerKg: 'water_l_per_kg',
  };
  for (const [key, value] of Object.entries(patch) as [keyof Profile, Profile[keyof Profile]][]) {
    await db.runAsync(`UPDATE profile SET ${columns[key]} = ? WHERE id = 1`, value);
  }
}

export interface WeightEntry {
  date: string;
  weightKg: number;
}

export async function listWeights(db: Db): Promise<WeightEntry[]> {
  return db.getAllAsync<WeightEntry>(
    'SELECT date, weight_kg AS weightKg FROM weight_log ORDER BY date DESC',
  );
}

export async function latestWeight(db: Db): Promise<number | null> {
  const row = await db.getFirstAsync<{ weight_kg: number }>(
    'SELECT weight_kg FROM weight_log ORDER BY date DESC LIMIT 1',
  );
  return row?.weight_kg ?? null;
}

/** Daily targets from the profile and latest weight, or null while the profile is incomplete. */
export async function loadNutritionTargets(db: Db, today: string): Promise<NutritionTargets | null> {
  const profile = await getProfile(db);
  const weightKg = await latestWeight(db);
  if (!profile.birthDate || !profile.heightCm || !weightKg) return null;
  return computeTargets({
    sex: profile.sex,
    heightCm: profile.heightCm,
    weightKg,
    age: ageOn(profile.birthDate, today),
    activityFactor: profile.activityFactor,
    deficitKcal: profile.deficitKcal,
    proteinGPerKg: profile.proteinGPerKg,
    fatGPerKg: profile.fatGPerKg,
    waterLPerKg: profile.waterLPerKg,
  });
}

export async function logWeight(db: Db, date: string, weightKg: number): Promise<void> {
  await db.runAsync(
    `INSERT INTO weight_log (date, weight_kg) VALUES (?, ?)
     ON CONFLICT(date) DO UPDATE SET weight_kg = excluded.weight_kg`,
    date,
    weightKg,
  );
}
