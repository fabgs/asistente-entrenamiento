import type {
  ExerciseType,
  IsoWeekday,
  ProgressionKind,
  RepTarget,
  RepUnit,
  SlotRule,
} from '@/domain/types';
import { bool, int, type Db } from '../db';
import { expireOpenChanges } from './weightChanges';

export interface Routine {
  id: number;
  name: string;
  position: number;
  weekdays: IsoWeekday[];
}

export interface Slot {
  id: number;
  routineId: number;
  exerciseId: number;
  exerciseName: string;
  exerciseType: ExerciseType;
  exerciseIncrementKg: number | null;
  position: number;
  weightKg: number | null;
  sets: number;
  target: RepTarget;
  perSide: boolean;
  unit: RepUnit;
  progression: ProgressionKind;
  allowDecrease: boolean;
  incrementKg: number | null;
  restSeconds: number | null;
  note: string | null;
}

interface SlotRow {
  id: number;
  routine_id: number;
  exercise_id: number;
  exercise_name: string;
  exercise_type: ExerciseType;
  exercise_increment_kg: number | null;
  position: number;
  weight_kg: number | null;
  sets: number;
  target_kind: RepTarget['kind'];
  rep_min: number | null;
  rep_max: number | null;
  fixed_reps: number | null;
  failure_minus: number | null;
  per_side: number;
  unit: RepUnit;
  progression: ProgressionKind;
  allow_decrease: number;
  increment_kg: number | null;
  rest_seconds: number | null;
  note: string | null;
}

const SLOT_SELECT = `
  SELECT s.*, e.name AS exercise_name, e.type AS exercise_type, e.increment_kg AS exercise_increment_kg
  FROM routine_slot s JOIN exercise e ON e.id = s.exercise_id`;

function targetOf(row: SlotRow): RepTarget {
  switch (row.target_kind) {
    case 'range':
      return { kind: 'range', min: row.rep_min ?? 0, max: row.rep_max ?? 0 };
    case 'fixed':
      return { kind: 'fixed', reps: row.fixed_reps ?? 0 };
    case 'failure':
      return { kind: 'failure', minus: row.failure_minus ?? 0 };
  }
}

function toSlot(row: SlotRow): Slot {
  return {
    id: row.id,
    routineId: row.routine_id,
    exerciseId: row.exercise_id,
    exerciseName: row.exercise_name,
    exerciseType: row.exercise_type,
    exerciseIncrementKg: row.exercise_increment_kg,
    position: row.position,
    weightKg: row.weight_kg,
    sets: row.sets,
    target: targetOf(row),
    perSide: bool(row.per_side),
    unit: row.unit,
    progression: row.progression,
    allowDecrease: bool(row.allow_decrease),
    incrementKg: row.increment_kg,
    restSeconds: row.rest_seconds,
    note: row.note,
  };
}

/** Columns for target_kind, rep_min, rep_max, fixed_reps, failure_minus. */
export function targetColumns(t: RepTarget): [string, number | null, number | null, number | null, number | null] {
  switch (t.kind) {
    case 'range':
      return ['range', t.min, t.max, null, null];
    case 'fixed':
      return ['fixed', null, null, t.reps, null];
    case 'failure':
      return ['failure', null, null, null, t.minus];
  }
}

export function slotRule(slot: Slot): SlotRule {
  return {
    sets: slot.sets,
    target: slot.target,
    progression: slot.progression,
    allowDecrease: slot.allowDecrease,
    incrementKg: slot.incrementKg,
    weightKg: slot.weightKg,
  };
}

export const isBodyweight = (slot: Slot) => slot.exerciseType === 'bodyweight';

async function attachWeekdays(db: Db, rows: Omit<Routine, 'weekdays'>[]): Promise<Routine[]> {
  const days = await db.getAllAsync<{ routine_id: number; weekday: IsoWeekday }>(
    'SELECT routine_id, weekday FROM routine_weekday ORDER BY weekday',
  );
  return rows.map((r) => ({
    ...r,
    weekdays: days.filter((d) => d.routine_id === r.id).map((d) => d.weekday),
  }));
}

export async function listRoutines(db: Db): Promise<Routine[]> {
  const rows = await db.getAllAsync<Omit<Routine, 'weekdays'>>(
    'SELECT id, name, position FROM routine WHERE archived = 0 ORDER BY position, id',
  );
  return attachWeekdays(db, rows);
}

export async function getRoutine(db: Db, id: number): Promise<Routine | null> {
  const row = await db.getFirstAsync<Omit<Routine, 'weekdays'>>(
    'SELECT id, name, position FROM routine WHERE id = ?',
    id,
  );
  return row ? (await attachWeekdays(db, [row]))[0] : null;
}

