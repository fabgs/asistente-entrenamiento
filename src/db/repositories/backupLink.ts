import type { BackupLink } from '@/domain/backupLink';
import type { Db } from '../db';
import { BACKUP_LINK_KEY, getMeta, setMeta } from '../maintenance';

/**
 * The copy in GitHub the data of this phone comes from (domain/backupLink). It lives in app_meta:
 * it is of the phone, not of the data, so it is not in the copies and restoring one keeps it.
 */
export async function getBackupLink(db: Db): Promise<BackupLink> {
  const sha = await getMeta(db, BACKUP_LINK_KEY);
  const row = await db.getFirstAsync<{ uploaded: number | null; has_data: number }>(
    `SELECT (SELECT last_backup_at IS NOT NULL FROM settings WHERE id = 1) AS uploaded,
            (EXISTS (SELECT 1 FROM routine) OR EXISTS (SELECT 1 FROM workout_session)
             OR EXISTS (SELECT 1 FROM cardio_session) OR EXISTS (SELECT 1 FROM weight_log)) AS has_data`,
  );
  return { sha, uploadedBefore: row?.uploaded === 1, hasData: row?.has_data === 1 };
}

/** `sha` of the copy just uploaded or restored; null when the data comes from none (a new phone). */
export const setBackupLink = (db: Db, sha: string | null) => setMeta(db, BACKUP_LINK_KEY, sha ?? '');
