import type { ExerciseType } from '@/domain/types';
import type { Db } from '../db';

export interface Exercise {
  id: number;
  name: string;
  type: ExerciseType;
  equipment: string | null;
  incrementKg: number | null;
  notes: string | null;
  /** Done with two dumbbells: the weight is that of each one, and the volume counts both. */
  pair: boolean;
}

export type ExerciseFields = Omit<Exercise, 'id'>;

const SELECT = `
  SELECT id, name, type, equipment, increment_kg AS incrementKg, notes, pair
  FROM exercise`;

type ExerciseRow = Omit<Exercise, 'pair'> & { pair: number };
const toExercise = (row: ExerciseRow): Exercise => ({ ...row, pair: row.pair === 1 });

export async function listExercises(db: Db): Promise<Exercise[]> {
  return (await db.getAllAsync<ExerciseRow>(`${SELECT} WHERE archived = 0 ORDER BY name COLLATE NOCASE`)).map(toExercise);
}

export async function getExercise(db: Db, id: number): Promise<Exercise | null> {
  const row = await db.getFirstAsync<ExerciseRow>(`${SELECT} WHERE id = ?`, id);
  return row ? toExercise(row) : null;
}

/** True when another active exercise already uses this name (case-insensitive). */
export async function exerciseNameTaken(db: Db, name: string, exceptId?: number): Promise<boolean> {
  const row = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM exercise WHERE name = ? COLLATE NOCASE AND archived = 0 AND id IS NOT ?',
    name.trim(),
    exceptId ?? null,
  );
  return row !== null;
}

/** Creates an exercise; an archived one with the same name is brought back instead. */
export async function createExercise(db: Db, fields: ExerciseFields): Promise<number> {
  const name = fields.name.trim();
  const archived = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM exercise WHERE name = ? COLLATE NOCASE AND archived = 1',
    name,
  );
  if (archived) {
    await updateExercise(db, archived.id, { ...fields, name });
    await db.runAsync('UPDATE exercise SET archived = 0 WHERE id = ?', archived.id);
    return archived.id;
  }
  const result = await db.runAsync(
    'INSERT INTO exercise (name, type, equipment, increment_kg, notes, pair) VALUES (?, ?, ?, ?, ?, ?)',
    name,
    fields.type,
    fields.equipment,
    fields.incrementKg,
    fields.notes,
    fields.pair ? 1 : 0,
  );
  return result.lastInsertRowId;
}

export async function updateExercise(db: Db, id: number, fields: ExerciseFields): Promise<void> {
  await db.runAsync(
    'UPDATE exercise SET name = ?, type = ?, equipment = ?, increment_kg = ?, notes = ?, pair = ? WHERE id = ?',
    fields.name.trim(),
    fields.type,
    fields.equipment,
    fields.incrementKg,
    fields.notes,
    fields.pair ? 1 : 0,
    id,
  );
}

/** Hides it from the catalog; routines that use it and its history are not touched. */
export async function archiveExercise(db: Db, id: number): Promise<void> {
  await db.runAsync('UPDATE exercise SET archived = 1 WHERE id = ?', id);
}
