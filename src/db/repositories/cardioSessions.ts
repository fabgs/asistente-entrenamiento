import { parsePlan, type CardioPlan } from '@/domain/cardioPlan';
import { formatCardioResult } from '@/domain/format';
import {
  activeMs,
  buildSamples,
  decodeSamples,
  encodeRoute,
  encodeSamples,
  summarizeTrack,
  type TrackPoint,
  type TrackSample,
} from '@/domain/gps';
import { localDateString } from '@/domain/schedule';
import {
  DEFAULT_SPRINT_PLAN,
  decodeLaps,
  encodeLaps,
  formatSprintResult,
  parseSprintPlan,
  type Lap,
  type SprintFix,
  type SprintPlan,
} from '@/domain/sprint';
import type { Db } from '../db';
import type { CardioActivity } from './cardio';

export type CardioSessionTracking = 'gps' | 'timer' | 'sprint';

export interface CardioSession {
  id: number;
  activityId: number | null;
  name: string;
  /** Given by the user (e.g. when sharing); null shows the activity name. */
  title: string | null;
  date: string;
  tracking: CardioSessionTracking;
  status: 'in_progress' | 'finished';
  startedAt: number;
  finishedAt: number | null;
  /** Set while paused. */
  pausedAt: number | null;
  pausedMs: number;
  segment: number;
  plan: CardioPlan | null;
  distanceM: number | null;
  /** Encoded polyline segments of a finished GPS session. */
  route: string | null;
  /** Time, distance and altitude profile of a finished GPS session, for its charts and splits. */
  samples: TrackSample[];
  /** The plan of a sprints session (in the `plan` column, which `plan` above reads as a timer). */
  sprint: SprintPlan | null;
  /** The sprints of the session: its whole state (PLAN.md §6.8). */
  laps: Lap[];
  /** `laps` as stored, for the optimistic writes of `setSprintLaps`. */
  lapsJson: string | null;
}

interface SessionRow {
  id: number;
  activity_id: number | null;
  name: string;
  title: string | null;
  date: string;
  tracking: CardioSessionTracking;
  status: CardioSession['status'];
  started_at: number;
  finished_at: number | null;
  paused_at: number | null;
  paused_ms: number;
  segment: number;
  plan: string | null;
  distance_m: number | null;
  route: string | null;
  samples: string | null;
  laps: string | null;
}

const toSession = (r: SessionRow): CardioSession => ({
  id: r.id,
  activityId: r.activity_id,
  name: r.name,
  title: r.title,
  date: r.date,
  tracking: r.tracking,
  status: r.status,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
  pausedAt: r.paused_at,
  pausedMs: r.paused_ms,
  segment: r.segment,
  plan: parsePlan(r.plan),
  distanceM: r.distance_m,
  route: r.route,
  samples: decodeSamples(r.samples),
  sprint: r.tracking === 'sprint' ? parseSprintPlan(r.plan) : null,
  laps: decodeLaps(r.laps),
  lapsJson: r.laps,
});