export async function routinesForWeekday(db: Db, weekday: IsoWeekday): Promise<Routine[]> {
  return (await listRoutines(db)).filter((r) => r.weekdays.includes(weekday));
}

export async function listSlots(db: Db, routineId: number): Promise<Slot[]> {
  const rows = await db.getAllAsync<SlotRow>(
    `${SLOT_SELECT} WHERE s.routine_id = ? AND s.archived = 0 ORDER BY s.position, s.id`,
    routineId,
  );
  return rows.map(toSlot);
}

export async function getSlot(db: Db, slotId: number): Promise<Slot | null> {
  const row = await db.getFirstAsync<SlotRow>(`${SLOT_SELECT} WHERE s.id = ?`, slotId);
  return row ? toSlot(row) : null;
}

export async function createRoutine(db: Db, name: string): Promise<number> {
  const row = await db.getFirstAsync<{ next: number }>(
    'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM routine',
  );
  const result = await db.runAsync('INSERT INTO routine (name, position) VALUES (?, ?)', name, row?.next ?? 0);
  return result.lastInsertRowId;
}

export async function renameRoutine(db: Db, routineId: number, name: string): Promise<void> {
  await db.runAsync('UPDATE routine SET name = ? WHERE id = ?', name, routineId);
}

export async function setRoutineWeekdays(db: Db, routineId: number, weekdays: IsoWeekday[]): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM routine_weekday WHERE routine_id = ?', routineId);
    for (const weekday of new Set(weekdays)) {
      await db.runAsync('INSERT INTO routine_weekday (routine_id, weekday) VALUES (?, ?)', routineId, weekday);
    }
  });
}

/** Hides the routine; its sessions and history stay. */
export async function archiveRoutine(db: Db, routineId: number): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync('UPDATE routine SET archived = 1 WHERE id = ?', routineId);
    await db.runAsync('DELETE FROM routine_weekday WHERE routine_id = ?', routineId);
  });
}

/** Adds an exercise at the end of a routine with a sensible default prescription. */
export async function addSlot(
  db: Db,
  routineId: number,
  exercise: { id: number; type: ExerciseType },
): Promise<number> {
  const row = await db.getFirstAsync<{ next: number }>(
    'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM routine_slot WHERE routine_id = ? AND archived = 0',
    routineId,
  );
  const result = await db.runAsync(
    `INSERT INTO routine_slot (routine_id, exercise_id, position, weight_kg, sets, target_kind, rep_min, rep_max)
     VALUES (?, ?, ?, ?, 3, 'range', 8, 12)`,
    routineId,
    exercise.id,
    row?.next ?? 0,
    exercise.type === 'bodyweight' ? null : 0,
  );
  return result.lastInsertRowId;
}

export interface SlotPrescription {
  sets: number;
  target: RepTarget;
  perSide: boolean;
  unit: RepUnit;
  progression: ProgressionKind;
  allowDecrease: boolean;
  incrementKg: number | null;
  restSeconds: number | null;
  note: string | null;
}

/** Everything about a slot except its weight, which changes through weightChanges. */
export async function updateSlotPrescription(db: Db, slotId: number, p: SlotPrescription): Promise<void> {
  await db.runAsync(
    `UPDATE routine_slot
     SET sets = ?, target_kind = ?, rep_min = ?, rep_max = ?, fixed_reps = ?, failure_minus = ?, per_side = ?,
         unit = ?, progression = ?, allow_decrease = ?, increment_kg = ?, rest_seconds = ?, note = ?
     WHERE id = ?`,
    p.sets,
    ...targetColumns(p.target),
    int(p.perSide),
    p.unit,
    p.progression,
    int(p.allowDecrease),
    p.incrementKg,
    p.restSeconds,
    p.note,
    slotId,
  );
}

/** Removes the exercise from its routine but keeps the history of its sets. */
export async function archiveSlot(db: Db, slotId: number, now = Date.now()): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync('UPDATE routine_slot SET archived = 1 WHERE id = ?', slotId);
    await expireOpenChanges(db, slotId, now);
  });
}

/** Moves a slot one place up (-1) or down (+1) within its routine. */
export async function moveSlot(db: Db, slotId: number, delta: -1 | 1): Promise<void> {
  const slot = await getSlot(db, slotId);
  if (!slot) return;
  const ids = (await listSlots(db, slot.routineId)).map((s) => s.id);
  const from = ids.indexOf(slotId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= ids.length) return;
  [ids[from], ids[to]] = [ids[to], ids[from]];
  await db.withTransactionAsync(async () => {
    for (const [position, id] of ids.entries()) {
      await db.runAsync('UPDATE routine_slot SET position = ? WHERE id = ?', position, id);
    }
  });
}
