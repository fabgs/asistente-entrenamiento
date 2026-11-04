import type { Db, SqlValue } from './db';
import {
  CARDIO_TRACKING_DEFAULTS,
  EXERCISE_MUSCLE_DEFAULTS,
  EXERCISE_PAIR_DEFAULTS,
  FOOD_NAME_FIXES,
  SPRINT_TRACKING_DEFAULTS,
} from './migrations';
import { importSeed } from './seed';
import type { SeedData } from './seedTypes';

/** Tables in a backup, in an order that respects foreign keys when inserting. */
export const BACKUP_TABLES = [
  'profile',
  'settings',
  'weight_log',
  'exercise',
  'exercise_muscle',
  'routine',
  'routine_weekday',
  'routine_slot',
  'cardio_activity',
  'cardio_session',
  'cardio_log',
  'workout_session',
  'set_log',
  'weight_change',
  'food',
  'diet_item',
] as const;

type Row = Record<string, SqlValue>;

export interface Backup {
  app: 'entreno';
  schemaVersion: number;
  exportedAt: string;
  tables: Partial<Record<(typeof BACKUP_TABLES)[number], Row[]>>;
}

export class BackupError extends Error {}

export async function schemaVersion(db: Db): Promise<number> {
  return (await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))?.user_version ?? 0;
}

export async function exportBackup(db: Db, now = new Date()): Promise<Backup> {
  const tables: Backup['tables'] = {};
  for (const table of BACKUP_TABLES) {
    tables[table] = await db.getAllAsync<Row>(`SELECT * FROM ${table}`);
  }
  return { app: 'entreno', schemaVersion: await schemaVersion(db), exportedAt: now.toISOString(), tables };
}

/** Parses and sanity-checks a backup file; messages are shown to the user as they are. */
export function parseBackup(text: string): Backup {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new BackupError('El fichero no es una copia de seguridad válida: no es JSON.');
  }
  const backup = data as Partial<Backup>;
  if (backup?.app !== 'entreno' || typeof backup.schemaVersion !== 'number' || typeof backup.tables !== 'object') {
    throw new BackupError('El fichero no es una copia de seguridad de Entreno.');
  }
  // Without these single rows the app cannot start, so such a file is never applied.
  if (backup.tables.profile?.length !== 1 || backup.tables.settings?.length !== 1) {
    throw new BackupError('La copia está incompleta: le falta el perfil o los ajustes.');
  }
  return backup as Backup;
}

async function deleteAllRows(db: Db): Promise<void> {
  // GPS points of a walk in progress are not backed up, but they reference its session.
  await db.runAsync('DELETE FROM cardio_point');
  for (const table of [...BACKUP_TABLES].reverse()) {
    await db.runAsync(`DELETE FROM ${table}`);
  }
  await db.runAsync(
    `DELETE FROM sqlite_sequence WHERE name IN (${BACKUP_TABLES.map(() => '?').join(', ')})`,
    ...BACKUP_TABLES,
  );
}

/** Deletes every row of the user's data; the schema and app metadata stay. */
export async function wipeAllData(db: Db): Promise<void> {
  await db.withTransactionAsync(() => deleteAllRows(db));
}

/** Settings a reset keeps: see `resetData`. */
const KEPT_ON_RESET = ['backup_owner', 'backup_repo', 'backup_path', 'last_backup_at', 'dev_mode'] as const;

/**
 * Wipes everything and loads `seed`, like a fresh install, but keeps where the GitHub copy goes
 * (right after a reset that copy is what one usually restores) and when it was last uploaded and
 * the developer mode: otherwise the automatic copy would upload the empty data over the good one.
 */
export async function resetData(db: Db, seed: SeedData, now: Date): Promise<void> {
  const kept = await db.getFirstAsync<Record<(typeof KEPT_ON_RESET)[number], SqlValue>>(
    `SELECT ${KEPT_ON_RESET.join(', ')} FROM settings WHERE id = 1`,
  );
  await wipeAllData(db);
  await importSeed(db, seed, now);
  // The Excel test data keeps the food names of before migration 6.
  await db.execAsync(FOOD_NAME_FIXES);
  if (kept) {
    await db.runAsync(
      `UPDATE settings SET ${KEPT_ON_RESET.map((c) => `${c} = ?`).join(', ')} WHERE id = 1`,
      ...KEPT_ON_RESET.map((c) => kept[c]),
    );
  }
}

/**
 * Replaces all data with the backup in a single transaction, so a failure leaves the current data
 * untouched. Older backups work: missing columns take their defaults. Developer mode always ends off.
 */
export async function restoreBackup(db: Db, backup: Backup): Promise<void> {
  if (backup.schemaVersion > (await schemaVersion(db))) {
    throw new BackupError('La copia es de una versión más nueva de la app. Actualiza la app antes de restaurarla.');
  }
  const columns = new Map<string, Set<string>>();
  for (const table of BACKUP_TABLES) {
    const info = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
    columns.set(table, new Set(info.map((c) => c.name)));
  }

  await db.withTransactionAsync(async () => {
    await deleteAllRows(db);
    for (const table of BACKUP_TABLES) {
      const known = columns.get(table)!;
      for (const row of backup.tables[table] ?? []) {
        const keys = Object.keys(row).filter((k) => known.has(k));
        if (keys.length === 0) continue;
        await db.runAsync(
          `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
          ...keys.map((k) => row[k]),
        );
      }
    }
    if (backup.schemaVersion < 4) await db.execAsync(CARDIO_TRACKING_DEFAULTS);
    // Migrations do not run on restored rows: same accent fixes as migration 6.
    if (backup.schemaVersion < 6) await db.execAsync(FOOD_NAME_FIXES);
    if (backup.schemaVersion < 7) await db.execAsync(EXERCISE_PAIR_DEFAULTS);
    if (backup.schemaVersion < 8) await db.execAsync(SPRINT_TRACKING_DEFAULTS);
    if (backup.schemaVersion < 9) await db.execAsync(EXERCISE_MUSCLE_DEFAULTS);
    // Restored data is real data: developer mode must not wipe it on the next install.
    await db.runAsync('UPDATE settings SET dev_mode = 0 WHERE id = 1');
  });
}

export async function getMeta(db: Db, key: string): Promise<string | null> {
  return (await db.getFirstAsync<{ value: string }>('SELECT value FROM app_meta WHERE key = ?', key))?.value ?? null;
}

export async function setMeta(db: Db, key: string, value: string): Promise<void> {
  await db.runAsync(
    'INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    value,
  );
}
