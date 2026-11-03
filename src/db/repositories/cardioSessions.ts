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
import type { Db } from '../db';
import type { CardioActivity } from './cardio';

export type CardioSessionTracking = 'gps' | 'timer';

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
});

export async function startCardioSession(db: Db, activity: CardioActivity, now = Date.now()): Promise<number> {
  if (activity.tracking === 'check') throw new Error('This activity is only checked off');
  const result = await db.runAsync(
    `INSERT INTO cardio_session (activity_id, name, date, tracking, started_at, plan) VALUES (?, ?, ?, ?, ?, ?)`,
    activity.id,
    activity.name,
    localDateString(new Date(now)),
    activity.tracking,
    now,
    activity.tracking === 'timer' && activity.plan ? JSON.stringify(activity.plan) : null,
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
}

/**
 * Stores fixes from the background GPS task in the running (not paused) GPS session.
 * Returns how many were stored: none when nothing is being recorded.
 */
export async function addTrackPoints(db: Db, points: NewPoint[]): Promise<number> {
  const session = await db.getFirstAsync<{ id: number; segment: number; started_at: number }>(
    `SELECT id, segment, started_at FROM cardio_session
     WHERE status = 'in_progress' AND tracking = 'gps' AND paused_at IS NULL
     ORDER BY started_at DESC LIMIT 1`,
  );
  if (!session) return 0;
  // Android may deliver a cached fix from before the start.
  const fresh = points.filter((p) => p.t >= session.started_at - 5_000);
  for (const p of fresh) {
    await db.runAsync(
      `INSERT INTO cardio_point (session_id, segment, t, lat, lon, accuracy, speed, altitude)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      session.id,
      session.segment,
      p.t,
      p.lat,
      p.lon,
      p.accuracy,
      p.speed,
      p.altitude,
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

/** An empty title goes back to the activity name. */
export async function setCardioTitle(db: Db, id: number, title: string): Promise<void> {
  await db.runAsync('UPDATE cardio_session SET title = ? WHERE id = ?', title.trim() || null, id);
}

export async function discardCardioSession(db: Db, id: number): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM cardio_point WHERE session_id = ?', id);
    await db.runAsync('UPDATE cardio_log SET session_id = NULL WHERE session_id = ?', id);
    await db.runAsync('DELETE FROM cardio_session WHERE id = ?', id);
  });
}
