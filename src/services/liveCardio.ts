import { Platform } from 'react-native';
import type { Db } from '@/db/db';
import { getActiveCardioSession, listTrackPoints, type CardioSession } from '@/db/repositories/cardioSessions';
import { getActiveSession } from '@/db/repositories/sessions';
import { liveWalk } from '@/domain/liveActivity';
import { walkSnapshot } from '@/domain/walkStats';
import { endLiveActivities, showCardioActivity } from '../../modules/rest-timer';

/** The GPS task refreshes the distance and the pace this often: the time counts by itself. */
const REFRESH_EVERY_MS = 10_000;
let lastRefresh = 0;

/**
 * iOS (1.5.7): the walk being recorded in its Live Activity, with what its fixes say so far. Only
 * a walk (GPS); sprints and phases use the countdown of `rest-timer` itself.
 */
export async function showLiveWalk(db: Db, session: CardioSession, now = Date.now()): Promise<void> {
  if (Platform.OS !== 'ios' || session.tracking !== 'gps' || session.status !== 'in_progress') return;
  const points = await listTrackPoints(db, session.id);
  const numbers = points.length > 0 ? walkSnapshot(session, points, now).numbers : null;
  showCardioActivity(liveWalk(session, numbers, now));
  lastRefresh = now;
}

/** From the GPS task, after storing a batch: at most every REFRESH_EVERY_MS. */
export async function refreshLiveWalk(db: Db, now = Date.now()): Promise<void> {
  if (Platform.OS !== 'ios' || now - lastRefresh < REFRESH_EVERY_MS) return;
  const session = await getActiveCardioSession(db);
  if (session) await showLiveWalk(db, session, now);
}

export function endLiveWalk(): void {
  if (Platform.OS === 'ios') endLiveActivities();
}

/** At start-up: with nothing in progress, a Live Activity left over from before (the app was closed) goes. */
export async function clearStaleLiveActivity(db: Db): Promise<void> {
  if (Platform.OS !== 'ios') return;
  if ((await getActiveSession(db)) || (await getActiveCardioSession(db))) return;
  endLiveActivities();
}
