import * as Application from 'expo-application';
import { File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import type { Db } from '@/db/db';
import { exportBackup, getMeta, parseBackup, resetData, restoreBackup, setMeta, type Backup } from '@/db/maintenance';
import {
  getBackupLink,
  getDeclinedCopy,
  getSyncedFingerprint,
  setBackupLink,
  setDeclinedCopy,
  setSyncedFingerprint,
} from '@/db/repositories/backupLink';
import { getActiveCardioSession } from '@/db/repositories/cardioSessions';
import { getActiveSession } from '@/db/repositories/sessions';
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
import { copyContents, mayReplaceCopy } from '@/domain/backupLink';
import { dataFingerprint, syncDecision } from '@/domain/sync';
import { localDateString } from '@/domain/schedule';
import { appKit, backupKeyStore } from './backupCipher';
import { rescheduleDailyReminders } from './dailyReminder';
import { getFileSha, getRawFile, putFile, type GithubTarget } from './githubBackup';
import { resetNotifications } from './notifications';

export { ForeignCopyError } from './githubBackup';

const TOKEN_KEY = 'github-backup-token';
const INSTALL_KEY = 'install-stamp';
/**
 * Automatic copies go up when the data changed (1.5.6), at most this often on their own (opening
 * the app, leaving it); always when a workout or a cardio ends. Each copy is a commit of about a
 * megabyte in the private repository: not one per tick of the diet.
 */
const AUTO_BACKUP_GAP_MS = 10 * 60 * 1000;

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

/** The text of a copy (the JSON of the data, encrypted if there is a password) and the fingerprint of that data. */
async function backupText(db: Db, now: Date): Promise<{ text: string; fingerprint: string }> {
  const backup = await exportBackup(db, now);
  const json = JSON.stringify(backup);
  const key = await backupKeyStore.get();
  return { text: key ? await encryptBackup(json, key, appKit) : json, fingerprint: dataFingerprint(backup.tables) };
}

async function writeBackupFile(db: Db, now: Date): Promise<{ file: File; fingerprint: string }> {
  const file = new File(Paths.cache, `entreno-backup-${localDateString(now)}.json`);
  if (file.exists) file.delete();
  file.create();
  const { text, fingerprint } = await backupText(db, now);
  await file.write(text);
  return { file, fingerprint };
}

/** The fingerprint of the data as it is now (domain/sync). */
async function currentFingerprint(db: Db): Promise<string> {
  return dataFingerprint((await exportBackup(db, new Date(0))).tables);
}

/**
 * Whether the data changed since the copy this phone uploaded or restored last (1.5.6). A phone with
 * none of the user's data has nothing to lose; one without a fingerprint yet (before its first copy
 * with 1.5.6) counts as changed.
 */
export async function hasLocalChanges(db: Db): Promise<boolean> {
  if (!(await getBackupLink(db)).hasData) return false;
  const synced = await getSyncedFingerprint(db);
  return synced === null || synced !== (await currentFingerprint(db));
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
  const { file } = await writeBackupFile(db, now);
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
 * `githubSha` is the copy in GitHub it came from: from now on the phone may upload over it.
 */
export async function restoreFrom(db: Db, { backup, key }: OpenedBackup, githubSha?: string | null): Promise<void> {
  await restoreBackup(db, backup);
  if (githubSha) {
    await setBackupLink(db, githubSha);
    // Its data is now that copy's: no changes of its own until the user makes some.
    await setSyncedFingerprint(db, await currentFingerprint(db));
  }
  if (key && !(await backupKeyStore.get())) await backupKeyStore.set(key);
  await resetNotifications();
  await rescheduleDailyReminders(db);
}

export function githubTarget(s: Settings): GithubTarget | null {
  if (!s.backupOwner || !s.backupRepo) return null;
  return { owner: s.backupOwner, repo: s.backupRepo, path: s.backupPath || 'entreno-backup.json' };
}

/**
 * Uploads a backup now; the result (time or error) is stored in settings for the UI. Only over the
 * copy this phone uploaded or restored last (PLAN.md §9): over any other, ForeignCopyError, unless
 * the user has just said so (`replaceForeign`).
 */
export async function backupToGithub(db: Db, now = new Date(), replaceForeign = false): Promise<void> {
  const settings = await getSettings(db);
  const target = githubTarget(settings);
  const token = await githubToken.get();
  if (!target || !token) throw new Error('Configura el repositorio y el token de GitHub primero.');
  try {
    const link = await getBackupLink(db);
    let fingerprint: string | null = null;
    const sha = await putFile(
      target,
      token,
      async () => {
        const written = await writeBackupFile(db, now);
        fingerprint = written.fingerprint;
        return written.file.base64();
      },
      `Copia de seguridad ${now.toISOString()}`,
      (current) => replaceForeign || mayReplaceCopy(current, link),
    );
    await setBackupLink(db, sha ?? (await getFileSha(target, token)));
    if (fingerprint !== null) await setSyncedFingerprint(db, fingerprint);
    await updateSettings(db, { lastBackupAt: now.getTime(), lastBackupError: null });
  } catch (e) {
    await updateSettings(db, { lastBackupError: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

/**
 * Downloads the latest backup from GitHub without applying it: its text, to open with `openBackup`,
 * and its sha, for `restoreFrom`.
 */
export async function downloadFromGithub(db: Db): Promise<{ text: string; sha: string | null }> {
  const target = githubTarget(await getSettings(db));
  const token = await githubToken.get();
  if (!target || !token) throw new Error('Configura el repositorio y el token de GitHub primero.');
  // The sha first: if another phone uploads in between, this one is left tied to the older copy
  // and asks before replacing the newer one.
  const sha = await getFileSha(target, token);
  return { text: await getRawFile(target, token), sha };
}

/** Whether GitHub holds a copy this phone would not replace on its own: one to restore, on a new phone. */
export async function foreignCopyInGithub(db: Db): Promise<boolean> {
  const target = githubTarget(await getSettings(db));
  const token = await githubToken.get();
  if (!target || !token) return false;
  const sha = await getFileSha(target, token);
  return sha !== null && !mayReplaceCopy(sha, await getBackupLink(db));
}

/**
 * Uploads a copy if the data changed since the last one (1.5.6; until then, once a day whatever
 * happened): at most every AUTO_BACKUP_GAP_MS, or right away with `force` (a workout or a cardio has
 * just ended). Never in developer mode, nor over another phone's copy; silently skipped if not
 * configured or offline.
 */
export async function maybeAutoBackup(db: Db, now = new Date(), { force = false } = {}): Promise<void> {
  const settings = await getSettings(db);
  if (settings.devMode || !githubTarget(settings) || !(await githubToken.get())) return;
  if (!force && settings.lastBackupAt && now.getTime() - settings.lastBackupAt < AUTO_BACKUP_GAP_MS) return;
  if (!(await hasLocalChanges(db))) return;
  await backupToGithub(db, now).catch(() => undefined);
}

/** A newer copy in GitHub than this phone's, uploaded by another one (1.5.6). */
export interface NewerCopy {
  kind: 'offer' | 'conflict';
  sha: string;
  /** null when it is encrypted with another password: it has to be restored from Ajustes. */
  opened: OpenedBackup | null;
  exportedAt: number | null;
  /** «tiene 377 entrenos y 9 sesiones de cardio». */
  contents: string | null;
}

/**
 * Whether another phone uploaded a newer copy than the one this phone's data comes from, to offer
 * it when the app opens (domain/sync). Null when there is nothing to offer, or nothing to ask now:
 * developer mode, GitHub not set up, offline, or a workout or a cardio in progress (a copy replaces
 * everything, also what is being recorded).
 */
export async function checkNewerCopy(db: Db): Promise<NewerCopy | null> {
  const settings = await getSettings(db);
  const target = githubTarget(settings);
  const token = await githubToken.get();
  if (settings.devMode || !target || !token) return null;
  if ((await getActiveSession(db)) || (await getActiveCardioSession(db))) return null;
  const sha = await getFileSha(target, token);
  const kind = syncDecision(sha, await getBackupLink(db), await getDeclinedCopy(db), await hasLocalChanges(db));
  if (kind === 'none' || sha === null) return null;
  const text = await getRawFile(target, token);
  const opened = await openBackup(text).catch((e) => {
    if (e instanceof PasswordNeededError) return null;
    throw e;
  });
  const tables = opened?.backup.tables;
  return {
    kind,
    sha,
    opened,
    exportedAt: opened ? new Date(opened.backup.exportedAt).getTime() : null,
    contents: tables ? copyContents(tables.workout_session?.length ?? 0, tables.cardio_session?.length ?? 0) : null,
  };
}

/** «Ahora no»: that copy is not offered again; the next one will be. */
export const declineNewerCopy = (db: Db, copy: NewerCopy) => setDeclinedCopy(db, copy.sha);

/** «Traer»: the data of the other phone replaces this one's. */
export async function bringNewerCopy(db: Db, copy: NewerCopy): Promise<void> {
  if (!copy.opened) throw new Error('Esta copia está cifrada con otra contraseña: tráela desde Ajustes → Copia de seguridad.');
  await restoreFrom(db, copy.opened, copy.sha);
}
