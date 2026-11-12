import { exportBackup, resetData, restoreBackup } from '../maintenance';
import { getBackupLink, setBackupLink } from '../repositories/backupLink';
import { updateSettings } from '../repositories/settings';
import { importSeed } from '../seed';
import { DEMO_SEED } from '../demoSeed';
import { SEED } from '../seedData';
import { createTestDb } from './testDb';

const NOW = new Date(2026, 10, 12, 21, 0);

describe('the copy in GitHub a phone comes from', () => {
  it('is unknown on a phone from before 1.5.3', async () => {
    const db = await createTestDb();
    await importSeed(db, DEMO_SEED, NOW);
    expect(await getBackupLink(db)).toEqual({ sha: null, uploadedBefore: false, hasData: true });
    await updateSettings(db, { lastBackupAt: 123 });
    expect((await getBackupLink(db)).uploadedBefore).toBe(true);
  });

  it('is none on a phone that starts empty, which only has the catalogues', async () => {
    const db = await createTestDb();
    await importSeed(db, SEED, NOW);
    await setBackupLink(db, null);
    expect(await getBackupLink(db)).toEqual({ sha: '', uploadedBefore: false, hasData: false });
  });

  it('is the one uploaded or restored last', async () => {
    const db = await createTestDb();
    await importSeed(db, DEMO_SEED, NOW);
    await setBackupLink(db, 'abc');
    expect((await getBackupLink(db)).sha).toBe('abc');
    await setBackupLink(db, 'def');
    expect((await getBackupLink(db)).sha).toBe('def');
  });

  it('is forgotten on a reset, which keeps when the last copy was uploaded', async () => {
    const db = await createTestDb();
    await importSeed(db, DEMO_SEED, NOW);
    await updateSettings(db, { lastBackupAt: 123 });
    await setBackupLink(db, 'abc');
    await resetData(db, SEED, NOW);
    expect(await getBackupLink(db)).toEqual({ sha: '', uploadedBefore: true, hasData: false });
  });

  it('forgets on a reset also what a phone from before 1.5.3 never said', async () => {
    const db = await createTestDb();
    await importSeed(db, DEMO_SEED, NOW);
    await resetData(db, SEED, NOW);
    expect((await getBackupLink(db)).sha).toBe('');
  });

  it('is of the phone, not of the data: restoring a copy keeps it', async () => {
    const source = await createTestDb();
    await importSeed(source, DEMO_SEED, NOW);
    await setBackupLink(source, 'of-the-other-phone');
    const backup = await exportBackup(source, NOW);

    const db = await createTestDb();
    await importSeed(db, SEED, NOW);
    await setBackupLink(db, null);
    await restoreBackup(db, backup);
    expect(await getBackupLink(db)).toMatchObject({ sha: '', hasData: true });
  });
});
