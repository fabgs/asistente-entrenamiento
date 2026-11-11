import * as Location from 'expo-location';
import type { SQLiteDatabase } from 'expo-sqlite';
import * as TaskManager from 'expo-task-manager';
import { storeTrackPoints } from '@/db/repositories/cardioSessions';
import { startSprintGnss, stopSprintGnss, takeSprintGnss } from '../../modules/rest-timer';
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
    const { follow, sprint } = await storeTrackPoints(
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
    // Sprints are measured with the chip's own fixes (1.5.2): each fused batch brings them along,
    // also with the screen locked, and starts the listener again in a process Android restarted.
    if (sprint) await drainSprintGnss(db);
    if (follow) await notifyFollow(follow).catch((e) => console.warn('Could not alert about the route', e));
  };
  queue = queue.then(batch).catch((e) => console.warn('Could not store GPS points', e));
  await queue;
});

/**
 * Stores the fixes the GPS chip gave since the last time (PLAN.md §6.8, 1.5.2) in the sprints in
 * progress; if nothing was listening (a new process), it starts. Each fix is taken once.
 */
async function drainSprintGnss(db: SQLiteDatabase): Promise<void> {
  const fixes = takeSprintGnss();
  if (fixes === null) {
    startSprintGnss();
    return;
  }
  if (fixes.length === 0) return;
  await storeTrackPoints(
    db,
    fixes.map((f) => ({
      t: f.t,
      lat: f.lat,
      lon: f.lon,
      accuracy: f.accuracy,
      speed: f.speed,
      altitude: null,
      // Not when it arrived: how far the fix's own (GPS) time runs behind the clock of the taps.
      receivedAt: f.t + f.clockLagMs,
      gnss: true,
      speedAccuracy: f.speedAccuracy,
    })),
  );
}

/**
 * Brings the chip's fixes now (the screen every second, and on finishing), through the task's own
 * connection and queue: the points are always written one batch at a time, from one place.
 */
export function storeSprintGnss(): Promise<void> {
  queue = queue
    .then(async () => {
      database ??= openDatabaseInBackground();
      await drainSprintGnss(await database);
    })
    .catch((e) => console.warn('Could not store the GPS fixes', e));
  return queue;
}

/** The chip's listener goes with the sprints: on with their GPS, off when they end. */
export const startSprintGps = () => startSprintGnss();
export const stopSprintGps = () => stopSprintGnss();

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

/**
 * Where the phone is, to open a map there (marking the straight of the sprints, 1.5.2): the last
 * place Android knows if it is recent, otherwise a fix asked now. Null without the permission (it
 * is not asked for here) or without a fix in a few seconds.
 */
export async function currentPlace(): Promise<{ lat: number; lon: number } | null> {
  try {
    if (!(await Location.getForegroundPermissionsAsync()).granted) return null;
    const known = await Location.getLastKnownPositionAsync({ maxAge: 60_000, requiredAccuracy: 100 });
    const fix =
      known ??
      (await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
      ]));
    return fix ? { lat: fix.coords.latitude, lon: fix.coords.longitude } : null;
  } catch {
    return null;
  }
}

export async function openLocationSettings(): Promise<void> {
  await Location.enableNetworkProviderAsync().catch(() => undefined);
}
