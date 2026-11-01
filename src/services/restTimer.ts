import * as Notifications from 'expo-notifications';
import { startRestCountdown, stopRestCountdown } from '../../modules/rest-timer';
import { REST_CHANNEL_ID, REST_SOUND } from './notifications';

const restId = (sessionId: number) => `rest-${sessionId}`;

/**
 * Lets the OS fire the rest-end alarm at `endsAt`, so it rings with the screen locked or the
 * app killed (PLAN.md §6.5). `alarmClock` maps to AlarmManager.setAlarmClock(), which Doze
 * does not defer. Meanwhile a native service shows the countdown on the lock screen and, if
 * `overlay` is on, as a floating bubble over other apps.
 */
export async function scheduleRestEnd(
  sessionId: number,
  endsAt: number,
  body: string,
  overlay: boolean,
): Promise<string> {
  await cancelRestEnd(sessionId);
  startRestCountdown(endsAt, 'Descanso', body, overlay);
  return Notifications.scheduleNotificationAsync({
    identifier: restId(sessionId),
    content: {
      title: '¡Descanso terminado!',
      body,
      sound: REST_SOUND,
      vibrate: [0, 400, 200, 400, 200, 700],
      priority: Notifications.AndroidNotificationPriority.MAX,
      data: { url: `/workout/${sessionId}` },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: endsAt,
      channelId: REST_CHANNEL_ID,
      delivery: 'alarmClock',
    },
  });
}

export async function cancelRestEnd(sessionId: number): Promise<void> {
  stopRestCountdown();
  await Notifications.cancelScheduledNotificationAsync(restId(sessionId)).catch(() => undefined);
  await Notifications.dismissNotificationAsync(restId(sessionId)).catch(() => undefined);
}

export const restDeadline = (seconds: number, now = Date.now()) => now + seconds * 1000;

/** Moves a running rest by `deltaSeconds`, never into the past. */
export const shiftDeadline = (endsAt: number, deltaSeconds: number, now = Date.now()) =>
  Math.max(now + 1000, endsAt + deltaSeconds * 1000);

/** Rest alarm in 10 s for the settings diagnostics; session 0 never exists. */
export const scheduleTestRest = (overlay: boolean) =>
  scheduleRestEnd(0, restDeadline(10), 'Prueba: bloquea el móvil o sal de la app', overlay);
