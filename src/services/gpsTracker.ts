import * as Location from 'expo-location';
import * as SQLite from 'expo-sqlite';
import * as TaskManager from 'expo-task-manager';
import { addTrackPoints } from '@/db/repositories/cardioSessions';
import { colors } from '@/theme';

const GPS_TASK = 'entreno-gps';
const DATABASE = 'entreno.db';
let database: Promise<SQLite.SQLiteDatabase> | null = null;

// Must run when the module loads (PLAN.md §6.8): if the app was closed, Android starts a fresh JS
// context just to deliver the fixes, and the task has to exist by then. It only stores points.
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(GPS_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  try {
    database ??= SQLite.openDatabaseAsync(DATABASE);
    const db = await database;
    await addTrackPoints(
      db,
      data.locations.map((l) => ({
        t: l.timestamp,
        lat: l.coords.latitude,
        lon: l.coords.longitude,
        accuracy: l.coords.accuracy,
        speed: l.coords.speed,
        altitude: l.coords.altitude,
      })),
    );
  } catch (e) {
    console.warn('Could not store GPS points', e);
  }
});

export type GpsStart = 'ok' | 'denied' | 'approximate' | 'off';

/**
 * Starts recording through a foreground service (the "Grabando" notification), which keeps
 * receiving fixes with the screen locked. That needs only the while-in-use location permission.
 */
export async function startGpsTracking(): Promise<GpsStart> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) return 'denied';
  if (permission.android?.accuracy === 'coarse') return 'approximate';
  if (!(await Location.hasServicesEnabledAsync())) {
    try {
      await Location.enableNetworkProviderAsync();
    } catch {
      return 'off';
    }
  }
  if (await Location.hasStartedLocationUpdatesAsync(GPS_TASK)) return 'ok';
  await Location.startLocationUpdatesAsync(GPS_TASK, {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: 3000,
    distanceInterval: 0,
    foregroundService: {
      notificationTitle: 'Grabando la ruta',
      notificationBody: 'Toca para ver la distancia y el ritmo',
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
