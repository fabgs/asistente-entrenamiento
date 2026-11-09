import { CATALOG_MUSCLES } from '@/domain/muscles';
import type { Db } from './db';

const sqlText = (text: string) => `'${text.replaceAll("'", "''")}'`;

/**
 * Tracking type and timer plan inferred from the activity, for cardio created before they existed
 * (migration 4, the seed and old backups). Only touches activities still on 'check'.
 */
export const CARDIO_TRACKING_DEFAULTS = `
  UPDATE cardio_activity SET tracking = 'gps'
    WHERE tracking = 'check' AND name LIKE '%caminar%';
  UPDATE cardio_activity
    SET tracking = 'timer', plan = '{"kind":"hiit","warmupMin":3,"rounds":6,"workSec":30,"restSec":60,"cooldownMin":3}'
    WHERE tracking = 'check' AND intensity LIKE '%HIIT%';
  UPDATE cardio_activity
    SET tracking = 'timer', plan = '{"kind":"miss","warmupMin":5,"mainMin":20,"cooldownMin":5}'
    WHERE tracking = 'check' AND name LIKE '%bici%' AND intensity LIKE '%MISS%';
  UPDATE cardio_activity
    SET tracking = 'timer',
        plan = '{"kind":"liss","minutes":' || COALESCE(NULLIF(CAST(target AS INTEGER), 0), 30) || '}'
    WHERE tracking = 'check' AND name LIKE '%bici%';
`;

/**
 * «Sprints + Bouncing», recorded until 1.3.3 with the HIIT timer, becomes a sprints activity
 * (migration 8, the seed and backups older than 8). To go back: Fases → HIIT in its editor.
 */
export const SPRINT_TRACKING_DEFAULTS = `
  UPDATE cardio_activity
    SET tracking = 'sprint', plan = '{"kind":"sprint","sprints":6,"restSec":90}'
    WHERE tracking = 'timer' AND name LIKE '%sprint%' AND plan LIKE '%"kind":"hiit"%';
`;

/** Exercises done with two dumbbells (material «mancuernas»): their weight is that of each one. */
export const EXERCISE_PAIR_DEFAULTS = `UPDATE exercise SET pair = 1 WHERE lower(trim(equipment)) = 'mancuernas';`;

/**
 * Foods of the first catalogue that were written without their accents: [old name, new name].
 * It is migration 6: further fixes go in a new migration, not here.
 */
export const FOOD_RENAMES: [string, string][] = [
  ['Proteina', 'Proteína'],
  ['Colageno', 'Colágeno'],
  ['Yogurt griego', 'Yogur griego'],
  ['Platano', 'Plátano'],
  ['Arandanos', 'Arándanos'],
  ['Higado de ternera', 'Hígado de ternera'],
  ['Salmon', 'Salmón'],
  ['Ragu', 'Ragú'],
  ['Atun lata', 'Atún en lata'],
];

/**
 * Fixes those names (migration 6, old backups, the Excel test data). A food is renamed only if it
 * still has exactly the old name and no food has the new one yet, so nothing the user wrote changes.
 */
export const FOOD_NAME_FIXES = FOOD_RENAMES.map(
  ([from, to]) =>
    `UPDATE food SET name = '${to}' WHERE name = '${from}'
       AND NOT EXISTS (SELECT 1 FROM food WHERE name = '${to}' COLLATE NOCASE);`,
).join('\n');

/**
 * Muscles of the catalog exercises, by name (migration 9, the seed and backups older than 9). An
 * exercise that already has muscles is left as the user set it.
 */
