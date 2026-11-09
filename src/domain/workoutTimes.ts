/**
 * Times of a workout (1.4.7, PLAN.md §6.4): the warm-up, each set and each rest, measured from the
 * taps the workout already asks for, with no button of its own. A set starts when its rest is left
 * (or the warm-up, or a warm-up set, ends, or its exercise is opened) and ends at «Serie hecha»; the
 * rest after it lasts until the next set starts. Sessions from before 1.4.7 and imported ones have
 * no times: everything here is then null, never 0.
 */

import { formatClock, NBSP } from './format';

export interface TimedSet {
  slotId: number | null;
  isWarmup: boolean;
  reps: number;
  startedAt: number | null;
  completedAt: number;
  /** The rest planned after it when it was logged; null for warm-ups and sets from before 1.4.7. */
  restSeconds: number | null;
}

/** No set lasts less than this, nor less than a second per rep (or per second held, or per step). */
export const MIN_SET_MS = 5_000;
export const MS_PER_REP = 1_000;
/** A rest longer than this was an interruption: it is told apart and left out of the medians. */
export const MAX_REST_MS = 10 * 60_000;
/** A warm-up shorter than this was a tap straight through: it reads «—», as none. */
export const MIN_WARMUP_MS = 30_000;
/** A warm-up longer than this was forgotten running: it is left out of the medians. */
export const MAX_WARMUP_MS = 60 * 60_000;
/** «Terminar» this long after the last set was forgotten: the workout ends at its last set. */
export const LATE_FINISH_MS = 15 * 60_000;
/** Closer than this to the plan is «igual que el plan». */
export const SAME_AS_PLAN_MS = 5_000;

/** From its start to «Serie hecha»; null when its start was not recorded. */
export function setDuration(set: TimedSet): number | null {
  if (set.startedAt === null || set.completedAt < set.startedAt) return null;
  return set.completedAt - set.startedAt;
}

/**
 * A set too short to be one: it was done with the rest still on screen and its start is the tap that
 * left the rest, just before «Serie hecha». Its time and the rest before it are not measured.
 */
export function isImplausibleSet(set: TimedSet): boolean {
  const ms = setDuration(set);
  return ms !== null && ms < Math.max(MIN_SET_MS, set.reps * MS_PER_REP);
}

export interface Rest<T extends TimedSet = TimedSet> {
  /** The work set it follows. */
  after: T;
  /** The set it leads to (a warm-up set of the next exercise, too). */
  next: T;
  ms: number;
  /** To another exercise: walking, loading another bar. */
  change: boolean;
  /** Longer than MAX_REST_MS. */
  interruption: boolean;
}

/**
 * The rests of a workout in order: from each work set to the start of the set after it. None after a
 * warm-up set (the next set starts right away), after the last set (it ends at «Terminar») or before
 * a set without a start or done with the rest on screen.
 */
export function restsOf<T extends TimedSet>(sets: readonly T[]): Rest<T>[] {
  const ordered = [...sets].sort((a, b) => a.completedAt - b.completedAt);
  const rests: Rest<T>[] = [];
  for (let i = 0; i < ordered.length - 1; i++) {
    const after = ordered[i];
    const next = ordered[i + 1];
    if (after.isWarmup || next.startedAt === null || isImplausibleSet(next)) continue;
    const ms = next.startedAt - after.completedAt;
    if (ms < 0) continue;
    rests.push({ after, next, ms, change: next.slotId !== after.slotId, interruption: ms > MAX_REST_MS });
  }
  return rests;
}

/**
 * How long an exercise took: from the start of its first set (warm-ups included) to its last
 * «Serie hecha», rests in between included. Null without a recorded start.
 */
export function exerciseSpan(sets: readonly TimedSet[]): number | null {
  if (sets.length === 0) return null;
  const ordered = [...sets].sort((a, b) => a.completedAt - b.completedAt);
  const first = ordered[0];
  if (first.startedAt === null) return null;
  return ordered[ordered.length - 1].completedAt - first.startedAt;
}

/** The warm-up of a session, once it ended; null without one or for one shorter than 30 s. */
export function warmupDuration(session: { warmupStartedAt: number | null; warmupEndedAt: number | null }): number | null {
  const { warmupStartedAt: start, warmupEndedAt: end } = session;
  if (start === null || end === null || end - start < MIN_WARMUP_MS) return null;
  return end - start;
}

