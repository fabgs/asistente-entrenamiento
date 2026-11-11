import { useEffect, useMemo, useRef } from 'react';
import { getCardioSession, lastTrackPoint, listSprintFixes, listTrackPoints, sprintLapFixes, type LastFix } from '@/db/repositories/cardioSessions';
import { hintsSeen } from '@/db/repositories/hints';
import { listPhotos } from '@/db/repositories/photos';
import { followedRoute, routeCount, walkRoute, type SavedRoute } from '@/db/repositories/routes';
import { getSettings } from '@/db/repositories/settings';
import { buildFollowLine, followView, routeAhead, type FollowState } from '@/domain/routeFollow';
import { routeEnds } from '@/domain/routes';
import { LAP_FIXES_MARGIN_MS, LAP_FIXES_TAIL_MS, measureSprint, sprintTraces, type SprintMeasure } from '@/domain/sprint';
import { isGpsRecording, storeSprintGnss } from '@/services/gpsTracker';
import { isOnPhone } from '@/services/photos';
import { useLoader } from './data';

/** What the live sprints screen reads besides the session: the GPS and each sprint measured so far. */
export interface SprintLive {
  lastFix: LastFix | null;
  gpsOn: boolean;
  /** Aligned with the laps; null for the open one. */
  measures: (SprintMeasure | null)[];
}

/**
 * A cardio session with its photos, its route and the settings its screens use. While a GPS session is
 * recording, its points come too and everything is read again every 3 s: the background task
 * stores the fixes. Sprints in progress are read every second, with each finished sprint measured
 * from its fixes.
 */
export function useCardioSession(sessionId: number) {
  // Sprints already settled are not measured again on every read.
  const settled = useRef(new Map<string, SprintMeasure>());
  const { data, reload } = useLoader(async (db) => {
    const session = await getCardioSession(db, sessionId);
    if (!session) return null;
    const inProgress = session.status === 'in_progress';
    const recording = inProgress && session.tracking === 'gps';
    let sprintLive: SprintLive | null = null;
    if (inProgress && session.tracking === 'sprint') {
      const now = Date.now();
      // The chip's fixes arrive with each fused batch; this brings the ones since then.
      await storeSprintGnss();
      const measures: (SprintMeasure | null)[] = [];
      for (const lap of session.laps) {
        if (lap.stopAt === null) {
          measures.push(null);
          continue;
        }
        const key = `${lap.startAt}:${lap.stopAt}`;
        let measure = settled.current.get(key);
        if (!measure) {
          const fixes = await listSprintFixes(db, sessionId, lap.startAt - LAP_FIXES_MARGIN_MS, lap.stopAt + LAP_FIXES_TAIL_MS);
          measure = measureSprint(fixes, lap.startAt, lap.stopAt, now);
          if (measure.settled) settled.current.set(key, measure);
        }
        measures.push(measure);
      }
      sprintLive = { lastFix: await lastTrackPoint(db, sessionId), gpsOn: await isGpsRecording(), measures };
    }
    return {
      session,
      points: recording ? await listTrackPoints(db, sessionId) : null,
      sprintLive,
      settings: await getSettings(db),
      hints: await hintsSeen(db),
      photos: (await listPhotos(db, { kind: 'cardio', id: sessionId })).filter(isOnPhone),
      // Finished sprints: the path of each one by the GPS chip, over the straight (1.5.2).
      sprintTraces:
        session.status === 'finished' && session.tracking === 'sprint' ? sprintTraces(session.laps, await sprintLapFixes(db, sessionId)) : [],
      // A finished walk: its saved route, or the question about the one it seems to repeat.
      route: session.status === 'finished' && session.tracking === 'gps' ? await walkRoute(db, sessionId) : null,
      // The route it follows (1.4.9), and whether there are any to follow.
      followed: session.followRouteId !== null ? await followedRoute(db, sessionId) : null,
      routes: recording ? await routeCount(db) : 0,
    };
  });

  const every = data?.points ? 3000 : data?.sprintLive ? 1000 : null;
  useEffect(() => {
    if (every === null) return;
    const timer = setInterval(reload, every);
    return () => clearInterval(timer);
  }, [every, reload]);

  return { data, reload };
}

/**
 * The followed route as the GPS task last placed the walker on it: what the line under the figures
 * says, what is left of it to draw (the part walked goes away, 1.4.10) and where it ends.
 */
export function useFollowedRoute(follow: { route: SavedRoute; state: FollowState | null } | null) {
  const key = follow ? `${follow.route.id}:${follow.route.createdAt}` : '';
  // eslint-disable-next-line react-hooks/exhaustive-deps -- a new route object arrives on every reload
  const line = useMemo(() => (follow ? buildFollowLine(follow.route.segments) : null), [key]);
  if (!follow || !line) return null;
  const ends = routeEnds(follow.route.segments);
  const { state } = follow;
  const backwards = (state?.dir || state?.initial) === -1;
  const ahead = routeAhead(follow.route.segments, line, state);
  // The start is a ring only while all of the route is ahead; at its end, nothing is left to mark.
  const whole = ahead === follow.route.segments;
  return {
    view: followView(state, line),
    ahead,
    ends:
      ends && state?.status !== 'done'
        ? { start: whole ? (backwards ? ends.end : ends.start) : null, end: backwards ? ends.start : ends.end }
        : null,
  };
}
