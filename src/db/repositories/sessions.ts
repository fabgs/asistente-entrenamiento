import { recommend } from '@/domain/progression';
import { localDateString } from '@/domain/schedule';
import type { ProgressionSettings, SessionPerformance } from '@/domain/types';
import { bool, type Db } from '../db';
import { listSlots, slotRule, type Slot } from './routines';
import { createRecommendation, expireOpenChanges } from './weightChanges';

export type SessionStatus = 'in_progress' | 'finished' | 'abandoned';

export interface Session {
  id: number;
  routineId: number | null;
  routineName: string | null;
  date: string;
  startedAt: number;
  finishedAt: number | null;
  status: SessionStatus;
  imported: boolean;
  restEndsAt: number | null;
  restNotificationId: string | null;
  currentSlotId: number | null;
  skippedSlotIds: number[];
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
  completedAt: number;
}

interface SessionRow {
  id: number;
  routine_id: number | null;
  routine_name: string | null;
  date: string;
  started_at: number;
  finished_at: number | null;
  status: SessionStatus;
  imported: number;
  rest_ends_at: number | null;
  rest_notification_id: string | null;
  current_slot_id: number | null;
  skipped_slot_ids: string;
}

const SESSION_SELECT = `
  SELECT ws.*, r.name AS routine_name
  FROM workout_session ws LEFT JOIN routine r ON r.id = ws.routine_id`;

function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    routineId: row.routine_id,
    routineName: row.routine_name,
    date: row.date,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status,
    imported: bool(row.imported),
    restEndsAt: row.rest_ends_at,
    restNotificationId: row.rest_notification_id,
    currentSlotId: row.current_slot_id,
    skippedSlotIds: JSON.parse(row.skipped_slot_ids) as number[],
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
         weight_kg AS weightKg, reps, is_extra AS isExtra, completed_at AS completedAt
  FROM set_log`;

type SetRow = Omit<SetLog, 'isExtra'> & { isExtra: number };
const toSet = (row: SetRow): SetLog => ({ ...row, isExtra: bool(row.isExtra) });

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
    'SELECT COUNT(*) AS n FROM set_log WHERE session_id = ? AND slot_id = ?',
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

export async function updateSetReps(db: Db, setId: number, reps: number): Promise<void> {
  await db.runAsync('UPDATE set_log SET reps = ? WHERE id = ?', reps, setId);
}

export async function deleteSet(db: Db, setId: number): Promise<void> {
  const set = await db.getFirstAsync<{ session_id: number; slot_id: number | null }>(
    'SELECT session_id, slot_id FROM set_log WHERE id = ?',
    setId,
  );
  if (!set) return;
  await db.runAsync('DELETE FROM set_log WHERE id = ?', setId);
  const remaining = await db.getAllAsync<{ id: number }>(
    'SELECT id FROM set_log WHERE session_id = ? AND slot_id IS ? ORDER BY completed_at, id',
    set.session_id,
    set.slot_id,
  );
  for (const [i, s] of remaining.entries()) {
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
     WHERE sl.slot_id = ? AND ws.status = 'finished'
       AND sl.session_id IN (
         SELECT DISTINCT s2.session_id FROM set_log s2 JOIN workout_session w2 ON w2.id = s2.session_id
         WHERE s2.slot_id = ? AND w2.status = 'finished'
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

/** Reps of the latest finished session of a slot, to prefill the inputs. */
export async function lastReps(db: Db, slotId: number): Promise<number[]> {
  return (await slotHistory(db, slotId, 1))[0]?.reps ?? [];
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
): Promise<void> {
  const session = await getSession(db, sessionId);
  if (!session || session.status !== 'in_progress') return;
  const sets = await listSets(db, sessionId);
  const slots = session.routineId ? await listSlots(db, session.routineId) : [];

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE workout_session
       SET status = 'finished', finished_at = ?, rest_ends_at = NULL, rest_notification_id = NULL, current_slot_id = NULL
       WHERE id = ?`,
      now,
      sessionId,
    );
    for (const slot of slots) {
      if (!sets.some((s) => s.slotId === slot.id)) continue;
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
      } else {
        await expireOpenChanges(db, slot.id, now);
      }
    }
  });
}

export async function discardSession(db: Db, sessionId: number): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM set_log WHERE session_id = ?', sessionId);
    await db.runAsync('DELETE FROM workout_session WHERE id = ?', sessionId);
  });
}

export interface SessionSummaryRow {
  id: number;
  date: string;
  routineName: string | null;
  startedAt: number;
  finishedAt: number | null;
  imported: boolean;
  setCount: number;
}

export async function listFinishedSessions(db: Db, limit = 100): Promise<SessionSummaryRow[]> {
  const rows = await db.getAllAsync<Omit<SessionSummaryRow, 'imported'> & { imported: number }>(
    `SELECT ws.id, ws.date, r.name AS routineName, ws.started_at AS startedAt, ws.finished_at AS finishedAt,
            ws.imported, (SELECT COUNT(*) FROM set_log sl WHERE sl.session_id = ws.id) AS setCount
     FROM workout_session ws LEFT JOIN routine r ON r.id = ws.routine_id
     WHERE ws.status = 'finished'
     ORDER BY ws.started_at DESC LIMIT ?`,
    limit,
  );
  return rows.map((r) => ({ ...r, imported: bool(r.imported) }));
}
