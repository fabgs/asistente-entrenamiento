/**
 * Seven taps in a row on the version at the foot of Ajustes show or hide the admin options, like
 * Android's developer options. A pause longer than TAP_GAP_MS starts the count again.
 */
export const TAPS_TO_TOGGLE = 7;
export const TAP_GAP_MS = 2000;
/** From this tap on, each one says how many are left. */
const COUNTDOWN_FROM = 3;

export interface Taps {
  count: number;
  at: number;
}

export type TapOutcome = { kind: 'none' } | { kind: 'left'; left: number } | { kind: 'toggle' };

/** The count after a tap at `now`; after the seventh it starts again. */
export function addTap(prev: Taps | null, now: number): Taps {
  const continues = prev !== null && prev.count < TAPS_TO_TOGGLE && now - prev.at <= TAP_GAP_MS;
  return { count: continues ? prev.count + 1 : 1, at: now };
}

export function tapOutcome(taps: Taps): TapOutcome {
  if (taps.count >= TAPS_TO_TOGGLE) return { kind: 'toggle' };
  if (taps.count >= COUNTDOWN_FROM) return { kind: 'left', left: TAPS_TO_TOGGLE - taps.count };
  return { kind: 'none' };
}

/** Shown in place of the version while counting: a snackbar there would catch the next taps. */
export function tapsLeftText(left: number): string {
  return left === 1 ? 'Falta 1 toque' : `Faltan ${left} toques`;
}
