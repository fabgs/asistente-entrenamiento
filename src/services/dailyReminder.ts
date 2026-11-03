import * as Notifications from 'expo-notifications';
import type { Db } from '@/db/db';
import { listCardio } from '@/db/repositories/cardio';
import { listRoutines, listSlots } from '@/db/repositories/routines';
import { getSettings } from '@/db/repositories/settings';
import { buildDailyMessage, ISO_WEEKDAYS, isoToExpoWeekday, type DayPlan } from '@/domain/schedule';
import type { IsoWeekday } from '@/domain/types';
import { DAILY_CHANNEL_ID } from './notifications';

const dailyId = (weekday: IsoWeekday) => `daily-${weekday}`;

async function buildWeekPlan(db: Db): Promise<DayPlan[]> {
  const routines = await listRoutines(db);
  const counts = new Map<number, number>();
  for (const r of routines) counts.set(r.id, (await listSlots(db, r.id)).length);
  const cardio = await listCardio(db);
  return ISO_WEEKDAYS.map((weekday) => ({
    weekday,
    routines: routines
      .filter((r) => r.weekdays.includes(weekday))
      .map((r) => ({ name: r.name, exerciseCount: counts.get(r.id) ?? 0 })),
    cardio: cardio.filter((c) => c.weekday === weekday).map((c) => ({ name: c.name, target: c.target })),
  }));
}

// Calls run one after another: controls save at once, and two overlapping runs could leave a day
// scheduled twice or not at all.
let queue: Promise<void> = Promise.resolve();

/**
 * Idempotent: replaces the 7 weekly reminders (PLAN.md §7.2). Call it on start-up and after any
 * change to routines, slots, weekdays, cardio or reminder settings.
 */
export function rescheduleDailyReminders(db: Db): Promise<void> {
  queue = queue.catch(() => undefined).then(() => reschedule(db));
  return queue;
}

async function reschedule(db: Db): Promise<void> {
  for (const weekday of ISO_WEEKDAYS) {
    await Notifications.cancelScheduledNotificationAsync(dailyId(weekday)).catch(() => undefined);
  }
  const settings = await getSettings(db);
  if (!settings.dailyReminderEnabled) return;

  const [hour, minute] = settings.dailyReminderTime.split(':').map(Number);
  for (const day of await buildWeekPlan(db)) {
    const { title, body } = buildDailyMessage(day);
    await Notifications.scheduleNotificationAsync({
      identifier: dailyId(day.weekday),
      content: { title, body, data: { url: '/' } },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
        weekday: isoToExpoWeekday(day.weekday),
        hour,
        minute,
        channelId: DAILY_CHANNEL_ID,
      },
    });
  }
}
