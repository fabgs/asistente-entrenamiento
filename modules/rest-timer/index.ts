import { requireOptionalNativeModule } from 'expo';

interface RestTimerNative {
  start(endsAt: number, title: string, body: string, overlay: boolean): void;
  stop(): void;
  canDrawOverlays(): boolean;
  /** Missing in native builds older than 1.3.0 (the JS can be newer during development). */
  isIgnoringBatteryOptimizations?: () => boolean;
  /** Missing in native builds older than 1.3.4. */
  startOngoing?: (startedAt: number, title: string, body: string) => void;
  stopOngoing?: () => void;
  setShowWhenLocked?: (on: boolean) => void;
  /** Missing in native builds older than the native sprint beep (1.3.4). */
  scheduleSprintBeep?: (goAt: number) => void;
  cancelSprintBeep?: () => void;
  /** Missing in native builds older than the encrypted copies (1.3.4). */
  pbkdf2Sha256?: (password: string, salt: string, iterations: number) => Promise<string>;
  /** Missing in native builds older than 1.5.0. */
  startSprintRunning?: (startAt: number, title: string, body: string, minMs: number) => void;
  stopSprintRunning?: () => void;
  takeSprintStop?: () => SprintButtonStop | null;
  addListener?: (event: 'onSprintStop', listener: (stop: SprintButtonStop) => void) => { remove(): void };
  /** Missing in native builds older than 1.5.2. */
  startSprintGnss?: () => boolean;
  stopSprintGnss?: () => void;
  takeSprintGnss?: () => number[][] | null;
}

/** A sprint stopped without the screen: with a volume button or the notification's «Parar». */
export interface SprintButtonStop {
  /** When it was pressed, epoch ms. */
  at: number;
  source: 'volume' | 'notification';
}

// Android only; absent on other platforms and in Jest.
const native = requireOptionalNativeModule<RestTimerNative>('RestTimer');

/** Lock-screen countdown (and floating bubble when the app is in the background) until `endsAt`. */
export function startRestCountdown(endsAt: number, title: string, body: string, overlay: boolean): void {
  native?.start(endsAt, title, body, overlay);
}

/** Ends the countdown; the activity in progress, if any, shows again. */
export function stopRestCountdown(): void {
  native?.stop();
}

/**
 * A fixed notification for an activity in progress (a workout), with the time since `startedAt`
 * counting up: tapping it goes back to the app. A countdown shows on top of it while it runs.
 * Calling it again updates the texts.
 */
export function startOngoing(startedAt: number, title: string, body: string): void {
  native?.startOngoing?.(startedAt, title, body);
}

export function stopOngoing(): void {
  native?.stopOngoing?.();
}

/** Lets the app's screen show over the lock screen (the sprints screen, while it is focused). */
export function setShowWhenLocked(on: boolean): void {
  native?.setShowWhenLocked?.(on);
}

/**
 * The sprint start beep at `goAt` (epoch ms), played by the app itself: an alarm wakes it 2 s before,
 * even with the screen locked or the app killed. Idempotent for the same start.
 */
export function scheduleSprintBeep(goAt: number): void {
  native?.scheduleSprintBeep?.(goAt);
}

export function cancelSprintBeep(): void {
  native?.cancelSprintBeep?.();
}

/**
 * The sprint starting at `startAt` (now, or when the countdown to its beep ends): a notification with
 * the time running and «Parar», and the volume buttons stop it while the app is in front. A press
 * before `minMs` from the start is ignored. Calling it again replaces it.
 */
export function startSprintRunning(startAt: number, title: string, body: string, minMs: number): void {
  native?.startSprintRunning?.(startAt, title, body, minMs);
}

export function stopSprintRunning(): void {
  native?.stopSprintRunning?.();
}

/** The stop pressed and not yet applied, if any; each one is returned once. */
export function takeSprintStop(): SprintButtonStop | null {
  return native?.takeSprintStop?.() ?? null;
}

/** Called when a button stops a sprint while the JavaScript is alive (the stop is also kept for `takeSprintStop`). */
export function onSprintButtonStop(listener: () => void): () => void {
  const sub = native?.addListener?.('onSprintStop', listener);
  return () => sub?.remove();
}

/** A fix straight from the GPS chip (1.5.2); see `SprintGnss.kt`. */
export interface GnssFix {
  /** The instant of the fix on the clock of the taps, epoch ms. */
  t: number;
  lat: number;
  lon: number;
  accuracy: number | null;
  /** Doppler speed, m/s. */
  speed: number | null;
  /** How far to trust that speed, m/s (68 %). */
  speedAccuracy: number | null;
  /** How far the fix's own (GPS) time runs behind the clock of the taps, ms. */
  clockLagMs: number;
}

/**
 * Listens to the GPS chip itself for the sprints (the fused location of expo-location smooths them
 * away). False when it cannot: no native module, no precise location permission or no GPS.
 */
export function startSprintGnss(): boolean {
  return native?.startSprintGnss?.() ?? false;
}

export function stopSprintGnss(): void {
  native?.stopSprintGnss?.();
}

/** The fixes kept since the last call, oldest first; null when it is not listening (a new process: start it again). */
export function takeSprintGnss(): GnssFix[] | null {
  const rows = native?.takeSprintGnss?.();
  if (!rows) return null;
  const known = (v: number) => (v < 0 ? null : v);
  return rows.map(([t, lat, lon, accuracy, speed, speedAccuracy, clockLagMs]) => ({
    t: Math.round(t),
    lat,
    lon,
    accuracy: known(accuracy),
    speed: known(speed),
    speedAccuracy: known(speedAccuracy),
    clockLagMs: Math.round(clockLagMs),
  }));
}

/**
 * PBKDF2-HMAC-SHA256 with a 32-byte result, native and off the JS thread (the key of the encrypted
 * copies, PLAN.md §9). Password and salt as base64 bytes; the key in base64, or null without it.
 */
export async function pbkdf2Sha256(password: string, salt: string, iterations: number): Promise<string | null> {
  return native?.pbkdf2Sha256 ? native.pbkdf2Sha256(password, salt, iterations) : null;
}

export function canDrawOverlays(): boolean {
  return native?.canDrawOverlays() ?? false;
}

/**
 * Whether Android leaves the app out of battery optimization, so alarms are not delayed. Null when
 * it cannot be known: no native module, or one built before this function existed.
 */
export function isIgnoringBatteryOptimizations(): boolean | null {
  if (typeof native?.isIgnoringBatteryOptimizations !== 'function') return null;
  try {
    return native.isIgnoringBatteryOptimizations();
  } catch {
    return null;
  }
}
