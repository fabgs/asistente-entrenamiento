import { cardioKey } from '@/domain/cardioPool';
import { normalizeForSearch } from '@/domain/format';
import { decodeSamples } from '@/domain/gps';
import {
  exerciseBest,
  longestWalkText,
  sessionHasRecord,
  usualUnit,
  walkRecords,
  workoutsPerWeek,
  type ExerciseBest,
  type RecordSet,
  type WalkRecords,
  type WalkRow,
} from '@/domain/records';
import type { ExerciseType, RepUnit } from '@/domain/types';
import {
  MAX_WARMUP_MS,
  median,
  restsOf,
  restStats,
  warmupDuration,
  workoutDuration,
  type RestStats,
  type TimedSet,
} from '@/domain/workoutTimes';
import { bool, type Db } from '../db';
import { getCardio } from './cardio';
import { listRoutines, listSlots } from './routines';
import { routeRecordOf } from './routes';

/** What the row of Perfil says: «370 entrenos · 5100 series». */
export async function workoutCounts(db: Db): Promise<{ workouts: number; sets: number }> {
  const row = await db.getFirstAsync<{ workouts: number; sets: number }>(
    `SELECT (SELECT COUNT(*) FROM workout_session WHERE status = 'finished') AS workouts,
            (SELECT COUNT(*) FROM set_log s JOIN workout_session w ON w.id = s.session_id
             WHERE w.status = 'finished' AND s.is_warmup = 0 AND s.reps > 0) AS sets`,
  );
  return { workouts: row?.workouts ?? 0, sets: row?.sets ?? 0 };
}

export interface ExerciseRecordRow {
  exerciseId: number;
  name: string;
  type: ExerciseType;
  pair: boolean;
  unit: RepUnit;
  best: ExerciseBest;
  /** The weight of its slot now (an exercise of the routines); undefined for the others. */
  slotWeightKg?: number | null;
}

export interface RecordsData {
  totals: { workouts: number; imported: number; since: string | null; sets: number; reps: number };
  years: { year: string; workouts: number; sets: number; perWeek: number }[];
  /** The exercises of the active routines, in their order. */
  routines: ExerciseRecordRow[];
  /** Those with sets in no active routine (archived, from the notes, loose), alphabetically. */
  others: ExerciseRecordRow[];
  times: {
    /** Median duration of the workouts of each active routine that were not imported. */
    routines: { id: number; name: string; medianMs: number; count: number }[];
    warmup: { medianMs: number; count: number } | null;
    rests: RestStats;
    /** The first day with a warm-up or a set with its start recorded. */
    since: string | null;
  };
  walks: WalkRecords[];
}

/** Everything of Récords (PLAN.md §6.6), up to `today`. */
export async function loadRecords(db: Db, today: string): Promise<RecordsData> {
  const sets = (
    await db.getAllAsync<Omit<RecordSet, 'imported'> & { imported: number }>(
      `SELECT s.exercise_id AS exerciseId, s.session_id AS sessionId, w.date, w.started_at AS startedAt, w.imported,
              COALESCE(rs.unit, 'reps') AS unit, s.weight_kg AS weightKg, s.reps
       FROM set_log s
       JOIN workout_session w ON w.id = s.session_id
       LEFT JOIN routine_slot rs ON rs.id = s.slot_id
       WHERE w.status = 'finished' AND s.is_warmup = 0 AND s.reps > 0`,
    )
  ).map((r) => ({ ...r, imported: bool(r.imported) }));
  const workouts = await db.getFirstAsync<{ workouts: number; imported: number | null; since: string | null }>(
    `SELECT COUNT(*) AS workouts, SUM(imported) AS imported, MIN(date) AS since FROM workout_session WHERE status = 'finished'`,
  );
  const perYear = await db.getAllAsync<{ year: string; workouts: number }>(
    `SELECT substr(date, 1, 4) AS year, COUNT(*) AS workouts FROM workout_session
     WHERE status = 'finished' GROUP BY year ORDER BY year DESC`,
  );
  const since = workouts?.since ?? null;

  return {
    totals: {
      workouts: workouts?.workouts ?? 0,
      imported: workouts?.imported ?? 0,
      since,
      sets: sets.length,
      // A hold of 7 min would add 420.
      reps: sets.reduce((sum, s) => sum + (s.unit === 'reps' ? s.reps : 0), 0),
    },
    years: perYear.map(({ year, workouts: count }) => ({
      year,
      workouts: count,
      sets: sets.filter((s) => s.date.startsWith(year)).length,
      perWeek: workoutsPerWeek(count, year, since ?? `${year}-01-01`, today),
    })),
    ...(await exerciseRecords(db, sets)),
    times: await timeRecords(db),
    walks: await walks(db),
  };
}

