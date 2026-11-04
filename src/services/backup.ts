import * as Application from 'expo-application';
import { File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import type { Db } from '@/db/db';
import { exportBackup, getMeta, parseBackup, resetData, restoreBackup, setMeta, type Backup } from '@/db/maintenance';
import { getSettings, updateSettings, type Settings } from '@/db/repositories/settings';
import { SEED } from '@/db/seedData';
import type { SeedData } from '@/db/seedTypes';
import {
  createBackupKey,
  decryptBackup,
  encryptBackup,
  keyForBackup,
  readEncrypted,
  sameKdf,
  type BackupKey,
} from '@/domain/backupCipher';
import { localDateString } from '@/domain/schedule';
import { appKit, backupKeyStore } from './backupCipher';
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
  await resetData(db, SEED, new Date());
  await resetNotifications();
  return true;
}

/** Back to a fresh install (or to `seed`, e.g. the Excel data in a development build). */
export async function resetToSeed(db: Db, now = new Date(), seed: SeedData = SEED): Promise<void> {
  await resetData(db, seed, now);
  await resetNotifications();
  await rescheduleDailyReminders(db);
}

/** Thrown by `openBackup` when the copy is encrypted and no stored key opens it. */
export class PasswordNeededError extends Error {
  constructor() {
    super('Esta copia está cifrada: hace falta su contraseña.');
  }
}

/** Whether copies leave the phone encrypted (PLAN.md §9). */
export async function hasBackupPassword(): Promise<boolean> {
  return (await backupKeyStore.get()) !== null;
}

/** Derives the key (a few seconds) and keeps it; the following copies go encrypted. */
export async function setBackupPassword(password: string): Promise<void> {
  await backupKeyStore.set(await createBackupKey(password, appKit));
}

export const clearBackupPassword = (): Promise<void> => backupKeyStore.clear();

/** The text of a copy: the JSON of the data, encrypted if there is a password. */
async function backupText(db: Db, now: Date): Promise<string> {
  const json = JSON.stringify(await exportBackup(db, now));
  const key = await backupKeyStore.get();
  return key ? encryptBackup(json, key, appKit) : json;
}

async function writeBackupFile(db: Db, now: Date): Promise<File> {
  const file = new File(Paths.cache, `entreno-backup-${localDateString(now)}.json`);
  if (file.exists) file.delete();
  file.create();
  await file.write(await backupText(db, now));
  return file;
}

/** A copy ready to restore, and the key that opened it if it was encrypted. */
export interface OpenedBackup {
  backup: Backup;
  key: BackupKey | null;
}

/**
 * Reads a copy, plain or encrypted. An encrypted one opens with the stored key if it is the same
 * password, or with `password` (PasswordNeededError without it, WrongPasswordError if it is not).
 */
export async function openBackup(text: string, password?: string): Promise<OpenedBackup> {
  const envelope = readEncrypted(text);
  if (!envelope) return { backup: parseBackup(text), key: null };
  const stored = await backupKeyStore.get();
  let key: BackupKey;
  if (stored && sameKdf(stored.kdf, envelope.kdf)) key = stored;
  else if (password) key = await keyForBackup(envelope, password, appKit);
  else throw new PasswordNeededError();
  return { backup: parseBackup(await decryptBackup(envelope, key, appKit)), key };
}

/** Opens the share sheet with a JSON backup (save to Drive, send by Telegram…). */
export async function shareBackupFile(db: Db, now = new Date()): Promise<void> {
  const file = await writeBackupFile(db, now);
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Guardar copia de seguridad' });
}

/** Lets the user choose a backup file; its text, or null if cancelled. Open it with `openBackup`. */
export async function pickBackupFile(): Promise<string | null> {
  const picked = await File.pickFileAsync({ mimeTypes: ['application/json', 'text/plain', 'application/octet-stream'] });
  if (picked.canceled || !picked.result) return null;
  return picked.result.text();
}

/**
 * Replaces the data with the copy. On a phone without a password yet, the one of an encrypted copy
 * is kept for the next ones (a new phone restoring its copies); only once restored, not on cancel.
 */
export async function restoreFrom(db: Db, { backup, key }: OpenedBackup): Promise<void> {
  await restoreBackup(db, backup);
  if (key && !(await backupKeyStore.get())) await backupKeyStore.set(key);
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

/** Downloads the latest backup from GitHub without applying it: its text, to open with `openBackup`. */
export async function downloadFromGithub(db: Db): Promise<string> {
  const target = githubTarget(await getSettings(db));
  const token = await githubToken.get();
  if (!target || !token) throw new Error('Configura el repositorio y el token de GitHub primero.');
  return getRawFile(target, token);
}

/** At most once a day, never in developer mode, silently skipped if not configured or offline. */
export async function maybeAutoBackup(db: Db, now = new Date()): Promise<void> {
  const settings = await getSettings(db);
  if (settings.devMode || !githubTarget(settings) || !(await githubToken.get())) return;
  if (settings.lastBackupAt && now.getTime() - settings.lastBackupAt < AUTO_BACKUP_EVERY_MS) return;
  await backupToGithub(db, now).catch(() => undefined);
}
