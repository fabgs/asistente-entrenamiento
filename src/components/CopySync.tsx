import { useEffect } from 'react';
import { AppState } from 'react-native';
import type { Db } from '@/db/db';
import { newerCopyMessage } from '@/domain/sync';
import { emitDataReplaced, useDb } from '@/hooks/data';
import {
  backupToGithub,
  bringNewerCopy,
  checkNewerCopy,
  declineNewerCopy,
  maybeAutoBackup,
  type NewerCopy,
} from '@/services/backup';
import { showDialog, showSnackbar, type DialogButton } from './Dialog';

/** Checking GitHub on every return to the app is cheap, but not twice in a minute. */
const CHECK_GAP_MS = 60 * 1000;
let lastCheck = 0;
let checking = false;

/**
 * Two phones with the same data (1.5.6, PLAN.md §9): if another phone uploaded a newer copy than
 * the one this phone's data comes from, ask whether to bring it. Called at start-up (after the
 * automatic copy) and each time the app comes back to the front.
 */
export async function offerNewerCopy(db: Db, now = Date.now()): Promise<void> {
  if (checking || now - lastCheck < CHECK_GAP_MS) return;
  checking = true;
  lastCheck = now;
  try {
    const copy = await checkNewerCopy(db);
    if (copy) ask(db, copy);
  } catch {
    // Offline, or GitHub not answering: the next return to the app tries again.
  } finally {
    checking = false;
  }
}

function ask(db: Db, copy: NewerCopy): void {
  const later: DialogButton = { text: 'Ahora no', style: 'cancel', onPress: () => void declineNewerCopy(db, copy) };
  if (!copy.opened || copy.exportedAt === null || copy.contents === null) {
    showDialog(
      'Hay una copia más nueva',
      'La subió otro móvil, cifrada con otra contraseña. Para traerla, ve a Ajustes, Copia de seguridad, «Restaurar…».',
      [{ ...later, text: 'Vale' }],
    );
    return;
  }
  const message = newerCopyMessage(copy.kind, copy.exportedAt, new Date(), copy.contents);
  const bring: DialogButton = {
    text: copy.kind === 'offer' ? 'Traer' : 'Traer la otra',
    style: copy.kind === 'offer' ? 'default' : 'destructive',
    onPress: () => void bringIt(db, copy),
  };
  const keep: DialogButton = { text: 'Subir la de este', style: 'destructive', onPress: () => void keepThis(db) };
  showDialog('Hay una copia más nueva', message, copy.kind === 'offer' ? [later, bring] : [later, keep, bring]);
}

async function bringIt(db: Db, copy: NewerCopy): Promise<void> {
  try {
    await bringNewerCopy(db, copy);
    emitDataReplaced();
    showSnackbar('Datos traídos del otro móvil');
  } catch (e) {
    showSnackbar(e instanceof Error ? e.message : 'No se pudieron traer los datos');
  }
}

async function keepThis(db: Db): Promise<void> {
  try {
    await backupToGithub(db, new Date(), true);
    showSnackbar('Subida la copia de este móvil');
  } catch {
    showSnackbar('No se pudo subir la copia');
  }
}

/** Mounted once at the root: leaving the app uploads what changed; coming back looks for a newer copy. */
export function CopySync() {
  const db = useDb();
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void offerNewerCopy(db);
      // iOS gives a few seconds in the background: enough most times, and if not, the next time.
      else if (state === 'background') void maybeAutoBackup(db).catch(() => undefined);
    });
    return () => sub.remove();
  }, [db]);
  return null;
}
