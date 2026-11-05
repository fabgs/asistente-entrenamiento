import type { Db } from '@/db/db';
import type { CardioActivity } from '@/db/repositories/cardio';
import {
  discardCardioSession,
  finishCardioSession,
  getActiveCardioSession,
  getCardioSession,
  pauseCardioSession,
  resumeCardioSession,
  startCardioSession,
  type CardioSession,
} from '@/db/repositories/cardioSessions';
import { activeMs } from '@/domain/gps';
import { cancelCardioTimer, scheduleCardioTimer } from './cardioTimer';
import { SPRINT_GPS, startGpsTracking, stopGpsTracking, WALK_GPS, type GpsStart } from './gpsTracker';
import { deletingPhotosOf } from './photos';
import { finishSprints, stopSprintTracking, syncSprint } from './sprintSession';

/** When the plan's clock would have started without the pauses so far. */
const planStart = (session: CardioSession, now: number) => now - activeMs(session, now);

async function startTracking(session: CardioSession, now: number, prompt = true): Promise<GpsStart> {
  if (session.tracking === 'gps') return startGpsTracking(WALK_GPS);
  if (session.tracking === 'sprint') {
    const gps = await startGpsTracking(SPRINT_GPS, { prompt });
    await syncSprint(session, now);
    return gps;
  }
  if (session.plan) await scheduleCardioTimer(session.id, session.name, session.plan, planStart(session, now), now);
  return 'ok';
}

async function stopTracking(session: CardioSession): Promise<void> {
  if (session.tracking === 'gps') await stopGpsTracking();
  else if (session.tracking === 'sprint') await stopSprintTracking(session);
  else await cancelCardioTimer(session.id);
}

/**
 * Creates the session and starts recording. If GPS cannot start, a walk is not kept; sprints are
 * (they can still be timed), and `gpsError` says why there is no GPS.
 */
export async function startCardio(
  db: Db,
  activity: CardioActivity,
  now = Date.now(),
): Promise<{ sessionId: number; gpsError?: Exclude<GpsStart, 'ok'> } | { error: Exclude<GpsStart, 'ok'> }> {
  const sessionId = await startCardioSession(db, activity, now);
  const session = (await getCardioSession(db, sessionId))!;
  const result = await startTracking(session, now).catch((): GpsStart => 'off');
  if (result === 'ok') return { sessionId };
  if (session.tracking === 'sprint') return { sessionId, gpsError: result };
  await discardCardioSession(db, sessionId);
  return { error: result };
}

export async function pauseCardio(db: Db, session: CardioSession, now = Date.now()): Promise<void> {
  await stopTracking(session);
  await pauseCardioSession(db, session.id, now);
}

export async function resumeCardio(db: Db, session: CardioSession, now = Date.now()): Promise<GpsStart> {
  await resumeCardioSession(db, session.id, now);
  return startTracking((await getCardioSession(db, session.id))!, now);
}

/** After the app was closed, the recording may have stopped (e.g. a reboot): start it again. */
export async function ensureCardioRunning(db: Db, session: CardioSession, now = Date.now()): Promise<void> {
  if (session.status !== 'in_progress' || session.pausedAt !== null) return;
  // Sprints resume quietly: no permission dialog and no switching the location on behind a screen.
  await startTracking(session, now, session.tracking !== 'sprint');
}

/** At start-up: sprints left running get their GPS, their next beep and their countdown back. */
export async function restoreCardioInProgress(db: Db, now = Date.now()): Promise<void> {
  const session = await getActiveCardioSession(db);
  if (session?.tracking === 'sprint') await ensureCardioRunning(db, session, now);
}

export async function finishCardio(db: Db, session: CardioSession, now = Date.now()): Promise<void> {
  if (session.tracking === 'sprint') {
    await finishSprints(db, session, now);
    return;
  }
  await stopTracking(session);
  await finishCardioSession(db, session.id, now);
}

export async function discardCardio(db: Db, session: CardioSession): Promise<void> {
  await stopTracking(session);
  await deletingPhotosOf(db, { kind: 'cardio', id: session.id }, () => discardCardioSession(db, session.id));
}

export const GPS_ERROR_MESSAGE: Record<Exclude<GpsStart, 'ok'>, string> = {
  denied: 'Sin permiso de ubicación no se puede grabar la ruta. Dáselo en Ajustes → Apps → Entreno → Permisos.',
  approximate: 'Con la ubicación aproximada no se puede medir la distancia. Activa «Usar ubicación precisa» en los permisos de Entreno.',
  off: 'La ubicación del móvil está desactivada. Actívala y vuelve a intentarlo.',
};
