import * as Notifications from 'expo-notifications';
import { router, Stack, ThemeProvider, type Href } from 'expo-router';
import { SQLiteProvider, type SQLiteDatabase } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { DialogHost, SnackbarHost } from '@/components/Dialog';
import { migrate } from '@/db/migrations';
import { importSeed } from '@/db/seed';
import { SEED } from '@/db/seedData';
import { useDb } from '@/hooks/data';
import { maybeAutoBackup, resetIfNewInstallInDevMode } from '@/services/backup';
import { rescheduleDailyReminders } from '@/services/dailyReminder';
// Defines the background GPS task as soon as the bundle loads (PLAN.md §6.8).
import '@/services/gpsTracker';
import {
  configureNotificationHandler,
  ensureChannels,
  getPermissionState,
  requestNotificationPermission,
} from '@/services/notifications';
import { colors, headerOptions, navigationTheme } from '@/theme';

configureNotificationHandler();

async function initDatabase(db: SQLiteDatabase) {
  await migrate(db);
  await resetIfNewInstallInDevMode(db);
  await importSeed(db, SEED, new Date());
}

// navigate, not push: going back to a screen already open must not stack a second copy of it.
function openFromNotification(response: Notifications.NotificationResponse | null) {
  const url = response?.notification.request.content.data?.url;
  if (typeof url === 'string') router.navigate(url as Href);
}

/** Channels, permissions, reminders and notification deep links. */
function Bootstrap() {
  const db = useDb();

  useEffect(() => {
    (async () => {
      await ensureChannels();
      if (!(await getPermissionState()).notifications) await requestNotificationPermission();
      await rescheduleDailyReminders(db);
      await maybeAutoBackup(db);
    })().catch((e) => console.warn('Start-up tasks failed', e));
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
          screenOptions={{ ...headerOptions, contentStyle: { backgroundColor: colors.bg } }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="workout/[sessionId]" options={{ title: 'Entrenando' }} />
          <Stack.Screen name="workout/resumen/[sessionId]" options={{ title: 'Resumen' }} />
          <Stack.Screen name="cardio-sesion/[id]" options={{ title: 'Cardio' }} />
          <Stack.Screen name="ruta/[id]" options={{ title: 'Mapa' }} />
          <Stack.Screen name="compartir/[tipo]/[id]" options={{ title: 'Compartir' }} />
          <Stack.Screen name="slot/[id]" options={{ title: 'Ejercicio de la rutina' }} />
          <Stack.Screen name="rutina/[id]" options={{ title: 'Editar rutina' }} />
          <Stack.Screen name="ejercicios" options={{ title: 'Ejercicios' }} />
          <Stack.Screen name="ejercicio/[id]" options={{ title: 'Ejercicio' }} />
          <Stack.Screen name="cardio" options={{ title: 'Cardio semanal' }} />
          <Stack.Screen name="cardio/actividad/[id]" options={{ title: 'Actividad' }} />
          <Stack.Screen name="progreso/[id]" options={{ title: 'Progreso' }} />
          <Stack.Screen name="alimentos" options={{ title: 'Alimentos' }} />
          <Stack.Screen name="alimento/[id]" options={{ title: 'Alimento' }} />
          <Stack.Screen name="ajustes" options={{ title: 'Ajustes' }} />
          <Stack.Screen name="dev/componentes" options={{ title: 'Componentes' }} />
        </Stack>
        <SnackbarHost />
        <DialogHost />
      </SQLiteProvider>
    </ThemeProvider>
  );
}
