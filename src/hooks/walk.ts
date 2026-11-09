import { useEffect, useRef } from 'react';
import { getCardioSession, lastTrackPoint, listSprintFixes, listTrackPoints } from '@/db/repositories/cardioSessions';
import { hintsSeen } from '@/db/repositories/hints';
import { listPhotos } from '@/db/repositories/photos';
import { followedRoute, routeCount, walkRoute } from '@/db/repositories/routes';
import { getSettings } from '@/db/repositories/settings';
import { LAP_FIXES_MARGIN_MS, measureSprint, type SprintMeasure } from '@/domain/sprint';
import { isGpsRecording } from '@/services/gpsTracker';
import { isOnPhone } from '@/services/photos';
import { useLoader } from './data';

/** What the live sprints screen reads besides the session: the GPS and each sprint measured so far. */
export interface SprintLive {
  lastFix: { t: number; accuracy: number | null; receivedAt: number | null } | null;
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
      const measures: (SprintMeasure | null)[] = [];
      for (const lap of session.laps) {
        if (lap.stopAt === null) {
          measures.push(null);
          continue;
        }
        const key = `${lap.startAt}:${lap.stopAt}`;
        let measure = settled.current.get(key);
        if (!measure) {
          const fixes = await listSprintFixes(db, sessionId, lap.startAt - LAP_FIXES_MARGIN_MS, lap.stopAt + LAP_FIXES_MARGIN_MS);
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
