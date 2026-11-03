export interface WarmupSet {
  weightKg: number | null;
  reps: number;
}

/** Default ramp: share of the working weight and reps for the 1st, 2nd and 3rd warm-up. */
const RAMP: [number, number][] = [
  [0.5, 10],
  [0.7, 5],
  [0.85, 3],
];

/**
 * What to propose for warm-up number `index` (0 = A1): the same one as last time if there was one;
 * otherwise 50 % × 10, 70 % × 5 and 85 % × 3 of the working weight, rounded down to the plate step.
 */
export function warmupProposal(index: number, workingKg: number, stepKg: number, lastTime: WarmupSet[] = []): WarmupSet {
  const previous = lastTime[index];
  if (previous) return { weightKg: previous.weightKg, reps: previous.reps };
  const [share, reps] = RAMP[Math.min(index, RAMP.length - 1)];
  const raw = workingKg * share;
  const weightKg = stepKg > 0 ? Math.floor(raw / stepKg + 1e-9) * stepKg : raw;
  return { weightKg: Math.round(weightKg * 100) / 100, reps };
}
