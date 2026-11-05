import { formatCardioResult } from '@/domain/format';
import { activeMs } from '@/domain/gps';
import type { RepUnit } from '@/domain/types';
import type { ExerciseSession } from '@/domain/progress';
import { decodeLaps, formatSprintResult, lapRows, sprintSummary } from '@/domain/sprint';
import { bool, type Db } from '../db';
import { listFinishedSessions, type SessionSummaryRow } from './sessions';
import type { WeightChange } from './weightChanges';

/** Every finished workout, newest first. No limit (−1 in SQLite): the history is a virtualized list. */
export const workoutHistory = (db: Db): Promise<SessionSummaryRow[]> => listFinishedSessions(db, -1);

/** What its sets count (seconds for a hold), from the slots it has been done with most. */
export async function exerciseUnit(db: Db, exerciseId: number): Promise<RepUnit> {
  const row = await db.getFirstAsync<{ unit: RepUnit }>(
    `SELECT rs.unit FROM routine_slot rs LEFT JOIN set_log sl ON sl.slot_id = rs.id
     WHERE rs.exercise_id = ?
     GROUP BY rs.unit ORDER BY COUNT(sl.id) DESC LIMIT 1`,
    exerciseId,
  );
  return row?.unit ?? 'reps';
}

/** Finished sessions that include the exercise (any routine), newest first. */
export async function exerciseSessions(db: Db, exerciseId: number): Promise<ExerciseSession[]> {
  const rows = await db.getAllAsync<{
    session_id: number;
    date: string;
    started_at: number;
    title: string | null;
    imported: number;
    routine_name: string | null;
    weight_kg: number | null;
    reps: number;
  }>(
    `SELECT sl.session_id, ws.date, ws.started_at, ws.title, ws.imported, r.name AS routine_name, sl.weight_kg, sl.reps
     FROM set_log sl
     JOIN workout_session ws ON ws.id = sl.session_id
     LEFT JOIN routine r ON r.id = ws.routine_id
     WHERE sl.exercise_id = ? AND ws.status = 'finished' AND sl.is_warmup = 0
     ORDER BY ws.started_at DESC, sl.completed_at, sl.id`,
    exerciseId,
  );
  const sessions = new Map<number, ExerciseSession>();
  for (const r of rows) {
    const session = sessions.get(r.session_id) ?? {
      sessionId: r.session_id,
      date: r.date,
      startedAt: r.started_at,
      title: r.title,
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
     JOIN set_log sl ON sl.exercise_id = e.id AND sl.is_warmup = 0
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

/** A finished session with GPS, a timer or sprints, or an activity only checked off on Hoy. */
export type CardioKind = 'gps' | 'timer' | 'sprint' | 'check';

export interface CardioEntry {
  /** Unique in the history: 's12' for session 12, 'l40' for checked-off log row 40. */
  key: string;
  date: string;
  /** The title of the session if it has one, otherwise the activity name. */
  name: string;
  kind: CardioKind;
  /** Short result, as on Hoy ("5,14 km · 59 min"); null for an activity only checked off. */
  value: string | null;
  sessionId: number | null;
  /** Encoded GPS route of the session, if it had one. */
  route: string | null;
  startedAt: number | null;
  distanceM: number | null;
  /** Time without the pauses. */
  activeMs: number | null;
  /** A sprints session: how many, the top speed and the best time. */
  sprint: { count: number; topSpeedMs: number | null; bestTimeMs: number | null } | null;
}

export interface CardioDay {
  date: string;
  activities: CardioEntry[];
}

/**
 * Cardio done per day, newest day first; in a day, the activities only checked off come first and
 * then the sessions in the order they were done. Every finished session is its own entry (two
 * walks on one day are two walks).
 */
export async function cardioHistory(db: Db): Promise<CardioDay[]> {
  const sessions = await db.getAllAsync<{
    id: number;
    date: string;
    name: string;
    title: string | null;
    tracking: 'gps' | 'timer' | 'sprint';
    started_at: number;
    finished_at: number;
    paused_ms: number;
    distance_m: number | null;
    route: string | null;
    laps: string | null;
  }>(
    `SELECT id, date, name, title, tracking, started_at, finished_at, paused_ms, distance_m, route, laps FROM cardio_session
     WHERE status = 'finished' ORDER BY started_at`,
  );
  const checked = await db.getAllAsync<{ id: number; date: string; name: string; value: string | null }>(
    `SELECT id, date, name, value FROM cardio_log
     WHERE done = 1 AND (session_id IS NULL OR session_id NOT IN (SELECT id FROM cardio_session WHERE status = 'finished'))
     ORDER BY id`,
  );
  const days = new Map<string, CardioDay>();
  const add = (activity: CardioEntry) => {
    const day = days.get(activity.date) ?? { date: activity.date, activities: [] };
    day.activities.push(activity);
    days.set(activity.date, day);
  };
  for (const c of checked) {
    add({
      key: `l${c.id}`,
      date: c.date,
      name: c.name,
      kind: 'check',
      value: c.value,
      sessionId: null,
      route: null,
      startedAt: null,
      distanceM: null,
      activeMs: null,
      sprint: null,
    });
  }
  for (const s of sessions) {
    const active = activeMs(
      { startedAt: s.started_at, finishedAt: s.finished_at, pausedAt: null, pausedMs: s.paused_ms },
      s.finished_at,
    );
    const laps = s.tracking === 'sprint' ? decodeLaps(s.laps) : null;
    const summary = laps ? sprintSummary(lapRows(laps)) : null;
    add({
      key: `s${s.id}`,
      date: s.date,
      name: s.title ?? s.name,
      kind: s.tracking,
      value: laps ? formatSprintResult(laps) : formatCardioResult(s.distance_m, active),
      sessionId: s.id,
      route: s.route,
      startedAt: s.started_at,
      distanceM: s.distance_m,
      activeMs: active,
      sprint: summary && { count: summary.count, topSpeedMs: summary.topSpeedMs, bestTimeMs: summary.bestTimeMs },
    });
  }
  return [...days.values()].sort((a, b) => b.date.localeCompare(a.date));
}

/** Every cardio activity done, newest first: the latest session of a day before the earlier ones. */
export async function cardioEntries(db: Db): Promise<CardioEntry[]> {
  return (await cardioHistory(db)).flatMap((day) => [...day.activities].reverse());
}
