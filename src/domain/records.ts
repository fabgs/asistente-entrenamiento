/**
 * Récords (1.4.7, PLAN.md §6.6): totals, the best set of each exercise and the walks, from the data
 * that is already there. Pure: the repository reads the rows and the screen only formats.
 */
import { formatKg, formatLoad, formatNumber, formatSetValues, formatShortDate, loadFigure, NBSP } from './format';
import { kmSplits, type TrackSample } from './gps';
import { calendarDaysBetween } from './muscles';
import { computeRecords, splitUnit, type ExerciseSession } from './progress';
import type { RepUnit } from './types';
import { fixed } from './walkStats';

/** A work set of a finished workout, with what the records need to know of it. */
export interface RecordSet {
  exerciseId: number;
  sessionId: number;
  date: string;
  /** Of the session: orders sessions of one day. */
  startedAt: number;
  imported: boolean;
  /** Of the slot it was done with ('reps' for a set without one). */
  unit: RepUnit;
  weightKg: number | null;
  reps: number;
}

/** The best set of an exercise: the heaviest if it ever had a load, otherwise the most reps, seconds or steps. */
export type ExerciseBest =
  | { kind: 'load'; kg: number; reps: number; date: string; sessionId: number; imported: boolean }
  | { kind: 'amount'; amount: number; date: string; sessionId: number; imported: boolean };

/**
 * The best set of an exercise among its sets in `unit` (a hold in seconds and the same exercise in reps
 * are not compared), with the rules of its progress screen (computeRecords): the heaviest set, ties
 * to more reps and then to the first time; without any load, the set with the most.
 */
export function exerciseBest(sets: readonly RecordSet[], unit: RepUnit): ExerciseBest | null {
  const sessions = new Map<number, ExerciseSession>();
  const imported = new Map<number, boolean>();
  for (const set of sets) {
    if (set.unit !== unit) continue;
    const session = sessions.get(set.sessionId) ?? {
      sessionId: set.sessionId,
      date: set.date,
      startedAt: set.startedAt,
      title: null,
      routineName: null,
      imported: set.imported,
      sets: [],
    };
    session.sets.push({ weightKg: set.weightKg, reps: set.reps });
    sessions.set(set.sessionId, session);
    imported.set(set.sessionId, set.imported);
  }
  const { maxWeight, maxReps } = computeRecords([...sessions.values()]);
  if (maxWeight) return { kind: 'load', ...maxWeight, imported: imported.get(maxWeight.sessionId) ?? false };
  if (maxReps) {
    return { kind: 'amount', amount: maxReps.reps, date: maxReps.date, sessionId: maxReps.sessionId, imported: imported.get(maxReps.sessionId) ?? false };
  }
  return null;
}

