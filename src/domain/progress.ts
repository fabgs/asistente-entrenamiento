import { format } from 'date-fns';
import { es } from 'date-fns/locale';

export interface LoggedSet {
  weightKg: number | null;
  reps: number;
}

/** Every set of one exercise in one finished session. */
export interface ExerciseSession {
  sessionId: number;
  date: string;
  startedAt: number;
  /** Given by the user; null shows the routine name. */
  title: string | null;
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

/**
 * Σ weight × reps. With `pair` (two dumbbells, the weight being that of each one) both count: two
 * dumbbells of 10 kg for 12 reps move 240 kg.
 */
export function volumeOf(sets: LoggedSet[], pair = false): number {
  return sets.reduce((sum, s) => sum + (s.weightKg ?? 0) * s.reps, 0) * (pair ? 2 : 1);
}

/** `topWeightKg` stays that of one dumbbell, as it is entered and shown («2 × 10 kg»). */
export function summarize(sets: LoggedSet[], pair = false): SessionSummary {
  return {
    topWeightKg: Math.max(0, ...sets.map((s) => s.weightKg ?? 0)),
    totalReps: sets.reduce((sum, s) => sum + s.reps, 0),
    volumeKg: volumeOf(sets, pair),
    bestSetReps: Math.max(0, ...sets.map((s) => s.reps)),
  };
}

export interface Records {
  /** Heaviest set; ties go to more reps, then to the first time it happened. */
  maxWeight: { kg: number; reps: number; date: string; sessionId: number } | null;
  /** Most reps in one set; ties go to the heavier set, then to the first time. */
  maxReps: { reps: number; kg: number; date: string; sessionId: number } | null;
  /** Largest Σ weight × reps in a session. */
  maxVolume: { kg: number; date: string; sessionId: number } | null;
}

export function computeRecords(sessions: ExerciseSession[], pair = false): Records {
  const chronological = [...sessions].sort((a, b) => a.startedAt - b.startedAt);
  let maxWeight: Records['maxWeight'] = null;
  let maxReps: Records['maxReps'] = null;
  let maxVolume: Records['maxVolume'] = null;

  for (const session of chronological) {
    const { sessionId, date } = session;
    for (const set of session.sets) {
      const kg = set.weightKg ?? 0;
      if (kg > 0 && (!maxWeight || kg > maxWeight.kg || (kg === maxWeight.kg && set.reps > maxWeight.reps))) {
        maxWeight = { kg, reps: set.reps, date, sessionId };
      }
      if (set.reps > 0 && (!maxReps || set.reps > maxReps.reps || (set.reps === maxReps.reps && kg > maxReps.kg))) {
        maxReps = { reps: set.reps, kg, date, sessionId };
      }
    }
    const volume = volumeOf(session.sets, pair);
    if (volume > 0 && (!maxVolume || volume > maxVolume.kg)) maxVolume = { kg: volume, date, sessionId };
  }
  return { maxWeight, maxReps, maxVolume };
}

/** Past this many reps Epley overshoots: such sets give no estimate. */
export const ONE_REP_MAX_MAX_REPS = 12;

export interface OneRepMax {
  /** Estimated weight for a single rep, rounded to 0.5 kg. */
  kg: number;
  /** The set it comes from. */
  fromKg: number;
  reps: number;
}

/**
 * Estimated one-rep max of a set with Epley's formula, kg × (1 + reps / 30); a single rep is its
 * own weight. Null without weight or past 12 reps. With two dumbbells it is that of each one, as
 * the weight is entered.
 */
export function estimateOneRepMax(kg: number | null, reps: number): number | null {
  if (kg === null || kg <= 0 || reps < 1 || reps > ONE_REP_MAX_MAX_REPS) return null;
  const estimate = reps === 1 ? kg : kg * (1 + reps / 30);
  return Math.round(estimate * 2) / 2;
}

/** The best estimate among the sets of a session; ties go to the heavier set. */
export function sessionOneRepMax(sets: LoggedSet[]): OneRepMax | null {
  let best: OneRepMax | null = null;
  for (const set of sets) {
    const kg = estimateOneRepMax(set.weightKg, set.reps);
    if (kg === null || set.weightKg === null) continue;
    if (!best || kg > best.kg || (kg === best.kg && set.weightKg > best.fromKg)) best = { kg, fromKg: set.weightKg, reps: set.reps };
  }
  return best;
}

/** The highest estimate ever; ties go to the first time. */
export function oneRepMaxRecord(sessions: ExerciseSession[]): (OneRepMax & { date: string; sessionId: number }) | null {
  let record: (OneRepMax & { date: string; sessionId: number }) | null = null;
  for (const session of [...sessions].sort((a, b) => a.startedAt - b.startedAt)) {
    const best = sessionOneRepMax(session.sets);
    if (best && (!record || best.kg > record.kg)) record = { ...best, date: session.date, sessionId: session.sessionId };
  }
  return record;
}

/**
 * The records to show side by side: «Más reps» is left out when it is the very set of «Mejor
 * peso» (the heaviest set was also the longest one), so the same set is never shown twice.
 */
export function distinctRecords(records: Records): Records {
  const { maxWeight, maxReps } = records;
  const sameSet =
    maxWeight !== null &&
    maxReps !== null &&
    maxWeight.sessionId === maxReps.sessionId &&
    maxWeight.kg === maxReps.kg &&
    maxWeight.reps === maxReps.reps;
  return sameSet ? { ...records, maxReps: null } : records;
}

/**
 * Axis bounds and ticks on clean steps (1, 2, 2.5 or 5 × 10ⁿ), never below zero (weights and
 * reps). A flat series is given room above and below so its line does not sit on the frame. A
 * series of whole numbers (reps) gets whole steps of at least 1: with 10, 10.5, 11 the axis would
 * read 10, 11, 11.
 */
export function niceScale(values: number[], targetTicks = 4): { min: number; max: number; ticks: number[] } {
  if (values.length === 0) return { min: 0, max: 1, ticks: [0, 1] };
  const whole = values.every(Number.isInteger);
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (lo === hi) {
    const pad = lo === 0 ? 1 : Math.abs(lo) * 0.1;
    lo -= pad;
    hi += pad;
  }
  const rough = (hi - lo) / Math.max(1, targetTicks - 1);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const candidates = [1, 2, 2.5, 5, 10].map((m) => m * magnitude);
  let step = candidates.find((s) => s >= rough && (!whole || Number.isInteger(s))) ?? 10 * magnitude;
  if (whole) step = Math.max(1, Math.round(step));
  const min = Math.max(0, Math.floor(lo / step) * step);
  const max = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let t = min; t <= max + step / 1000; t += step) ticks.push(Math.round(t * 1000) / 1000);
  return { min, max, ticks };
}

