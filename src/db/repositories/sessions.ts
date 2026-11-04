import { recommend } from '@/domain/progression';
import { looseSlotIds, slotToOpen } from '@/domain/workoutMachine';
import { localDateString } from '@/domain/schedule';
import type { ProgressionSettings, SessionPerformance } from '@/domain/types';
import { bool, type Db } from '../db';
import { listSlots, listSlotsByIds, slotRule, type Slot } from './routines';
import { createRecommendation, expireOpenChanges } from './weightChanges';

export type SessionStatus = 'in_progress' | 'finished' | 'abandoned';

export interface Session {
  id: number;
  routineId: number | null;
  routineName: string | null;
  /** Given by the user (e.g. when sharing); null shows the routine name. */
  title: string | null;
  date: string;
  startedAt: number;
  finishedAt: number | null;
  status: SessionStatus;
  imported: boolean;
  restEndsAt: number | null;
  restNotificationId: string | null;
  currentSlotId: number | null;
  skippedSlotIds: number[];
  /** A loose session (no routine): its first exercise, for its name. */
  looseFirst: string | null;
  /** A loose session: how many exercises it has sets of. */
  looseCount: number;
}

export interface SetLog {
  id: number;
  sessionId: number;
  slotId: number | null;
  exerciseId: number;
  setIndex: number;
  weightKg: number | null;
  reps: number;
  isExtra: boolean;
  /** Warm-up set: logged with its own weight, never counts for sets, volume, records or progression. */
  isWarmup: boolean;
  completedAt: number;
}

interface SessionRow {
  id: number;
  routine_id: number | null;
  routine_name: string | null;
  title: string | null;
  date: string;
  started_at: number;
  finished_at: number | null;
  status: SessionStatus;
  imported: number;
  rest_ends_at: number | null;
  rest_notification_id: string | null;
  current_slot_id: number | null;
  skipped_slot_ids: string;
  loose_first: string | null;
  loose_count: number;
}

/**
 * A loose session (routine_id NULL, PLAN.md §6.4) is named after its first exercise: the one of its
 * first set or, before any, the one in course. Its exercises are the slots of its sets.
 */
const LOOSE_COLUMNS = `
  CASE WHEN ws.routine_id IS NULL THEN COALESCE(
    (SELECT e.name FROM set_log sl JOIN exercise e ON e.id = sl.exercise_id
     WHERE sl.session_id = ws.id ORDER BY sl.completed_at, sl.id LIMIT 1),
    (SELECT e.name FROM routine_slot rs JOIN exercise e ON e.id = rs.exercise_id WHERE rs.id = ws.current_slot_id)) END AS loose_first,
  CASE WHEN ws.routine_id IS NULL THEN (SELECT COUNT(DISTINCT sl.slot_id) FROM set_log sl WHERE sl.session_id = ws.id) ELSE 0 END AS loose_count`;

const SESSION_SELECT = `
  SELECT ws.*, r.name AS routine_name, ${LOOSE_COLUMNS}
  FROM workout_session ws LEFT JOIN routine r ON r.id = ws.routine_id`;

function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    routineId: row.routine_id,
    routineName: row.routine_name,
    title: row.title,
    date: row.date,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status,
    imported: bool(row.imported),
    restEndsAt: row.rest_ends_at,
    restNotificationId: row.rest_notification_id,
    currentSlotId: row.current_slot_id,
    skippedSlotIds: JSON.parse(row.skipped_slot_ids) as number[],
    looseFirst: row.loose_first,
    looseCount: row.loose_count,
  };
}

export async function getSession(db: Db, id: number): Promise<Session | null> {
  const row = await db.getFirstAsync<SessionRow>(`${SESSION_SELECT} WHERE ws.id = ?`, id);
  return row ? toSession(row) : null;
}

export async function getActiveSession(db: Db): Promise<Session | null> {
  const row = await db.getFirstAsync<SessionRow>(
    `${SESSION_SELECT} WHERE ws.status = 'in_progress' ORDER BY ws.started_at DESC LIMIT 1`,
  );
  return row ? toSession(row) : null;
}

export async function startSession(db: Db, routineId: number, now: Date): Promise<number> {
  const result = await db.runAsync(
    `INSERT INTO workout_session (routine_id, date, started_at, status) VALUES (?, ?, ?, 'in_progress')`,
    routineId,
    localDateString(now),
    now.getTime(),
  );
  return result.lastInsertRowId;
}

