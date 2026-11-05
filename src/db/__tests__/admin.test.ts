import { exportBackup, resetData, restoreBackup } from '../maintenance';
import { getAdminOptions, setAdminOptions } from '../repositories/admin';
import { updateSettings } from '../repositories/settings';
import { importSeed } from '../seed';
import { SEED } from '../seedData';
import { createTestDb } from './testDb';

const NOW = new Date(2026, 10, 5, 22, 0);

async function freshInstall() {
  const db = await createTestDb();
  await importSeed(db, SEED, NOW);
  return db;
}

describe('admin options', () => {
  it('are hidden on a new phone (a friend installing the APK)', async () => {
    expect(await getAdminOptions(await freshInstall())).toBe(false);
  });

  it('show on a phone that already copies to GitHub or is in test mode (the developer updating)', async () => {
    const github = await freshInstall();
    await updateSettings(github, { backupOwner: 'fabgs', backupRepo: 'entreno-backup' });
    expect(await getAdminOptions(github)).toBe(true);

    const testing = await freshInstall();
    await updateSettings(testing, { devMode: true });
    expect(await getAdminOptions(testing)).toBe(true);
  });

  it('keep the first decision, and what the seven taps choose', async () => {
    const db = await freshInstall();
    expect(await getAdminOptions(db)).toBe(false);
    // Configuring GitHub later does not show them by itself: the taps decide from now on.
    await updateSettings(db, { backupOwner: 'fabgs', backupRepo: 'entreno-backup' });
    expect(await getAdminOptions(db)).toBe(false);
    await setAdminOptions(db, true);
    expect(await getAdminOptions(db)).toBe(true);
    await setAdminOptions(db, false);
    expect(await getAdminOptions(db)).toBe(false);
  });

  it('survive a reset and restoring a copy', async () => {
    const db = await freshInstall();
    await setAdminOptions(db, true);
    const backup = await exportBackup(db, NOW);
    await resetData(db, SEED, NOW);
    expect(await getAdminOptions(db)).toBe(true);
    await restoreBackup(db, backup);
    expect(await getAdminOptions(db)).toBe(true);
  });
});
