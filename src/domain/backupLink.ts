import { countOf } from './progress';

/**
 * Which copy in GitHub the data of this phone comes from (PLAN.md §9). A phone only replaces on
 * its own the copy it uploaded or restored last: a new phone, or one whose data was reset, has
 * none, so its empty data never goes over the good copy without asking.
 */
export interface BackupLink {
  /**
   * Blob sha of the copy this phone uploaded or restored last; '' if its data comes from none (new
   * or reset); null on a phone from before 1.5.3, which did not keep it.
   */
  sha: string | null;
  /** It has uploaded a copy before (`settings.last_backup_at`). */
  uploadedBefore: boolean;
  /** It holds something of the user's: routines, sessions or weigh-ins. */
  hasData: boolean;
}

/** Whether uploading may replace the copy in GitHub (`remoteSha`, null if there is none) without asking. */
export function mayReplaceCopy(remoteSha: string | null, link: BackupLink): boolean {
  if (remoteSha === null) return true;
  // Before 1.5.3 the sha was not kept: a phone that was already uploading its data goes on doing it.
  if (link.sha === null) return link.uploadedBefore && link.hasData;
  return link.sha === remoteSha;
}

/** What a copy holds, for the question before restoring it: an empty one has to be seen as such. */
export function copyContents(workouts: number, cardio: number): string {
  if (workouts === 0 && cardio === 0) return 'no tiene ningún entreno ni cardio';
  const parts = [
    workouts > 0 ? countOf(workouts, 'entreno', 'entrenos') : null,
    cardio > 0 ? countOf(cardio, 'sesión de cardio', 'sesiones de cardio') : null,
  ].filter((p): p is string => p !== null);
  return `tiene ${parts.join(' y ')}`;
}