/**
 * Starts a loose session on a slot of any routine: one exercise with its weight and prescription,
 * outside any routine. Null if another workout is in progress.
 */
export async function startLooseSession(db: Db, slotId: number, now: Date): Promise<number | null> {
  let id: number | null = null;
  await db.withTransactionAsync(async () => {
    if (await db.getFirstAsync(`SELECT id FROM workout_session WHERE status = 'in_progress'`)) return;
    const result = await db.runAsync(
      `INSERT INTO workout_session (routine_id, date, started_at, status, current_slot_id) VALUES (NULL, ?, ?, 'in_progress', ?)`,
      localDateString(now),
      now.getTime(),
      slotId,
    );
    id = result.lastInsertRowId;
  });
  return id;
}

/** «Añadir otro ejercicio» to a loose session: it becomes the one in course (not while resting). */
export async function addLooseExercise(db: Db, sessionId: number, slotId: number): Promise<boolean> {
  const result = await db.runAsync(
    `UPDATE workout_session SET current_slot_id = ?
     WHERE id = ? AND status = 'in_progress' AND routine_id IS NULL AND rest_ends_at IS NULL`,
    slotId,
    sessionId,
  );
  return result.changes > 0;
}

/**
 * The exercises of a session: those of its routine or, for a loose one, the slots of its sets and
 * the one in course (archived ones included, so their sets do not vanish).
 */
export async function sessionSlots(db: Db, session: Session, sets: SetLog[]): Promise<Slot[]> {
  if (session.routineId !== null) return listSlots(db, session.routineId);
  return listSlotsByIds(db, looseSlotIds(sets, session.currentSlotId));
}

export async function updateSessionState(
  db: Db,
  id: number,
  patch: {
    currentSlotId?: number | null;
    restEndsAt?: number | null;
    restNotificationId?: string | null;
    skippedSlotIds?: number[];
  },
): Promise<void> {
  if ('currentSlotId' in patch) {
    await db.runAsync('UPDATE workout_session SET current_slot_id = ? WHERE id = ?', patch.currentSlotId ?? null, id);
  }
  if ('restEndsAt' in patch) {
    await db.runAsync('UPDATE workout_session SET rest_ends_at = ? WHERE id = ?', patch.restEndsAt ?? null, id);
  }
  if ('restNotificationId' in patch) {
    await db.runAsync(
      'UPDATE workout_session SET rest_notification_id = ? WHERE id = ?',
      patch.restNotificationId ?? null,
      id,
    );
  }
  if (patch.skippedSlotIds) {
    await db.runAsync(
      'UPDATE workout_session SET skipped_slot_ids = ? WHERE id = ?',
      JSON.stringify(patch.skippedSlotIds),
      id,
    );
  }
}

const SET_SELECT = `
  SELECT id, session_id AS sessionId, slot_id AS slotId, exercise_id AS exerciseId, set_index AS setIndex,
         weight_kg AS weightKg, reps, is_extra AS isExtra, is_warmup AS isWarmup, completed_at AS completedAt
  FROM set_log`;

type SetRow = Omit<SetLog, 'isExtra' | 'isWarmup'> & { isExtra: number; isWarmup: number };
const toSet = (row: SetRow): SetLog => ({ ...row, isExtra: bool(row.isExtra), isWarmup: bool(row.isWarmup) });

export async function listSets(db: Db, sessionId: number): Promise<SetLog[]> {
  const rows = await db.getAllAsync<SetRow>(
    `${SET_SELECT} WHERE session_id = ? ORDER BY completed_at, id`,
    sessionId,
  );
  return rows.map(toSet);
}