export async function startCardioSession(db: Db, activity: CardioActivity, now = Date.now()): Promise<number> {
  if (activity.tracking === 'check') throw new Error('This activity is only checked off');
  const sprints = activity.tracking === 'sprint';
  const plan = sprints ? (activity.sprint ?? DEFAULT_SPRINT_PLAN) : activity.tracking === 'timer' ? activity.plan : null;
  const result = await db.runAsync(
    `INSERT INTO cardio_session (activity_id, name, date, tracking, started_at, plan, laps) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    activity.id,
    activity.name,
    localDateString(new Date(now)),
    activity.tracking,
    now,
    plan ? JSON.stringify(plan) : null,
    sprints ? '[]' : null,
  );
  return result.lastInsertRowId;
}

export async function getCardioSession(db: Db, id: number): Promise<CardioSession | null> {
  const row = await db.getFirstAsync<SessionRow>('SELECT * FROM cardio_session WHERE id = ?', id);
  return row ? toSession(row) : null;
}

export async function getActiveCardioSession(db: Db): Promise<CardioSession | null> {
  const row = await db.getFirstAsync<SessionRow>(
    `SELECT * FROM cardio_session WHERE status = 'in_progress' ORDER BY started_at DESC LIMIT 1`,
  );
  return row ? toSession(row) : null;
}

export interface NewPoint {
  t: number;
  lat: number;
  lon: number;
  accuracy: number | null;
  speed: number | null;
  altitude: number | null;
  /** When the task stored it (diagnosis of clock skew); null in older callers. */
  receivedAt?: number | null;
}

/**
 * Stores fixes from the background GPS task in the running (not paused) GPS or sprints session.
 * Returns how many were stored: none when nothing is being recorded.
 */
export async function addTrackPoints(db: Db, points: NewPoint[]): Promise<number> {
  const session = await db.getFirstAsync<{ id: number; segment: number; started_at: number }>(
    `SELECT id, segment, started_at FROM cardio_session
     WHERE status = 'in_progress' AND tracking IN ('gps', 'sprint') AND paused_at IS NULL
     ORDER BY started_at DESC LIMIT 1`,
  );
  if (!session) return 0;
  // Android may deliver a cached fix from before the start.
  const fresh = points.filter((p) => p.t >= session.started_at - 5_000);
  for (const p of fresh) {
    await db.runAsync(
      `INSERT INTO cardio_point (session_id, segment, t, lat, lon, accuracy, speed, altitude, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      session.id,
      session.segment,
      p.t,
      p.lat,
      p.lon,
      p.accuracy,
      p.speed,
      p.altitude,
      p.receivedAt ?? null,
    );
  }
  return fresh.length;
}

export async function listTrackPoints(db: Db, sessionId: number): Promise<TrackPoint[]> {
  return db.getAllAsync<TrackPoint>(
    'SELECT t, lat, lon, accuracy, altitude, segment FROM cardio_point WHERE session_id = ? ORDER BY t, id',
    sessionId,
  );
}

export async function pauseCardioSession(db: Db, id: number, now = Date.now()): Promise<void> {
  await db.runAsync(
    `UPDATE cardio_session SET paused_at = ? WHERE id = ? AND paused_at IS NULL AND status = 'in_progress'`,
    now,
    id,
  );
}

/** Resumes after a pause; GPS fixes from now on go to a new segment. */
export async function resumeCardioSession(db: Db, id: number, now = Date.now()): Promise<void> {
  await db.runAsync(
    `UPDATE cardio_session
     SET paused_ms = paused_ms + (? - paused_at), paused_at = NULL, segment = segment + 1
     WHERE id = ? AND paused_at IS NOT NULL AND status = 'in_progress'`,
    now,
    id,
  );
}

/**
 * Closes the session, keeps the route compressed (its points are deleted) and marks the activity
 * as done today with a short result, e.g. "5,23 km · 58 min".
 */
