import type { Db } from '../db';
import { getMeta, setMeta } from '../maintenance';

const KEY = 'admin';

/**
 * Whether Ajustes shows the admin options (the copy in GitHub and test mode), which are only for
 * the developer: friends get the APK without them. Seven taps on the version change it (see
 * domain/secretTaps). It lives in app_meta, so a reset or a restored copy keeps it. A phone that
 * has never decided gets them if it already uses either (the developer's phone, on updating).
 */
export async function getAdminOptions(db: Db): Promise<boolean> {
  const saved = await getMeta(db, KEY);
  if (saved !== null) return saved === '1';
  const inUse = await db.getFirstAsync<{ yes: number }>(
    `SELECT (dev_mode = 1 OR (backup_owner IS NOT NULL AND backup_owner <> '' AND backup_repo IS NOT NULL AND backup_repo <> '')) AS yes
     FROM settings WHERE id = 1`,
  );
  const shown = inUse?.yes === 1;
  await setAdminOptions(db, shown);
  return shown;
}

export const setAdminOptions = (db: Db, shown: boolean) => setMeta(db, KEY, shown ? '1' : '0');