/** Records a set; the weight is always copied from the slot (PLAN.md §6.1). */
export async function logSet(
  db: Db,
  sessionId: number,
  slot: Slot,
  reps: number,
  now = Date.now(),
): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM set_log WHERE session_id = ? AND slot_id = ? AND is_warmup = 0',
    sessionId,
    slot.id,
  );
  const setIndex = (row?.n ?? 0) + 1;
  const result = await db.runAsync(
    `INSERT INTO set_log (session_id, slot_id, exercise_id, set_index, weight_kg, reps, is_extra, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    sessionId,
    slot.id,
    slot.exerciseId,
    setIndex,
    slot.weightKg,
    reps,
    setIndex > slot.sets ? 1 : 0,
    now,
  );
  return result.lastInsertRowId;
}

/** Records a warm-up set of a slot, with the weight actually used. */
export async function logWarmupSet(
  db: Db,
  sessionId: number,
  slot: Slot,
  weightKg: number | null,
  reps: number,
  now = Date.now(),
): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM set_log WHERE session_id = ? AND slot_id = ? AND is_warmup = 1',
    sessionId,
    slot.id,
  );
  const result = await db.runAsync(
    `INSERT INTO set_log (session_id, slot_id, exercise_id, set_index, weight_kg, reps, is_extra, is_warmup, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?)`,
    sessionId,
    slot.id,
    slot.exerciseId,
    (row?.n ?? 0) + 1,
    weightKg,
    reps,
    now,
  );
  return result.lastInsertRowId;
}

export async function updateSetReps(db: Db, setId: number, reps: number): Promise<void> {
  await db.runAsync('UPDATE set_log SET reps = ? WHERE id = ?', reps, setId);
}

export async function deleteSet(db: Db, setId: number): Promise<void> {
  const set = await db.getFirstAsync<{ session_id: number; slot_id: number | null; is_warmup: number }>(
    'SELECT session_id, slot_id, is_warmup FROM set_log WHERE id = ?',
    setId,
  );
  if (!set) return;
  await db.runAsync('DELETE FROM set_log WHERE id = ?', setId);
  // Warm-ups and working sets are numbered apart.
  const remaining = await db.getAllAsync<{ id: number }>(
    'SELECT id FROM set_log WHERE session_id = ? AND slot_id IS ? AND is_warmup = ? ORDER BY completed_at, id',
    set.session_id,
    set.slot_id,
    set.is_warmup,
  );
  for (const [i, s] of remaining.entries()) {
    await db.runAsync('UPDATE set_log SET set_index = ? WHERE id = ?', i + 1, s.id);
  }
}

/** Puts a deleted set back exactly as it was («Deshacer»), numbering its siblings again. */
export async function restoreSet(db: Db, set: SetLog): Promise<void> {
  await db.runAsync(
    `INSERT INTO set_log (id, session_id, slot_id, exercise_id, set_index, weight_kg, reps, is_extra, is_warmup, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    set.id,
    set.sessionId,
    set.slotId,
    set.exerciseId,
    set.setIndex,
    set.weightKg,
    set.reps,
    set.isExtra ? 1 : 0,
    set.isWarmup ? 1 : 0,
    set.completedAt,
  );
  const siblings = await db.getAllAsync<{ id: number }>(
    'SELECT id FROM set_log WHERE session_id = ? AND slot_id IS ? AND is_warmup = ? ORDER BY completed_at, id',
    set.sessionId,
    set.slotId,
    set.isWarmup ? 1 : 0,
  );
  for (const [i, s] of siblings.entries()) {
    await db.runAsync('UPDATE set_log SET set_index = ? WHERE id = ?', i + 1, s.id);
  }
}

export interface SlotPerformance extends SessionPerformance {
  sessionId: number;
}

/** Performances of a slot in finished sessions, newest first. */
export async function slotHistory(db: Db, slotId: number, limit = 6): Promise<SlotPerformance[]> {
  const rows = await db.getAllAsync<{ session_id: number; weight_kg: number | null; reps: number }>(
    `SELECT sl.session_id, sl.weight_kg, sl.reps
     FROM set_log sl JOIN workout_session ws ON ws.id = sl.session_id
     WHERE sl.slot_id = ? AND ws.status = 'finished' AND sl.is_warmup = 0
       AND sl.session_id IN (
         SELECT DISTINCT s2.session_id FROM set_log s2 JOIN workout_session w2 ON w2.id = s2.session_id
         WHERE s2.slot_id = ? AND w2.status = 'finished' AND s2.is_warmup = 0
         ORDER BY w2.started_at DESC LIMIT ?)
     ORDER BY ws.started_at DESC, sl.set_index`,
    slotId,
    slotId,
    limit,
  );
  const bySession = new Map<number, SlotPerformance>();
  for (const r of rows) {
    const perf = bySession.get(r.session_id) ?? { sessionId: r.session_id, weightKg: r.weight_kg, reps: [] };
    perf.reps.push(r.reps);
    bySession.set(r.session_id, perf);
  }
  return [...bySession.values()];
}

