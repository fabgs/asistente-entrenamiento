import * as Notifications from 'expo-notifications';
import { describePlan, PLAN_KIND_LABEL, planAlarms, planSeconds, type CardioPlan } from '@/domain/cardioPlan';
import { startRestCountdown, stopRestCountdown } from '../../modules/rest-timer';
import { REST_CHANNEL_ID, REST_SOUND } from './notifications';

const prefix = (sessionId: number) => `cardio-${sessionId}-`;

/**
 * Lets the OS ring every phase change of a cardio timer (PLAN.md §6.8): all alarms are scheduled
 * up front with `alarmClock`, so they sound with the screen locked even though JS is paused. The
 * lock-screen countdown shows the time to the end. `planStartMs` is when the plan's clock would
 * have started without pauses.
 */
export async function scheduleCardioTimer(
  sessionId: number,
  name: string,
  plan: CardioPlan,
  planStartMs: number,
  now = Date.now(),
): Promise<void> {
  await cancelCardioTimer(sessionId);
  const endsAt = planStartMs + planSeconds(plan) * 1000;
  if (endsAt <= now) return;
  startRestCountdown(endsAt, name, `${PLAN_KIND_LABEL[plan.kind]} · ${describePlan(plan)}`, false);
  for (const alarm of planAlarms(plan, name, planStartMs, now)) {
    await Notifications.scheduleNotificationAsync({
      identifier: prefix(sessionId) + alarm.key,
      content: {
        title: alarm.title,
        body: alarm.body,
        sound: REST_SOUND,
        vibrate: [0, 400, 200, 400],
        priority: Notifications.AndroidNotificationPriority.MAX,
        data: { url: `/cardio-sesion/${sessionId}` },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: alarm.at,
        channelId: REST_CHANNEL_ID,
        delivery: 'alarmClock',
      },
    });
  }
}

/** Cancels what is left of the timer and clears the phase alarms already shown, except the end. */
export async function cancelCardioTimer(sessionId: number): Promise<void> {
  stopRestCountdown();
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const n of scheduled) {
    if (n.identifier.startsWith(prefix(sessionId))) {
      await Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => undefined);
    }
  }
  for (const n of await Notifications.getPresentedNotificationsAsync()) {
    const id = n.request.identifier;
    if (id.startsWith(prefix(sessionId)) && id !== prefix(sessionId) + 'end') {
      await Notifications.dismissNotificationAsync(id).catch(() => undefined);
    }
  }
}
