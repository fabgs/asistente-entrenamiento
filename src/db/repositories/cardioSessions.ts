import { parsePlan, type CardioPlan } from '@/domain/cardioPlan';
import { formatCardioResult } from '@/domain/format';
import {
  activeMs,
  buildSamples,
  decodeRoute,
  decodeSamples,
  encodeRoute,
  encodeSamples,
  summarizeTrack,
  type TrackPoint,
  type TrackSample,
} from '@/domain/gps';
import {
  buildFollowLine,
  followStep,
  followView,
  parseFollowState,
  type FollowEvent,
  type FollowLine,
  type FollowState,
  type FollowView,
} from '@/domain/routeFollow';
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
  /** The saved route chosen to follow (1.4.9), kept after the walk for its grey line. */
  followRouteId: number | null;
  /** Where on that route the GPS task last placed the walker; null once finished. */
  followState: FollowState | null;
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
  follow_route_id: number | null;
  follow_state: string | null;
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
  followRouteId: r.follow_route_id,
  followState: parseFollowState(r.follow_state),
});

/** `followRouteId`: a walk that follows a saved route from the start (1.4.9). */
export async function startCardioSession(
  db: Db,
  activity: CardioActivity,
  now = Date.now(),
  followRouteId: number | null = null,
): Promise<number> {
  if (activity.tracking === 'check') throw new Error('This activity is only checked off');
  const sprints = activity.tracking === 'sprint';
  const plan = sprints ? (activity.sprint ?? DEFAULT_SPRINT_PLAN) : activity.tracking === 'timer' ? activity.plan : null;
  const result = await db.runAsync(
    `INSERT INTO cardio_session (activity_id, name, date, tracking, started_at, plan, laps, follow_route_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    activity.id,
    activity.name,
    localDateString(new Date(now)),
    activity.tracking,
    now,
    plan ? JSON.stringify(plan) : null,
    sprints ? '[]' : null,
    activity.tracking === 'gps' ? followRouteId : null,
  );
  return result.lastInsertRowId;
}

/**
 * Starts (or stops, with null) following a route on a walk being recorded, with the detector's state
 * to put back (undoing «Dejar de seguir»); a new route starts from scratch.
 */
export async function setFollowRoute(db: Db, sessionId: number, routeId: number | null, state: FollowState | null = null): Promise<void> {
  await db.runAsync(
    `UPDATE cardio_session SET follow_route_id = ?, follow_state = ? WHERE id = ? AND status = 'in_progress' AND tracking = 'gps'`,
    routeId,
    routeId !== null && state ? JSON.stringify(state) : null,
    sessionId,
  );
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

/** What a batch of fixes did to a route being followed, for the GPS task to alert. */
export interface FollowResult {
  sessionId: number;
  routeName: string;
  event: FollowEvent | null;
  view: FollowView;
}

// The task runs every 3 s: the followed route is decoded once, until it changes (ids come back after a restore).
let followLine: { key: string; line: FollowLine } | null = null;

function lineFor(routeId: number, createdAt: number, path: string): FollowLine {
  const key = `${routeId}:${createdAt}`;
  if (followLine?.key !== key) followLine = { key, line: buildFollowLine(decodeRoute(path)) };
  return followLine.line;
}

/**
 * Stores fixes from the background GPS task in the running (not paused) GPS or sprints session and,
 * on a walk that follows a route, moves its detector on (PLAN.md §6.8): its state is saved in the
 * session, and the result says what to alert. A failure of the detector never loses the points.
 */
export async function storeTrackPoints(
  db: Db,
  points: NewPoint[],
  now = Date.now(),
): Promise<{ stored: number; follow: FollowResult | null }> {
  const session = await db.getFirstAsync<{
    id: number;
    segment: number;
    started_at: number;
    follow_route_id: number | null;
    follow_state: string | null;
    path: string | null;
    route_name: string | null;
    route_created: number | null;
    route_alert: number | null;
  }>(
    `SELECT s.id, s.segment, s.started_at, s.follow_route_id, s.follow_state,
            r.path, r.name AS route_name, r.created_at AS route_created,
            (SELECT route_alert FROM settings WHERE id = 1) AS route_alert
     FROM cardio_session s LEFT JOIN route r ON r.id = s.follow_route_id
     WHERE s.status = 'in_progress' AND s.tracking IN ('gps', 'sprint') AND s.paused_at IS NULL
     ORDER BY s.started_at DESC LIMIT 1`,
  );
  if (!session) return { stored: 0, follow: null };
  // Android may deliver a cached fix from before the start.
  const fresh = points.filter((p) => p.t >= session.started_at - 5_000);
  let follow: FollowResult | null = null;
  let followJson: string | null = null;
  if (session.follow_route_id !== null && session.path && session.route_created !== null && fresh.length > 0) {
    try {
      const line = lineFor(session.follow_route_id, session.route_created, session.path);
      const { state, event } = followStep(line, parseFollowState(session.follow_state), fresh, now, session.route_alert !== 0);
      followJson = JSON.stringify(state);
      follow = { sessionId: session.id, routeName: session.route_name ?? '', event, view: followView(state, line) };
    } catch (e) {
      console.warn('Could not follow the route', e);
    }
  }
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
  if (followJson !== null) {
    // Only if it still follows that route: «Dejar de seguir» may have come in the meantime.
    await db.runAsync(
      'UPDATE cardio_session SET follow_state = ? WHERE id = ? AND follow_route_id = ?',
      followJson,
      session.id,
      session.follow_route_id,
    );
  }
  return { stored: fresh.length, follow };
}

/** Stores fixes (see `storeTrackPoints`): how many, none when nothing is being recorded. */
export async function addTrackPoints(db: Db, points: NewPoint[]): Promise<number> {
  return (await storeTrackPoints(db, points)).stored;
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
       SET status = 'finished', finished_at = ?, paused_at = NULL, distance_m = ?, route = ?, samples = ?, follow_state = NULL
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
