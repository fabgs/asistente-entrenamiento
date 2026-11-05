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

/** The hidden (archived) routine that holds the slots of exercises done loose and in no routine. */
export const LOOSE_ROUTINE = 'Ejercicios sueltos';

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
  /** Two dumbbells of `weightKg` each (see Exercise.pair). */
  exercisePair: boolean;
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
  /** Its routine is the hidden one of loose exercises (looseSlotFor): it belongs to no routine. */
  looseOnly?: boolean;
}

interface SlotRow {
  id: number;
  routine_id: number;
  exercise_id: number;
  exercise_name: string;
  exercise_type: ExerciseType;
  exercise_increment_kg: number | null;
  exercise_pair: number;
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
  loose_only: number;
}

const SLOT_SELECT = `
  SELECT s.*, e.name AS exercise_name, e.type AS exercise_type, e.increment_kg AS exercise_increment_kg,
         e.pair AS exercise_pair, (r.archived = 1 AND r.name = '${LOOSE_ROUTINE}') AS loose_only
  FROM routine_slot s JOIN exercise e ON e.id = s.exercise_id JOIN routine r ON r.id = s.routine_id`;

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
    exercisePair: bool(row.exercise_pair),
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
    looseOnly: bool(row.loose_only),
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

/** Slots by id, in the order of `ids`; missing ones are skipped (with `activeOnly`, also archived ones). */
export async function listSlotsByIds(db: Db, ids: readonly number[], activeOnly = false): Promise<Slot[]> {
  if (ids.length === 0) return [];
  const rows = await db.getAllAsync<SlotRow>(
    `${SLOT_SELECT} WHERE s.id IN (${ids.map(() => '?').join(', ')})${activeOnly ? ' AND s.archived = 0' : ''}`,
    ...ids,
  );
  const byId = new Map(rows.map((r) => [r.id, toSlot(r)]));
  return ids.map((id) => byId.get(id)).filter((s): s is Slot => s !== undefined);
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

/** Puts a routine on one weekday or takes it off, without touching its other days (editor of a day). */
export async function setRoutineOnWeekday(db: Db, routineId: number, weekday: IsoWeekday, on: boolean): Promise<void> {
  if (on) {
    await db.runAsync('INSERT OR IGNORE INTO routine_weekday (routine_id, weekday) VALUES (?, ?)', routineId, weekday);
  } else {
    await db.runAsync('DELETE FROM routine_weekday WHERE routine_id = ? AND weekday = ?', routineId, weekday);
  }
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

/** What `updateSlotPrescription` writes, as the slot has it now: the starting point of its editor. */
export function prescriptionOf(slot: Slot): SlotPrescription {
  return {
    sets: slot.sets,
    target: slot.target,
    perSide: slot.perSide,
    unit: slot.unit,
    progression: slot.progression,
    allowDecrease: slot.allowDecrease,
    incrementKg: slot.incrementKg,
    restSeconds: slot.restSeconds,
    note: slot.note,
  };
}

/**
 * True when both prescriptions save the same (the editor's «Guardar» stays off until they differ).
 * Notes are compared as the editor saves them: trimmed, and empty as none.
 */
export function samePrescription(a: SlotPrescription, b: SlotPrescription): boolean {
  const key = (p: SlotPrescription) =>
    JSON.stringify([
      p.sets,
      targetColumns(p.target),
      p.perSide,
      p.unit,
      p.progression,
      p.allowDecrease,
      p.incrementKg,
      p.restSeconds,
      p.note?.trim() || null,
    ]);
  return key(a) === key(b);
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


/**
 * The slot to do an exercise loose with («Ejercicio suelto»): the one of an active routine (the last
 * one used, if it is in several) or, for an exercise in no routine, its own slot in the hidden
 * LOOSE_ROUTINE, created the first time with 3 × 8–12 and the heaviest set of the last time it was
 * done (not a lighter back-off set at the end); that slot
 * keeps its weight and suggestions for the next time. Never one of another archived routine (the
 * imported history keeps its own).
 */
export async function looseSlotFor(db: Db, exercise: { id: number; type: ExerciseType }): Promise<number> {
  const inRoutine = await db.getFirstAsync<{ id: number }>(
    `SELECT rs.id FROM routine_slot rs JOIN routine r ON r.id = rs.routine_id
     WHERE rs.exercise_id = ? AND rs.archived = 0 AND r.archived = 0
     ORDER BY COALESCE((SELECT MAX(sl.completed_at) FROM set_log sl WHERE sl.slot_id = rs.id), 0) DESC, r.position, rs.position
     LIMIT 1`,
    exercise.id,
  );
  if (inRoutine) return inRoutine.id;
  const loose = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM routine WHERE name = ? AND archived = 1 ORDER BY id LIMIT 1',
    LOOSE_ROUTINE,
  );
  if (loose) {
    const own = await db.getFirstAsync<{ id: number }>(
      'SELECT id FROM routine_slot WHERE routine_id = ? AND exercise_id = ? AND archived = 0',
      loose.id,
      exercise.id,
    );
    if (own) return own.id;
  }
  const routineId =
    loose?.id ?? (await db.runAsync('INSERT INTO routine (name, position, archived) VALUES (?, 999, 1)', LOOSE_ROUTINE)).lastInsertRowId;
  const slotId = await addSlot(db, routineId, exercise);
  const last = await db.getFirstAsync<{ kg: number | null }>(
    `SELECT MAX(weight_kg) AS kg FROM set_log
     WHERE exercise_id = ? AND is_warmup = 0
       AND session_id = (SELECT session_id FROM set_log WHERE exercise_id = ? AND is_warmup = 0 ORDER BY completed_at DESC LIMIT 1)`,
    exercise.id,
    exercise.id,
  );
  if (last?.kg) await db.runAsync('UPDATE routine_slot SET weight_kg = ? WHERE id = ?', last.kg, slotId);
  return slotId;
}
