import { requireOptionalNativeModule } from 'expo';

interface RestTimerNative {
  start(endsAt: number, title: string, body: string, overlay: boolean): void;
  stop(): void;
  canDrawOverlays(): boolean;
  /** Missing in native builds older than 1.3.0 (the JS can be newer during development). */
  isIgnoringBatteryOptimizations?: () => boolean;
}

// Android only; absent on other platforms and in Jest.
const native = requireOptionalNativeModule<RestTimerNative>('RestTimer');

/** Lock-screen countdown (and floating bubble when the app is in the background) until `endsAt`. */
export function startRestCountdown(endsAt: number, title: string, body: string, overlay: boolean): void {
  native?.start(endsAt, title, body, overlay);
}

export function stopRestCountdown(): void {
  native?.stop();
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