export async function finishCardioSession(db: Db, id: number, now = Date.now()): Promise<void> {
  const session = await getCardioSession(db, id);
  if (!session || session.status !== 'in_progress') return;
  const finishedAt = session.pausedAt ?? now;
  const active = activeMs({ ...session, finishedAt, pausedAt: null }, finishedAt);
  let distance: number | null = null;
  let route: string | null = null;
  let samples: string | null = null;
  if (session.tracking === 'gps') {
    const summary = summarizeTrack(await listTrackPoints(db, id), finishedAt);
    distance = summary.distanceM;
    route = encodeRoute(summary.segments) || null;
    samples = summary.segments.length > 0 ? encodeSamples(buildSamples(summary.segments, session.startedAt)) : null;
  }
  const value = formatCardioResult(distance, active);

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE cardio_session
       SET status = 'finished', finished_at = ?, paused_at = NULL, distance_m = ?, route = ?, samples = ?
       WHERE id = ?`,
      finishedAt,
      distance,
      route,
      samples,
      id,
    );
    await db.runAsync('DELETE FROM cardio_point WHERE session_id = ?', id);
    await db.runAsync(
      `INSERT INTO cardio_log (date, activity_id, name, done, value, session_id) VALUES (?, ?, ?, 1, ?, ?)
       ON CONFLICT(date, activity_id) DO UPDATE SET done = 1, value = excluded.value, session_id = excluded.session_id`,
      session.date,
      session.activityId,
      session.name,
      value,
      id,
    );
  });
}

/**
 * Writes the laps of a sprints session only if they are still what was read: the second write of a
 * double tap finds them changed and does nothing. True when it wrote.
 */
export async function setSprintLaps(db: Db, id: number, expected: string | null, next: string): Promise<boolean> {
  const result = await db.runAsync(
    `UPDATE cardio_session SET laps = ? WHERE id = ? AND status = 'in_progress' AND laps IS ?`,
    next,
    id,
    expected,
  );
  return result.changes === 1;
}

/** Fixes of a session between two instants, with their Doppler speed. */
export async function listSprintFixes(db: Db, id: number, from: number, to: number): Promise<SprintFix[]> {
  return db.getAllAsync<SprintFix>(
    `SELECT t, lat, lon, accuracy, speed, received_at AS receivedAt FROM cardio_point
     WHERE session_id = ? AND t BETWEEN ? AND ? ORDER BY t, id`,
    id,
    from,
    to,
  );
}

export async function lastTrackPoint(db: Db, id: number): Promise<{ t: number; accuracy: number | null; receivedAt: number | null } | null> {
  return db.getFirstAsync(
    'SELECT t, accuracy, received_at AS receivedAt FROM cardio_point WHERE session_id = ? ORDER BY t DESC, id DESC LIMIT 1',
    id,
  );
}

/**
 * Closes a sprints session with its measured laps and the fixes around each sprint (to measure it
 * again some day), deletes its points and marks the activity as done today («6 sprints · máx. …»).
 */
export async function finishSprintSession(db: Db, id: number, finishedAt: number, laps: Lap[], lapFixes: string | null): Promise<void> {
  const session = await getCardioSession(db, id);
  if (!session || session.status !== 'in_progress') return;
  const distances = laps.map((l) => l.distanceM).filter((d): d is number => d !== null);
  const distance = distances.length > 0 ? distances.reduce((sum, d) => sum + d, 0) : null;
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE cardio_session
       SET status = 'finished', finished_at = ?, paused_at = NULL, distance_m = ?, route = NULL, samples = NULL, laps = ?, lap_fixes = ?
       WHERE id = ?`,
      finishedAt,
      distance,
      encodeLaps(laps),
      lapFixes,
      id,
    );
    await db.runAsync('DELETE FROM cardio_point WHERE session_id = ?', id);
    await db.runAsync(
      `INSERT INTO cardio_log (date, activity_id, name, done, value, session_id) VALUES (?, ?, ?, 1, ?, ?)
       ON CONFLICT(date, activity_id) DO UPDATE SET done = 1, value = excluded.value, session_id = excluded.session_id`,
      session.date,
      session.activityId,
      session.name,
      formatSprintResult(laps),
      id,
    );
  });
}

/** An empty title goes back to the activity name. */
export async function setCardioTitle(db: Db, id: number, title: string): Promise<void> {
  await db.runAsync('UPDATE cardio_session SET title = ? WHERE id = ?', title.trim() || null, id);
}

export async function discardCardioSession(db: Db, id: number): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM cardio_point WHERE session_id = ?', id);
    // Its day's log goes too: «Hecho» on Hoy must not keep a cardio that is no longer anywhere.
    await db.runAsync('DELETE FROM cardio_log WHERE session_id = ?', id);
    await db.runAsync('DELETE FROM photo WHERE cardio_session_id = ?', id);
    await db.runAsync('DELETE FROM cardio_session WHERE id = ?', id);
  });
}