/** Items in a row that fall in the same month ('YYYY-MM'), in the order given (newest first). */
export function groupByMonth<T>(items: T[], dateOf: (item: T) => string): { month: string; items: T[] }[] {
  const groups: { month: string; items: T[] }[] = [];
  for (const item of items) {
    const month = dateOf(item).slice(0, 7);
    const last = groups.at(-1);
    if (last?.month === month) last.items.push(item);
    else groups.push({ month, items: [item] });
  }
  return groups;
}

const parseIso = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d ?? 1);
};

/** Header of a month in a history list: «Noviembre», with the year if it is not this year. */
export function formatMonth(month: string, now = new Date()): string {
  const date = parseIso(month);
  const text = format(date, date.getFullYear() === now.getFullYear() ? 'LLLL' : "LLLL 'de' yyyy", { locale: es });
  return capitalize(text);
}

/** «vie 30 oct» from 'YYYY-MM-DD' (lower case: it goes mid-sentence; capitalize it to start a line). */
export function formatDayMonth(iso: string): string {
  return format(parseIso(iso), 'EEE d MMM', { locale: es });
}

export const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** «1 serie», «11 series». */
export const countOf = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "5,14 km" → { value: "5,14", unit: "km" }, so the unit can be drawn smaller and grey. */
export function splitUnit(text: string): { value: string; unit?: string } {
  const at = text.search(/[  ]/);
  return at < 0 ? { value: text } : { value: text.slice(0, at), unit: text.slice(at + 1) };
}

/**
 * At most about `maxPoints` points of a route, keeping the ends of every segment: a thumbnail of
 * 48 dp shows no more, and drawing the thousands of fixes of a long walk in each row slows the list.
 */
export function thinSegments<T>(segments: T[][], maxPoints: number): T[][] {
  const total = segments.reduce((n, s) => n + s.length, 0);
  const every = Math.max(1, Math.ceil(total / maxPoints));
  if (every === 1) return segments;
  return segments.map((s) => s.filter((_, i) => i % every === 0 || i === s.length - 1));
}
