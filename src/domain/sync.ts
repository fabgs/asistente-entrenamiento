import { mayReplaceCopy, type BackupLink } from './backupLink';
import { formatTimeOfDay } from './format';
import { localDateString } from './schedule';

/**
 * Two phones with the same data (1.5.6, PLAN.md §9): each uploads its copy when its data changes,
 * and when the other one opens and finds a newer copy in GitHub than its own, it offers to bring it.
 * Nothing merges: a copy replaces all the data, so when both phones changed, the user chooses.
 */

/**
 * Columns of `settings` that change on their own or only say how the phone shows things: they do
 * not count as a change of the data (the last copy's time would change the data at every upload).
 */
export const VOLATILE_SETTINGS: readonly string[] = [
  'last_backup_at',
  'last_backup_error',
  'cardio_hero',
  'distance_unit',
  'cardio_chart',
  'cardio_live_panel',
  'muscle_map_mode',
];

type Rows = Partial<Record<string, Record<string, unknown>[]>>;

/** cyrb53: a fast 53-bit string hash, enough to tell whether something changed (not a security hash). */
function cyrb53(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

/** What the data of a copy is, without what changes on its own: equal fingerprints, same data. */
export function dataFingerprint(tables: Rows): string {
  const settings = (tables.settings ?? []).map((row) => {
    const kept = { ...row };
    for (const column of VOLATILE_SETTINGS) delete kept[column];
    return kept;
  });
  return cyrb53(JSON.stringify({ ...tables, settings }));
}

/**
 * What to do when the app opens: nothing; offer the newer copy of another phone; or, when this
 * phone has changes of its own too, let the user choose which one stays.
 *
 * `dirty`: the data changed since the copy it uploaded or restored last. `declinedSha`: a copy the
 * user already said «Ahora no» to, which is not offered again.
 */
export function syncDecision(
  remoteSha: string | null,
  link: BackupLink,
  declinedSha: string | null,
  dirty: boolean,
): 'none' | 'offer' | 'conflict' {
  if (remoteSha === null || mayReplaceCopy(remoteSha, link) || remoteSha === declinedSha) return 'none';
  return dirty ? 'conflict' : 'offer';
}

/** «hoy a las 20:15», «ayer a las 9:03», «el 22/11 a las 9:03». */
export function whenText(ms: number, now: Date): string {
  const day = localDateString(new Date(ms));
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const at = `a las ${formatTimeOfDay(ms)}`;
  if (day === localDateString(now)) return `hoy ${at}`;
  if (day === localDateString(yesterday)) return `ayer ${at}`;
  const [, m, d] = day.split('-').map(Number);
  return `el ${d}/${m} ${at}`;
}

/**
 * The question when another phone uploaded a newer copy. `contents` is copyContents of that copy
 * («tiene 377 entrenos y 9 sesiones de cardio»).
 */
export function newerCopyMessage(kind: 'offer' | 'conflict', exportedAt: number, now: Date, contents: string): string {
  const copy = `La subió otro móvil ${whenText(exportedAt, now)} y ${contents}.`;
  return kind === 'offer'
    ? `${copy} ¿Traer sus datos a este móvil?`
    : `${copy} Este móvil también tiene cambios que no están en ella: si la traes, se pierden; si subes la de este, se pierden los del otro.`;
}
