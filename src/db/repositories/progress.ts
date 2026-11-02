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

export async function cardioHistory(db: Db, limitDays = 60): Promise<CardioDay[]> {
  const rows = await db.getAllAsync<{
    date: string;
    name: string;
    value: string | null;
    session_id: number | null;
    route: string | null;
  }>(
    `SELECT cl.date, cl.name, cl.value, cl.session_id, cs.route FROM cardio_log cl
     LEFT JOIN cardio_session cs ON cs.id = cl.session_id
     WHERE cl.done = 1 AND cl.date IN (SELECT DISTINCT date FROM cardio_log WHERE done = 1 ORDER BY date DESC LIMIT ?)
     ORDER BY cl.date DESC, cl.id`,
    limitDays,
  );
  const days = new Map<string, CardioDay>();
  for (const r of rows) {
    const day = days.get(r.date) ?? { date: r.date, activities: [] };
    day.activities.push({ name: r.name, value: r.value, sessionId: r.session_id, route: r.route });
    days.set(r.date, day);
  }
  return [...days.values()];
}