/** Warm-ups of the latest finished session of a slot that had any, in order: proposed again. */
export async function lastWarmups(db: Db, slotId: number): Promise<{ weightKg: number | null; reps: number }[]> {
  return db.getAllAsync<{ weightKg: number | null; reps: number }>(
    `SELECT sl.weight_kg AS weightKg, sl.reps FROM set_log sl
     WHERE sl.slot_id = ? AND sl.is_warmup = 1 AND sl.session_id = (
       SELECT s2.session_id FROM set_log s2 JOIN workout_session w2 ON w2.id = s2.session_id
       WHERE s2.slot_id = ? AND s2.is_warmup = 1 AND w2.status = 'finished'
       ORDER BY w2.started_at DESC LIMIT 1)
     ORDER BY sl.set_index`,
    slotId,
    slotId,
  );
}

/** Reps of the latest finished session of a slot, to prefill the inputs. */
export async function lastReps(db: Db, slotId: number): Promise<number[]> {
  return (await slotHistory(db, slotId, 1))[0]?.reps ?? [];
}

/**
 * Proposes the next load for a slot from its history; never changes the slot weight. Without
 * `expireOnKeep` (a loose session) a «keep» leaves an open suggestion alone: a few loose sets must
 * not wipe the routine's «Subir a 37,5 kg».
 */
async function proposeForSlot(db: Db, slot: Slot, sessionId: number, settings: ProgressionSettings, now: number, expireOnKeep: boolean) {
  const history = await slotHistory(db, slot.id);
  const rec = recommend(slotRule(slot), slot.exerciseIncrementKg, history, settings);
  if (rec.action === 'increase' || rec.action === 'decrease') {
    await createRecommendation(db, {
      slotId: slot.id,
      sessionId,
      fromKg: slot.weightKg,
      toKg: rec.toKg,
      reason: rec.reason,
      source: 'progression',
      now,
    });
  } else if (expireOnKeep) {
    await expireOpenChanges(db, slot.id, now);
  }
}

/** Active slots that have working sets (not just warm-ups) in the session, loose ones included. */
async function trainedSlots(db: Db, session: Session): Promise<Slot[]> {
  const sets = (await listSets(db, session.id)).filter((s) => !s.isWarmup);
  const slots =
    session.routineId !== null ? await listSlots(db, session.routineId) : await listSlotsByIds(db, looseSlotIds(sets, null), true);
  return slots.filter((slot) => sets.some((s) => s.slotId === slot.id));
}

/**
 * Closes the session and stores one pending recommendation per trained slot.
 * Slot weights are never changed here (PLAN.md §6.2).
 */
export async function finishSession(
  db: Db,
  sessionId: number,
  settings: ProgressionSettings,
  now = Date.now(),
): Promise<'finished' | 'discarded' | null> {
  const session = await getSession(db, sessionId);
  if (!session || session.status !== 'in_progress') return null;
  // A loose session with nothing done leaves nothing behind.
  if (session.routineId === null && (await listSets(db, sessionId)).length === 0) {
    await discardSession(db, sessionId);
    return 'discarded';
  }
  const slots = await trainedSlots(db, session);

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE workout_session
       SET status = 'finished', finished_at = ?, rest_ends_at = NULL, rest_notification_id = NULL, current_slot_id = NULL
       WHERE id = ?`,
      now,
      sessionId,
    );
    for (const slot of slots) await proposeForSlot(db, slot, sessionId, settings, now, session.routineId !== null);
  });
  return 'finished';
}

/**
 * After correcting a finished session, redoes its recommendations. Only for slots where it is still
 * the latest session and whose recommendation from it was not already applied.
 */
export async function refreshRecommendations(
  db: Db,
  sessionId: number,
  settings: ProgressionSettings,
  now = Date.now(),
): Promise<void> {
  const session = await getSession(db, sessionId);
  if (!session || session.status !== 'finished') return;
  // Exercises whose sets were all deleted no longer back a recommendation.
  await db.runAsync(
    `UPDATE weight_change SET status = 'expired', decided_at = ?
     WHERE session_id = ? AND status IN ('pending', 'dismissed')
       AND slot_id NOT IN (SELECT slot_id FROM set_log WHERE session_id = ? AND slot_id IS NOT NULL AND is_warmup = 0)`,
    now,
    sessionId,
    sessionId,
  );
  for (const slot of await trainedSlots(db, session)) {
    const latest = (await slotHistory(db, slot.id, 1))[0];
    if (latest?.sessionId !== sessionId) continue;
    const applied = await db.getFirstAsync<{ id: number }>(
      `SELECT id FROM weight_change WHERE slot_id = ? AND session_id = ? AND status = 'applied'`,
      slot.id,
      sessionId,
    );
    if (applied) continue;
    await db.withTransactionAsync(() => proposeForSlot(db, slot, sessionId, settings, now, session.routineId !== null));
  }
}

/** Deletes a finished session; recommendations that came from it are dropped. */
export async function deleteFinishedSession(db: Db, sessionId: number, now = Date.now()): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE weight_change SET status = 'expired', decided_at = ?
       WHERE session_id = ? AND status IN ('pending', 'dismissed')`,
      now,
      sessionId,
    );
    await db.runAsync('DELETE FROM set_log WHERE session_id = ?', sessionId);
    await db.runAsync('DELETE FROM workout_session WHERE id = ?', sessionId);
  });
}

