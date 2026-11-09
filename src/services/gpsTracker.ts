import * as Location from 'expo-location';
import type { SQLiteDatabase } from 'expo-sqlite';
import * as TaskManager from 'expo-task-manager';
import { storeTrackPoints } from '@/db/repositories/cardioSessions';
import { notifyFollow } from './routeAlert';
import { openDatabaseInBackground } from './secureDatabase';
import { colors } from '@/theme';

const GPS_TASK = 'entreno-gps';
let database: Promise<SQLiteDatabase> | null = null;

// One batch at a time: the detector of a followed route reads the state the previous batch wrote.
let queue: Promise<void> = Promise.resolve();

// Must run when the module loads (PLAN.md §6.8): if the app was closed, Android starts a fresh JS
// context just to deliver the fixes, and the task has to exist by then. It stores the points and,
// on a walk that follows a route, alerts on leaving it and coming back (1.4.9).
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(GPS_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  const receivedAt = Date.now();
  const batch = async () => {
    database ??= openDatabaseInBackground();
    const db = await database;
    const { follow } = await storeTrackPoints(
      db,
      data.locations.map((l) => ({
        t: l.timestamp,
        lat: l.coords.latitude,
        lon: l.coords.longitude,
        accuracy: l.coords.accuracy,
        speed: l.coords.speed,
        altitude: l.coords.altitude,
        receivedAt,
      })),
      receivedAt,
    );
    if (follow) await notifyFollow(follow).catch((e) => console.warn('Could not alert about the route', e));
  };
  queue = queue.then(batch).catch((e) => console.warn('Could not store GPS points', e));
  await queue;
});

export type GpsStart = 'ok' | 'denied' | 'approximate' | 'off';

/** How often to ask for a fix and what the fixed «recording» notification says. */
export interface GpsOptions {
  intervalMs: number;
  title: string;
  body: string;
}

export const WALK_GPS: GpsOptions = { intervalMs: 3000, title: 'Grabando la ruta', body: 'Toca para ver la distancia y el ritmo' };
/** A fix a second: a sprint lasts 10–15 s. */
export const SPRINT_GPS: GpsOptions = { intervalMs: 1000, title: 'Sprints', body: 'GPS activo para medir cada sprint' };

/**
 * Starts recording through a foreground service (the "Grabando" notification), which keeps
 * receiving fixes with the screen locked. That needs only the while-in-use location permission.
 * With `prompt: false` (resuming in the background of a screen) it asks nothing and turns nothing on.
 */
export async function startGpsTracking(options = WALK_GPS, { prompt = true } = {}): Promise<GpsStart> {
  const permission = prompt ? await Location.requestForegroundPermissionsAsync() : await Location.getForegroundPermissionsAsync();
  if (!permission.granted) return 'denied';
  if (permission.android?.accuracy === 'coarse') return 'approximate';
  if (!(await Location.hasServicesEnabledAsync())) {
    if (!prompt) return 'off';
    try {
      await Location.enableNetworkProviderAsync();
    } catch {
      return 'off';
    }
  }
  if (await Location.hasStartedLocationUpdatesAsync(GPS_TASK)) {
    // Already running: fine if at the same rate (a walk asks every 3 s, the sprints every second).
    const running = await TaskManager.getTaskOptionsAsync<{ timeInterval?: number }>(GPS_TASK).catch(() => null);
    if (running?.timeInterval === options.intervalMs) return 'ok';
    await Location.stopLocationUpdatesAsync(GPS_TASK);
  }
  await Location.startLocationUpdatesAsync(GPS_TASK, {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: options.intervalMs,
    distanceInterval: 0,
    foregroundService: {
      notificationTitle: options.title,
      notificationBody: options.body,
      notificationColor: colors.primary,
      killServiceOnDestroy: false,
    },
  });
  return 'ok';
}

export async function stopGpsTracking(): Promise<void> {
  if (await Location.hasStartedLocationUpdatesAsync(GPS_TASK)) await Location.stopLocationUpdatesAsync(GPS_TASK);
}

export const isGpsRecording = () => Location.hasStartedLocationUpdatesAsync(GPS_TASK);

export async function openLocationSettings(): Promise<void> {
  await Location.enableNetworkProviderAsync().catch(() => undefined);
}