export const EXERCISE_MUSCLE_DEFAULTS = CATALOG_MUSCLES.map(([name, primary, secondary]) => {
  const values = [
    ...primary.map((m) => `(${sqlText(m)}, 'primary')`),
    ...secondary.map((m) => `(${sqlText(m)}, 'secondary')`),
  ].join(', ');
  return `INSERT INTO exercise_muscle (exercise_id, muscle, role)
    SELECT e.id, m.column1, m.column2 FROM exercise e, (VALUES ${values}) m
    WHERE e.name = ${sqlText(name)} COLLATE NOCASE
      AND NOT EXISTS (SELECT 1 FROM exercise_muscle x WHERE x.exercise_id = e.id);`;
}).join('\n');

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
  `
  ALTER TABLE settings ADD COLUMN dev_mode INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE settings ADD COLUMN last_backup_error TEXT;
  CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `,
  `
  ALTER TABLE cardio_activity ADD COLUMN tracking TEXT NOT NULL DEFAULT 'check';
  ALTER TABLE cardio_activity ADD COLUMN plan TEXT;
  CREATE TABLE cardio_session (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    activity_id INTEGER REFERENCES cardio_activity(id),
    name TEXT NOT NULL,
    date TEXT NOT NULL,
    tracking TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'in_progress',
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    paused_at INTEGER,
    paused_ms INTEGER NOT NULL DEFAULT 0,
    segment INTEGER NOT NULL DEFAULT 0,
    plan TEXT,
    distance_m REAL,
    route TEXT,
    samples TEXT
  );
  CREATE TABLE cardio_point (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES cardio_session(id) ON DELETE CASCADE,
    segment INTEGER NOT NULL,
    t INTEGER NOT NULL,
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    accuracy REAL,
    speed REAL,
    altitude REAL
  );
  CREATE INDEX idx_cardio_point_session ON cardio_point(session_id, t);
  CREATE INDEX idx_cardio_session_status ON cardio_session(status);
  ALTER TABLE cardio_log ADD COLUMN session_id INTEGER REFERENCES cardio_session(id);
  ${CARDIO_TRACKING_DEFAULTS}
  `,
  `
  ALTER TABLE set_log ADD COLUMN is_warmup INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE workout_session ADD COLUMN title TEXT;
  ALTER TABLE cardio_session ADD COLUMN title TEXT;
  ALTER TABLE settings ADD COLUMN cardio_hero TEXT NOT NULL DEFAULT 'distance';
  ALTER TABLE settings ADD COLUMN distance_unit TEXT NOT NULL DEFAULT 'km';
  ALTER TABLE settings ADD COLUMN cardio_chart TEXT NOT NULL DEFAULT 'pace';
  ALTER TABLE settings ADD COLUMN cardio_live_panel TEXT NOT NULL DEFAULT 'map';
  `,
  FOOD_NAME_FIXES,
  `
  ALTER TABLE exercise ADD COLUMN pair INTEGER NOT NULL DEFAULT 0;
  ${EXERCISE_PAIR_DEFAULTS}
  `,
  `
  ALTER TABLE cardio_session ADD COLUMN laps TEXT;
  ALTER TABLE cardio_session ADD COLUMN lap_fixes TEXT;
  ALTER TABLE cardio_point ADD COLUMN received_at INTEGER;
  ${SPRINT_TRACKING_DEFAULTS}
  `,
  `
  CREATE TABLE exercise_muscle (
    exercise_id INTEGER NOT NULL REFERENCES exercise(id) ON DELETE CASCADE,
    muscle TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('primary', 'secondary')),
    PRIMARY KEY (exercise_id, muscle)
  );
  ${EXERCISE_MUSCLE_DEFAULTS}
  `,
  `
  CREATE TABLE photo (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cardio_session_id INTEGER REFERENCES cardio_session(id) ON DELETE CASCADE,
    workout_session_id INTEGER REFERENCES workout_session(id) ON DELETE CASCADE,
    file TEXT NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    taken_at INTEGER,
    lat REAL,
    lon REAL,
    created_at INTEGER NOT NULL,
    CHECK ((cardio_session_id IS NULL) <> (workout_session_id IS NULL))
  );
  CREATE INDEX idx_photo_cardio ON photo(cardio_session_id);
  CREATE INDEX idx_photo_workout ON photo(workout_session_id);
  `,
  `
  ALTER TABLE routine ADD COLUMN warmup INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE workout_session ADD COLUMN warmup_started_at INTEGER;
  ALTER TABLE workout_session ADD COLUMN warmup_ended_at INTEGER;
  ALTER TABLE workout_session ADD COLUMN set_started_at INTEGER;
  ALTER TABLE set_log ADD COLUMN started_at INTEGER;
  ALTER TABLE set_log ADD COLUMN rest_seconds INTEGER;
  ALTER TABLE settings ADD COLUMN muscle_map_mode TEXT NOT NULL DEFAULT 'week';
  `,
  // Mis rutas (1.4.8). A route keeps its own copy of the line, so deleting the walk it came from
  // changes nothing; deleting the route leaves its walks without one.
  `
  CREATE TABLE route (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'walk' CHECK (source IN ('walk', 'gpx')),
    path TEXT NOT NULL,
    distance_m REAL NOT NULL,
    climb_m REAL,
    created_at INTEGER NOT NULL
  );
  ALTER TABLE cardio_session ADD COLUMN route_id INTEGER REFERENCES route(id) ON DELETE SET NULL;
  ALTER TABLE cardio_session ADD COLUMN route_relation TEXT CHECK (route_relation IN ('same', 'reverse', 'variant'));
  ALTER TABLE cardio_session ADD COLUMN route_declined INTEGER NOT NULL DEFAULT 0;
  CREATE INDEX idx_cardio_session_route ON cardio_session(route_id);
  `,
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
