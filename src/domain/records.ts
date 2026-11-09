/**
 * Récords (1.4.7, PLAN.md §6.6): totals, the best set of each exercise and the walks, from the data
 * that is already there. Pure: the repository reads the rows and the screen only formats.
 */
import { formatLoad, formatNumber, formatSetValues, formatShortDate, loadFigure, NBSP } from './format';
import { kmSplits, type TrackSample } from './gps';
import { calendarDaysBetween } from './muscles';
import { computeRecords, splitUnit, type ExerciseSession } from './progress';
import type { RepUnit } from './types';

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