export async function updateSetWeight(db: Db, setId: number, weightKg: number | null): Promise<void> {
  await db.runAsync('UPDATE set_log SET weight_kg = ? WHERE id = ?', weightKg, setId);
}

/** An empty title goes back to the routine name. */
export async function setSessionTitle(db: Db, sessionId: number, title: string): Promise<void> {
  await db.runAsync('UPDATE workout_session SET title = ? WHERE id = ?', title.trim() || null, sessionId);
}

export async function discardSession(db: Db, sessionId: number): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM set_log WHERE session_id = ?', sessionId);
    await db.runAsync('DELETE FROM workout_session WHERE id = ?', sessionId);
  });
}

export interface SessionSummaryRow {
  id: number;
  routineId: number | null;
  date: string;
  routineName: string | null;
  title: string | null;
  startedAt: number;
  finishedAt: number | null;
  imported: boolean;
  setCount: number;
  looseFirst: string | null;
  looseCount: number;
}

const SUMMARY_SELECT = `
  SELECT ws.id, ws.routine_id AS routineId, ws.date, r.name AS routineName, ws.title, ws.started_at AS startedAt,
         ws.finished_at AS finishedAt, ws.imported,
         (SELECT COUNT(*) FROM set_log sl WHERE sl.session_id = ws.id AND sl.is_warmup = 0) AS setCount,
         ${LOOSE_COLUMNS.replace(' AS loose_first', ' AS looseFirst').replace(' AS loose_count', ' AS looseCount')}
  FROM workout_session ws LEFT JOIN routine r ON r.id = ws.routine_id`;

type SummaryRow = Omit<SessionSummaryRow, 'imported'> & { imported: number };
const toSummary = (r: SummaryRow): SessionSummaryRow => ({ ...r, imported: bool(r.imported) });

export async function listFinishedSessions(db: Db, limit = 100): Promise<SessionSummaryRow[]> {
  const rows = await db.getAllAsync<SummaryRow>(`${SUMMARY_SELECT} WHERE ws.status = 'finished' ORDER BY ws.started_at DESC LIMIT ?`, limit);
  return rows.map(toSummary);
}

/** Every workout finished on a date (routines and loose ones, the same routine twice too), by start. */
export async function finishedSessionsOn(db: Db, date: string): Promise<SessionSummaryRow[]> {
  const rows = await db.getAllAsync<SummaryRow>(
    `${SUMMARY_SELECT} WHERE ws.status = 'finished' AND ws.imported = 0 AND ws.date = ? ORDER BY ws.started_at`,
    date,
  );
  return rows.map(toSummary);
}

/** Starting or continuing a workout goes straight to the set to do next (see slotToOpen). */
export async function openNextSet(db: Db, sessionId: number): Promise<void> {
  const session = await getSession(db, sessionId);
  if (!session || session.status !== 'in_progress') return;
  const sets = await listSets(db, sessionId);
  const slots = await sessionSlots(db, session, sets);
  const slotId = slotToOpen(
    slots.map((s) => ({ slotId: s.id, sets: s.sets })),
    sets,
    session.skippedSlotIds,
    session.currentSlotId,
    session.restEndsAt !== null,
  );
  if (slotId !== null && slotId !== session.currentSlotId) await updateSessionState(db, sessionId, { currentSlotId: slotId });
}