async function exerciseRecords(db: Db, sets: RecordSet[]): Promise<Pick<RecordsData, 'routines' | 'others'>> {
  const exercises = new Map(
    (await db.getAllAsync<{ id: number; name: string; type: ExerciseType; pair: number }>('SELECT id, name, type, pair FROM exercise')).map(
      (e) => [e.id, e],
    ),
  );
  const setsOf = new Map<number, RecordSet[]>();
  for (const set of sets) {
    const list = setsOf.get(set.exerciseId);
    if (list) list.push(set);
    else setsOf.set(set.exerciseId, [set]);
  }

  const row = (exerciseId: number, unit: RepUnit, slotWeightKg?: number | null): ExerciseRecordRow | null => {
    const exercise = exercises.get(exerciseId);
    const best = exerciseBest(setsOf.get(exerciseId) ?? [], unit);
    if (!exercise || !best) return null;
    return { exerciseId, name: exercise.name, type: exercise.type, pair: bool(exercise.pair), unit, best, slotWeightKg };
  };

  // In the order of Rutinas and of their exercises; an exercise in two routines, at its first place.
  const inRoutines: { exerciseId: number; unit: RepUnit; weightKg: number | null }[] = [];
  for (const routine of await listRoutines(db)) {
    for (const slot of await listSlots(db, routine.id)) {
      if (!inRoutines.some((e) => e.exerciseId === slot.exerciseId)) {
        inRoutines.push({ exerciseId: slot.exerciseId, unit: slot.unit, weightKg: slot.weightKg });
      }
    }
  }
  const routines = inRoutines.map((e) => row(e.exerciseId, e.unit, e.weightKg)).filter((r): r is ExerciseRecordRow => r !== null);
  const others = [...setsOf.keys()]
    .filter((id) => !inRoutines.some((e) => e.exerciseId === id))
    .map((id) => row(id, usualUnit(setsOf.get(id)!)))
    .filter((r): r is ExerciseRecordRow => r !== null)
    .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
  return { routines, others };
}

async function timeRecords(db: Db): Promise<RecordsData['times']> {
  const routines: RecordsData['times']['routines'] = [];
  for (const routine of await listRoutines(db)) {
    const sessions = await db.getAllAsync<{ startedAt: number; finishedAt: number; lastSetAt: number | null }>(
      `SELECT ws.started_at AS startedAt, ws.finished_at AS finishedAt,
              (SELECT MAX(completed_at) FROM set_log WHERE session_id = ws.id) AS lastSetAt
       FROM workout_session ws
       WHERE ws.routine_id = ? AND ws.status = 'finished' AND ws.imported = 0 AND ws.finished_at IS NOT NULL`,
      routine.id,
    );
    const durations = sessions.filter((s) => s.lastSetAt !== null).map((s) => workoutDuration(s.startedAt, s.finishedAt, s.lastSetAt));
    const medianMs = median(durations);
    if (medianMs !== null) routines.push({ id: routine.id, name: routine.name, medianMs, count: durations.length });
  }

  const warmups = (
    await db.getAllAsync<{ warmupStartedAt: number; warmupEndedAt: number | null }>(
      `SELECT warmup_started_at AS warmupStartedAt, warmup_ended_at AS warmupEndedAt FROM workout_session
       WHERE status = 'finished' AND warmup_started_at IS NOT NULL`,
    )
  )
    .map(warmupDuration)
    .filter((ms): ms is number => ms !== null && ms <= MAX_WARMUP_MS);
  const warmupMedian = median(warmups);

  const timed = await db.getAllAsync<Omit<TimedSet, 'isWarmup'> & { sessionId: number; isWarmup: number }>(
    `SELECT s.session_id AS sessionId, s.slot_id AS slotId, s.is_warmup AS isWarmup, s.reps, s.started_at AS startedAt,
            s.completed_at AS completedAt, s.rest_seconds AS restSeconds
     FROM set_log s JOIN workout_session w ON w.id = s.session_id
     WHERE w.status = 'finished'
       AND s.session_id IN (SELECT DISTINCT session_id FROM set_log WHERE started_at IS NOT NULL)
     ORDER BY s.session_id, s.completed_at, s.id`,
  );
  const bySession = new Map<number, TimedSet[]>();
  for (const { sessionId, ...row } of timed) {
    const set = { ...row, isWarmup: bool(row.isWarmup) };
    const list = bySession.get(sessionId);
    if (list) list.push(set);
    else bySession.set(sessionId, [set]);
  }

  const first = await db.getFirstAsync<{ date: string | null }>(
    `SELECT MIN(w.date) AS date FROM workout_session w
     WHERE w.status = 'finished'
       AND (w.warmup_started_at IS NOT NULL OR EXISTS (SELECT 1 FROM set_log s WHERE s.session_id = w.id AND s.started_at IS NOT NULL))`,
  );
  return {
    routines,
    warmup: warmupMedian !== null ? { medianMs: warmupMedian, count: warmups.length } : null,
    rests: restStats([...bySession.values()].flatMap((sessionSets) => restsOf(sessionSets))),
    since: first?.date ?? null,
  };
}

