import * as Notifications from 'expo-notifications';
import type { FollowResult } from '@/db/repositories/cardioSessions';
import { followNotice } from '@/domain/routeFollow';
import { ROUTE_BACK_CHANNEL_ID, ROUTE_OFF_CHANNEL_ID } from './notifications';

const identifier = (sessionId: number) => `route-${sessionId}`;

/**
 * The alert of a route being followed (PLAN.md §6.8, 1.4.9), shown at once, also from the GPS task
 * with the screen locked or the app closed. «De vuelta» replaces «Te has salido» (same identifier).
 * No `sound: false` in the content: expo would make it silent and the channel's vibration is lost.
 */
export async function notifyFollow({ sessionId, routeName, event, view }: FollowResult): Promise<void> {
  if (!event) return;
  const { title, body } = followNotice(event, view, routeName);
  await Notifications.scheduleNotificationAsync({
    identifier: identifier(sessionId),
    content: { title, body, data: { url: `/cardio-sesion/${sessionId}` } },
    trigger: { channelId: event === 'back' ? ROUTE_BACK_CHANNEL_ID : ROUTE_OFF_CHANNEL_ID },
  });
}

/** Removes it: finished, discarded, paused, no longer followed, the alert switched off or the route deleted. */
export async function dismissRouteAlert(sessionId: number): Promise<void> {
  await Notifications.dismissNotificationAsync(identifier(sessionId)).catch(() => undefined);
}
