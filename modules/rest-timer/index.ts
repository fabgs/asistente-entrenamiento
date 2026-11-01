import { requireOptionalNativeModule } from 'expo';

interface RestTimerNative {
  start(endsAt: number, title: string, body: string, overlay: boolean): void;
  stop(): void;
  canDrawOverlays(): boolean;
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
