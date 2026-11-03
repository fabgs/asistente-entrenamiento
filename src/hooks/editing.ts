import { router, usePreventRemove } from 'expo-router';
import { useEffect, useState } from 'react';
import { showDialog } from '@/components/Dialog';
import type { Db } from '@/db/db';
import { rescheduleDailyReminders } from '@/services/dailyReminder';

let writes: Promise<unknown> = Promise.resolve();

/**
 * Runs the editors' writes one after another: controls save at once, and two quick taps must never
 * open two SQLite transactions at the same time (expo-sqlite cannot nest them).
 */
export function queueWrite<T>(task: () => Promise<T>): Promise<T> {
  const next = writes.catch(() => undefined).then(task);
  writes = next;
  return next;
}

/** After a change to routines, slots, days or cardio (AGENTS.md), without making the user wait. */
export function reschedule(db: Db): void {
  rescheduleDailyReminders(db).catch((e) => console.warn('No se pudieron reprogramar los avisos diarios', e));
}

/**
 * A control that saves at once (the days of a routine, a routine on a day): it shows the new value
 * straight away while `save` writes it (queued) and reloads, and goes back to `saved` if it fails.
 */
export function useSavedAtOnce<T>(saved: T, save: (value: T) => Promise<void>): [T, (value: T) => void] {
  const [pending, setPending] = useState<{ value: T; version: number } | null>(null);
  const change = (value: T) => {
    const version = (pending?.version ?? 0) + 1;
    setPending({ value, version });
    queueWrite(() => save(value))
      .catch((e) => console.warn('No se pudo guardar', e))
      .finally(() => setPending((p) => (p?.version === version ? null : p)));
  };
  return [pending ? pending.value : saved, change];
}

/**
 * A form with a single «Guardar». Leaving it with unsaved changes (back gesture or arrow) asks
 * «¿Guardar los cambios?»; `save` returns false when something is missing, and then it stays.
 * Returns `leave`: back without asking, once saved or removed.
 */
export function useSaveGuard(dirty: boolean, save: () => Promise<boolean>): () => void {
  const [leaving, setLeaving] = useState(false);
  const allowLeaving = usePreventRemove(dirty && !leaving, ({ repeat }) => {
    showDialog('¿Guardar los cambios?', undefined, [
      {
        text: 'Guardar',
        onPress: async () => {
          if (!(await save())) return;
          setLeaving(true);
          repeat();
        },
      },
      {
        text: 'Descartar',
        style: 'destructive',
        onPress: () => {
          setLeaving(true);
          repeat();
        },
      },
      { text: 'Seguir editando', style: 'cancel' },
    ]);
  });
  return () => {
    setLeaving(true);
    allowLeaving();
    if (router.canGoBack()) router.back();
    else router.replace('/rutinas');
  };
}

const listeners = new Set<() => void>();

/** Data changed outside the screen on view (the «Deshacer» of a Snackbar): open screens reload. */
export function emitDataChanged(): void {
  for (const listener of listeners) listener();
}

/** Calls `listener` (a stable `reload`) whenever `emitDataChanged` is called. */
export function useOnDataChanged(listener: () => void): void {
  useEffect(() => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [listener]);
}
