import * as Notifications from 'expo-notifications';
import { router, Stack, ThemeProvider, type Href } from 'expo-router';
import { SQLiteProvider, type SQLiteDatabase } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import seedJson from '../../data/seed/seed.json';
import { migrate } from '@/db/migrations';
import { importSeed } from '@/db/seed';
import type { SeedData } from '@/db/seedTypes';
import { useDb } from '@/hooks/data';
import { rescheduleDailyReminders } from '@/services/dailyReminder';
import {
  configureNotificationHandler,
  ensureChannels,
  getPermissionState,
  requestNotificationPermission,
} from '@/services/notifications';
import { colors, navigationTheme } from '@/theme';

configureNotificationHandler();

async function initDatabase(db: SQLiteDatabase) {
  await migrate(db);
  await importSeed(db, seedJson as SeedData, new Date());
}

function openFromNotification(response: Notifications.NotificationResponse | null) {
  const url = response?.notification.request.content.data?.url;
  if (typeof url === 'string') router.push(url as Href);
}

/** Channels, permissions, reminders and notification deep links. */
function Bootstrap() {
  const db = useDb();

  useEffect(() => {
    (async () => {
      await ensureChannels();
      if (!(await getPermissionState()).notifications) await requestNotificationPermission();
      await rescheduleDailyReminders(db);
    })().catch((e) => console.warn('Notification setup failed', e));
  }, [db]);

  useEffect(() => {
    Notifications.getLastNotificationResponseAsync().then((response) => {
      openFromNotification(response);
      Notifications.clearLastNotificationResponseAsync();
    });
    const sub = Notifications.addNotificationResponseReceivedListener(openFromNotification);
    return () => sub.remove();
  }, []);

  return null;
}

export default function RootLayout() {
  return (
    <ThemeProvider value={navigationTheme}>
      <StatusBar style="light" />
      <SQLiteProvider databaseName="entreno.db" onInit={initDatabase}>
        <Bootstrap />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.card },
            headerTintColor: colors.text,
            contentStyle: { backgroundColor: colors.bg },
          }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="workout/[sessionId]" options={{ title: 'Entrenando' }} />
          <Stack.Screen name="workout/resumen/[sessionId]" options={{ title: 'Resumen' }} />
          <Stack.Screen name="slot/[id]" options={{ title: 'Peso del ejercicio' }} />
          <Stack.Screen name="ajustes" options={{ title: 'Ajustes' }} />
        </Stack>
      </SQLiteProvider>
    </ThemeProvider>
  );
}