/** The unit most of an exercise's sets were done in: that of an exercise in no routine. */
export function usualUnit(sets: readonly RecordSet[]): RepUnit {
  const counts = new Map<RepUnit, number>();
  for (const set of sets) counts.set(set.unit, (counts.get(set.unit) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'reps';
}

/**
 * Workouts a week in one year: from 1 January (or the first workout ever, in its year) to 31
 * December (or today, in the current year).
 */
export function workoutsPerWeek(count: number, year: string, firstEver: string, today: string): number {
  const start = firstEver.startsWith(year) ? firstEver : `${year}-01-01`;
  const end = today.startsWith(year) ? today : `${year}-12-31`;
  const weeks = Math.max(1, (calendarDaysBetween(start, end) + 1) / 7);
  return count / weeks;
}

/** A finished GPS walk, with the key of its activity (cardioKey) to group the same one. */
export interface WalkRow {
  id: number;
  key: string;
  name: string;
  date: string;
  startedAt: number;
  distanceM: number | null;
  samples: TrackSample[];
}

export interface WalkRecords {
  /** The name of its latest walk. */
  name: string;
  count: number;
  totalM: number;
  since: string;
  longest: { distanceM: number; sessionId: number; date: string } | null;
  /** The fastest whole kilometre. */
  bestKm: { seconds: number; sessionId: number; date: string } | null;
}

/** The walks of each activity with GPS, the one walked last first. */
export function walkRecords(walks: readonly WalkRow[]): WalkRecords[] {
  const groups = new Map<string, WalkRow[]>();
  for (const walk of [...walks].sort((a, b) => b.startedAt - a.startedAt)) groups.set(walk.key, [...(groups.get(walk.key) ?? []), walk]);
  return [...groups.values()].map((group) => {
    let longest: WalkRecords['longest'] = null;
    let bestKm: WalkRecords['bestKm'] = null;
    // Oldest first, so a tie keeps the first time.
    for (const walk of [...group].reverse()) {
      const metres = walk.distanceM ?? 0;
      if (metres > 0 && (!longest || metres > longest.distanceM)) longest = { distanceM: metres, sessionId: walk.id, date: walk.date };
      for (const split of kmSplits(walk.samples)) {
        if (split.distanceM === 1000 && (!bestKm || split.seconds < bestKm.seconds)) {
          bestKm = { seconds: split.seconds, sessionId: walk.id, date: walk.date };
        }
      }
    }
    return {
      name: group[0].name,
      count: group.length,
      totalM: group.reduce((sum, w) => sum + (w.distanceM ?? 0), 0),
      since: group.map((w) => w.date).sort()[0],
      longest,
      bestKm,
    };
  });
}

/** «12 mar» this year, «12 mar 2025» another one. */
export function formatRecordDate(iso: string, today: string): string {
  return iso.slice(0, 4) === today.slice(0, 4) ? formatShortDate(iso) : `${formatShortDate(iso)} ${iso.slice(0, 4)}`;
}

/** An amount in its unit, as a figure: «22» reps, «7» min, «40» pasos. */
function amountFigure(amount: number, unit: RepUnit): { value: string; unit: string } {
  if (unit === 'reps') return { value: String(amount), unit: 'reps' };
  return splitUnit(formatSetValues([amount], unit)) as { value: string; unit: string };
}

/**
 * How a row of Récords reads its best set: the figure on the right and the line under the name.
 * A load: «40 kg» (or «2 × 20 kg», or «15 kg» over «lastre») and «8 reps · 12 mar 2025 · ahora 35 kg»,
 * «ahora» only when the slot's weight is another one, and «Importado» when it comes from the notes.
 * Without any load: «22 reps» over its date.
 */
export function recordReading(
  row: { best: ExerciseBest; unit: RepUnit; bodyweight: boolean; pair: boolean; slotWeightKg?: number | null },
  today: string,
): { figure: { value: string; unit?: string; caption?: string }; subtitle: string | null } {
  const { best, unit } = row;
  const date = formatRecordDate(best.date, today);
  const imported = best.imported ? 'Importado' : null;
  if (best.kind === 'amount') {
    return { figure: { ...amountFigure(best.amount, unit), caption: date }, subtitle: imported };
  }
  const figure = loadFigure(best.kg, row.bodyweight, row.pair) ?? { value: formatNumber(best.kg), unit: 'kg' };
  const amount = unit === 'reps' ? `${best.reps}${NBSP}reps` : formatSetValues([best.reps], unit);
  const now =
    row.slotWeightKg !== undefined && (row.slotWeightKg ?? 0) !== best.kg
      ? `ahora ${formatLoad(row.slotWeightKg, row.bodyweight, row.pair).toLowerCase()}`
      : null;
  return { figure, subtitle: [amount, date, now, imported].filter(Boolean).join(' · ') };
}

/**
 * «Nuevo récord» (1.4.10, PLAN.md §6.6): the set just done becomes the best set of its exercise, the
 * one Récords shows. A notice with the figure and the one before; nothing else.
 */

/** Workouts of the exercise there must be before a set can be a record: the first days always are. */
export const RECORD_MIN_SESSIONS = 3;

export type NewRecord =
  /** Heavier than ever. */
  | { kind: 'weight'; kg: number; beforeKg: number }
  /** With the heaviest weight ever, more reps (or seconds, or steps). */
  | { kind: 'amountAtWeight'; kg: number; amount: number; before: number }
  /** An exercise that never had a load: more than ever. */
  | { kind: 'amount'; amount: number; before: number };

/**
 * Whether a work set beats the best set of its exercise. `earlier` are its work sets with reps in the
 * finished workouts and those done before it in this one (`sessionId`), in any unit: only those in
 * `unit` are compared. Equalling is not beating; a second set like the first says nothing and a
 * better one is another record. Needs three earlier workouts of the exercise in that unit, and with
 * a load for a record with a load: the first day with a belt of an exercise noted without one is not
 * a record.
 */
export function recordOf(
  earlier: readonly RecordSet[],
  set: { weightKg: number | null; reps: number },
  unit: RepUnit,
  sessionId: number,
): NewRecord | null {
  if (set.reps <= 0) return null;
  const sets = earlier.filter((s) => s.unit === unit && s.reps > 0);
  const best = exerciseBest(sets, unit);
  if (!best) return null;
  const before = sets.filter((s) => s.sessionId !== sessionId);
  const workouts = new Set(before.map((s) => s.sessionId)).size;
  const loaded = new Set(before.filter((s) => (s.weightKg ?? 0) > 0).map((s) => s.sessionId)).size;
  const kg = set.weightKg ?? 0;
  if (best.kind === 'amount') {
    // Never a load before: one today is a first day, not a record.
    if (kg > 0 || workouts < RECORD_MIN_SESSIONS || set.reps <= best.amount) return null;
    return { kind: 'amount', amount: set.reps, before: best.amount };
  }
  if (loaded < RECORD_MIN_SESSIONS) return null;
  if (kg > best.kg) return { kind: 'weight', kg, beforeKg: best.kg };
  if (kg === best.kg && set.reps > best.reps) return { kind: 'amountAtWeight', kg, amount: set.reps, before: best.reps };
  return null;
}

/** «14 reps», «70 s», «2:30 min», «40 pasos». */
const amountText = (amount: number, unit: RepUnit) => (unit === 'reps' ? `${amount}${NBSP}reps` : formatSetValues([amount], unit));

/**
 * The notice: «Nuevo récord · 42,5 kg · antes 40 kg», «Nuevo récord · 9 reps con 42,5 kg · antes 8»,
 * «Nuevo récord · 14 reps · antes 13». The load as everywhere: «lastre 15 kg», «2 × 20 kg».
 */
export function recordText(record: NewRecord, unit: RepUnit, exercise: { bodyweight: boolean; pair: boolean }): string {
  const load = (kg: number) => formatLoad(kg, exercise.bodyweight, exercise.pair).toLowerCase();
  // A time changes of unit at two minutes: the one before keeps its own.
  const earlier = (amount: number) => (unit === 'seconds' ? amountText(amount, unit) : String(amount));
  switch (record.kind) {
    case 'weight':
      return `Nuevo récord · ${load(record.kg)} · antes ${exercise.bodyweight ? formatKg(record.beforeKg) : load(record.beforeKg)}`;
    case 'amountAtWeight':
      return `Nuevo récord · ${amountText(record.amount, unit)} con ${load(record.kg)} · antes ${earlier(record.before)}`;
    case 'amount':
      return `Nuevo récord · ${amountText(record.amount, unit)} · antes ${earlier(record.before)}`;
  }
}

/**
 * Whether a workout holds a record of an exercise, for its tag in the summary: some set of it, in
 * the order they were done, beat what there was before it. Computed from the sets, never stored, so
 * correcting a set moves it. `before` are the sets of the earlier workouts.
 */
export function sessionHasRecord(
  before: readonly RecordSet[],
  sets: readonly { weightKg: number | null; reps: number }[],
  unit: RepUnit,
  session: Pick<RecordSet, 'exerciseId' | 'sessionId' | 'date' | 'startedAt'>,
): boolean {
  const earlier = [...before];
  let found = false;
  for (const set of sets) {
    if (recordOf(earlier, set, unit, session.sessionId)) found = true;
    earlier.push({ ...session, imported: false, unit, weightKg: set.weightKg, reps: set.reps });
  }
  return found;
}

/** Walks of the activity there must be before one can be its longest. */
export const LONGEST_MIN_WALKS = 5;
/** Under this, a longer walk is the error of the GPS (3–8 %) on the usual one. */
export const LONGEST_MARGIN = 0.05;

/**
 * «Nuevo récord de distancia · 7,42 km · antes 6,90 km»: the walk just finished is the longest of its
 * activity by more than the margin, with five before it. Not for a walk that repeats a saved route
 * (the caller leaves those out: the same loop is never longer, only measured differently).
 */
export function longestWalkText(walk: WalkRow, walks: readonly WalkRow[]): string | null {
  const earlier = walks.filter((w) => w.key === walk.key && w.id !== walk.id && w.startedAt < walk.startedAt && (w.distanceM ?? 0) > 0);
  if (earlier.length < LONGEST_MIN_WALKS) return null;
  const longest = Math.max(...earlier.map((w) => w.distanceM ?? 0));
  const metres = walk.distanceM ?? 0;
  if (metres <= longest * (1 + LONGEST_MARGIN)) return null;
  const km = (m: number) => `${fixed(m / 1000, 2)}${NBSP}km`;
  return `Nuevo récord de distancia · ${km(metres)} · antes ${km(longest)}`;
}
