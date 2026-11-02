import { formatCardioResult } from '@/domain/format';
import { activeMs } from '@/domain/gps';
import type { ExerciseSession } from '@/domain/progress';
import { bool, type Db } from '../db';
import type { WeightChange } from './weightChanges';

/** Finished sessions that include the exercise (any routine), newest first. */
export async function exerciseSessions(db: Db, exerciseId: number): Promise<ExerciseSession[]> {
  const rows = await db.getAllAsync<{
    session_id: number;
    date: string;
    started_at: number;
    imported: number;
    routine_name: string | null;
    weight_kg: number | null;
    reps: number;
  }>(
    `SELECT sl.session_id, ws.date, ws.started_at, ws.imported, r.name AS routine_name, sl.weight_kg, sl.reps
     FROM set_log sl
     JOIN workout_session ws ON ws.id = sl.session_id
     LEFT JOIN routine r ON r.id = ws.routine_id
     WHERE sl.exercise_id = ? AND ws.status = 'finished'
     ORDER BY ws.started_at DESC, sl.completed_at, sl.id`,
    exerciseId,
  );
  const sessions = new Map<number, ExerciseSession>();
  for (const r of rows) {
    const session = sessions.get(r.session_id) ?? {
      sessionId: r.session_id,
      date: r.date,
      startedAt: r.started_at,
      routineName: r.routine_name,
      imported: bool(r.imported),
      sets: [],
    };
    session.sets.push({ weightKg: r.weight_kg, reps: r.reps });
    sessions.set(r.session_id, session);
  }
  return [...sessions.values()];
}

export interface ExerciseOverview {
  id: number;
  name: string;
  sessions: number;
  lastDate: string;
  topWeightKg: number | null;
}

export async function exercisesWithHistory(db: Db): Promise<ExerciseOverview[]> {
  return db.getAllAsync<ExerciseOverview>(
    `SELECT e.id, e.name, COUNT(DISTINCT ws.id) AS sessions, MAX(ws.date) AS lastDate,
            NULLIF(MAX(COALESCE(sl.weight_kg, 0)), 0) AS topWeightKg
     FROM exercise e
     JOIN set_log sl ON sl.exercise_id = e.id
     JOIN workout_session ws ON ws.id = sl.session_id AND ws.status = 'finished'
     GROUP BY e.id
     ORDER BY lastDate DESC, e.name COLLATE NOCASE`,
  );
}

export type ExerciseWeightChange = WeightChange & { routineName: string };

/** Decided weight changes (applied, ignored or manual) of every routine slot using the exercise. */
export async function exerciseWeightChanges(db: Db, exerciseId: number, limit = 20): Promise<ExerciseWeightChange[]> {
  return db.getAllAsync<ExerciseWeightChange>(
    `SELECT wc.id, wc.slot_id AS slotId, wc.session_id AS sessionId, wc.from_kg AS fromKg, wc.to_kg AS toKg,
            wc.reason, wc.source, wc.status, wc.created_at AS createdAt, wc.decided_at AS decidedAt,
            r.name AS routineName
     FROM weight_change wc
     JOIN routine_slot s ON s.id = wc.slot_id
     JOIN routine r ON r.id = s.routine_id
     WHERE s.exercise_id = ? AND wc.status IN ('applied', 'dismissed')
     ORDER BY COALESCE(wc.decided_at, wc.created_at) DESC
     LIMIT ?`,
    exerciseId,
    limit,
  );
}

export interface CardioDay {
  date: string;
  /** `route` is the encoded GPS route of the session, if it had one. */
  activities: { name: string; value: string | null; sessionId: number | null; route: string | null }[];
}

/**
 * Cardio done per day, newest first. Every finished session is its own entry (two walks on one day
 * are two walks); activities only checked off come from the log.
 */
export async function cardioHistory(db: Db, limitDays = 60): Promise<CardioDay[]> {
  const sessions = await db.getAllAsync<{
    id: number;
    date: string;
    name: string;
    started_at: number;
    finished_at: number;
    paused_ms: number;
    distance_m: number | null;
    route: string | null;
  }>(
    `SELECT id, date, name, started_at, finished_at, paused_ms, distance_m, route FROM cardio_session
     WHERE status = 'finished' ORDER BY started_at`,
  );
  const checked = await db.getAllAsync<{ date: string; name: string; value: string | null }>(
    `SELECT date, name, value FROM cardio_log
     WHERE done = 1 AND (session_id IS NULL OR session_id NOT IN (SELECT id FROM cardio_session WHERE status = 'finished'))
     ORDER BY id`,
  );
  const days = new Map<string, CardioDay>();
  const add = (date: string, activity: CardioDay['activities'][number]) => {
    const day = days.get(date) ?? { date, activities: [] };
    day.activities.push(activity);
    days.set(date, day);
  };
  for (const c of checked) add(c.date, { name: c.name, value: c.value, sessionId: null, route: null });
  for (const s of sessions) {
    const active = activeMs(
      { startedAt: s.started_at, finishedAt: s.finished_at, pausedAt: null, pausedMs: s.paused_ms },
      s.finished_at,
    );
    add(s.date, { name: s.name, value: formatCardioResult(s.distance_m, active), sessionId: s.id, route: s.route });
  }
  return [...days.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, limitDays);
}