/** The middle value (the mean of the two middle ones with an even count); null without values. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** A rest between two sets of the same exercise that was not an interruption: the ones the medians use. */
export const isRestBetweenSets = (rest: Rest) => !rest.change && !rest.interruption;

export interface RestStats {
  /** Median of the rests between sets; null without any. */
  medianMs: number | null;
  count: number;
  /** Median of (real − planned) over the rests whose set kept its plan; null without any. */
  overPlanMs: number | null;
}

export function restStats(rests: readonly Rest[]): RestStats {
  const between = rests.filter(isRestBetweenSets);
  const withPlan = between.filter((r) => r.after.restSeconds !== null);
  return {
    medianMs: median(between.map((r) => r.ms)),
    count: between.length,
    overPlanMs: median(withPlan.map((r) => r.ms - r.after.restSeconds! * 1000)),
  };
}

export interface SessionTimes {
  warmupMs: number | null;
  rests: RestStats;
  /** Rests longer than 10 min, left out of the median. */
  interruptions: number[];
}

/** The times of one workout for its summary: null and empty when it has none. */
export function sessionTimes(
  session: { warmupStartedAt: number | null; warmupEndedAt: number | null },
  sets: readonly TimedSet[],
): SessionTimes {
  const rests = restsOf(sets);
  return {
    warmupMs: warmupDuration(session),
    rests: restStats(rests),
    interruptions: rests.filter((r) => !r.change && r.interruption).map((r) => r.ms),
  };
}

/**
 * Of one exercise in a workout: how long it took and its rests between sets, in order. With a single
 * set there is no span: it would be the time of that set, which is not shown (it includes loading the
 * bar and would read as time under tension).
 */
export function exerciseTimes(slotId: number, sets: readonly TimedSet[]): { spanMs: number | null; rests: number[] } {
  const own = sets.filter((s) => s.slotId === slotId);
  return {
    spanMs: own.length >= 2 ? exerciseSpan(own) : null,
    rests: restsOf(sets)
      .filter((r) => !r.change && r.after.slotId === slotId)
      .map((r) => r.ms),
  };
}

/**
 * How long a workout took: from its start to «Terminar» or, when that came more than 15 min after the
 * last set (it was left open), to the last set.
 */
export function workoutDuration(startedAt: number, finishedAt: number, lastSetAt: number | null): number {
  const last = Math.max(startedAt, lastSetAt ?? startedAt);
  return (finishedAt - last > LATE_FINISH_MS ? last : finishedAt) - startedAt;
}

/** A rest to the second: «2:41» (rounded, not up as a countdown). */
export const formatRest = (ms: number) => formatClock(Math.round(ms / 1000) * 1000);

/** «18 s más que el plan», «1:05 menos que el plan» or «igual que el plan». */
export function formatOverPlan(ms: number): string {
  if (Math.abs(ms) < SAME_AS_PLAN_MS) return 'igual que el plan';
  const seconds = Math.round(Math.abs(ms) / 1000);
  const amount = seconds < 60 ? `${seconds}${NBSP}s` : formatRest(Math.abs(ms));
  return `${amount} ${ms > 0 ? 'más' : 'menos'} que el plan`;
}

/** How many recent timed workouts the progress of an exercise reads its rest from. */
export const PROGRESS_REST_SESSIONS = 8;

/**
 * The rest between sets of one exercise across workouts (newest first): the median over the latest
 * workouts that measured one, how many they were and the rest planned the last time.
 */
export function exerciseRestAcross<T extends TimedSet>(
  workouts: readonly (readonly T[])[],
  isOfExercise: (set: T) => boolean,
): { medianMs: number | null; sessions: number; planSeconds: number | null } {
  const perWorkout = workouts
    .map((sets) => restsOf(sets).filter((r) => isOfExercise(r.after) && isRestBetweenSets(r)))
    .filter((rests) => rests.length > 0)
    .slice(0, PROGRESS_REST_SESSIONS);
  const latest = perWorkout[0]?.at(-1);
  return {
    medianMs: median(perWorkout.flat().map((r) => r.ms)),
    sessions: perWorkout.length,
    planSeconds: latest?.after.restSeconds ?? null,
  };
}
