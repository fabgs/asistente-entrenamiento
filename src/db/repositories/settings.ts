import { ageOn, computeTargets, type NutritionTargets, type Sex } from '@/domain/nutrition';
import { sanitizeProgression } from '@/domain/progression';
import type { ProgressionMode, ProgressionSettings } from '@/domain/types';
import type { TrackMetric } from '@/domain/trackChart';
import { isWalkMetric, type DistanceUnit, type WalkMetric } from '@/domain/walkStats';
import { bool, int, type Db } from '../db';

export type LivePanel = 'map' | 'chart' | 'splits';
/** What the body map of Perfil paints: the sets of this week, or the days since each muscle worked. */
export type MuscleMapMode = 'week' | 'days';
const LIVE_PANELS: LivePanel[] = ['map', 'chart', 'splits'];
const TRACK_METRICS: TrackMetric[] = ['pace', 'speed', 'altitude'];

export interface Settings {
  restSecondsDefault: number;
  defaultIncrementKg: number;
  progressionMode: ProgressionMode;
  sessionsBelowToDecrease: number;
  dailyReminderEnabled: boolean;
  dailyReminderTime: string;
  keepAwake: boolean;
  restOverlay: boolean;
  devMode: boolean;
  backupOwner: string | null;
  backupRepo: string | null;
  backupPath: string | null;
  lastBackupAt: number | null;
  lastBackupError: string | null;
  /** Figure shown big on a walk's screen. */
  cardioHero: WalkMetric;
  distanceUnit: DistanceUnit;
  /** Metric last chosen in a walk's chart. */
  cardioChart: TrackMetric;
  /** Panel last chosen under the figures of a walk being recorded. */
  cardioLivePanel: LivePanel;
  muscleMapMode: MuscleMapMode;
  /** Alert when leaving a route being followed (1.4.9): the switch of «Seguir una ruta» and of the walk's menu. */
  routeAlert: boolean;
}

interface SettingsRow {
  rest_seconds_default: number;
  default_increment_kg: number;
  progression_mode: ProgressionMode;
  sessions_below_to_decrease: number;
  daily_reminder_enabled: number;
  daily_reminder_time: string;
  keep_awake: number;
  rest_overlay: number;
  dev_mode: number;
  backup_owner: string | null;
  backup_repo: string | null;
  backup_path: string | null;
  last_backup_at: number | null;
  last_backup_error: string | null;
  cardio_hero: string;
  distance_unit: string;
  cardio_chart: string;
  cardio_live_panel: string;
  muscle_map_mode: string;
  route_alert: number;
}

export async function getSettings(db: Db): Promise<Settings> {
  const row = await db.getFirstAsync<SettingsRow>('SELECT * FROM settings WHERE id = 1');
  if (!row) throw new Error('settings row missing');
  // Rules out of range (a backup edited by hand) are read as the engine can use them.
  const rules = sanitizeProgression({
    defaultIncrementKg: row.default_increment_kg,
    mode: row.progression_mode,
    sessionsBelowToDecrease: row.sessions_below_to_decrease,
  });
  return {
    restSecondsDefault: row.rest_seconds_default,
    defaultIncrementKg: rules.defaultIncrementKg,
    progressionMode: rules.mode,
    sessionsBelowToDecrease: rules.sessionsBelowToDecrease,
    dailyReminderEnabled: bool(row.daily_reminder_enabled),
    dailyReminderTime: row.daily_reminder_time,
    keepAwake: bool(row.keep_awake),
    restOverlay: bool(row.rest_overlay),
    devMode: bool(row.dev_mode),
    backupOwner: row.backup_owner,
    backupRepo: row.backup_repo,
    backupPath: row.backup_path,
    lastBackupAt: row.last_backup_at,
    lastBackupError: row.last_backup_error,
    cardioHero: isWalkMetric(row.cardio_hero) ? row.cardio_hero : 'distance',
    distanceUnit: row.distance_unit === 'm' ? 'm' : 'km',
    cardioChart: TRACK_METRICS.find((m) => m === row.cardio_chart) ?? 'pace',
    cardioLivePanel: LIVE_PANELS.find((p) => p === row.cardio_live_panel) ?? 'map',
    muscleMapMode: row.muscle_map_mode === 'days' ? 'days' : 'week',
    routeAlert: bool(row.route_alert),
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
    restOverlay: 'rest_overlay',
    devMode: 'dev_mode',
    backupOwner: 'backup_owner',
    backupRepo: 'backup_repo',
    backupPath: 'backup_path',
    lastBackupAt: 'last_backup_at',
    lastBackupError: 'last_backup_error',
    cardioHero: 'cardio_hero',
    distanceUnit: 'distance_unit',
    cardioChart: 'cardio_chart',
    cardioLivePanel: 'cardio_live_panel',
    muscleMapMode: 'muscle_map_mode',
    routeAlert: 'route_alert',
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

/** A page of the weigh-ins, newest first: the list of all of them loads as it scrolls. */
export async function listWeightsPage(db: Db, limit: number, offset: number): Promise<WeightEntry[]> {
  return db.getAllAsync<WeightEntry>(
    'SELECT date, weight_kg AS weightKg FROM weight_log ORDER BY date DESC LIMIT ? OFFSET ?',
    limit,
    offset,
  );
}

export async function countWeights(db: Db): Promise<number> {
  return (await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM weight_log'))?.n ?? 0;
}

export async function latestWeight(db: Db): Promise<number | null> {
  const row = await db.getFirstAsync<{ weight_kg: number }>(
    'SELECT weight_kg FROM weight_log ORDER BY date DESC LIMIT 1',
  );
  return row?.weight_kg ?? null;
}

/** Daily targets from the profile and latest weight, or null while the profile is incomplete. */
export async function loadNutritionTargets(db: Db, today: string): Promise<NutritionTargets | null> {
  return nutritionTargetsOf(await getProfile(db), await latestWeight(db), today);
}

/** Same as loadNutritionTargets, for a profile being edited on screen. */
export function nutritionTargetsOf(profile: Profile, weightKg: number | null, today: string): NutritionTargets | null {
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

/** Deletes a weigh-in, but never the last one: the daily targets need a weight. */
export async function deleteWeight(db: Db, date: string): Promise<boolean> {
  const r = await db.runAsync(
    'DELETE FROM weight_log WHERE date = ? AND (SELECT COUNT(*) FROM weight_log) > 1',
    date,
  );
  return r.changes > 0;
}
