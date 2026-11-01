export interface LoggedSet {
  weightKg: number | null;
  reps: number;
}

/** Every set of one exercise in one finished session. */
export interface ExerciseSession {
  sessionId: number;
  date: string;
  startedAt: number;
  routineName: string | null;
  imported: boolean;
  sets: LoggedSet[];
}

export interface SessionSummary {
  topWeightKg: number;
  totalReps: number;
  volumeKg: number;
  bestSetReps: number;
}

export function summarize(sets: LoggedSet[]): SessionSummary {
  return {
    topWeightKg: Math.max(0, ...sets.map((s) => s.weightKg ?? 0)),
    totalReps: sets.reduce((sum, s) => sum + s.reps, 0),
    volumeKg: sets.reduce((sum, s) => sum + (s.weightKg ?? 0) * s.reps, 0),
    bestSetReps: Math.max(0, ...sets.map((s) => s.reps)),
  };
}

export interface Records {
  /** Heaviest set; ties go to more reps, then to the first time it happened. */
  maxWeight: { kg: number; reps: number; date: string } | null;
  /** Most reps in one set; ties go to the heavier set, then to the first time. */
  maxReps: { reps: number; kg: number; date: string } | null;
  /** Largest Σ weight × reps in a session. */
  maxVolume: { kg: number; date: string } | null;
}

export function computeRecords(sessions: ExerciseSession[]): Records {
  const chronological = [...sessions].sort((a, b) => a.startedAt - b.startedAt);
  let maxWeight: Records['maxWeight'] = null;
  let maxReps: Records['maxReps'] = null;
  let maxVolume: Records['maxVolume'] = null;

  for (const session of chronological) {
    for (const set of session.sets) {
      const kg = set.weightKg ?? 0;
      if (kg > 0 && (!maxWeight || kg > maxWeight.kg || (kg === maxWeight.kg && set.reps > maxWeight.reps))) {
        maxWeight = { kg, reps: set.reps, date: session.date };
      }
      if (set.reps > 0 && (!maxReps || set.reps > maxReps.reps || (set.reps === maxReps.reps && kg > maxReps.kg))) {
        maxReps = { reps: set.reps, kg, date: session.date };
      }
    }
    const volume = summarize(session.sets).volumeKg;
    if (volume > 0 && (!maxVolume || volume > maxVolume.kg)) maxVolume = { kg: volume, date: session.date };
  }
  return { maxWeight, maxReps, maxVolume };
}

/**
 * Axis bounds and ticks on clean steps (1, 2, 2.5 or 5 × 10ⁿ), never below zero (weights and
 * reps). A flat series is given room above and below so its line does not sit on the frame.
 */
export function niceScale(values: number[], targetTicks = 4): { min: number; max: number; ticks: number[] } {
  if (values.length === 0) return { min: 0, max: 1, ticks: [0, 1] };
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (lo === hi) {
    const pad = lo === 0 ? 1 : Math.abs(lo) * 0.1;
    lo -= pad;
    hi += pad;
  }
  const rough = (hi - lo) / Math.max(1, targetTicks - 1);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? 10 * magnitude;
  const min = Math.max(0, Math.floor(lo / step) * step);
  const max = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let t = min; t <= max + step / 1000; t += step) ticks.push(Math.round(t * 1000) / 1000);
  return { min, max, ticks };
}
