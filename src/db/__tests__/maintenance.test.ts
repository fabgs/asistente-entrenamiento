import type { Db } from '../db';
import {
  BackupError,
  exportBackup,
  getMeta,
  parseBackup,
  restoreBackup,
  schemaVersion,
  setMeta,
  wipeAllData,
} from '../maintenance';
import { listRoutines, listSlots } from '../repositories/routines';
import { listSets, logSet, startSession } from '../repositories/sessions';
import { getSettings, updateSettings } from '../repositories/settings';
import { importSeed } from '../seed';
import { SEED } from '../seedData';
import { createTestDb } from './testDb';

const NOW = new Date(2026, 10, 2, 7, 0);

async function seededDb(): Promise<Db> {
  const db = await createTestDb();
  await importSeed(db, SEED, NOW);
  return db;
}

const count = async (db: Db, table: string) =>
  (await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))!.n;

describe('backup and restore', () => {
  it('round-trips every table through JSON', async () => {
    const source = await seededDb();
    const routine = (await listRoutines(source))[0];
    const slot = (await listSlots(source, routine.id))[0];
    const sessionId = await startSession(source, routine.id, NOW);
    await logSet(source, sessionId, slot, 7);
    await updateSettings(source, { backupOwner: 'someone', backupRepo: 'backups' });

    const json = JSON.stringify(await exportBackup(source, NOW));

    const target = await createTestDb();
    await restoreBackup(target, parseBackup(json));
    for (const table of ['routine', 'routine_slot', 'set_log', 'food', 'diet_item', 'weight_change']) {
      expect(await count(target, table)).toBe(await count(source, table));
    }
    expect((await listSets(target, sessionId)).map((s) => s.reps)).toEqual([7]);
    expect((await getSettings(target)).backupRepo).toBe('backups');
  });

  it('replaces existing data instead of merging', async () => {
    const db = await seededDb();
    const backup = await exportBackup(db, NOW);
    await restoreBackup(db, backup);
    expect(await count(db, 'routine')).toBe(4);
    expect(await count(db, 'exercise')).toBe(22);
  });

  it('rejects files that are not backups and backups from a newer app', async () => {
    expect(() => parseBackup('not json')).toThrow(BackupError);
    expect(() => parseBackup('{"app":"other"}')).toThrow('no es una copia de seguridad de Entreno');
    expect(() => parseBackup('{"app":"entreno","schemaVersion":3,"exportedAt":"","tables":{}}')).toThrow(
      'incompleta',
    );

    const db = await seededDb();
    const backup = await exportBackup(db, NOW);
    await expect(restoreBackup(db, { ...backup, schemaVersion: (await schemaVersion(db)) + 1 })).rejects.toThrow(
      'versión más nueva',
    );
    expect(await count(db, 'routine')).toBe(4);
  });

  it('ignores unknown columns from other versions', async () => {
    const db = await seededDb();
    const backup = await exportBackup(db, NOW);
    backup.tables.food = backup.tables.food!.map((f) => ({ ...f, removed_column: 'x' }));
    await restoreBackup(db, backup);
    expect(await count(db, 'food')).toBe(34);
  });
});

describe('wipe and metadata', () => {
  it('wipes all user data but keeps app metadata', async () => {
    const db = await seededDb();
    await setMeta(db, 'install-stamp', 'a');
    await wipeAllData(db);
    for (const table of ['profile', 'settings', 'routine', 'set_log', 'food']) {
      expect(await count(db, table)).toBe(0);
    }
    expect(await getMeta(db, 'install-stamp')).toBe('a');

    expect(await importSeed(db, SEED, NOW)).toBe(true);
    expect(await count(db, 'routine')).toBe(4);
  });

  it('starts in developer mode', async () => {
    expect((await getSettings(await seededDb())).devMode).toBe(true);
  });
});
