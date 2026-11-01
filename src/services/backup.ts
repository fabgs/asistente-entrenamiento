import * as Application from 'expo-application';
import { File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import type { Db } from '@/db/db';
import { exportBackup, getMeta, parseBackup, restoreBackup, setMeta, wipeAllData, type Backup } from '@/db/maintenance';
import { getSettings, updateSettings, type Settings } from '@/db/repositories/settings';
import { importSeed } from '@/db/seed';
import { SEED } from '@/db/seedData';
import { localDateString } from '@/domain/schedule';
import { rescheduleDailyReminders } from './dailyReminder';
import { getRawFile, putFile, type GithubTarget } from './githubBackup';
import { resetNotifications } from './notifications';

const TOKEN_KEY = 'github-backup-token';
const INSTALL_KEY = 'install-stamp';
const AUTO_BACKUP_EVERY_MS = 24 * 60 * 60 * 1000;

export const githubToken = {
  get: () => SecureStore.getItemAsync(TOKEN_KEY),
  set: (token: string) => SecureStore.setItemAsync(TOKEN_KEY, token.trim()),
  clear: () => SecureStore.deleteItemAsync(TOKEN_KEY),
};

/**
 * Developer mode (PLAN.md §8): on the first launch after installing a new APK, all data is wiped
 * and the seed is loaded again. Android updates `lastUpdateTime` on every install.
 */
export async function resetIfNewInstallInDevMode(db: Db): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  const stamp = await Application.getLastUpdateTimeAsync()
    .then((d) => d.toISOString())
    .catch(() => null);
  if (!stamp) return false;
  const previous = await getMeta(db, INSTALL_KEY);
  await setMeta(db, INSTALL_KEY, stamp);
  if (previous === stamp) return false;
  const settings = await db.getFirstAsync<{ dev_mode: number }>('SELECT dev_mode FROM settings WHERE id = 1');
  if (settings?.dev_mode !== 1) return false;
  await wipeAllData(db);
  await resetNotifications();
  return true;
}

/** Back to the Excel data, keeping nothing. */
export async function resetToSeed(db: Db, now = new Date()): Promise<void> {
  await wipeAllData(db);
  await importSeed(db, SEED, now);
  await resetNotifications();
  await rescheduleDailyReminders(db);
}

async function writeBackupFile(db: Db, now: Date): Promise<File> {
  const file = new File(Paths.cache, `entreno-backup-${localDateString(now)}.json`);
  if (file.exists) file.delete();
  file.create();
  await file.write(JSON.stringify(await exportBackup(db, now)));
  return file;
}

/** Opens the share sheet with a JSON backup (save to Drive, send by Telegram…). */
export async function shareBackupFile(db: Db, now = new Date()): Promise<void> {
  const file = await writeBackupFile(db, now);
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Guardar copia de seguridad' });
}

/** Lets the user choose a backup file; null if cancelled. Throws BackupError if it is not valid. */
export async function pickBackupFile(): Promise<Backup | null> {
  const picked = await File.pickFileAsync({ mimeTypes: ['application/json', 'text/plain', 'application/octet-stream'] });
  if (picked.canceled || !picked.result) return null;
  return parseBackup(await picked.result.text());
}

export async function restoreFrom(db: Db, backup: Backup): Promise<void> {
  await restoreBackup(db, backup);
  await resetNotifications();
  await rescheduleDailyReminders(db);
}

export function githubTarget(s: Settings): GithubTarget | null {
  if (!s.backupOwner || !s.backupRepo) return null;
  return { owner: s.backupOwner, repo: s.backupRepo, path: s.backupPath || 'entreno-backup.json' };
}

/** Uploads a backup now; the result (time or error) is stored in settings for the UI. */
export async function backupToGithub(db: Db, now = new Date()): Promise<void> {
  const settings = await getSettings(db);
  const target = githubTarget(settings);
  const token = await githubToken.get();
  if (!target || !token) throw new Error('Configura el repositorio y el token de GitHub primero.');
  try {
    const file = await writeBackupFile(db, now);
    await putFile(target, token, await file.base64(), `Copia de seguridad ${now.toISOString()}`);
    await updateSettings(db, { lastBackupAt: now.getTime(), lastBackupError: null });
  } catch (e) {
    await updateSettings(db, { lastBackupError: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

/** Downloads the latest backup from GitHub without applying it, so the user can confirm first. */
export async function downloadFromGithub(db: Db): Promise<Backup> {
  const target = githubTarget(await getSettings(db));
  const token = await githubToken.get();
  if (!target || !token) throw new Error('Configura el repositorio y el token de GitHub primero.');
  return parseBackup(await getRawFile(target, token));
}

/** At most once a day, never in developer mode, silently skipped if not configured or offline. */
export async function maybeAutoBackup(db: Db, now = new Date()): Promise<void> {
  const settings = await getSettings(db);
  if (settings.devMode || !githubTarget(settings) || !(await githubToken.get())) return;
  if (settings.lastBackupAt && now.getTime() - settings.lastBackupAt < AUTO_BACKUP_EVERY_MS) return;
  await backupToGithub(db, now).catch(() => undefined);
}