/** Every finished GPS walk, with the key of its activity. */
async function walkRows(db: Db): Promise<WalkRow[]> {
  const rows = await db.getAllAsync<{
    id: number;
    activityId: number | null;
    name: string;
    date: string;
    startedAt: number;
    distanceM: number | null;
    samples: string | null;
  }>(
    `SELECT id, activity_id AS activityId, name, date, started_at AS startedAt, distance_m AS distanceM, samples
     FROM cardio_session WHERE status = 'finished' AND tracking = 'gps'`,
  );
  // The same activity planned on several days is one (cardioKey); a deleted one goes by its name.
  const keys = new Map<number, { key: string; name: string } | null>();
  for (const id of new Set(rows.map((r) => r.activityId).filter((id): id is number => id !== null))) {
    const activity = await getCardio(db, id);
    keys.set(id, activity ? { key: cardioKey(activity), name: activity.name } : null);
  }
  return rows.map((r) => {
    const activity = r.activityId !== null ? keys.get(r.activityId) : null;
    return {
      id: r.id,
      key: activity?.key ?? `name:${normalizeForSearch(r.name.trim())}`,
      name: activity?.name ?? r.name,
      date: r.date,
      startedAt: r.startedAt,
      distanceM: r.distanceM,
      samples: decodeSamples(r.samples),
    };
  });
}

const walks = async (db: Db): Promise<WalkRecords[]> => walkRecords(await walkRows(db));

const RECORD_SET_SELECT = `SELECT s.exercise_id AS exerciseId, s.session_id AS sessionId, w.date, w.started_at AS startedAt, w.imported,
              COALESCE(rs.unit, 'reps') AS unit, s.weight_kg AS weightKg, s.reps
       FROM set_log s
       JOIN workout_session w ON w.id = s.session_id
       LEFT JOIN routine_slot rs ON rs.id = s.slot_id
       WHERE s.is_warmup = 0 AND s.reps > 0`;

type RecordSetRow = Omit<RecordSet, 'imported'> & { imported: number };

/**
 * What a set about to be logged is compared with (1.4.10, `recordOf`): the work sets of its exercise
 * in the finished workouts, in any routine, and those already done in this one.
 */
export async function recordSetsOf(db: Db, exerciseId: number, sessionId: number): Promise<RecordSet[]> {
  const rows = await db.getAllAsync<RecordSetRow>(
    `${RECORD_SET_SELECT} AND s.exercise_id = ? AND (w.status = 'finished' OR w.id = ?) ORDER BY w.started_at, s.completed_at, s.id`,
    exerciseId,
    sessionId,
  );
  return rows.map((r) => ({ ...r, imported: bool(r.imported) }));
}

/**
 * The exercises with a record in a workout, for the tag of its summary: computed from the sets, so
 * correcting or deleting one moves it. None in an imported workout (its sets are the history).
 */
export async function sessionRecordExercises(db: Db, sessionId: number): Promise<number[]> {
  const session = await db.getFirstAsync<{ date: string; startedAt: number; imported: number }>(
    'SELECT date, started_at AS startedAt, imported FROM workout_session WHERE id = ?',
    sessionId,
  );
  if (!session || session.imported) return [];
  const own = await db.getAllAsync<RecordSetRow>(`${RECORD_SET_SELECT} AND s.session_id = ? ORDER BY s.completed_at, s.id`, sessionId);
  const ids = [...new Set(own.map((s) => s.exerciseId))];
  if (ids.length === 0) return [];
  const before = (
    await db.getAllAsync<RecordSetRow>(
      `${RECORD_SET_SELECT} AND w.status = 'finished' AND s.session_id <> ? AND w.started_at <= ?
         AND s.exercise_id IN (${ids.map(() => '?').join(', ')})`,
      sessionId,
      session.startedAt,
      ...ids,
    )
  ).map((r) => ({ ...r, imported: bool(r.imported) }));
  return ids.filter((exerciseId) =>
    [...new Set(own.filter((s) => s.exerciseId === exerciseId).map((s) => s.unit))].some((unit) =>
      sessionHasRecord(
        before.filter((s) => s.exerciseId === exerciseId),
        own.filter((s) => s.exerciseId === exerciseId && s.unit === unit),
        unit,
        { exerciseId, sessionId, date: session.date, startedAt: session.startedAt },
      ),
    ),
  );
}

/**
 * The notice of a walk just finished, if it is a record (1.4.10): the best time of the route it
 * repeats, or the longest walk of its activity when it repeats none. One at most.
 */
export async function walkRecordText(db: Db, sessionId: number): Promise<string | null> {
  const route = await routeRecordOf(db, sessionId);
  if (route.repeats) return route.text;
  const rows = await walkRows(db);
  const walk = rows.find((w) => w.id === sessionId);
  return walk ? longestWalkText(walk, rows) : null;
}
