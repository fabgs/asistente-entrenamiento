import type { Db } from './db';

/**
 * Append-only list: never edit a migration that has shipped, add a new one instead.
 * The index + 1 is stored in PRAGMA user_version.
 */
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE profile (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    name TEXT,
    sex TEXT NOT NULL DEFAULT 'male',
    birth_date TEXT,
    height_cm REAL,
    activity_factor REAL NOT NULL DEFAULT 1.5,
    deficit_kcal REAL NOT NULL DEFAULT 400,
    protein_g_per_kg REAL NOT NULL DEFAULT 2,
    fat_g_per_kg REAL NOT NULL DEFAULT 1,
    water_l_per_kg REAL NOT NULL DEFAULT 0.035
  );
  CREATE TABLE settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    rest_seconds_default INTEGER NOT NULL DEFAULT 150,
    default_increment_kg REAL NOT NULL DEFAULT 2.5,
    progression_mode TEXT NOT NULL DEFAULT 'average',
    sessions_below_to_decrease INTEGER NOT NULL DEFAULT 2,
    daily_reminder_enabled INTEGER NOT NULL DEFAULT 1,
    daily_reminder_time TEXT NOT NULL DEFAULT '06:00',
    keep_awake INTEGER NOT NULL DEFAULT 1,
    backup_owner TEXT,
    backup_repo TEXT,
    backup_path TEXT,
    last_backup_at INTEGER
  );
  CREATE TABLE weight_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL UNIQUE,
    weight_kg REAL NOT NULL
  );
  CREATE TABLE exercise (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    equipment TEXT,
    increment_kg REAL,
    notes TEXT,
    archived INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE routine (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE routine_weekday (
    routine_id INTEGER NOT NULL REFERENCES routine(id),
    weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
    PRIMARY KEY (routine_id, weekday)
  );
  CREATE TABLE routine_slot (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    routine_id INTEGER NOT NULL REFERENCES routine(id),
    exercise_id INTEGER NOT NULL REFERENCES exercise(id),
    position INTEGER NOT NULL,
    weight_kg REAL,
    sets INTEGER NOT NULL,
    target_kind TEXT NOT NULL,
    rep_min INTEGER,
    rep_max INTEGER,
    fixed_reps INTEGER,
    failure_minus INTEGER,
    per_side INTEGER NOT NULL DEFAULT 0,
    unit TEXT NOT NULL DEFAULT 'reps',
    progression TEXT NOT NULL DEFAULT 'load',
    allow_decrease INTEGER NOT NULL DEFAULT 1,
    increment_kg REAL,
    rest_seconds INTEGER,
    note TEXT,
    archived INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE cardio_activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
    name TEXT NOT NULL,
    target TEXT,
    intensity TEXT,
    notes TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE cardio_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    activity_id INTEGER REFERENCES cardio_activity(id),
    name TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 1,
    value TEXT,
    notes TEXT,
    UNIQUE (date, activity_id)
  );
  CREATE TABLE workout_session (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    routine_id INTEGER REFERENCES routine(id),
    date TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    status TEXT NOT NULL DEFAULT 'in_progress',
    imported INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    rest_ends_at INTEGER,
    rest_notification_id TEXT,
    current_slot_id INTEGER,
    skipped_slot_ids TEXT NOT NULL DEFAULT '[]'
  );
  CREATE TABLE set_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES workout_session(id) ON DELETE CASCADE,
    slot_id INTEGER REFERENCES routine_slot(id),
    exercise_id INTEGER NOT NULL REFERENCES exercise(id),
    set_index INTEGER NOT NULL,
    weight_kg REAL,
    reps INTEGER NOT NULL,
    is_extra INTEGER NOT NULL DEFAULT 0,
    completed_at INTEGER NOT NULL
  );
  CREATE TABLE weight_change (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slot_id INTEGER NOT NULL REFERENCES routine_slot(id),
    session_id INTEGER REFERENCES workout_session(id) ON DELETE SET NULL,
    from_kg REAL,
    to_kg REAL,
    reason TEXT NOT NULL,
    source TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    decided_at INTEGER
  );
  CREATE TABLE food (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    fat_per_100g REAL NOT NULL,
    carbs_per_100g REAL NOT NULL,
    protein_per_100g REAL NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE diet_item (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
    meal TEXT NOT NULL,
    food_id INTEGER NOT NULL REFERENCES food(id),
    grams REAL NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_set_log_session ON set_log(session_id);
  CREATE INDEX idx_set_log_slot ON set_log(slot_id, completed_at);
  CREATE INDEX idx_set_log_exercise ON set_log(exercise_id, completed_at);
  CREATE INDEX idx_session_status ON workout_session(status);
  CREATE INDEX idx_session_date ON workout_session(date);
  CREATE INDEX idx_weight_change_slot ON weight_change(slot_id, status);
  CREATE INDEX idx_diet_item_weekday ON diet_item(weekday);
  CREATE INDEX idx_cardio_log_date ON cardio_log(date);
  `,
  `ALTER TABLE settings ADD COLUMN rest_overlay INTEGER NOT NULL DEFAULT 1;`,
];

export async function migrate(db: Db): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  for (let version = current; version < MIGRATIONS.length; version++) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(MIGRATIONS[version]);
      await db.execAsync(`PRAGMA user_version = ${version + 1}`);
    });
  }
}
