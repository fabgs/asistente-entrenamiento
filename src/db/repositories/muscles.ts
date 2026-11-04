import {
  musclesFromRows,
  NO_MUSCLES,
  totalSets,
  weekBefore,
  weekSoFar,
  withoutMuscles,
  type ExerciseMuscles,
  type ExerciseSets,
} from '@/domain/muscles';
import type { Db } from '../db';

type MuscleRow = { exerciseId: number; muscle: string; role: string };

/** Muscles of every exercise that has any, archived ones included (their sets still count). */
export async function allExerciseMuscles(db: Db): Promise<Map<number, ExerciseMuscles>> {
  const rows = await db.getAllAsync<MuscleRow>(
    'SELECT exercise_id AS exerciseId, muscle, role FROM exercise_muscle ORDER BY exercise_id',
  );
  const byExercise = new Map<number, MuscleRow[]>();
  for (const row of rows) byExercise.set(row.exerciseId, [...(byExercise.get(row.exerciseId) ?? []), row]);
  return new Map([...byExercise].map(([id, list]) => [id, musclesFromRows(list)]));
}

export async function getExerciseMuscles(db: Db, exerciseId: number): Promise<ExerciseMuscles> {
  const rows = await db.getAllAsync<MuscleRow>(
    'SELECT exercise_id AS exerciseId, muscle, role FROM exercise_muscle WHERE exercise_id = ?',
    exerciseId,
  );
  return rows.length > 0 ? musclesFromRows(rows) : NO_MUSCLES;
}

/** Replaces the exercise's muscles; a muscle in both lists stays primary. */
export async function setExerciseMuscles(db: Db, exerciseId: number, muscles: ExerciseMuscles): Promise<void> {
  await db.runAsync('DELETE FROM exercise_muscle WHERE exercise_id = ?', exerciseId);
  const secondary = muscles.secondary.filter((m) => !muscles.primary.includes(m));
  for (const [list, role] of [
    [muscles.primary, 'primary'],
    [secondary, 'secondary'],
  ] as const) {
    for (const muscle of list) {
      await db.runAsync('INSERT INTO exercise_muscle (exercise_id, muscle, role) VALUES (?, ?, ?)', exerciseId, muscle, role);
    }
  }
}

/**
 * Work sets per exercise of the finished workouts between two local dates (both included): warm-up
 * sets and sets without reps do not count; extra sets and loose workouts do.
 */
export async function workSetsBetween(db: Db, from: string, to: string): Promise<{ exerciseId: number; sets: number }[]> {
  return db.getAllAsync<{ exerciseId: number; sets: number }>(
    `SELECT s.exercise_id AS exerciseId, COUNT(*) AS sets
     FROM set_log s JOIN workout_session w ON w.id = s.session_id
     WHERE w.status = 'finished' AND w.date BETWEEN ? AND ? AND s.is_warmup = 0 AND s.reps > 0
     GROUP BY s.exercise_id`,
    from,
    to,
  );
}

export interface MuscleWeekData {
  done: ExerciseSets[];
  planned: ExerciseSets[];
  /** Real sets of last week, for a Monday with nothing done yet. */
  lastWeek: number;
  musclesOf: Map<number, ExerciseMuscles>;
  /** Exercises of the catalog in the plan or done this week without a primary muscle: their sets count nowhere. */
  unmapped: number[];
  names: Map<number, string>;
}

/** Everything the muscles of «esta semana» need (Perfil and its detail). */
export async function loadMuscleWeek(db: Db, today: string): Promise<MuscleWeekData> {
  const week = weekSoFar(today);
  const before = weekBefore(today);
  const done = await workSetsBetween(db, week.from, week.to);
  const planned = await plannedWeekSets(db);
  const musclesOf = await allExerciseMuscles(db);
  const exercises = await db.getAllAsync<{ id: number; name: string; archived: number }>(
    'SELECT id, name, archived FROM exercise',
  );
  const active = new Set(exercises.filter((e) => e.archived === 0).map((e) => e.id));
  return {
    done,
    planned,
    lastWeek: totalSets(await workSetsBetween(db, before.from, before.to)),
    musclesOf,
    unmapped: withoutMuscles([...planned, ...done].map((s) => s.exerciseId), musclesOf).filter((id) => active.has(id)),
    names: new Map(exercises.map((e) => [e.id, e.name])),
  };
}

/** Sets a week of the plan per exercise: each active slot's sets times the days of its routine. */
export async function plannedWeekSets(db: Db): Promise<{ exerciseId: number; sets: number }[]> {
  return db.getAllAsync<{ exerciseId: number; sets: number }>(
    `SELECT rs.exercise_id AS exerciseId, SUM(rs.sets * d.days) AS sets
     FROM routine_slot rs
     JOIN routine r ON r.id = rs.routine_id
     JOIN (SELECT routine_id, COUNT(*) AS days FROM routine_weekday GROUP BY routine_id) d ON d.routine_id = r.id
     WHERE r.archived = 0 AND rs.archived = 0
     GROUP BY rs.exercise_id`,
  );
}
