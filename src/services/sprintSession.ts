import type { Db } from '@/db/db';
import {
  finishSprintSession,
  getCardioSession,
  lastTrackPoint,
  listSprintFixes,
  setSprintLaps,
  type CardioSession,
} from '@/db/repositories/cardioSessions';
import {
  cancelGo,
  closeForFinish,
  dropLastClosed,
  dropOpen,
  encodeLapFixes,
  encodeLaps,
  extraSprint,
  goNow,
  measureLaps,
  shiftRest,
  sprintLabel,
  sprintState,
  stopLap,
  withMeasures,
  type Lap,
  type SprintPlan,
} from '@/domain/sprint';
import {
  cancelSprintBeep,
  scheduleSprintBeep,
  setShowWhenLocked,
  startRestCountdown,
  stopRestCountdown,
} from '../../modules/rest-timer';
import { cancelCardioTimer } from './cardioTimer';
import { isGpsRecording, stopGpsTracking } from './gpsTracker';

const SETTLE_POLL_MS = 500;
const SETTLE_WAIT_MS = 5_000;

/** The laps before and after an action, to put back what it did. */
export type SprintUndo = { from: string; to: string | null };

/**
 * Makes the next beep and the lock-screen countdown match the laps (PLAN.md §6.8). Idempotent: the
 * native beep keeps a start it already has, and one already waiting to sound is not doubled.
 */
export async function syncSprint(session: CardioSession, now = Date.now()): Promise<void> {
  const plan = session.sprint;
  const state = plan && session.status === 'in_progress' ? sprintState(plan, session.laps, now) : null;
  if (!plan || state?.kind !== 'waiting') {
    cancelSprintBeep();
    stopRestCountdown();
    return;
  }
  scheduleSprintBeep(state.goAt);
  const label = sprintLabel(state.number, plan);
  startRestCountdown(state.goAt, state.restFrom ? 'Descanso' : 'Preparados', `${label} · sale con el pitido`, false);
}

/** Reads the session, applies `transition` and writes it only if nothing changed meanwhile. */
async function apply(
  db: Db,
  sessionId: number,
  now: number,
  transition: (plan: SprintPlan, laps: Lap[]) => Lap[] | null,
): Promise<SprintUndo | null> {
  const session = await getCardioSession(db, sessionId);
  if (!session?.sprint || session.status !== 'in_progress') return null;
  const next = transition(session.sprint, session.laps);
  if (!next) return null;
  const json = encodeLaps(next);
  if (!(await setSprintLaps(db, sessionId, session.lapsJson, json))) return null;
  await syncSprint({ ...session, laps: next, lapsJson: json }, now);
  return { from: json, to: session.lapsJson };
}

/** «Empezar sprint» and «Saltar descanso»: the beep in 5 s. */
export async function goSprint(db: Db, sessionId: number, now = Date.now()): Promise<boolean> {
  return !!(await apply(db, sessionId, now, (plan, laps) => goNow(plan, laps, now)));
}

/** «Cancelar» during the last 5 s. */
export async function cancelSprintGo(db: Db, sessionId: number, now = Date.now()): Promise<boolean> {
  return !!(await apply(db, sessionId, now, (plan, laps) => cancelGo(plan, laps, now)));
}

export type SprintStop =
  | { kind: 'ignored' }
  | { kind: 'false-start'; undo: SprintUndo }
  | { kind: 'stopped'; number: number; timeMs: number; last: boolean; undo: SprintUndo };

/** «Parar». `at` is taken when it is called, before anything is awaited: it is the time of the tap. */
export async function stopSprint(db: Db, sessionId: number, at = Date.now()): Promise<SprintStop> {
  let outcome: ReturnType<typeof stopLap> = { kind: 'ignored' };
  const undo = await apply(db, sessionId, at, (plan, laps) => {
    outcome = stopLap(plan, laps, at);
    return outcome.kind === 'ignored' ? null : outcome.laps;
  });
  const result = outcome as ReturnType<typeof stopLap>;
  if (!undo || result.kind === 'ignored') return { kind: 'ignored' };
  if (result.kind === 'false-start') return { kind: 'false-start', undo };
  return { kind: 'stopped', number: result.number, timeMs: result.timeMs, last: result.last, undo };
}

/** Puts the laps back as they were before an action (the Snackbar's «Deshacer»). */
export async function undoSprint(db: Db, sessionId: number, undo: SprintUndo, now = Date.now()): Promise<boolean> {
  if (!(await setSprintLaps(db, sessionId, undo.from, undo.to ?? '[]'))) return false;
  const restored = await getCardioSession(db, sessionId);
  if (restored) await syncSprint(restored, now);
  return true;
}

export async function shiftSprintRest(db: Db, sessionId: number, deltaSec: number, now = Date.now()): Promise<boolean> {
  return !!(await apply(db, sessionId, now, (plan, laps) => shiftRest(plan, laps, deltaSec, now)));
}

/** «Quitar el sprint N»: the last finished one. */
export const dropLastSprint = (db: Db, sessionId: number, now = Date.now()) =>
  apply(db, sessionId, now, (plan, laps) => dropLastClosed(plan, laps, now));

/** «Quitar este sprint»: one that was never stopped. */
export const dropRunningSprint = (db: Db, sessionId: number, now = Date.now()) =>
  apply(db, sessionId, now, (plan, laps) => dropOpen(plan, laps, now));

/** «Otro sprint» after the planned ones. */
export async function addExtraSprint(db: Db, sessionId: number, now = Date.now()): Promise<boolean> {
  return !!(await apply(db, sessionId, now, (plan, laps) => extraSprint(plan, laps, now)));
}

/** Only the sprints screen, while focused, shows over the lock screen: power button, then «Parar». */
export function showOverLockScreen(on: boolean): void {
  setShowWhenLocked(on);
}

/** Stops everything a sprints session keeps running: GPS, alarm, countdown and the lock-screen pass. */
export async function stopSprintTracking(session: CardioSession): Promise<void> {
  cancelSprintBeep();
  await stopGpsTracking();
  await cancelCardioTimer(session.id);
  showOverLockScreen(false);
}

/**
 * Finishes a sprints session: a sprint still running closes now, the fixes after the last stop get
 * a few seconds to arrive, and every sprint is measured once more with all of them.
 */
export async function finishSprints(db: Db, stale: CardioSession, now = Date.now()): Promise<void> {
  // The screen's copy may be a second old: the laps written since then must not be lost.
  const session = (await getCardioSession(db, stale.id)) ?? stale;
  if (session.status !== 'in_progress') return;
  const laps = closeForFinish(session.laps, now);
  const json = encodeLaps(laps);
  if (json !== session.lapsJson) await setSprintLaps(db, session.id, session.lapsJson, json);
  const lastStop = laps.filter((l) => l.stopAt !== null).at(-1)?.stopAt ?? null;
  if (lastStop !== null && (await isGpsRecording())) {
    while (Date.now() < lastStop + SETTLE_WAIT_MS) {
      const last = await lastTrackPoint(db, session.id);
      if (last && last.t >= lastStop + 1000) break;
      await new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS));
    }
  }
  await stopSprintTracking(session);
  const fixes = await listSprintFixes(db, session.id, session.startedAt - 5000, Date.now() + 60_000);
  const measured = withMeasures(laps, measureLaps(fixes, laps, Infinity));
  await finishSprintSession(db, session.id, now, measured, encodeLapFixes(measured, fixes));
}
