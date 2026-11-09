import type { Db } from '@/db/db';
import { isBodyweight, type Slot } from '@/db/repositories/routines';
import { getActiveSession, isWarmingUp, listSets, sessionSlots, type Session, type SetLog } from '@/db/repositories/sessions';
import { formatLoad } from '@/domain/format';
import { nextPendingSlot, nextStep, setsDone, type NextStep } from '@/domain/workoutMachine';
import { startOngoing, stopOngoing } from '../../modules/rest-timer';

const loadOf = (slot: Slot) => formatLoad(slot.weightKg, isBodyweight(slot), slot.exercisePair);

/** «Rutina completada», or for a loose session «Ejercicio completado» / «Ejercicios completados». */
export function completedLabel(session: Pick<Session, 'routineId'>, slots: Slot[]): string {
  if (session.routineId !== null) return 'Rutina completada';
  return slots.length === 1 ? 'Ejercicio completado' : 'Ejercicios completados';
}

/** What comes next, for the rest notification and the bar of the list: "Serie 2 de 3 · Remo con barra · 37,5 kg". */
export function describeNext(next: NextStep, slots: Slot[], finishedLabel = 'Rutina completada'): string {
  if (next.kind === 'finished') return finishedLabel;
  const slot = slots.find((s) => s.id === next.slotId);
  if (!slot) return next.kind === 'next_set' ? `Serie ${next.setNumber}` : 'Siguiente ejercicio';
  return next.kind === 'next_set'
    ? `Serie ${next.setNumber} de ${slot.sets} · ${slot.exerciseName} · ${loadOf(slot)}`
    : `Siguiente ejercicio: ${slot.exerciseName} · ${loadOf(slot)}`;
}

/**
 * The line of the workout notification: the warm-up, the set being done or coming after the rest, or
 * how many sets are done while looking at the list.
 */
export function inProgressText(session: Session, slots: Slot[], sets: SetLog[]): string {
  const planned = slots.map((s) => ({ slotId: s.id, sets: s.sets }));
  const skipped = session.skippedSlotIds;
  const done = completedLabel(session, slots);
  if (isWarmingUp(session)) {
    const nextId = session.currentSlotId ?? nextPendingSlot(planned, sets, skipped, null);
    const next = slots.find((s) => s.id === nextId);
    return next ? `Calentamiento · Siguiente: ${next.exerciseName} · ${loadOf(next)}` : 'Calentamiento';
  }
  if (session.restEndsAt) return describeNext(nextStep(planned, sets, skipped, session.currentSlotId ?? -1), slots, done);
  const current = slots.find((s) => s.id === session.currentSlotId);
  if (current) {
    const doneSets = setsDone(current.id, sets);
    return doneSets < current.sets
      ? describeNext({ kind: 'next_set', slotId: current.id, setNumber: doneSets + 1 }, slots, done)
      : `${current.exerciseName} · ${loadOf(current)}`;
  }
  const working = sets.filter((s) => !s.isWarmup).length;
  if (working > 0 && nextPendingSlot(planned, sets, skipped, null) === null) return done;
  return `${working} de ${slots.reduce((sum, s) => sum + s.sets, 0)} series`;
}

/**
 * While a workout is in progress, a fixed notification with its time counting up takes the user
 * back to it (PLAN.md §6.5); the rest countdown shows on top of it and then gives way to it again.
 */
export function showWorkoutInProgress(session: Session, slots: Slot[], sets: SetLog[]): void {
  startOngoing(session.startedAt, session.title ?? session.routineName ?? 'Ejercicio suelto', inProgressText(session, slots, sets));
}

export function clearWorkoutInProgress(): void {
  stopOngoing();
}

/** At start-up: a workout left running (the app was closed) gets its notification back. */
export async function restoreWorkoutInProgress(db: Db): Promise<void> {
  const session = await getActiveSession(db);
  if (!session) return;
  const sets = await listSets(db, session.id);
  showWorkoutInProgress(session, await sessionSlots(db, session, sets), sets);
}
